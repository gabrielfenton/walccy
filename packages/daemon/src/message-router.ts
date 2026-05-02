import * as crypto from 'crypto';
import type {
  ClientMessage,
  ServerMessage,
  DirectoryEntry,
} from '@walccy/protocol';
import { SessionManager } from './session-manager.js';
import { DirectoryScanner, recentCwdsFromSessions } from './directory-scanner.js';
import { PushService } from './push.js';
import type { WalccyConfig } from './config.js';
import {
  ClientRegistry,
  ConnectedClient,
  INPUT_LOCK_TTL_MS,
} from './client-registry.js';
import logger from './logger.js';
import pkg from '../package.json';

const DAEMON_VERSION: string = pkg.version;
const MAX_INPUT_LENGTH = 64 * 1024; // 64 KB max input

export interface RouterDeps {
  sessionManager: SessionManager;
  config: WalccyConfig;
  registry: ClientRegistry;
  directoryScanner: DirectoryScanner;
  pushService?: PushService;
}

// ──────────────────────────────────────────────
// MessageRouter
// ──────────────────────────────────────────────
//
// Pure dispatch table. Validates, narrows by msg.type, then calls the right
// handler. Handlers know about deps but not about transport/framing.

export class MessageRouter {
  private listDirsCache: { at: number; entries: DirectoryEntry[] } | null = null;
  private clientListDirsAt: Map<string, number> = new Map();
  private static readonly LIST_DIRS_MIN_INTERVAL_MS = 1000;
  private static readonly LIST_DIRS_CACHE_TTL_MS = 2000;

  constructor(private readonly deps: RouterDeps) {}

