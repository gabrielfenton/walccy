import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { IPty } from 'node-pty';
import { LineBuffer } from './buffer.js';
import type { Session as SessionInfo, SessionStatus, BufferedLine } from './types.js';
import logger from './logger.js';

// ──────────────────────────────────────────────
// Typed event emitter interface
// ──────────────────────────────────────────────

interface SessionEvents {
  data: (lines: BufferedLine[]) => void;
  exit: () => void;
}

// ──────────────────────────────────────────────
// Session class
// ──────────────────────────────────────────────

export class Session extends EventEmitter {
  readonly id: string;
  /** The original detected PID (or 0 for daemon-spawned sessions). */
  readonly pid: number;
  /** node-pty instance — only set for sessions we own. */
  private pty: IPty | null = null;
  /** Read-stream used to monitor external processes. */
  private monitorStream: fs.ReadStream | null = null;
  /** Whether we own the PTY (can accept writes). */
  private owned: boolean = false;

  readonly buffer: LineBuffer;
  private _info: SessionInfo;

  constructor(pid: number, cwd: string, name: string, maxBufferLines = 10000) {
    super();
    this.id = uuidv4();
    this.pid = pid;
    this.buffer = new LineBuffer(maxBufferLines);

    this._info = {
      id: this.id,
      pid,
      name,
      cwd,
      status: 'idle',
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      lineCount: 0,
      waitingForInput: false,
      connectedClients: [],
    };
  }

  // ────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────

  get info(): SessionInfo {
    return { ...this._info, lineCount: this.buffer.size };
  }

  updateStatus(status: SessionStatus): void {
    this._info.status = status;
  }

  /**
   * Spawn a new `claude` process in `cwd` via node-pty.
   * The daemon owns this PTY and can send input.
   */
  async spawn(cols = 220, rows = 50): Promise<void> {
    if (this.pty) return;

    // Lazy-load node-pty so the module can be tested without a native binding
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pty = require('node-pty') as typeof import('node-pty');

    this.pty = pty.spawn('claude', [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: this._info.cwd,
      env: process.env as Record<string, string>,
    });

    this.owned = true;
    this._info.status = 'active';

    this.pty.onData((data: string) => {
      this._handleRawData(data, 'stdout');
    });

    this.pty.onExit(() => {
      this._info.status = 'ended';
      this.pty = null;
      this.owned = false;
      this.emit('exit');
    });
  }

  /**
   * Attach to an external process by reading its stdout fd via /proc.
   * Creates a read-only (no-write) session.
   */
  async attach(): Promise<void> {
    if (this.pty || this.monitorStream) return;

    const fdPath = `/proc/${this.pid}/fd/1`;

    try {
      // Verify the fd exists and is readable
      fs.accessSync(fdPath, fs.constants.R_OK);
    } catch {
      logger.warn(
        `Session ${this.id}: cannot read ${fdPath} — monitoring as external-only`
      );
      this._info.status = 'active';
      // Still mark active; the scanner keeps the session alive by PID presence.
      this._startExitWatcher();
      return;
    }

    try {
      this.monitorStream = fs.createReadStream(fdPath, {
        encoding: 'utf8',
        autoClose: true,
      });

      this._info.status = 'active';

      this.monitorStream.on('data', (chunk: string | Buffer) => {
        const data = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        this._handleRawData(data, 'stdout');
      });

      this.monitorStream.on('error', (err) => {
        logger.debug(`Session ${this.id} monitor stream error: ${err.message}`);
        this.monitorStream = null;
      });

      this.monitorStream.on('close', () => {
        logger.debug(`Session ${this.id} monitor stream closed`);
        this.monitorStream = null;
      });
    } catch (err) {
      logger.debug(`Session ${this.id}: failed to open ${fdPath}: ${String(err)}`);
      this._info.status = 'active';
    }

    this._startExitWatcher();
  }

  /**
   * Send input to the owned PTY.
   * No-ops for external sessions (read-only).
   */
  write(data: string, clientId?: string): void {
    if (!this.owned || !this.pty) {
      logger.warn(
        `Session ${this.id}: write attempted on non-owned session (clientId=${clientId ?? 'unknown'})`
      );
      return;
    }

    // Record input in buffer
    const line = this.buffer.push({
      rawContent: data,
      content: data,
      timestamp: Date.now(),
      source: 'input',
      inputClientId: clientId,
    });

    this._info.lastActivityAt = Date.now();
    this.emit('data', [line]);

    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    if (!this.owned || !this.pty) return;
    this.pty.resize(cols, rows);
  }

  kill(): void {
    if (this.pty) {
      try {
        this.pty.kill();
      } catch {
        // already dead
      }
      this.pty = null;
    }

    if (this.monitorStream) {
      this.monitorStream.destroy();
      this.monitorStream = null;
    }

    this._info.status = 'ended';
  }

  // Typed overloads
  on(event: 'data', listener: (lines: BufferedLine[]) => void): this;
  on(event: 'exit', listener: () => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  // ────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────

  private _handleRawData(data: string, source: 'stdout' | 'stderr'): void {
    // Split on newlines, keep partial last line if needed
    const segments = data.split(/\r?\n/);
    const bufferedLines: BufferedLine[] = [];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      // Skip empty trailing segment caused by trailing newline
      if (i === segments.length - 1 && seg === '') continue;
      if (seg === undefined) continue;

      const line = this.buffer.push({
        rawContent: seg,
        content: seg,
        timestamp: Date.now(),
        source,
      });
      bufferedLines.push(line);
    }

    if (bufferedLines.length > 0) {
      this._info.lastActivityAt = Date.now();
      this._info.status = 'active';
      this.emit('data', bufferedLines);
    }
  }

  /**
   * Poll /proc/{pid} to detect when the external process exits.
   */
  private _startExitWatcher(): void {
    const procDir = `/proc/${this.pid}`;
    const timer = setInterval(() => {
      if (!fs.existsSync(procDir)) {
        clearInterval(timer);
        this._info.status = 'ended';
        this.emit('exit');
      }
    }, 2000);

    // Don't let this timer keep the process alive
    timer.unref();
  }
}

// Re-export for clarity
export type { SessionEvents };
