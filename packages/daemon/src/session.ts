import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as net from 'net';
import { v4 as uuidv4 } from 'uuid';
import type { IPty } from 'node-pty';
import { LineBuffer } from './buffer.js';
import type { Session as SessionInfo, SessionStatus, BufferedLine } from '@walccy/protocol';
import logger from './logger.js';

// ──────────────────────────────────────────────
// Session mode (tagged union)
// ──────────────────────────────────────────────
//
// The runtime mode of a Session is represented as a discriminated union so
// every I/O method can switch on `mode.kind` and TypeScript will check
// exhaustiveness.  `null` means pre-init (constructed but not yet
// spawned/attached/wrapped) or post-kill.
//
//   spawn  — daemon owns a node-pty PTY (writable).
//   attach — read-only monitor on /proc/{pid}/fd/1; `stream` is null when fd
//            is a TTY (we skip the read stream to avoid stealing terminal
//            input) and the session is exit-watcher only.
//   wrap   — fed by `walccy wrap`; bidirectional via a unix socket, treated
//            as `owned` for UI purposes even though the PTY is on the
//            wrapper side.
//
type SessionMode =
  | { kind: 'spawn'; pty: IPty }
  | { kind: 'attach'; stream: fs.ReadStream | null }
  | { kind: 'wrap'; socket: net.Socket };

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

  /** Current runtime mode (null = pre-init / post-kill). */
  private mode: SessionMode | null = null;

  readonly buffer: LineBuffer;
  private _info: SessionInfo;
  /** Accumulates partial lines between data events. */
  private _partialLine: string = '';
  /** Timer for detecting idle state (waiting for input). */
  private _idleTimer: ReturnType<typeof setTimeout> | null = null;
  private _exitWatcher: ReturnType<typeof setInterval> | null = null;
  private _lastWriteRejectAt: number = 0;
  private static readonly IDLE_TIMEOUT_MS = 3000;
  private static readonly WRITE_REJECT_WARN_INTERVAL_MS = 5000;

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

  /** True when the daemon (or wrapper CLI) accepts writes for this session. */
  get owned(): boolean {
    const k = this.mode?.kind;
    return k === 'spawn' || k === 'wrap';
  }

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
    this.mode = { kind: 'wrap', socket };
    this._info.owned = true;
    this._info.status = 'active';

    socket.on('close', () => {
      // Only react if this is still the bound socket. kill() already does
      // snapshot-then-null on this.mode, so it'll have set mode=null before
      // calling socket.destroy(); in that path this handler short-circuits.
      if (this.mode?.kind === 'wrap' && this.mode.socket === socket) {
        this.mode = null;
        this._info.owned = false;
        this._info.status = 'ended';
        this.emit('exit');
      }
    });
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
    if (this.mode) return;

    // Lazy-load node-pty so the module can be tested without a native binding
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pty = require('node-pty') as typeof import('node-pty');

    const ptyProc = pty.spawn('claude', [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: this._info.cwd,
      env: this._sanitizedEnv(),
    });

    this.mode = { kind: 'spawn', pty: ptyProc };
    this._info.owned = true;
    this._info.status = 'active';

    ptyProc.onData((data: string) => {
      this._handleRawData(data, 'stdout');
    });

    ptyProc.onExit(() => {
      this._info.status = 'ended';
      // Only clear if we're still in spawn mode for this same pty — kill()
      // may have already transitioned us to null.
      if (this.mode?.kind === 'spawn' && this.mode.pty === ptyProc) {
        this.mode = null;
      }
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
    if (this.mode) return;

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
        this.mode = { kind: 'attach', stream: null };
        this._info.status = 'active';
        this._startExitWatcher();
        return;
      }
    } catch {
      logger.warn(
        `Session ${this.id}: cannot read ${fdPath} — monitoring as external-only`
      );
      this.mode = { kind: 'attach', stream: null };
      this._info.status = 'active';
      this._startExitWatcher();
      return;
    }

    try {
      const stream = fs.createReadStream(fdPath, {
        encoding: 'utf8',
        autoClose: true,
      });

      this.mode = { kind: 'attach', stream };
      this._info.status = 'active';

      stream.on('data', (chunk: string | Buffer) => {
        const data = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        this._handleRawData(data, 'stdout');
      });

      stream.on('error', (err) => {
        logger.debug(`Session ${this.id} monitor stream error: ${err.message}`);
        if (this.mode?.kind === 'attach') {
          this.mode = { kind: 'attach', stream: null };
        }
      });

      stream.on('close', () => {
        logger.debug(`Session ${this.id} monitor stream closed`);
        if (this.mode?.kind === 'attach') {
          this.mode = { kind: 'attach', stream: null };
        }
      });
    } catch (err) {
      logger.debug(`Session ${this.id}: failed to open ${fdPath}: ${String(err)}`);
      this.mode = { kind: 'attach', stream: null };
      this._info.status = 'active';
    }

    this._startExitWatcher();
  }

  private static readonly MAX_INPUT_LENGTH = 64 * 1024; // 64 KB

  /**
   * Send input to the owned PTY.
   * No-ops for external (attach) sessions (read-only).
   */
  write(data: string, clientId?: string): void {
    const mode = this.mode;
    if (!mode || mode.kind === 'attach') {
      const now = Date.now();
      const msg = `Session ${this.id}: write attempted on non-owned session (clientId=${clientId ?? 'unknown'})`;
      if (now - this._lastWriteRejectAt > Session.WRITE_REJECT_WARN_INTERVAL_MS) {
        logger.warn(msg);
        this._lastWriteRejectAt = now;
      } else {
        logger.debug(msg);
      }
      return;
    }

    if (data.length > Session.MAX_INPUT_LENGTH) {
      logger.warn(
        `Session ${this.id}: input too large (${data.length} bytes), truncating to ${Session.MAX_INPUT_LENGTH}`
      );
      data = data.slice(0, Session.MAX_INPUT_LENGTH);
    }

    this._info.lastActivityAt = Date.now();

    // Both wrap and spawn modes record stdout via the PTY echo, so we
    // don't synthesize an input-source line.  Skipping this also prevents
    // "(local) input line" + "(remote echo) stdout line" duplication in
    // mobile scrollback for any cooked-mode child (bash, sh).
    switch (mode.kind) {
      case 'wrap':
        mode.socket.write(
          JSON.stringify({
            type: 'INPUT',
            data: Buffer.from(data, 'utf8').toString('base64'),
          }) + '\n'
        );
        return;
      case 'spawn':
        mode.pty.write(data);
        return;
      default: {
        // Exhaustiveness guard
        const _exhaustive: never = mode;
        void _exhaustive;
        return;
      }
    }
  }

  resize(cols: number, rows: number): void {
    const mode = this.mode;
    if (!mode) return;
    switch (mode.kind) {
      case 'wrap':
        mode.socket.write(
          JSON.stringify({ type: 'RESIZE', cols, rows }) + '\n'
        );
        return;
      case 'spawn':
        mode.pty.resize(cols, rows);
        return;
      case 'attach':
        // read-only — no resize
        return;
      default: {
        const _exhaustive: never = mode;
        void _exhaustive;
        return;
      }
    }
  }

  kill(): void {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }

    if (this._exitWatcher) {
      clearInterval(this._exitWatcher);
      this._exitWatcher = null;
    }

    // Snapshot then clear `mode` BEFORE destroying the underlying resource —
    // socket.destroy() / pty.kill() can synchronously re-enter via 'close'
    // handlers, and we want those handlers to see a null mode.
    const mode = this.mode;
    this.mode = null;
    this._info.owned = false;

    if (mode) {
      switch (mode.kind) {
        case 'spawn':
          try {
            mode.pty.kill();
          } catch {
            // already dead
          }
          break;
        case 'attach':
          if (mode.stream) {
            mode.stream.destroy();
          }
          break;
        case 'wrap':
          try {
            mode.socket.destroy();
          } catch {
            // already closed
          }
          break;
        default: {
          const _exhaustive: never = mode;
          void _exhaustive;
        }
      }
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
        this._exitWatcher = null;
        this._info.status = 'ended';
        this.emit('exit');
      }
    }, 2000);

    this._exitWatcher = timer;

    // Don't let this timer keep the process alive
    timer.unref();
  }
}

// Re-export for clarity
export type { SessionEvents };