  /**
   * Entry point invoked by ws-transport for every parsed JSON message.
   */
  dispatch(client: ConnectedClient, msg: unknown): void {
    if (typeof msg !== 'object' || msg === null || !('type' in msg)) {
      this.deps.registry.sendError(client.ws, 'INVALID_MESSAGE', 'Missing type field');
      return;
    }

    const typed = msg as ClientMessage;

    if (!this._validateMessage(typed)) {
      this.deps.registry.sendError(client.ws, 'INVALID_MESSAGE', 'Invalid message fields');
      return;
    }

    // AUTH must be first
    if (!client.isAuthenticated) {
      if (typed.type !== 'AUTH') {
        this.deps.registry.sendError(client.ws, 'NOT_AUTHENTICATED', 'Send AUTH first');
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
        this.deps.registry.sendError(client.ws, 'UNKNOWN_TYPE', 'Unknown message type');
    }
  }

  // ────────────────────────────────────────────
  // Validation
  // ────────────────────────────────────────────

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
          msg.data.length <= MAX_INPUT_LENGTH
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
        return msg.query === undefined || (typeof msg.query === 'string' && msg.query.length <= 256);
      case 'SPAWN_SESSION':
        return (
          typeof msg.cwd === 'string' && msg.cwd.length > 0 && msg.cwd.length <= 4096 &&
          typeof msg.requestId === 'string' && msg.requestId.length > 0
        );
      default: {
        // exhaustiveness check — if a new ClientMessage variant is added without
        // a case here, TS errors at compile time (`msg` won't narrow to never).
        const _exhaustive: never = msg;
        void _exhaustive;
        return false;
      }
    }
  }

  // ────────────────────────────────────────────
  // Handlers
  // ────────────────────────────────────────────

  private _handleAuth(client: ConnectedClient, msg: ClientMessage & { type: 'AUTH' }): void {
    const { config, registry } = this.deps;

    const secretBuf = Buffer.from(String(msg.secret));
    const expectedBuf = Buffer.from(config.authSecret);
    const isValid =
      secretBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(secretBuf, expectedBuf);

    if (!isValid) {
      logger.warn(`WS client ${client.id}: auth failed`);
      const fail: ServerMessage = {
        type: 'AUTH_FAIL',
        reason: 'Invalid secret',
      };
      registry.send(client.ws, fail);
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
      const rebindOk = registry.rebind(client, requested);
      // rebindOk === false means another connection already holds msg.clientId.
      // We still send AUTH_OK so the client functions, just on the
      // connection-scoped UUID instead of its preferred persistent id.
      void rebindOk;
    }

    const ok: ServerMessage = { type: 'AUTH_OK', clientId: client.id, daemonVersion: DAEMON_VERSION };
    registry.send(client.ws, ok);
    logger.info(`WS client authenticated: ${client.id} (${client.name})`);
  }

  private _handleListSessions(client: ConnectedClient): void {
    const sessions = this.deps.sessionManager
      .getAllSessions()
      .map((s) => s.info);
    const msg: ServerMessage = { type: 'SESSIONS', sessions };
    this.deps.registry.send(client.ws, msg);
  }

  private _handleSubscribe(
    client: ConnectedClient,
    msg: ClientMessage & { type: 'SUBSCRIBE' }
  ): void {
    const { sessionManager, registry, config } = this.deps;
    const session = sessionManager.getSession(msg.sessionId);
    if (!session) {
      registry.sendError(client.ws, 'SESSION_NOT_FOUND', `Session ${msg.sessionId} not found`);
      return;
    }

    client.subscribedSessions.add(msg.sessionId);
    sessionManager.addClientToSession(msg.sessionId, client.id);

    if (msg.fromLine !== undefined) {
      const lines = session.buffer.getLines(msg.fromLine);
      const reply: ServerMessage = {
        type: 'RESUME',
        sessionId: msg.sessionId,
        lines,
        totalLines: session.buffer.totalLinesReceived,
      };
      registry.send(client.ws, reply);
      logger.debug(
        `Client ${client.id} resumed session ${msg.sessionId} from line ${msg.fromLine}, sent ${lines.length} lines`
      );
    } else {
      const historyCount = config.historyOnConnect;
      const lines = session.buffer.getRecent(historyCount);
      const history: ServerMessage = {
        type: 'HISTORY',
        sessionId: msg.sessionId,
        lines,
        totalLines: session.buffer.totalLinesReceived,
        firstAvailableLine: session.buffer.firstAvailableLine(),
      };
      registry.send(client.ws, history);
      logger.debug(
        `Client ${client.id} subscribed to session ${msg.sessionId}, sent ${lines.length} history lines`
      );
    }
  }

  private _handleUnsubscribe(
    client: ConnectedClient,
    msg: ClientMessage & { type: 'UNSUBSCRIBE' }
  ): void {
    client.subscribedSessions.delete(msg.sessionId);
    this.deps.sessionManager.removeClientFromSession(msg.sessionId, client.id);
    logger.debug(`Client ${client.id} unsubscribed from session ${msg.sessionId}`);
  }

  private _handleInput(
    client: ConnectedClient,
    msg: ClientMessage & { type: 'INPUT' }
  ): void {
    const { sessionManager, registry } = this.deps;
    const session = sessionManager.getSession(msg.sessionId);
    if (!session) {
      registry.sendError(client.ws, 'SESSION_NOT_FOUND', `Session ${msg.sessionId} not found`);
      return;
    }

    // Check input lock
    const lock = registry.getInputLock(msg.sessionId);
    if (lock && lock.expiresAt > Date.now() && lock.clientId !== client.id) {
      const lockMsg: ServerMessage = {
        type: 'INPUT_LOCK',
        sessionId: msg.sessionId,
        lockedByClientId: lock.clientId,
        lockedByClientName: lock.clientName,
        expiresAt: lock.expiresAt,
      };
      registry.send(client.ws, lockMsg);
      return;
    }

    if (!session.owned) {
      // Read-only / attach-mode session: skip the lock entirely.  session.write
      // would log+no-op anyway, no point also locking other clients out.
      session.write(msg.data, client.id);
      return;
    }

    registry.setInputLock(msg.sessionId, {
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
    const { sessionManager, registry } = this.deps;
    const session = sessionManager.getSession(msg.sessionId);
    if (!session) {
      registry.sendError(client.ws, 'SESSION_NOT_FOUND', `Session ${msg.sessionId} not found`);
      return;
    }
    session.resize(msg.cols, msg.rows);
  }

  private _handlePing(client: ConnectedClient): void {
    const pong: ServerMessage = { type: 'PONG', timestamp: Date.now() };
    this.deps.registry.send(client.ws, pong);
  }

  private _handleRegisterPushToken(
    client: ConnectedClient,
    msg: ClientMessage & { type: 'REGISTER_PUSH_TOKEN' }
  ): void {
    if (this.deps.pushService) {
      this.deps.pushService.registerToken(client.id, msg.token, msg.platform);
    }
  }

  private _handleListDirectories(
    client: ConnectedClient,
    msg: ClientMessage & { type: 'LIST_DIRECTORIES' }
  ): void {
    const { sessionManager, directoryScanner, registry } = this.deps;

    const now = Date.now();
    const last = this.clientListDirsAt.get(client.id) ?? 0;
    if (
      now - last < MessageRouter.LIST_DIRS_MIN_INTERVAL_MS &&
      this.listDirsCache &&
      now - this.listDirsCache.at < MessageRouter.LIST_DIRS_CACHE_TTL_MS
    ) {
      // Per-client rate-limit hit; serve cache silently.
      registry.send(client.ws, {
        type: 'DIRECTORY_LIST',
        directories: this.listDirsCache.entries,
      });
      return;
    }
    this.clientListDirsAt.set(client.id, now);
    if (
      this.listDirsCache &&
      now - this.listDirsCache.at < MessageRouter.LIST_DIRS_CACHE_TTL_MS &&
      !msg.query
    ) {
      registry.send(client.ws, {
        type: 'DIRECTORY_LIST',
        directories: this.listDirsCache.entries,
      });
      return;
    }
    const recentCwds = recentCwdsFromSessions(
      sessionManager.getAllSessions().map((s) => s.info)
    );
    const directories = directoryScanner.scan({
      recentCwds,
      query: msg.query,
    });
    if (!msg.query) {
      this.listDirsCache = { at: now, entries: directories };
    }
    const reply: ServerMessage = { type: 'DIRECTORY_LIST', directories };
    registry.send(client.ws, reply);
  }

  private async _handleSpawnSession(
    client: ConnectedClient,
    msg: ClientMessage & { type: 'SPAWN_SESSION' }
  ): Promise<void> {
    const { sessionManager, directoryScanner, registry, config } = this.deps;
    const cwd = directoryScanner.resolveAndValidate(msg.cwd);
    if (!cwd) {
      const reply: ServerMessage = {
        type: 'SPAWN_RESULT',
        requestId: msg.requestId,
        error: `Directory not accessible: ${msg.cwd}`,
      };
      registry.send(client.ws, reply);
      return;
    }

    // Concurrent-spawn cap.  Counts daemon-owned sessions only — externally
    // discovered (read-only) sessions don't consume a spawn slot.
    const cap = config.maxSpawnedSessions;
    if (cap > 0) {
      const ownedCount = sessionManager
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
        registry.send(client.ws, reply);
        return;
      }
    }

    try {
      const session = await sessionManager.spawnSession(cwd);
      const reply: ServerMessage = {
        type: 'SPAWN_RESULT',
        requestId: msg.requestId,
        sessionId: session.id,
      };
      registry.send(client.ws, reply);
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
      registry.send(client.ws, reply);
    }
  }
}
