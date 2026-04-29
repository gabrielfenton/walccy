import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as net from 'net';
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
  /** Wrapper-CLI socket — set when this session is fed by `walccy wrap`. */
  private wrapperSocket: net.Socket | null = null;
  /** Whether we own the PTY (can accept writes). */
  private owned: boolean = false;

  readonly buffer: LineBuffer;
  private _info: SessionInfo;
  /** Accumulates partial lines between data events. */
  private _partialLine: string = '';
  /** Timer for detecting idle state (waiting for input). */
  private _idleTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly IDLE_TIMEOUT_MS = 3000;

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
      owned: false,
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

  setConnectedClients(clients: string[]): void {
    this._info.connectedClients = clients;
  }

  /**
   * Bind a wrapper-CLI socket to this session.  Output bytes will arrive via
   * `pushExternalData()` and writes initiated by daemon clients will be sent
   * back through the socket so the wrapper can feed them to the local PTY.
   * Input is bidirectional, so the session is treated as `owned` for UI
   * purposes — the read-only banner won't show.
   */
  attachWrapper(socket: net.Socket): void {
    this.wrapperSocket = socket;
    this.owned = true;
    this._info.owned = true;
    this._info.status = 'active';
  }

  /** Feed raw output from a wrapper-CLI socket into this session's buffer. */
  pushExternalData(data: string): void {
    this._handleRawData(data, 'stdout');
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
      env: this._sanitizedEnv(),
    });

    this.owned = true;
    this._info.owned = true;
    this._info.status = 'active';

    this.pty.onData((data: string) => {
      this._handleRawData(data, 'stdout');
    });

    this.pty.onExit(() => {
      this._info.status = 'ended';
      this.pty = null;
      this.owned = false;
      this._info.owned = false;
      this.emit('exit');
    });
  }

  /**
   * Attach to an external process by reading its stdout fd via /proc.
   * Creates a read-only (no-write) session.
   *
   * **Limitation:** Reading `/proc/{pid}/fd/1` only works reliably when the
   * fd points to a regular file or a pipe whose other end is not being consumed
   * concurrently. If fd/1 is a TTY, reads may return terminal input rather than
   * output, or race with the terminal driver. For best results, prefer
   * daemon-spawned sessions (where we own the PTY master).
   */
  async attach(): Promise<void> {
    if (this.pty || this.monitorStream) return;

    const fdPath = `/proc/${this.pid}/fd/1`;

    // Verify the fd exists, is readable, and check what it points to
    try {
      fs.accessSync(fdPath, fs.constants.R_OK);
      const realPath = fs.readlinkSync(fdPath);
      // If fd points to a TTY, do NOT open a read stream — reading from a PTY
      // slave competes with the terminal emulator for input, which blocks the
      // user from typing.  Monitor as external-only (exit watcher only).
      if (realPath.startsWith('/dev/pts/') || realPath.startsWith('/dev/tty')) {
        logger.warn(
          `Session ${this.id}: fd/1 points to ${realPath} (TTY) — skipping output monitor to avoid stealing terminal input`
        );
        this._info.status = 'active';
        this._startExitWatcher();
        return;
      }
    } catch {
      logger.warn(
        `Session ${this.id}: cannot read ${fdPath} — monitoring as external-only`
      );
      this._info.status = 'active';
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

  private static readonly MAX_INPUT_LENGTH = 64 * 1024; // 64 KB

  /**
   * Send input to the owned PTY.
   * No-ops for external sessions (read-only).
   */
  write(data: string, clientId?: string): void {
    if (!this.owned || (!this.pty && !this.wrapperSocket)) {
      logger.warn(
        `Session ${this.id}: write attempted on non-owned session (clientId=${clientId ?? 'unknown'})`
      );
      return;
    }

    if (data.length > Session.MAX_INPUT_LENGTH) {
      logger.warn(
        `Session ${this.id}: input too large (${data.length} bytes), truncating to ${Session.MAX_INPUT_LENGTH}`
      );
      data = data.slice(0, Session.MAX_INPUT_LENGTH);
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

    if (this.wrapperSocket) {
      this.wrapperSocket.write(
        JSON.stringify({
          type: 'INPUT',
          data: Buffer.from(data, 'utf8').toString('base64'),
        }) + '\n'
      );
    } else if (this.pty) {
      this.pty.write(data);
    }
  }

  resize(cols: number, rows: number): void {
    if (this.wrapperSocket) {
      this.wrapperSocket.write(
        JSON.stringify({ type: 'RESIZE', cols, rows }) + '\n'
      );
      return;
    }
    if (!this.owned || !this.pty) return;
    this.pty.resize(cols, rows);
  }

  kill(): void {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }

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

    if (this.wrapperSocket) {
      try {
        this.wrapperSocket.destroy();
      } catch {
        // already closed
      }
      this.wrapperSocket = null;
    }

    this._info.status = 'ended';
  }

  // Typed overloads
  on(event: 'data', listener: (lines: BufferedLine[]) => void): this;
  on(event: 'exit', listener: () => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  // ────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────

  private _handleRawData(data: string, source: 'stdout' | 'stderr'): void {
    // Prepend any partial line from the previous chunk
    const combined = this._partialLine + data;
    const segments = combined.split(/\r?\n/);
    const bufferedLines: BufferedLine[] = [];

    // The last segment is either empty (if data ended with \n) or a partial line
    // to be carried over to the next data event.
    this._partialLine = segments.pop() ?? '';

    for (const seg of segments) {
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

      // Clear waitingForInput — new output means Claude is working
      if (this._info.waitingForInput) {
        this._info.waitingForInput = false;
      }

      this.emit('data', bufferedLines);

      // Reset the idle timer — if no output arrives for IDLE_TIMEOUT_MS,
      // assume Claude is waiting for user input
      this._resetIdleTimer();
    }
  }

  private _resetIdleTimer(): void {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
    }
    this._idleTimer = setTimeout(() => {
      this._idleTimer = null;
      if (this._info.status === 'active' && !this._info.waitingForInput) {
        this._info.waitingForInput = true;
        // Emit an update so the WS server broadcasts the state change
        this.emit('data', []);
      }
    }, Session.IDLE_TIMEOUT_MS);
    this._idleTimer.unref();
  }

  /**
   * Build a sanitized environment for spawned processes.
   * Only passes through safe, well-known variables.
   */
  private _sanitizedEnv(): Record<string, string> {
    const allowlist = [
      'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE',
      'PATH', 'TERM', 'COLORTERM', 'EDITOR', 'VISUAL',
      'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_RUNTIME_DIR',
      'SSH_AUTH_SOCK', 'GPG_AGENT_INFO',
      'NODE_ENV', 'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY',
    ];
    const env: Record<string, string> = {};
    for (const key of allowlist) {
      if (process.env[key] !== undefined) {
        env[key] = process.env[key]!;
      }
    }
    return env;
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
