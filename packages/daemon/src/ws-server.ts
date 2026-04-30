import * as crypto from 'crypto';
import * as http from 'http';
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
} from './types.js';
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

  broadcastSessionAdded(session: SessionInfo): void {
    const msg: ServerMessage = { type: 'SESSION_ADDED', session };
    this._broadcastAll(msg);

    // Wire output events for newly added sessions (guard against duplicate listeners)
    if (!this.wiredSessions.has(session.id)) {
      const sessionObj = this.sessionManager.getSession(session.id);
      if (sessionObj) {
        this.wiredSessions.add(session.id);
        sessionObj.on('data', (lines: BufferedLine[]) => {
          this.broadcastOutput(session.id, lines);
        });
      }
    }
  }

  broadcastSessionRemoved(sessionId: string): void {
    const msg: ServerMessage = { type: 'SESSION_REMOVED', sessionId };
    this._broadcastAll(msg);
    // Clean up wired session and expired input lock
    this.wiredSessions.delete(sessionId);
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
      logger.debug(`WS client disconnected: ${clientId}`);
      for (const sessionId of client.subscribedSessions) {
        this.sessionManager.removeClientFromSession(sessionId, clientId);
      }
      this.pushService?.unregisterClient(clientId);
      this.clients.delete(clientId);
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
    (client as ConnectedClient & { authTimeout?: ReturnType<typeof setTimeout> }).authTimeout = authTimeout;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = msg as any;
    switch (m.type) {
      case 'AUTH':
        return typeof m.secret === 'string' && typeof m.clientId === 'string';
      case 'LIST_SESSIONS':
      case 'PING':
        return true;
      case 'SUBSCRIBE':
        return (
          typeof m.sessionId === 'string' &&
          (m.fromLine === undefined || (typeof m.fromLine === 'number' && Number.isInteger(m.fromLine) && m.fromLine >= 0))
        );
      case 'UNSUBSCRIBE':
        return typeof m.sessionId === 'string';
      case 'INPUT':
        return (
          typeof m.sessionId === 'string' &&
          typeof m.data === 'string' &&
          m.data.length <= WsServer.MAX_INPUT_LENGTH
        );
      case 'RESIZE':
        return (
          typeof m.sessionId === 'string' &&
          typeof m.cols === 'number' && Number.isInteger(m.cols) && m.cols > 0 && m.cols <= 1000 &&
          typeof m.rows === 'number' && Number.isInteger(m.rows) && m.rows > 0 && m.rows <= 500
        );
      case 'REGISTER_PUSH_TOKEN':
        return (
          typeof m.token === 'string' && m.token.length > 0 &&
          (m.platform === 'android' || m.platform === 'ios')
        );
      case 'LIST_DIRECTORIES':
        return m.query === undefined || typeof m.query === 'string';
      case 'SPAWN_SESSION':
        return (
          typeof m.cwd === 'string' && m.cwd.length > 0 && m.cwd.length <= 4096 &&
          typeof m.requestId === 'string' && m.requestId.length > 0
        );
      default:
        return true; // Unknown types are handled by the switch default
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
