// ──────────────────────────────────────────────
// claude-driver — owns one @anthropic-ai/claude-agent-sdk Query
// ──────────────────────────────────────────────
//
// One driver instance ↔ one walccy session ↔ one SDK `query()` call.
// Drives a duplex stream: stdin (user messages, async-iterable) and stdout
// (an AsyncGenerator<SDKMessage>). canUseTool is wired here; permission
// resolutions are unblocked by the daemon's message-router on incoming
// app ControlMessages.

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import {
  query,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type CanUseTool,
  type PermissionResult,
  type PermissionMode,
  type AgentDefinition,
  type Options,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  SessionEvent,
  UserContentBlock,
} from '@walccy/protocol';
import { translate, buildPermissionRequest } from './stream-translator.js';
import logger from './logger.js';

// ──────────────────────────────────────────────
// Resolve the claude CLI executable
// ──────────────────────────────────────────────
//
// The SDK's default executable lookup expects a native installer layout
// (node_modules/@anthropic-ai/claude-agent-sdk-<platform>/claude) that
// isn't there when claude was installed via nvm/npm-global. We resolve
// once at module load via `which claude` and pass the absolute path to
// each query() invocation. WALCCY_CLAUDE_PATH overrides for tests.

let cachedClaudePath: string | undefined;

function resolveClaudePath(): string | undefined {
  if (cachedClaudePath !== undefined) return cachedClaudePath || undefined;
  const override = process.env['WALCCY_CLAUDE_PATH'];
  if (override && fs.existsSync(override)) {
    cachedClaudePath = override;
    return cachedClaudePath;
  }
  try {
    const out = execFileSync('which', ['claude'], { encoding: 'utf8' }).trim();
    if (out && fs.existsSync(out)) {
      cachedClaudePath = out;
      logger.info(`ClaudeDriver: resolved claude binary → ${out}`);
      return cachedClaudePath;
    }
  } catch {
    // fall through
  }
  // Empty string sentinel = looked but didn't find; SDK will use its default.
  cachedClaudePath = '';
  return undefined;
}

// ──────────────────────────────────────────────
// User-message input queue
// ──────────────────────────────────────────────
//
// The SDK accepts `AsyncIterable<SDKUserMessage>` as the prompt. We expose
// a `push()` method that resolves the pending iterator step, so user turns
// arrive on demand. The queue stays open for the life of the driver.

interface QueuedMessage {
  content: UserContentBlock[];
  /** Optional resume of an existing message id; otherwise daemon generates. */
  parent_tool_use_id?: string | null;
}

class UserMessageQueue {
  private buffer: QueuedMessage[] = [];
  private waiter: ((msg: QueuedMessage | null) => void) | null = null;
  private closed = false;

  push(msg: QueuedMessage): void {
    if (this.closed) {
      logger.warn('UserMessageQueue: push after close — dropping message');
      return;
    }
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(msg);
    } else {
      this.buffer.push(msg);
    }
  }

  close(): void {
    this.closed = true;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(null);
    }
  }

  async *iter(sessionId: () => string): AsyncIterable<SDKUserMessage> {
    while (true) {
      let next: QueuedMessage | null;
      if (this.buffer.length > 0) {
        next = this.buffer.shift()!;
      } else if (this.closed) {
        return;
      } else {
        next = await new Promise<QueuedMessage | null>((resolve) => {
          this.waiter = resolve;
        });
      }
      if (next === null) return;
      // SDK accepts MessageParam content as either string or block array; we
      // always pass blocks (matches multipart text+image shape).
      const userMsg = {
        type: 'user' as const,
        message: {
          role: 'user' as const,
          // The block shapes carried by walccy match Anthropic's MessageParam
          // content types at runtime; the cast is necessary because their
          // public TS shape uses branded discriminants from a different
          // import path.
          content: next.content,
        },
        parent_tool_use_id: next.parent_tool_use_id ?? null,
        session_id: sessionId(),
      };
      yield userMsg as unknown as SDKUserMessage;
    }
  }
}

