// ──────────────────────────────────────────────
// Session — one ClaudeDriver, one EventBuffer
// ──────────────────────────────────────────────
//
// Stream-json era. A session is always a daemon-spawned Claude Agent SDK
// `query()` driver — no more PTY mode union, no attach/wrap. The driver
// emits typed `SessionEvent`s into the buffer; consumers (notification
// dispatcher, ws fan-out) subscribe to the session's typed event stream.

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import type {
  Session as SessionInfo,
  SessionStatus,
  SessionEvent,
  UserContentBlock,
  PermissionMode,
  AgentDefinition,
} from '@walccy/protocol';
import { ClaudeDriver, type ClaudeDriverOptions } from './claude-driver.js';
import { RingEventBuffer } from './event-buffer.js';
import logger from './logger.js';

// ──────────────────────────────────────────────
// Spawn options exposed to session-manager / spawn-handler
// ──────────────────────────────────────────────

export interface SessionSpawnOptions {
  cwd: string;
  /** Optional explicit display name (otherwise derived by SessionManager). */
  name?: string;
  permissionMode?: PermissionMode;
  model?: string;
  effortLevel?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  outputStyle?: string;
  worktree?: string | boolean;
  resumeSessionId?: string;
  agent?: string;
  agents?: Record<string, AgentDefinition>;
}

// ──────────────────────────────────────────────
// Session events (typed EventEmitter contract)
// ──────────────────────────────────────────────

export interface SessionEvents {
  /** A new SessionEvent landed in the buffer (with its assigned index). */
  'session-event': (event: SessionEvent, index: number) => void;
  /** The underlying driver stream ended (turn loop closed or stop()). */
  exit: () => void;
}

// ──────────────────────────────────────────────
// Session class
// ──────────────────────────────────────────────

export class Session extends EventEmitter {
  readonly id: string;
  /** Daemon doesn't own a child PID directly — the SDK manages that. */
  readonly pid: number = 0;

  private driver: ClaudeDriver | null = null;
  readonly buffer: RingEventBuffer;
  private _info: SessionInfo;

  constructor(name: string, cwd: string, maxBufferEvents = 10_000) {
    super();
    this.id = uuidv4();
    this.buffer = new RingEventBuffer({ maxEvents: maxBufferEvents });

    this._info = {
      id: this.id,
      pid: 0,
      name,
      cwd,
      status: 'idle',
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      waitingForInput: false,
      connectedClients: [],
      owned: true,
      costSoFar: 0,
      lastEventIndex: -1,
    };
  }

  // ────────────────────────────────────────────
  // Lifecycle
  // ────────────────────────────────────────────

  async spawn(opts: SessionSpawnOptions): Promise<void> {
    if (this.driver) {
      logger.warn(`Session ${this.id}: spawn called twice — ignoring`);
      return;
    }

    const extraArgs: Record<string, string | null> = {};
    if (opts.worktree !== undefined && opts.worktree !== false) {
      extraArgs['worktree'] = typeof opts.worktree === 'string' ? opts.worktree : null;
    }
    // NOTE: --output-style is not a Claude CLI flag (verified via `claude --help`,
    // claude-code v2.x). Output style is configured via `/output-style` slash
    // command or settings JSON instead. Stash the preference on session.info so
    // the UI can still display it, but don't pass it on the wire.
    if (opts.effortLevel) extraArgs['effort'] = opts.effortLevel;

    const driverOpts: ClaudeDriverOptions = {
      cwd: opts.cwd,
      permissionMode: opts.permissionMode,
      model: opts.model,
      agent: opts.agent,
      agents: opts.agents,
      resume: opts.resumeSessionId,
      env: this._sanitizedEnv(),
      extraArgs: Object.keys(extraArgs).length > 0 ? extraArgs : undefined,
    };
    if (opts.permissionMode) this._info.permissionMode = opts.permissionMode;
    if (opts.model) this._info.model = opts.model;
    if (opts.effortLevel) this._info.effortLevel = opts.effortLevel;

    this.driver = new ClaudeDriver(driverOpts);
    this.driver.on('event', (ev) => this._onEvent(ev));
    this.driver.on('end', () => {
      logger.info(`Session ${this.id}: driver stream ended`);
      this._info.status = 'ended';
      this.emit('exit');
    });
    this.driver.on('error', (err) => {
      logger.error(`Session ${this.id}: driver error: ${err.message}`);
      const errorEvent: SessionEvent = {
        kind: 'error',
        code: 'driver_error',
        message: err.message,
        fatal: false,
      };
      this._onEvent(errorEvent);
    });

    await this.driver.start();
    // Status stays 'idle' until the first `status: 'requesting'` event from
    // the SDK; without this the Composer would show its stop button before
    // any turn has even been requested.
  }

