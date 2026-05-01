import * as crypto from 'crypto';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { SessionManager } from './session-manager.js';
import { DirectoryScanner, recentCwdsFromSessions } from './directory-scanner.js';
import { PushService } from './push.js';
import type { WalccyConfig } from './config.js';
import type {
  ClientMessage,
  ServerMessage,
  Session as SessionInfo,
  BufferedLine,
} from '@walccy/protocol';
import logger from './logger.js';
import pkg from '../package.json';

const DAEMON_VERSION: string = pkg.version;

// ──────────────────────────────────────────────
// Connected client state
// ──────────────────────────────────────────────

interface ConnectedClient {
  id: string;
  name: string;
  ws: WebSocket;
  subscribedSessions: Set<string>;
  isAuthenticated: boolean;
  authTimeout?: ReturnType<typeof setTimeout>;
}

// ──────────────────────────────────────────────
// Input lock state per session
// ──────────────────────────────────────────────

interface InputLock {
  clientId: string;
  clientName: string;
  expiresAt: number;
}

const INPUT_LOCK_TTL_MS = 2000;

// ──────────────────────────────────────────────
// WsServer
// ──────────────────────────────────────────────

export class WsServer {
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients: Map<string, ConnectedClient> = new Map();
  private inputLocks: Map<string, InputLock> = new Map();
  private directoryScanner = new DirectoryScanner();

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly config: WalccyConfig,
    private readonly bindAddress: string,
    private readonly pushService?: PushService
  ) {}

  // ────────────────────────────────────────────
  // Lifecycle
  // ────────────────────────────────────────────

  async start(): Promise<void> {
    this.httpServer = http.createServer();
    this.wss = new WebSocketServer({
      server: this.httpServer,
      maxPayload: 1024 * 1024, // 1 MB max message size
    });

    this.wss.on('connection', (ws: WebSocket) => {
      this._handleConnection(ws);
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(this.config.port, this.bindAddress, () => {
        logger.info(
          `WebSocket server listening on ws://${this.bindAddress}:${this.config.port}`
        );
        resolve();
      });
      this.httpServer!.once('error', reject);
    });

    // Wire session manager events to broadcasts
    this.sessionManager.on('session-added', (session: SessionInfo) => {
      this.broadcastSessionAdded(session);
    });

    this.sessionManager.on('session-removed', (sessionId: string) => {
      this.broadcastSessionRemoved(sessionId);
    });

    this.sessionManager.on(
      'session-updated',
      (sessionId: string, changes: Partial<SessionInfo>) => {
        this.broadcastSessionUpdated(sessionId, changes);
      }
    );

    // Note: No need to wire existing sessions here — the scanner hasn't
    // started yet so getAllSessions() is always empty at this point.
    // New sessions are wired in broadcastSessionAdded().
  }

  stop(): void {
    this.wss?.close();
    this.httpServer?.close();
    logger.info('WebSocket server stopped');
  }

  // ────────────────────────────────────────────
  // Broadcast helpers
  // ────────────────────────────────────────────

  /** Track sessions that already have a data listener wired to avoid duplicates. */
  private wiredSessions: Set<string> = new Set();
  /**
   * Per-session pending OUTPUT line queue. We coalesce bursts of PTY data
   * (which can arrive as 50-chunk bursts per visible block) into a single
   * OUTPUT broadcast per turn of the event loop.
   */
  private pendingOutput: Map<string, BufferedLine[]> = new Map();
  private outputScheduled: Set<string> = new Set();

  broadcastSessionAdded(session: SessionInfo): void {
    const msg: ServerMessage = { type: 'SESSION_ADDED', session };
    this._broadcastAll(msg);

    // Wire output events for newly added sessions (guard against duplicate listeners)
    if (!this.wiredSessions.has(session.id)) {
      const sessionObj = this.sessionManager.getSession(session.id);
      if (sessionObj) {
        this.wiredSessions.add(session.id);
        const sessionId = session.id;
        sessionObj.on('data', (lines: BufferedLine[]) => {
          if (lines.length === 0) return;
          let queue = this.pendingOutput.get(sessionId);
          if (!queue) {
            queue = [];
            this.pendingOutput.set(sessionId, queue);
          }
          for (const l of lines) queue.push(l);

          if (!this.outputScheduled.has(sessionId)) {
            this.outputScheduled.add(sessionId);
            setImmediate(() => {
              this.outputScheduled.delete(sessionId);
              const batch = this.pendingOutput.get(sessionId);
              this.pendingOutput.delete(sessionId);
              if (!batch || batch.length === 0) return;
              this.broadcastOutput(sessionId, batch);
            });
          }
        });
      }
    }
  }

  broadcastSessionRemoved(sessionId: string): void {
    const msg: ServerMessage = { type: 'SESSION_REMOVED', sessionId };
    this._broadcastAll(msg);
    // Clean up wired session, pending OUTPUT queue, expired input lock
    this.wiredSessions.delete(sessionId);
    this.pendingOutput.delete(sessionId);
    this.outputScheduled.delete(sessionId);
    this.inputLocks.delete(sessionId);
  }

  broadcastSessionUpdated(
    sessionId: string,
    changes: Partial<SessionInfo>
  ): void {
    const msg: ServerMessage = { type: 'SESSION_UPDATED', sessionId, changes };
    this._broadcastAll(msg);

    // Send FCM push when a session starts waiting for input
    if (changes.waitingForInput === true && this.pushService?.isEnabled) {
      const session = this.sessionManager.getSession(sessionId);
      const name = session?.info.name ?? 'Claude';
      this.pushService.sendToAll(
        `${name} needs input`,
        'Claude has finished its task and is waiting for your response.',
        { sessionId }
      ).catch((err) => {
        logger.warn(`FCM push error: ${String(err)}`);
      });
    }
  }

  broadcastOutput(sessionId: string, lines: BufferedLine[]): void {
    const msg: ServerMessage = { type: 'OUTPUT', sessionId, lines };
    this._broadcastToSession(sessionId, msg);
  }

  // ────────────────────────────────────────────
  // Connection handling
  // ────────────────────────────────────────────

  private _handleConnection(ws: WebSocket): void {
    const clientId = uuidv4();
    const client: ConnectedClient = {
      id: clientId,
      name: '',
      ws,
      subscribedSessions: new Set(),
      isAuthenticated: false,
    };

    this.clients.set(clientId, client);
    logger.debug(`WS client connected: ${clientId}`);

    ws.on('message', (raw: Buffer | string) => {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      let msg: unknown;
      try {
        msg = JSON.parse(text);
      } catch {
        logger.warn(`WS client ${clientId}: invalid JSON, closing`);
        this._sendError(ws, 'PARSE_ERROR', 'Invalid JSON');
        ws.close(1002, 'Invalid JSON');
        return;
      }

      this._handleMessage(client, msg);
    });

    ws.on('close', () => {
      // Note: client.id may have been rebound during AUTH to the device-side
      // persistent id. Always use client.id (current) for cleanup so the
      // push-token entry registered post-AUTH is removed correctly.
      logger.debug(`WS client disconnected: ${client.id}`);
      for (const sessionId of client.subscribedSessions) {
        this.sessionManager.removeClientFromSession(sessionId, client.id);
      }
      this.pushService?.unregisterClient(client.id);
      this.clients.delete(client.id);
    });

    ws.on('error', (err: Error) => {
      logger.warn(`WS client ${clientId} error: ${err.message}`);
    });

    // Set a 10-second auth timeout — cleared once authenticated
    const authTimeout = setTimeout(() => {
      if (!client.isAuthenticated) {
        logger.warn(`WS client ${clientId}: auth timeout, closing`);
        ws.close(1008, 'Auth timeout');
      }
    }, 10000);
    authTimeout.unref();
    client.authTimeout = authTimeout;
  }

  private _handleMessage(client: ConnectedClient, msg: unknown): void {
    if (typeof msg !== 'object' || msg === null || !('type' in msg)) {
      this._sendError(client.ws, 'INVALID_MESSAGE', 'Missing type field');
      return;
    }

    const typed = msg as ClientMessage;

    // Validate required fields based on message type
    if (!this._validateMessage(typed)) {
      this._sendError(client.ws, 'INVALID_MESSAGE', 'Invalid message fields');
      return;
    }

    // AUTH must be first
    if (!client.isAuthenticated) {
      if (typed.type !== 'AUTH') {
        this._sendError(client.ws, 'NOT_AUTHENTICATED', 'Send AUTH first');
        client.ws.close(1008, 'Not authenticated');
        return;
      }
      this._handleAuth(client, typed);
      return;
    }

    switch (typed.type) {
      case 'AUTH':
        // Already authenticated — ignore
        break;
      case 'LIST_SESSIONS':
        this._handleListSessions(client);
        break;
      case 'SUBSCRIBE':
        this._handleSubscribe(client, typed);
        break;
      case 'UNSUBSCRIBE':
        this._handleUnsubscribe(client, typed);
        break;
      case 'INPUT':
        this._handleInput(client, typed);
        break;
      case 'RESIZE':
        this._handleResize(client, typed);
        break;
      case 'PING':
        this._handlePing(client);
        break;
      case 'REGISTER_PUSH_TOKEN':
        this._handleRegisterPushToken(client, typed);
        break;
      case 'LIST_DIRECTORIES':
        this._handleListDirectories(client, typed);
        break;
      case 'SPAWN_SESSION':
        void this._handleSpawnSession(client, typed);
        break;
      default:
        this._sendError(client.ws, 'UNKNOWN_TYPE', 'Unknown message type');
    }
  }

  // ────────────────────────────────────────────
  // Message validation
  // ────────────────────────────────────────────

  private static readonly MAX_INPUT_LENGTH = 64 * 1024; // 64 KB max input

  private _validateMessage(msg: ClientMessage): boolean {
    switch (msg.type) {
      case 'AUTH':
        return typeof msg.secret === 'string' && typeof msg.clientId === 'string';
      case 'LIST_SESSIONS':
      case 'PING':
        return true;
      case 'SUBSCRIBE':
        return (
          typeof msg.sessionId === 'string' &&
          (msg.fromLine === undefined || (typeof msg.fromLine === 'number' && Number.isInteger(msg.fromLine) && msg.fromLine >= 0))
        );
      case 'UNSUBSCRIBE':
        return typeof msg.sessionId === 'string';
      case 'INPUT':
        return (
          typeof msg.sessionId === 'string' &&
          typeof msg.data === 'string' &&
          msg.data.length <= WsServer.MAX_INPUT_LENGTH
        );
      case 'RESIZE':
        return (
          typeof msg.sessionId === 'string' &&
          typeof msg.cols === 'number' && Number.isInteger(msg.cols) && msg.cols > 0 && msg.cols <= 1000 &&
          typeof msg.rows === 'number' && Number.isInteger(msg.rows) && msg.rows > 0 && msg.rows <= 500
        );
      case 'REGISTER_PUSH_TOKEN':
        return (
          typeof msg.token === 'string' && msg.token.length > 0 &&
          (msg.platform === 'android' || msg.platform === 'ios')
        );
      case 'LIST_DIRECTORIES':
        return msg.query === undefined || typeof msg.query === 'string';
      case 'SPAWN_SESSION':
        return (
          typeof msg.cwd === 'string' && msg.cwd.length > 0 && msg.cwd.length <= 4096 &&
          typeof msg.requestId === 'string' && msg.requestId.length > 0
        );
      default:
        return true; // Unknown types handled elsewhere
    }
  }

  // ────────────────────────────────────────────
  // Message handlers
  // ────────────────────────────────────────────

  private _handleAuth(client: ConnectedClient, msg: ClientMessage & { type: 'AUTH' }): void {
    const secretBuf = Buffer.from(String(msg.secret));
    const expectedBuf = Buffer.from(this.config.authSecret);
    const isValid =
      secretBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(secretBuf, expectedBuf);

    if (!isValid) {
      logger.warn(`WS client ${client.id}: auth failed`);
      const fail: ServerMessage = {
        type: 'AUTH_FAIL',
        reason: 'Invalid secret',
      };
      this._send(client.ws, fail);
      client.ws.close(1008, 'Auth failed');
      return;
    }

    client.isAuthenticated = true;
    client.name = msg.clientName || 'unknown';
    if (client.authTimeout) {
      clearTimeout(client.authTimeout);
      client.authTimeout = undefined;
    }

    // Rebind to the device-supplied persistent clientId so push-token
    // registrations survive reconnects. The transient connection UUID is
    // only used until AUTH succeeds (so the auth-timeout cleanup works).
    const requested = msg.clientId;
    if (
      typeof requested === 'string' &&
      requested.length > 0 &&
      requested.length <= 100 &&
      !requested.includes('\0')
    ) {
      if (requested !== client.id) {
        this.clients.delete(client.id);
        client.id = requested;
        this.clients.set(client.id, client);
      }
    }

    const ok: ServerMessage = { type: 'AUTH_OK', clientId: client.id, daemonVersion: DAEMON_VERSION };
    this._send(client.ws, ok);
    logger.info(`WS client authenticated: ${client.id} (${client.name})`);
  }

  private _handleListSessions(client: ConnectedClient): void {
    const sessions = this.sessionManager
      .getAllSessions()
      .map((s) => s.info);
    const msg: ServerMessage = { type: 'SESSIONS', sessions };
    this._send(client.ws, msg);
  }

  private _handleSubscribe(
    client: ConnectedClient,
    msg: ClientMessage & { type: 'SUBSCRIBE' }
  ): void {
    const session = this.sessionManager.getSession(msg.sessionId);
    if (!session) {
      this._sendError(client.ws, 'SESSION_NOT_FOUND', `Session ${msg.sessionId} not found`);
      return;
    }

    client.subscribedSessions.add(msg.sessionId);
    this.sessionManager.addClientToSession(msg.sessionId, client.id);

    // Send history
    const historyCount = this.config.historyOnConnect;
    const lines =
      msg.fromLine !== undefined
        ? session.buffer.getLines(msg.fromLine)
        : session.buffer.getRecent(historyCount);

    const history: ServerMessage = {
      type: 'HISTORY',
      sessionId: msg.sessionId,
      lines,
      totalLines: session.buffer.totalLinesReceived,
      firstAvailableLine: session.buffer.firstAvailableLine(),
    };
    this._send(client.ws, history);

    logger.debug(
      `Client ${client.id} subscribed to session ${msg.sessionId}, sent ${lines.length} history lines`
    );
  }

  private _handleUnsubscribe(
    client: ConnectedClient,
    msg: ClientMessage & { type: 'UNSUBSCRIBE' }
  ): void {
    client.subscribedSessions.delete(msg.sessionId);
    this.sessionManager.removeClientFromSession(msg.sessionId, client.id);
    logger.debug(`Client ${client.id} unsubscribed from session ${msg.sessionId}`);
  }

  private _handleInput(
    client: ConnectedClient,
    msg: ClientMessage & { type: 'INPUT' }
  ): void {
    const session = this.sessionManager.getSession(msg.sessionId);
    if (!session) {
      this._sendError(client.ws, 'SESSION_NOT_FOUND', `Session ${msg.sessionId} not found`);
      return;
    }

    // Check input lock
    const lock = this.inputLocks.get(msg.sessionId);
    if (lock && lock.expiresAt > Date.now() && lock.clientId !== client.id) {
      const lockMsg: ServerMessage = {
        type: 'INPUT_LOCK',
        sessionId: msg.sessionId,
        lockedByClientId: lock.clientId,
        lockedByClientName: lock.clientName,
        expiresAt: lock.expiresAt,
      };
      this._send(client.ws, lockMsg);
      return;
    }

    // Set/refresh input lock
    this.inputLocks.set(msg.sessionId, {
      clientId: client.id,
      clientName: client.name,
      expiresAt: Date.now() + INPUT_LOCK_TTL_MS,
    });

    session.write(msg.data, client.id);
  }

  private _handleResize(
    client: ConnectedClient,
    msg: ClientMessage & { type: 'RESIZE' }
  ): void {
    const session = this.sessionManager.getSession(msg.sessionId);
    if (!session) {
      this._sendError(client.ws, 'SESSION_NOT_FOUND', `Session ${msg.sessionId} not found`);
      return;
    }
    session.resize(msg.cols, msg.rows);
  }

  private _handlePing(client: ConnectedClient): void {
    const pong: ServerMessage = { type: 'PONG', timestamp: Date.now() };
    this._send(client.ws, pong);
  }

  private _handleRegisterPushToken(
    client: ConnectedClient,
    msg: ClientMessage & { type: 'REGISTER_PUSH_TOKEN' }
  ): void {
    if (this.pushService) {
      this.pushService.registerToken(client.id, msg.token, msg.platform);
    }
  }

  private _handleListDirectories(
    client: ConnectedClient,
    msg: ClientMessage & { type: 'LIST_DIRECTORIES' }
  ): void {
    const recentCwds = recentCwdsFromSessions(
      this.sessionManager.getAllSessions().map((s) => s.info)
    );
    const directories = this.directoryScanner.scan({
      recentCwds,
      query: msg.query,
    });
    const reply: ServerMessage = { type: 'DIRECTORY_LIST', directories };
    this._send(client.ws, reply);
  }

  private async _handleSpawnSession(
    client: ConnectedClient,
    msg: ClientMessage & { type: 'SPAWN_SESSION' }
  ): Promise<void> {
    const cwd = this.directoryScanner.resolveAndValidate(msg.cwd);
    if (!cwd) {
      const reply: ServerMessage = {
        type: 'SPAWN_RESULT',
        requestId: msg.requestId,
        error: `Directory not accessible: ${msg.cwd}`,
      };
      this._send(client.ws, reply);
      return;
    }

    // Defence-in-depth: reject any cwd outside the user's home subtree.
    // resolveAndValidate also enforces this, but spawn handlers are a juicy
    // target so we re-check here in case the validator is bypassed.
    const home = os.homedir();
    const resolved = path.resolve(cwd);
    if (resolved !== home && !resolved.startsWith(home + path.sep)) {
      logger.warn(
        `Rejected SPAWN_SESSION outside home: client=${client.id} cwd=${resolved}`
      );
      const reply: ServerMessage = {
        type: 'SPAWN_RESULT',
        requestId: msg.requestId,
        error: 'cwd must be under your home directory',
      };
      this._send(client.ws, reply);
      return;
    }

    // Concurrent-spawn cap.  Counts daemon-owned sessions only — externally
    // discovered (read-only) sessions don't consume a spawn slot.
    const cap = this.config.maxSpawnedSessions;
    if (cap > 0) {
      const ownedCount = this.sessionManager
        .getAllSessions()
        .filter((s) => s.info.owned).length;
      if (ownedCount >= cap) {
        logger.warn(
          `Rejected SPAWN_SESSION over cap: client=${client.id} owned=${ownedCount} cap=${cap}`
        );
        const reply: ServerMessage = {
          type: 'SPAWN_RESULT',
          requestId: msg.requestId,
          error: `Spawned-session cap reached (${cap}). Close an existing session and try again.`,
        };
        this._send(client.ws, reply);
        return;
      }
    }

    try {
      const session = await this.sessionManager.spawnSession(cwd);
      const reply: ServerMessage = {
        type: 'SPAWN_RESULT',
        requestId: msg.requestId,
        sessionId: session.id,
      };
      this._send(client.ws, reply);
      logger.info(
        `Spawn requested by ${client.id} (${client.name}) cwd=${cwd} → session ${session.id}`
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn(`Spawn failed for ${client.id} cwd=${cwd}: ${reason}`);
      const reply: ServerMessage = {
        type: 'SPAWN_RESULT',
        requestId: msg.requestId,
        error: reason,
      };
      this._send(client.ws, reply);
    }
  }

  // ────────────────────────────────────────────
  // Sending helpers
  // ────────────────────────────────────────────

  private _send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      logger.debug(`WS send error: ${String(err)}`);
    }
  }

  private _sendError(ws: WebSocket, code: string, message: string): void {
    const msg: ServerMessage = { type: 'ERROR', code, message };
    this._send(ws, msg);
  }

  private _broadcastAll(msg: ServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const client of this.clients.values()) {
      if (client.isAuthenticated && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(payload);
        } catch (err) {
          logger.debug(`Broadcast error to ${client.id}: ${String(err)}`);
        }
      }
    }
  }

  private _broadcastToSession(sessionId: string, msg: ServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const client of this.clients.values()) {
      if (
        client.isAuthenticated &&
        client.subscribedSessions.has(sessionId) &&
        client.ws.readyState === WebSocket.OPEN
      ) {
        try {
          client.ws.send(payload);
        } catch (err) {
          logger.debug(`Session broadcast error to ${client.id}: ${String(err)}`);
        }
      }
    }
  }
}
