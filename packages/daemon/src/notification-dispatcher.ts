import type {
  ServerMessage,
  Session as SessionInfo,
  SessionEvent,
} from '@walccy/protocol';
import { SessionManager } from './session-manager.js';
import { PushService } from './push.js';
import { ClientRegistry } from './client-registry.js';
import logger from './logger.js';

/**
 * NotificationDispatcher
 *
 * Subscribes to SessionManager events and fans out:
 *   - SESSION_ADDED / SESSION_REMOVED / SESSION_UPDATED to all clients.
 *   - SESSION_EVENT to clients subscribed to the source session.
 *   - Push notification on the false→true edge of waitingForInput
 *     (driven today by the `permission_request` event — AskUserQuestion,
 *     ExitPlanMode, any other tool that fires canUseTool).
 *
 * Per-session SESSION_EVENT broadcasts are coalesced to one flush per turn
 * of the event loop, so streaming `assistant_text_delta` bursts collapse
 * into a single WS frame batch (the buffer already merges sequential
 * deltas — this layer only batches over the WS boundary).
 */
export class NotificationDispatcher {
  private wiredSessions: Set<string> = new Set();

  /** Pending event batches per session (flushed via setImmediate). */
  private pendingEvents: Map<
    string,
    Array<{ event: SessionEvent; eventIndex: number }>
  > = new Map();
  private eventScheduled: Set<string> = new Set();

  /** Edge-detection cache for waitingForInput → push trigger. */
  private waitingState: Map<string, boolean> = new Map();

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly registry: ClientRegistry,
    private readonly pushService?: PushService
  ) {}

  start(): void {
    this.sessionManager.on('session-added', (session) =>
      this._onSessionAdded(session)
    );
    this.sessionManager.on('session-removed', (sessionId) =>
      this._onSessionRemoved(sessionId)
    );
    this.sessionManager.on('session-updated', (sessionId, changes) =>
      this._onSessionUpdated(sessionId, changes)
    );
    this.sessionManager.on('session-event', (sessionId, event, index) =>
      this._enqueueSessionEvent(sessionId, event, index)
    );
  }

  // ────────────────────────────────────────────
  // Handlers
  // ────────────────────────────────────────────

  private _onSessionAdded(session: SessionInfo): void {
    const msg: ServerMessage = { type: 'SESSION_ADDED', session };
    this.registry.broadcastAll(msg);
    this.wiredSessions.add(session.id);
  }

  private _onSessionRemoved(sessionId: string): void {
    const msg: ServerMessage = { type: 'SESSION_REMOVED', sessionId };
    this.registry.broadcastAll(msg);
    this.wiredSessions.delete(sessionId);
    this.pendingEvents.delete(sessionId);
    this.eventScheduled.delete(sessionId);
    this.waitingState.delete(sessionId);
  }

  private _onSessionUpdated(
    sessionId: string,
    changes: Partial<SessionInfo>
  ): void {
    const msg: ServerMessage = { type: 'SESSION_UPDATED', sessionId, changes };
    this.registry.broadcastAll(msg);

    // Push on the false→true edge of waitingForInput.
    if (changes.waitingForInput !== undefined) {
      const previous = this.waitingState.get(sessionId) ?? false;
      const next = changes.waitingForInput === true;
      this.waitingState.set(sessionId, next);
      if (!previous && next && this.pushService?.isEnabled) {
        const session = this.sessionManager.getSession(sessionId);
        const name = session?.info.name ?? 'Claude';
        this.pushService
          .sendToAll(
            `${name} needs input`,
            'Claude is waiting for your response.',
            { sessionId }
          )
          .catch((err) => {
            logger.warn(`FCM push error: ${String(err)}`);
          });
      }
    }
  }

  private _enqueueSessionEvent(
    sessionId: string,
    event: SessionEvent,
    eventIndex: number
  ): void {
    let queue = this.pendingEvents.get(sessionId);
    if (!queue) {
      queue = [];
      this.pendingEvents.set(sessionId, queue);
    }
    queue.push({ event, eventIndex });

    if (this.eventScheduled.has(sessionId)) return;
    this.eventScheduled.add(sessionId);
    setImmediate(() => {
      this.eventScheduled.delete(sessionId);
      const batch = this.pendingEvents.get(sessionId);
      this.pendingEvents.delete(sessionId);
      if (!batch || batch.length === 0) return;
      for (const { event: ev, eventIndex: idx } of batch) {
        const out: ServerMessage = {
          type: 'SESSION_EVENT',
          sessionId,
          eventIndex: idx,
          event: ev,
        };
        this.registry.broadcastToSession(sessionId, out);
      }
    });
  }
}
