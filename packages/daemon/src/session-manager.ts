import { EventEmitter } from 'events';
import * as path from 'path';
import { Session, type SessionSpawnOptions } from './session.js';
import type { Session as SessionInfo, SessionEvent } from '@walccy/protocol';
import { TranscriptWatcher } from './transcript-watcher.js';
import logger from './logger.js';

// ──────────────────────────────────────────────
// Typed event emitter interface
// ──────────────────────────────────────────────

interface SessionManagerEvents {
  'session-added': (session: SessionInfo) => void;
  'session-removed': (sessionId: string) => void;
  'session-updated': (sessionId: string, changes: Partial<SessionInfo>) => void;
  'session-event': (sessionId: string, event: SessionEvent, index: number) => void;
}

export class SessionManager extends EventEmitter {
  private sessions: Map<string, Session> = new Map();
  private maxBufferEvents: number;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private transcripts: TranscriptWatcher;

  constructor(maxBufferEvents = 10_000, transcripts?: TranscriptWatcher) {
    super();
    this.maxBufferEvents = maxBufferEvents;
    this.transcripts = transcripts ?? new TranscriptWatcher();
    this.transcripts.on('summary', (sessionId: string, summary: string) => {
      const session = this.sessions.get(sessionId);
      if (!session) return;
      const trimmed = summary.trim();
      if (!trimmed || session.info.name === trimmed) return;
      session.setName(trimmed);
      this.emit('session-updated', sessionId, { name: trimmed });
    });
  }

  // ────────────────────────────────────────────
  // Explicit kill (client-initiated)
  // ────────────────────────────────────────────

  /**
   * Terminate a session by id. Stops the SDK driver via Query.interrupt()
   * and removes the session. Returns true if a session existed, false
   * otherwise.
   */
  async killSession(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return false;
    try {
      await session.kill();
    } catch (err) {
      logger.warn(`killSession(${id}): kill failed: ${String(err)}`);
    }
    this.removeSession(id);
    return true;
  }

  // ────────────────────────────────────────────
  // Idle prune
  // ────────────────────────────────────────────

  /**
   * Periodically drop sessions that have had no activity for `idleMs` AND
   * have no subscribed clients. Idle prune is now opt-in legacy plumbing —
   * with no attach mode and explicit kill via the UI, most sessions go
   * away cleanly. Retained for safety against runaway forgotten tabs.
   */
  startIdlePrune(idleMs: number, checkIntervalMs = 15 * 60 * 1000): void {
    if (this.pruneTimer || idleMs <= 0) return;
    this.pruneTimer = setInterval(() => {
      void this._pruneOnce(idleMs);
    }, checkIntervalMs);
    this.pruneTimer.unref();
    logger.info(
      `SessionManager: idle prune enabled (idleMs=${idleMs}, checkMs=${checkIntervalMs})`
    );
  }

  stopIdlePrune(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  stopTranscriptWatcher(): void {
    this.transcripts.stopAll();
  }

  /** Exposed for tests — runs one prune pass without scheduling. */
  async _pruneOnce(idleMs: number): Promise<number> {
    const cutoff = Date.now() - idleMs;
    let removed = 0;
    for (const session of Array.from(this.sessions.values())) {
      const info = session.info;
      if (info.connectedClients.length > 0) continue;
      if (info.lastActivityAt > cutoff) continue;
      logger.info(
        `Pruning idle session ${session.id} (idle for ${Date.now() - info.lastActivityAt}ms)`
      );
      await this.killSession(session.id);
      removed++;
    }
    return removed;
  }

  // ────────────────────────────────────────────
  // Session lifecycle
  // ────────────────────────────────────────────

  /**
   * Spawn a new Claude session via the Agent SDK in `cwd`.
   */
  async spawnSession(opts: SessionSpawnOptions): Promise<Session> {
    const name = opts.name ?? this.deriveName(opts.cwd);
    const session = new Session(name, opts.cwd, this.maxBufferEvents);

    this.sessions.set(session.id, session);
    this.wireSessionEvents(session);

    session.on('exit', () => {
      logger.info(`Session ${session.id} exited`);
      this.removeSession(session.id);
    });

    try {
      await session.spawn(opts);
    } catch (err) {
      // Spawn failed — clean up the half-constructed session.
      this.sessions.delete(session.id);
      this.transcripts.unwatch(session.id);
      throw err;
    }

    logger.info(`Spawned session: id=${session.id} cwd=${opts.cwd} name=${name}`);
    this.transcripts.watch(session.id, opts.cwd, session.info.startedAt);
    this.emit('session-added', session.info);
    return session;
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  removeSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.transcripts.unwatch(id);
    void session.kill();
    this.sessions.delete(id);
    logger.info(`Session removed: id=${id}`);
    this.emit('session-removed', id);
  }

  /** Add / remove a client ID from a session's connectedClients list. */
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
    const base = path.basename(cwd) || cwd;
    const used = new Set<string>();
    for (const s of this.sessions.values()) used.add(s.info.name);
    if (!used.has(base)) return base;
    for (let i = 2; ; i++) {
      const candidate = `${base} ${i}`;
      if (!used.has(candidate)) return candidate;
    }
  }

  /** Forward typed SessionEvents up as a manager-level event for fan-out. */
  private wireSessionEvents(session: Session): void {
    session.on('session-event', (event, index) => {
      this.emit('session-event', session.id, event, index);
      // Mirror cost / status / waitingForInput / model into a partial
      // session-updated broadcast so the SessionHeader stays current
      // without the app having to derive it from every event.
      const info = session.info;
      const changes: Partial<SessionInfo> = {
        lastActivityAt: info.lastActivityAt,
        status: info.status,
        waitingForInput: info.waitingForInput,
        costSoFar: info.costSoFar,
        lastEventIndex: info.lastEventIndex,
      };
      if (event.kind === 'init') {
        changes.model = info.model;
        changes.permissionMode = info.permissionMode;
      }
      this.emit('session-updated', session.id, changes);
    });
  }

  // Typed overloads
  on<E extends keyof SessionManagerEvents>(
    event: E,
    listener: SessionManagerEvents[E]
  ): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
}

export type { SessionManagerEvents };