// ──────────────────────────────────────────────
// Pending permission table
// ──────────────────────────────────────────────

interface PendingPermission {
  requestId: string;
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  resolve: (result: PermissionResult) => void;
}

// ──────────────────────────────────────────────
// Driver options + events
// ──────────────────────────────────────────────

export interface ClaudeDriverOptions {
  cwd: string;
  /** Initial permission mode for the SDK. Defaults to `default`. */
  permissionMode?: PermissionMode;
  /** Model alias or full id. */
  model?: string;
  /** Custom agents map for `--agents`. */
  agents?: Record<string, AgentDefinition>;
  /** Built-in agent name for `--agent`. */
  agent?: string;
  /** Tool restrictions. */
  tools?: Options['tools'];
  allowedTools?: string[];
  disallowedTools?: string[];
  additionalDirectories?: string[];
  /** Resume a previous session id (used after Stop button respawn). */
  resume?: string;
  /** Forks the resumed session into a fresh id (for branching). */
  forkSession?: boolean;
  /** Environment passthrough; defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Extra CLI args (e.g., --worktree, --output-style). */
  extraArgs?: Record<string, string | null>;
}

export interface ClaudeDriverEvents {
  event: (event: SessionEvent) => void;
  end: () => void;
  error: (err: Error) => void;
}

// ──────────────────────────────────────────────
// ClaudeDriver
// ──────────────────────────────────────────────

export class ClaudeDriver extends EventEmitter {
  private inputQueue = new UserMessageQueue();
  private q: Query | null = null;
  private pending = new Map<string, PendingPermission>();
  private currentSessionId = '';
  private started = false;
  private stopped = false;

  constructor(private readonly opts: ClaudeDriverOptions) {
    super();
  }

