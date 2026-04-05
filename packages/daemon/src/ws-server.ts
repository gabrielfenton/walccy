import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { SessionManager } from './session-manager.js';
import type { WalccyConfig } from './config.js';
import type {
  ClientMessage,
  ServerMessage,
  Session as SessionInfo,
  BufferedLine,
} from './types.js';
import logger from './logger.js';

// ──────────────────────────────────────────────
// Connected client state
// ──────────────────────────────────────────────

interface ConnectedClient {
  id: string;
  name: string;
  ws: WebSocket;
  subscribedSessions: Set<string>;
  isAuthenticated: boolean;
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

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly config: WalccyConfig,
    private readonly bindAddress: string
  ) {}

  // ────────────────────────────────────────────
  // Lifecycle
  // ────────────────────────────────────────────

  async start(): Promise<void> {
    this.httpServer = http.createServer();
    this.wss = new WebSocketServer({ server: this.httpServer });

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

    // Wire per-session output events
    this.sessionManager.getAllSessions().forEach((session) => {
      session.on('data', (lines: BufferedLine[]) => {
        this.broadcastOutput(session.id, lines);
      });
    });
  }

  stop(): void {
    this.wss?.close();
    this.httpServer?.close();
    logger.info('WebSocket server stopped');
  }

  // ────────────────────────────────────────────
  // Broadcast helpers
  // ────────────────────────────────────────────

  broadcastSessionAdded(session: SessionInfo): void {
    const msg: ServerMessage = { type: 'SESSION_ADDED', session };
    this._broadcastAll(msg);

    // Wire output events for newly added sessions
    const sessionObj = this.sessionManager.getSession(session.id);
    if (sessionObj) {
      sessionObj.on('data', (lines: BufferedLine[]) => {
        this.broadcastOutput(session.id, lines);
      });
    }
  }

  broadcastSessionRemoved(sessionId: string): void {
    const msg: ServerMessage = { type: 'SESSION_REMOVED', sessionId };
    this._broadcastAll(msg);
  }

  broadcastSessionUpdated(
    sessionId: string,
    changes: Partial<SessionInfo>
  ): void {
    const msg: ServerMessage = { type: 'SESSION_UPDATED', sessionId, changes };
    this._broadcastAll(msg);
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
      this.clients.delete(clientId);
    });

    ws.on('error', (err: Error) => {
      logger.warn(`WS client ${clientId} error: ${err.message}`);
    });

    // Set a 10-second auth timeout
    const authTimeout = setTimeout(() => {
      if (!client.isAuthenticated) {
        logger.warn(`WS client ${clientId}: auth timeout, closing`);
        ws.close(1008, 'Auth timeout');
      }
    }, 10000);
    authTimeout.unref();
  }

  private _handleMessage(client: ConnectedClient, msg: unknown): void {
    if (typeof msg !== 'object' || msg === null || !('type' in msg)) {
      this._sendError(client.ws, 'INVALID_MESSAGE', 'Missing type field');
      return;
    }

    const typed = msg as ClientMessage;

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
      default:
        this._sendError(client.ws, 'UNKNOWN_TYPE', 'Unknown message type');
    }
  }

  // ────────────────────────────────────────────
  // Message handlers
  // ────────────────────────────────────────────

  private _handleAuth(client: ConnectedClient, msg: ClientMessage & { type: 'AUTH' }): void {
    if (msg.secret !== this.config.authSecret) {
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

    const ok: ServerMessage = { type: 'AUTH_OK', clientId: client.id };
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
