import { EventEmitter } from 'events';
import * as net from 'net';
import * as path from 'path';
import { Session } from './session.js';
import type { Session as SessionInfo } from '@walccy/protocol';
import logger from './logger.js';

// ──────────────────────────────────────────────
// Typed event emitter interface
// ──────────────────────────────────────────────

interface SessionManagerEvents {
  'session-added': (session: SessionInfo) => void;
  'session-removed': (sessionId: string) => void;
  'session-updated': (sessionId: string, changes: Partial<SessionInfo>) => void;
}

export class SessionManager extends EventEmitter {
  private sessions: Map<string, Session> = new Map();
  /** Maps detected PID → session ID to avoid duplicate sessions. */
  private pidToSessionId: Map<number, string> = new Map();
  private maxBufferLines: number;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(maxBufferLines = 10000) {
    super();
    this.maxBufferLines = maxBufferLines;
  }

  // ────────────────────────────────────────────
  // Explicit kill (client-initiated)
  // ────────────────────────────────────────────

  /**
   * Terminate a session by id.  Best-effort `SIGTERM` against the recorded
   * pid (covers attach / wrap modes where the underlying process is not
   * directly owned by the daemon — spawn mode would still get killed via
   * pty.kill inside session.kill, but SIGTERM first is harmless and unifies
   * the code path).  Then the session is removed (which emits 'session-removed'
   * so ws-server broadcasts SESSION_REMOVED to clients).
   *
   * Returns true if a session with that id existed, false otherwise.
   */
  killSession(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;

    const pid = session.pid;
    if (pid > 0) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        // ESRCH = no such process (already dead) — fine.
        // EPERM = not ours (rare for user-owned claude processes) — log.
        if (code !== 'ESRCH') {
          logger.warn(
            `killSession(${id}): process.kill(${pid}) failed: ${String(err)}`
          );
        }
      }
    }

    this.removeSession(id);
    return true;
  }

  // ────────────────────────────────────────────
  // Idle-attach pruning
  // ────────────────────────────────────────────

  /**
   * Periodically drop attach-mode (non-owned) sessions that have had no
   * activity for `idleMs` and currently have no subscribed clients.  This
   * cleans up long-running orphans (e.g. a months-old detached tmux running
   * `claude`) so they don't permanently litter the tab bar.
   *
   * The underlying process is NOT killed — pruning only stops tracking.
   * The ProcessScanner won't re-emit `process-found` for a still-alive pid
   * already in its `knownPids`, so the pruned session stays gone until the
   * pid dies and a new claude process recycles the id, or the daemon
   * restarts.
   */
  startIdlePrune(idleMs: number, checkIntervalMs = 15 * 60 * 1000): void {
    if (this.pruneTimer || idleMs <= 0) return;
    this.pruneTimer = setInterval(() => {
      this._pruneOnce(idleMs);
    }, checkIntervalMs);
    this.pruneTimer.unref();
    logger.info(
      `SessionManager: idle-attach prune enabled (idleMs=${idleMs}, checkMs=${checkIntervalMs})`
    );
  }

  stopIdlePrune(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  /** Exposed for tests — runs one prune pass without scheduling. */
  _pruneOnce(idleMs: number): number {
    const cutoff = Date.now() - idleMs;
    let removed = 0;
    for (const session of Array.from(this.sessions.values())) {
      const info = session.info;
      if (info.owned) continue; // only prune RO sessions
      if (info.connectedClients.length > 0) continue;
      if (info.lastActivityAt > cutoff) continue;
      logger.info(
        `Pruning idle attach session ${session.id} (pid=${session.pid}, idle for ${Date.now() - info.lastActivityAt}ms)`
      );
      this.removeSession(session.id);
      removed++;
    }
    return removed;
  }

  // ────────────────────────────────────────────
  // Session lifecycle
  // ────────────────────────────────────────────

  /**
   * Create a session for a detected external PID.
   * Returns the existing session if one already exists for this PID.
   */
  createSession(pid: number, cwd: string): Session {
    // Deduplicate by PID
    const existingId = this.pidToSessionId.get(pid);
    if (existingId) {
      const existing = this.sessions.get(existingId);
      if (existing) return existing;
    }

    const name = this.deriveName(cwd);
    const session = new Session(pid, cwd, name, this.maxBufferLines);

    this.sessions.set(session.id, session);
    this.pidToSessionId.set(pid, session.id);

    this.wireSessionEvents(session);

    session.on('exit', () => {
      logger.info(`Session ${session.id} (pid=${pid}) exited`);
      this.removeSession(session.id);
    });

    logger.info(
      `Session created: id=${session.id} pid=${pid} cwd=${cwd} name=${name}`
    );

    this.emit('session-added', session.info);

    return session;
  }

  /**
   * Spawn a new `claude` process owned by the daemon via node-pty.
   */
  async spawnSession(cwd: string): Promise<Session> {
    const name = this.deriveName(cwd);
    const session = new Session(0, cwd, name, this.maxBufferLines);

    this.sessions.set(session.id, session);

    this.wireSessionEvents(session);

    session.on('exit', () => {
      logger.info(`Spawned session ${session.id} exited`);
      this.removeSession(session.id);
    });

    await session.spawn();

    logger.info(`Spawned session: id=${session.id} cwd=${cwd} name=${name}`);
    this.emit('session-added', session.info);

    return session;
  }

  /**
   * Create a session backed by a `walccy wrap` CLI socket.  The wrapper owns
   * the actual PTY and forwards I/O over `socket`.
   */
  createWrappedSession(
    pid: number,
    cwd: string,
    name: string | undefined,
    socket: net.Socket
  ): Session {
    const finalName = name ?? this.deriveName(cwd);
    const session = new Session(pid, cwd, finalName, this.maxBufferLines);
    session.attachWrapper(socket);

    this.sessions.set(session.id, session);
    if (pid > 0) this.pidToSessionId.set(pid, session.id);

    this.wireSessionEvents(session);

    session.on('exit', () => {
      logger.info(`Wrapped session ${session.id} (pid=${pid}) exited`);
      this.removeSession(session.id);
    });

    logger.info(
      `Wrapped session created: id=${session.id} pid=${pid} cwd=${cwd} name=${finalName}`
    );

    this.emit('session-added', session.info);

    return session;
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  getSessionByPid(pid: number): Session | undefined {
    const id = this.pidToSessionId.get(pid);
    return id ? this.sessions.get(id) : undefined;
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  removeSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;

    // Clean up PID mapping
    this.pidToSessionId.delete(session.pid);

    session.kill();
    this.sessions.delete(id);

    logger.info(`Session removed: id=${id}`);
    this.emit('session-removed', id);
  }

  /**
   * Add or remove a client ID from a session's connectedClients list.
   */
  addClientToSession(sessionId: string, clientId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const info = session.info;
    if (!info.connectedClients.includes(clientId)) {
      const updated = [...info.connectedClients, clientId];
      session.setConnectedClients(updated);
      this.emit('session-updated', sessionId, { connectedClients: updated });
    }
  }

  removeClientFromSession(sessionId: string, clientId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const info = session.info;
    const updated = info.connectedClients.filter((c) => c !== clientId);
    session.setConnectedClients(updated);
    this.emit('session-updated', sessionId, { connectedClients: updated });
  }

  // ────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────

  private deriveName(cwd: string): string {
    return path.basename(cwd) || cwd;
  }

  /** Forward session 'data' events as session-updated metadata broadcasts. */
  private wireSessionEvents(session: Session): void {
    session.on('data', () => {
      const info = session.info;
      this.emit('session-updated', session.id, {
        lastActivityAt: info.lastActivityAt,
        lineCount: info.lineCount,
        status: info.status,
        waitingForInput: info.waitingForInput,
      });
    });
  }

  // Typed overloads
  on(event: 'session-added', listener: (session: SessionInfo) => void): this;
  on(event: 'session-removed', listener: (sessionId: string) => void): this;
  on(
    event: 'session-updated',
    listener: (sessionId: string, changes: Partial<SessionInfo>) => void
  ): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
}

// Satisfy TS unused import check
export type { SessionManagerEvents };