  /** Begin pumping. Resolves when the first SDK message arrives. */
  async start(): Promise<void> {
    if (this.started) throw new Error('ClaudeDriver: already started');
    this.started = true;

    const canUseTool: CanUseTool = (toolName, input, callbackOptions) =>
      this.handlePermissionRequest(toolName, input, callbackOptions);

    const options: Options = {
      cwd: this.opts.cwd,
      permissionMode: this.opts.permissionMode,
      model: this.opts.model,
      agents: this.opts.agents,
      agent: this.opts.agent,
      tools: this.opts.tools,
      allowedTools: this.opts.allowedTools,
      disallowedTools: this.opts.disallowedTools,
      additionalDirectories: this.opts.additionalDirectories,
      resume: this.opts.resume,
      forkSession: this.opts.forkSession,
      env: this.opts.env ?? process.env,
      extraArgs: this.opts.extraArgs,
      pathToClaudeCodeExecutable: resolveClaudePath(),
      canUseTool,
      includePartialMessages: true,
      stderr: (data) => {
        const trimmed = data.trim();
        if (trimmed.length > 0) {
          logger.warn(`[claude stderr] ${trimmed}`);
        }
      },
    };

    // Cast the prompt source: the SDK accepts `AsyncIterable<SDKUserMessage>`
    // but its public type lives behind several import paths. The narrowed
    // shape we yield is compatible at runtime.
    const promptIter = this.inputQueue.iter(() => this.currentSessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.q = query({ prompt: promptIter as any, options });

    // Pump in the background.
    this.pump().catch((err) => {
      logger.error(`ClaudeDriver pump error: ${err}`);
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    });
  }

  private async pump(): Promise<void> {
    if (!this.q) return;
    try {
      for await (const msg of this.q) {
        this.captureSessionId(msg);
        const events = translate(msg);
        for (const ev of events) this.emit('event', ev);
      }
    } catch (err) {
      logger.error(`ClaudeDriver pump caught: ${err}`);
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.emit('end');
    }
  }

  private captureSessionId(msg: SDKMessage): void {
    const sid = (msg as { session_id?: string }).session_id;
    if (typeof sid === 'string' && sid.length > 0) {
      this.currentSessionId = sid;
    }
  }

  /** SDK session id (assigned after init). Empty string before. */
  get sdkSessionId(): string {
    return this.currentSessionId;
  }

  // ── Control plane ──

  sendUserMessage(content: UserContentBlock[]): void {
    if (this.stopped) {
      logger.warn('ClaudeDriver.sendUserMessage after stop — dropped');
      return;
    }
    this.inputQueue.push({ content });
  }

  async interrupt(): Promise<void> {
    if (!this.q) return;
    await this.q.interrupt();
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    if (!this.q) return;
    await this.q.setPermissionMode(mode);
  }

  async setModel(model?: string): Promise<void> {
    if (!this.q) return;
    await this.q.setModel(model);
  }

  /** Stop the driver. Idempotent. Closes input; SDK pump drains. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.inputQueue.close();
    if (this.q) {
      try {
        await this.q.interrupt();
      } catch (err) {
        logger.warn(`ClaudeDriver.stop interrupt failed: ${err}`);
      }
    }
  }

  // ── Permission plane ──

  private handlePermissionRequest(
    toolName: string,
    input: Record<string, unknown>,
    cb: Parameters<CanUseTool>[2]
  ): Promise<PermissionResult> {
    return new Promise<PermissionResult>((resolve) => {
      const requestId = randomUUID();
      const pending: PendingPermission = {
        requestId,
        toolUseId: cb.toolUseID,
        toolName,
        input,
        resolve,
      };
      this.pending.set(requestId, pending);
      this.emit(
        'event',
        buildPermissionRequest({
          requestId,
          toolUseId: cb.toolUseID,
          toolName,
          input,
          title: cb.title,
          description: cb.description,
          suggestions: cb.suggestions,
          agentId: cb.agentID,
        })
      );
      // If the abort signal fires (e.g., interrupt during pending prompt),
      // resolve as deny so the SDK can unwind cleanly.
      cb.signal.addEventListener('abort', () => {
        if (this.pending.delete(requestId)) {
          resolve({ behavior: 'deny', message: 'aborted' });
        }
      });
    });
  }

  /**
   * App-side decision arrived. `decision` becomes `behavior`. `updatedInput`
   * lets the app rewrite the tool call (used by AskUserQuestion to pass the
   * user's answer back as the tool input).
   */
  resolvePermission(args: {
    requestId: string;
    decision: 'allow' | 'deny';
    updatedInput?: Record<string, unknown>;
    message?: string;
  }): boolean {
    const pending = this.pending.get(args.requestId);
    if (!pending) return false;
    this.pending.delete(args.requestId);
    if (args.decision === 'allow') {
      pending.resolve({
        behavior: 'allow',
        updatedInput: args.updatedInput ?? pending.input,
      });
    } else {
      pending.resolve({
        behavior: 'deny',
        message: args.message ?? 'user rejected',
        interrupt: false,
      });
    }
    return true;
  }

  /** Helper for plan/answer paths — same as resolvePermission with allow. */
  resolveByToolUseId(args: {
    toolUseId: string;
    decision: 'allow' | 'deny';
    updatedInput?: Record<string, unknown>;
    message?: string;
  }): boolean {
    for (const [requestId, pending] of this.pending.entries()) {
      if (pending.toolUseId === args.toolUseId) {
        return this.resolvePermission({
          requestId,
          decision: args.decision,
          updatedInput: args.updatedInput,
          message: args.message,
        });
      }
    }
    return false;
  }
}

// ──────────────────────────────────────────────
// Typed EventEmitter overrides
// ──────────────────────────────────────────────

export declare interface ClaudeDriver {
  on<E extends keyof ClaudeDriverEvents>(
    event: E,
    listener: ClaudeDriverEvents[E]
  ): this;
  emit<E extends keyof ClaudeDriverEvents>(
    event: E,
    ...args: Parameters<ClaudeDriverEvents[E]>
  ): boolean;
}
