import type {
  ServerMessage,
  Session as SessionInfo,
  BufferedLine,
} from '@walccy/protocol';
import { SessionManager } from './session-manager.js';
import { PushService } from './push.js';
import { ClientRegistry } from './client-registry.js';
import logger from './logger.js';

/**
 * NotificationDispatcher
 *
 * Subscribes to SessionManager lifecycle events (`session-added`,
 * `session-removed`, `session-updated`) and to per-session `'data'` events,
 * and fans out notifications to:
 *
 *   - Connected WS clients via ClientRegistry (broadcastAll / broadcastToSession)
 *   - Push targets via PushService when waitingForInput flips true
 *
 * Owns the per-session OUTPUT coalescing queue so PTY data bursts collapse
 * into one OUTPUT message per event-loop turn.
 */
export class NotificationDispatcher {
  /** Track sessions that already have a data listener wired to avoid duplicates. */
  private wiredSessions: Set<string> = new Set();
  /**
   * Per-session pending OUTPUT line queue. Bursts of PTY data (which can
   * arrive as 50-chunk bursts per visible block) are coalesced into a single
   * OUTPUT broadcast per turn of the event loop.
   */
  private pendingOutput: Map<string, BufferedLine[]> = new Map();
  private outputScheduled: Set<string> = new Set();
  /**
   * Defense-in-depth cache of the last observed waitingForInput value per
   * session. Session._resetIdleTimer is edge-triggered at the source today,
   * but we don't want to depend on that invariant from a different module —
   * if upstream ever re-emits current state (refactor, metadata refresh,
   * resync), we still only push on the false→true edge as observed by us.
   */
  private waitingState: Map<string, boolean> = new Map();

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly registry: ClientRegistry,
    private readonly pushService?: PushService
  ) {}

  start(): void {
    this.sessionManager.on('session-added', (session: SessionInfo) => {
      this._onSessionAdded(session);
    });

    this.sessionManager.on('session-removed', (sessionId: string) => {
      this._onSessionRemoved(sessionId);
    });

    this.sessionManager.on(
      'session-updated',
      (sessionId: string, changes: Partial<SessionInfo>) => {
        this._onSessionUpdated(sessionId, changes);
      }
    );

    // Note: No need to wire existing sessions here — the scanner hasn't
    // started yet so getAllSessions() is always empty at this point.
    // New sessions are wired in _onSessionAdded().
  }

  // ────────────────────────────────────────────
  // SessionManager event handlers
  // ────────────────────────────────────────────

  private _onSessionAdded(session: SessionInfo): void {
    const msg: ServerMessage = { type: 'SESSION_ADDED', session };
    this.registry.broadcastAll(msg);

    // Wire output events for newly added sessions (guard against duplicates)
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
              const out: ServerMessage = {
                type: 'OUTPUT',
                sessionId,
                lines: batch,
              };
              this.registry.broadcastToSession(sessionId, out);
            });
          }
        });
      }
    }
  }

  private _onSessionRemoved(sessionId: string): void {
    const msg: ServerMessage = { type: 'SESSION_REMOVED', sessionId };
    this.registry.broadcastAll(msg);
    // Clean up wired session, pending OUTPUT queue, expired input lock
    this.wiredSessions.delete(sessionId);
    this.pendingOutput.delete(sessionId);
    this.outputScheduled.delete(sessionId);
    this.waitingState.delete(sessionId);
    this.registry.clearInputLock(sessionId);
  }

  private _onSessionUpdated(
    sessionId: string,
    changes: Partial<SessionInfo>
  ): void {
    const msg: ServerMessage = { type: 'SESSION_UPDATED', sessionId, changes };
    this.registry.broadcastAll(msg);

    // Defense-in-depth: only push on the false→true edge as observed by us,
    // even if upstream re-emits the same state.
    if (changes.waitingForInput !== undefined) {
      const previous = this.waitingState.get(sessionId) ?? false;
      const next = changes.waitingForInput === true;
      this.waitingState.set(sessionId, next);

      if (!previous && next && this.pushService?.isEnabled) {
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
  }
}
