import type {
  ClientMessage,
  ServerMessage,
  ControlMessage,
  ControlMessageEnvelope,
  DirectoryEntry,
  PermissionMode,
  EffortLevel,
} from '@walccy/protocol';
import { SessionManager } from './session-manager.js';
import { DirectoryScanner, recentCwdsFromSessions } from './directory-scanner.js';
import { PushService } from './push.js';
import type { WalccyConfig } from './config.js';
import { ClientRegistry, ConnectedClient } from './client-registry.js';
import { handleAuth } from './auth-handler.js';
import { handleSpawnSession } from './spawn-handler.js';
import { handleListMemory } from './memory-handler.js';
import { handleListTranscripts } from './transcript-handler.js';
import logger from './logger.js';

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
// Pure dispatch. Validates, narrows by msg.type, then calls the right
// handler. Control plane (interrupt, plan_accept, set_model, etc.) lives
// in ControlMessageEnvelope; everything else is its own top-level wire
// message.

export class MessageRouter {
  private listDirsCache: { at: number; entries: DirectoryEntry[] } | null = null;
  private clientListDirsAt: Map<string, number> = new Map();
  private static readonly LIST_DIRS_MIN_INTERVAL_MS = 1000;
  private static readonly LIST_DIRS_CACHE_TTL_MS = 2000;

  constructor(private readonly deps: RouterDeps) {}

  dispatch(client: ConnectedClient, msg: unknown): void {
    if (typeof msg !== 'object' || msg === null || !('type' in msg)) {
      this.deps.registry.sendError(
        client.ws,
        'INVALID_MESSAGE',
        'Missing type field'
      );
      return;
    }

    const typed = msg as ClientMessage;

    if (!this._validateMessage(typed)) {
      this.deps.registry.sendError(
        client.ws,
        'INVALID_MESSAGE',
        'Invalid message fields'
      );
      return;
    }

    // AUTH must be first
    if (!client.isAuthenticated) {
      if (typed.type !== 'AUTH') {
        this.deps.registry.sendError(
          client.ws,
          'NOT_AUTHENTICATED',
          'Send AUTH first'
        );
        client.ws.close(1008, 'Not authenticated');
        return;
      }
      handleAuth(client, typed, {
        config: this.deps.config,
        registry: this.deps.registry,
        pushService: this.deps.pushService,
      });
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
        void handleSpawnSession(client, typed, {
          sessionManager: this.deps.sessionManager,
          directoryScanner: this.deps.directoryScanner,
          registry: this.deps.registry,
          config: this.deps.config,
        });
        break;
      case 'CONTROL_MESSAGE':
        void this._handleControlMessage(client, typed);
        break;
      case 'LIST_MEMORY':
        void handleListMemory(client, typed, {
          sessionManager: this.deps.sessionManager,
          registry: this.deps.registry,
        });
        break;
      case 'LIST_TRANSCRIPTS':
        void handleListTranscripts(client, typed, {
          sessionManager: this.deps.sessionManager,
          registry: this.deps.registry,
        });
        break;
      default: {
        const _exhaustive: never = typed;
        void _exhaustive;
        this.deps.registry.sendError(
          client.ws,
          'UNKNOWN_TYPE',
          'Unknown message type'
        );
      }
    }
  }

  // ────────────────────────────────────────────
  // Validation
  // ────────────────────────────────────────────

  private _validateMessage(msg: ClientMessage): boolean {
    switch (msg.type) {
      case 'AUTH':
        return (
          typeof msg.secret === 'string' && typeof msg.clientId === 'string'
        );
      case 'LIST_SESSIONS':
      case 'PING':
        return true;
      case 'SUBSCRIBE':
        return (
          typeof msg.sessionId === 'string' &&
          (msg.fromEventIndex === undefined ||
            (typeof msg.fromEventIndex === 'number' &&
              Number.isInteger(msg.fromEventIndex) &&
              msg.fromEventIndex >= 0))
        );
      case 'UNSUBSCRIBE':
        return typeof msg.sessionId === 'string';
      case 'REGISTER_PUSH_TOKEN':
        return (
          typeof msg.token === 'string' &&
          msg.token.length > 0 &&
          (msg.platform === 'android' || msg.platform === 'ios')
        );
      case 'LIST_DIRECTORIES':
        return (
          msg.query === undefined ||
          (typeof msg.query === 'string' && msg.query.length <= 256)
        );
      case 'SPAWN_SESSION':
        return (
          typeof msg.cwd === 'string' &&
          msg.cwd.length > 0 &&
          msg.cwd.length <= 4096 &&
          typeof msg.requestId === 'string' &&
          msg.requestId.length > 0
        );
      case 'LIST_MEMORY':
        return (
          typeof msg.requestId === 'string' &&
          msg.requestId.length > 0 &&
          typeof msg.sessionId === 'string' &&
          msg.sessionId.length > 0 &&
          (msg.fileName === undefined ||
            (typeof msg.fileName === 'string' && msg.fileName.length <= 256))
        );
      case 'LIST_TRANSCRIPTS':
        return (
          typeof msg.requestId === 'string' &&
          msg.requestId.length > 0 &&
          typeof msg.cwd === 'string' &&
          msg.cwd.length > 0 &&
          msg.cwd.length <= 4096 &&
          (msg.limit === undefined ||
            (typeof msg.limit === 'number' &&
              Number.isInteger(msg.limit) &&
              msg.limit > 0 &&
              msg.limit <= 200))
        );
      case 'CONTROL_MESSAGE':
        return (
          typeof msg.sessionId === 'string' &&
          msg.sessionId.length > 0 &&
          typeof msg.message === 'object' &&
          msg.message !== null
        );
      default: {
        const _exhaustive: never = msg;
        void _exhaustive;
        return false;
      }
    }
  }

