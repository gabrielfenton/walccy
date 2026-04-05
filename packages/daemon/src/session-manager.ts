import { EventEmitter } from 'events';
import * as path from 'path';
import { Session } from './session.js';
import type { Session as SessionInfo } from './types.js';
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

  constructor(maxBufferLines = 10000) {
    super();
    this.maxBufferLines = maxBufferLines;
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

    // Forward session data events as session-updated broadcasts
    session.on('data', () => {
      this.emit('session-updated', session.id, {
        lastActivityAt: session.info.lastActivityAt,
        lineCount: session.info.lineCount,
        status: session.info.status,
      });
    });

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

    session.on('data', () => {
      this.emit('session-updated', session.id, {
        lastActivityAt: session.info.lastActivityAt,
        lineCount: session.info.lineCount,
        status: session.info.status,
      });
    });

    session.on('exit', () => {
      logger.info(`Spawned session ${session.id} exited`);
      this.removeSession(session.id);
    });

    await session.spawn();

    logger.info(`Spawned session: id=${session.id} cwd=${cwd} name=${name}`);
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
      // Mutate via updateStatus — we need to reach into the internal _info.
      // Session exposes updateStatus; for connectedClients we emit update directly.
      this.emit('session-updated', sessionId, {
        connectedClients: [...info.connectedClients, clientId],
      });
    }
  }

  removeClientFromSession(sessionId: string, clientId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const info = session.info;
    const updated = info.connectedClients.filter((c) => c !== clientId);
    this.emit('session-updated', sessionId, { connectedClients: updated });
  }

  // ────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────

  private deriveName(cwd: string): string {
    return path.basename(cwd) || cwd;
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