  /**
   * Send the user's next turn. `content` is multipart text+image content
   * matching MessageParam shape.
   */
  sendUserMessage(content: UserContentBlock[]): void {
    if (!this.driver) {
      logger.warn(`Session ${this.id}: sendUserMessage with no driver`);
      return;
    }
    this._info.lastActivityAt = Date.now();
    this._info.waitingForInput = false;
    this.driver.sendUserMessage(content);
  }

  async interrupt(): Promise<void> {
    if (!this.driver) return;
    await this.driver.interrupt();
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    if (!this.driver) return;
    await this.driver.setPermissionMode(mode);
    this._info.permissionMode = mode;
  }

  async setModel(model?: string): Promise<void> {
    if (!this.driver) return;
    await this.driver.setModel(model);
    this._info.model = model;
  }

  resolvePermission(args: {
    requestId: string;
    decision: 'allow' | 'deny';
    updatedInput?: Record<string, unknown>;
    message?: string;
  }): boolean {
    if (!this.driver) return false;
    return this.driver.resolvePermission(args);
  }

  resolveByToolUseId(args: {
    toolUseId: string;
    decision: 'allow' | 'deny';
    updatedInput?: Record<string, unknown>;
    message?: string;
  }): boolean {
    if (!this.driver) return false;
    return this.driver.resolveByToolUseId(args);
  }

  async kill(): Promise<void> {
    if (!this.driver) return;
    await this.driver.stop();
    this._info.status = 'ended';
  }

  // ────────────────────────────────────────────
  // Metadata
  // ────────────────────────────────────────────

  get info(): SessionInfo {
    return { ...this._info, lastEventIndex: this.buffer.totalCount - 1 };
  }

  updateStatus(status: SessionStatus): void {
    this._info.status = status;
  }

  setConnectedClients(clients: string[]): void {
    this._info.connectedClients = clients;
  }

  setName(name: string): void {
    this._info.name = name;
  }

  get owned(): boolean {
    // Daemon always owns the SDK driver in v2 — kept for protocol compat.
    return true;
  }

  // Typed overloads
  on<E extends keyof SessionEvents>(event: E, listener: SessionEvents[E]): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
  emit<E extends keyof SessionEvents>(
    event: E,
    ...args: Parameters<SessionEvents[E]>
  ): boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emit(event: string, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  // ────────────────────────────────────────────
  // Internal
  // ────────────────────────────────────────────

  private _onEvent(ev: SessionEvent): void {
    const { event, index } = this.buffer.push(ev);
    this._info.lastActivityAt = Date.now();

    // Drive session info from event kinds the UI cares about at the meta
    // level (status pill, waiting indicator, cost chip).
    switch (event.kind) {
      case 'init':
        if (event.model) this._info.model = event.model;
        if (event.permissionMode) this._info.permissionMode = event.permissionMode;
        // The driver captures the SDK session id from the same message that
        // produced this init event, so it's populated by now. Persist it on
        // session info so the resume id survives app reconnects.
        if (this.driver?.sdkSessionId) this._info.sdkSessionId = this.driver.sdkSessionId;
        break;
      case 'status':
        this._info.status =
          event.status === 'requesting' || event.status === 'compacting'
            ? 'active'
            : 'idle';
        if (event.permissionMode) this._info.permissionMode = event.permissionMode;
        break;
      case 'permission_request':
        // Surfaces the false→true edge that drives the push notification.
        this._info.waitingForInput = true;
        break;
      case 'turn_complete':
        this._info.status = 'idle';
        this._info.costSoFar = (this._info.costSoFar ?? 0) + event.cost.total;
        break;
      default:
        break;
    }

    this._info.lastEventIndex = index;
    this.emit('session-event', event, index);
  }

  /** Allowlisted env passthrough for the SDK child process. */
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
      const v = process.env[key];
      if (v !== undefined) env[key] = v;
    }
    return env;
  }
}