  // ────────────────────────────────────────────
  // Handlers
  // ────────────────────────────────────────────

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
    const { sessionManager, registry } = this.deps;
    const session = sessionManager.getSession(msg.sessionId);
    if (!session) {
      registry.sendError(
        client.ws,
        'SESSION_NOT_FOUND',
        `Session ${msg.sessionId} not found`
      );
      return;
    }

    registry.addSubscription(client.id, msg.sessionId);
    sessionManager.addClientToSession(msg.sessionId, client.id);

    const fromIndex = msg.fromEventIndex ?? 0;
    const { events, firstAvailableIndex } = session.buffer.getFrom(fromIndex);
    const history: ServerMessage = {
      type: 'HISTORY',
      sessionId: msg.sessionId,
      events,
      totalEvents: session.buffer.totalCount,
      firstAvailableEventIndex: firstAvailableIndex,
    };
    registry.send(client.ws, history);
    logger.debug(
      `Client ${client.id} subscribed to session ${msg.sessionId} (from ${fromIndex}, sent ${events.length} events)`
    );
  }

  private _handleUnsubscribe(
    client: ConnectedClient,
    msg: ClientMessage & { type: 'UNSUBSCRIBE' }
  ): void {
    this.deps.registry.removeSubscription(client.id, msg.sessionId);
    this.deps.sessionManager.removeClientFromSession(
      msg.sessionId,
      client.id
    );
  }

  private async _handleControlMessage(
    client: ConnectedClient,
    env: ControlMessageEnvelope
  ): Promise<void> {
    const { sessionManager, registry } = this.deps;
    const session = sessionManager.getSession(env.sessionId);
    if (!session) {
      registry.sendError(
        client.ws,
        'SESSION_NOT_FOUND',
        `Session ${env.sessionId} not found`
      );
      return;
    }

    const m: ControlMessage = env.message;
    try {
      switch (m.type) {
        case 'send_user_message':
          session.sendUserMessage(m.content);
          return;
        case 'interrupt':
          await session.interrupt();
          return;
        case 'kill_session':
          await sessionManager.killSession(m.sessionId);
          return;
        case 'plan_accept':
          session.resolveByToolUseId({
            toolUseId: m.toolUseId,
            decision: 'allow',
          });
          return;
        case 'plan_reject':
          session.resolveByToolUseId({
            toolUseId: m.toolUseId,
            decision: 'deny',
            message: m.reason,
          });
          return;
        case 'answer_question':
          // The model expects updatedInput.questions[i].answer; map answers
          // array into a shape the AskUserQuestion tool tolerates. The
          // simplest viable wire-form is { answers } — the SDK uses this
          // verbatim as the tool's input for the next turn.
          session.resolveByToolUseId({
            toolUseId: m.toolUseId,
            decision: 'allow',
            updatedInput: { answers: m.answers },
          });
          return;
        case 'resolve_permission':
          session.resolvePermission({
            requestId: m.requestId,
            decision: m.decision,
            updatedInput: m.updatedInput,
          });
          return;
        case 'change_permission_mode':
          await session.setPermissionMode(m.mode as PermissionMode);
          return;
        case 'set_model':
          await session.setModel(m.model);
          return;
        case 'set_effort_level':
          // SDK doesn't expose mid-session effort change yet; log + ignore
          // (next spawn picks it up via SpawnSessionMessage.effortLevel).
          logger.info(
            `set_effort_level (${m.level as EffortLevel}) ignored mid-session — apply at next spawn`
          );
          return;
        default: {
          const _exhaustive: never = m;
          void _exhaustive;
          registry.sendError(
            client.ws,
            'UNKNOWN_CONTROL',
            `Unknown control message type`
          );
        }
      }
    } catch (err) {
      logger.warn(
        `Control message error (session=${env.sessionId}, type=${m.type}): ${String(err)}`
      );
      registry.sendError(
        client.ws,
        'CONTROL_ERROR',
        err instanceof Error ? err.message : String(err)
      );
    }
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
}
