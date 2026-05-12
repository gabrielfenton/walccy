// ──────────────────────────────────────────────
// SessionEvent — the daemon→app wire event union
// ──────────────────────────────────────────────
//
// A discriminated union keyed on `kind`. Most kinds map 1:1 to a variant of
// the SDK's `SDKMessage`. Two kinds are walccy-specific (no SDK analogue):
//
//   - permission_request : raised by the daemon when canUseTool fires.
//                          App responds via a `resolve_permission` /
//                          `plan_accept` / `plan_reject` / `answer_question`
//                          ControlMessage to unblock the SDK callback.
//   - error              : daemon-internal errors that are not API mirror
//                          errors (transport drops, translator failures).
//
// The shape carries only what the UI renders. The translator may drop or
// coalesce SDK events (e.g., chains of content_block_delta become a single
// `assistant_text_delta` accumulating text) — see daemon stream-translator.

import type {
  PermissionMode,
  EffortLevel,
  PermissionUpdate,
  HookEvent,
  ModelUsage,
  McpServerStatus,
  SDKPermissionDenial,
} from './claude-stream.js';

// ──────────────────────────────────────────────
// Session metadata shapes carried inside events
// ──────────────────────────────────────────────

export interface SessionInitAgent {
  /** Agent name (matches `--agent` value). */
  name: string;
  /** Short description from the agent definition, if exposed. */
  description?: string;
}

/** MCP server snapshot at session init. Mirrors SDK's `McpServerStatus`. */
export type SessionInitMcpServer = McpServerStatus;

export interface SessionInitPlugin {
  name: string;
  path: string;
}

export interface TurnCost {
  /** Total USD spent on this turn. */
  total: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreateTokens?: number;
}

export interface RateLimitInfo {
  status: 'allowed' | 'allowed_warning' | 'rejected';
  resetsAt?: number;
  rateLimitType?: string;
  utilization?: number;
  overageStatus?: 'allowed' | 'allowed_warning' | 'rejected';
  overageResetsAt?: number;
  isUsingOverage?: boolean;
  surpassedThreshold?: number;
}

// ──────────────────────────────────────────────
// SessionEvent variants
// ──────────────────────────────────────────────

/** First event in a session. Hydrated from SDKSystemMessage subtype=init. */
export interface SessionEventInit {
  kind: 'init';
  sessionId: string;
  model: string;
  cwd: string;
  tools: string[];
  agents: SessionInitAgent[];
  skills: string[];
  slashCommands: string[];
  mcpServers: SessionInitMcpServer[];
  plugins: SessionInitPlugin[];
  permissionMode: PermissionMode;
  memoryPaths: Record<string, string>;
  outputStyle?: string;
  claudeCodeVersion?: string;
}

/**
 * Status pulse.
 *   - `requesting`/`compacting` come straight from `SDKStatusMessage.status`.
 *   - `idle` is daemon-synthesised: emitted when a `turn_complete` lands and
 *     no further `requesting` follows.
 */
export interface SessionEventStatus {
  kind: 'status';
  status: 'requesting' | 'compacting' | 'idle';
  permissionMode?: PermissionMode;
}

/** Anthropic rate limit transition. Drives the banner. */
export interface SessionEventRateLimit {
  kind: 'rate_limit';
  info: RateLimitInfo;
}

/** Incremental assistant text token (or short chunk). */
export interface SessionEventAssistantTextDelta {
  kind: 'assistant_text_delta';
  messageId: string;
  /** New text appended to this message's running text. */
  text: string;
}

/** Assistant text block finalized. `fullText` is the assembled string. */
export interface SessionEventAssistantTextDone {
  kind: 'assistant_text_done';
  messageId: string;
  fullText: string;
}

/** Incremental thinking token (extended thinking models). */
export interface SessionEventThinkingDelta {
  kind: 'thinking_delta';
  messageId: string;
  text: string;
}

/** Thinking block finalized. */
export interface SessionEventThinkingDone {
  kind: 'thinking_done';
  messageId: string;
  fullText: string;
  durationMs?: number;
}

/** Model invoked a tool. App renders the appropriate ToolCard. */
export interface SessionEventToolUse {
  kind: 'tool_use';
  messageId: string;
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
  /** Set for tools invoked by a sub-agent (Task) — used to group AgentCard. */
  parentToolUseId: string | null;
}

/** Tool produced a result. Drives state transition on the matching ToolCard. */
export interface SessionEventToolResult {
  kind: 'tool_result';
  toolUseId: string;
  /** Raw content array as sent back to the model. */
  content: unknown;
  isError: boolean;
  /** Bash/Edit/etc. expose structured fields here. */
  structured?: {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    isImage?: boolean;
    interrupted?: boolean;
    noOutputExpected?: boolean;
  };
}

/** Turn ended. Carries cost/usage/stop_reason for the SessionHeader. */
export interface SessionEventTurnComplete {
  kind: 'turn_complete';
  stopReason: string | null;
  durationMs: number;
  cost: TurnCost;
  modelUsage?: Record<string, ModelUsage>;
  permissionDenials?: SDKPermissionDenial[];
  /** Mirrored from result.subtype === 'success' vs 'error'. */
  isError: boolean;
  /** Mirrored from result.result text. */
  result?: string;
}

// ── Hook plane ──

export interface SessionEventHookStarted {
  kind: 'hook_started';
  hookId: string;
  event: HookEvent;
  toolUseId?: string;
  matcher?: string;
}

export interface SessionEventHookProgress {
  kind: 'hook_progress';
  hookId: string;
  message: string;
  data?: unknown;
}

export interface SessionEventHookResponse {
  kind: 'hook_response';
  hookId: string;
  decision: 'allow' | 'deny' | 'ask' | 'defer';
  reason?: string;
}

// ── Plugin / MCP / Auth plane ──

export interface SessionEventPluginInstall {
  kind: 'plugin_install';
  pluginId: string;
  status: 'fetching' | 'installing' | 'ready' | 'failed';
  message?: string;
}

/**
 * Auth bridge output. Carries the SDK fields verbatim plus an optional
 * per-server status snapshot the daemon may attach for UI rendering.
 */
export interface SessionEventAuthStatus {
  kind: 'auth_status';
  isAuthenticating: boolean;
  /** Output lines from the auth flow (e.g., OAuth URLs the user must visit). */
  output: string[];
  error?: string;
  /** Optional daemon-derived per-server state for the settings UI. */
  server?: McpServerStatus;
}

// ── Sub-agent (Task) plane ──

export interface SessionEventTaskStarted {
  kind: 'task_started';
  taskId: string;
  parentToolUseId?: string;
  description?: string;
}

export interface SessionEventTaskProgress {
  kind: 'task_progress';
  taskId: string;
  message: string;
}

export interface SessionEventTaskUpdated {
  kind: 'task_updated';
  taskId: string;
  /** Mirrors `SDKTaskUpdatedMessage.patch.status` + `SDKTaskNotificationMessage.status`. */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'killed' | 'stopped';
  /** Mirror of patch.description / patch.error / patch.is_backgrounded if changed. */
  description?: string;
  error?: string;
  isBackgrounded?: boolean;
}

// ── Misc ──

export interface SessionEventToolProgress {
  kind: 'tool_progress';
  toolUseId: string;
  progress: number; // 0..1
  message?: string;
}

export interface SessionEventMemoryRecall {
  kind: 'memory_recall';
  path: string;
  summary?: string;
}

export interface SessionEventCompactBoundary {
  kind: 'compact_boundary';
  /** From SDK `compact_metadata.trigger`. */
  trigger: 'manual' | 'auto';
  preTokens: number;
  postTokens?: number;
  durationMs?: number;
}

export interface SessionEventPermissionDenied {
  kind: 'permission_denied';
  toolUseId: string;
  toolName: string;
  reason: 'auto_deny' | 'user_reject' | 'hook_deny' | 'rule_deny' | 'other';
  detail?: string;
}

export interface SessionEventElicitationComplete {
  kind: 'elicitation_complete';
  toolUseId: string;
  result: unknown;
}

// ── Walccy-specific ──

/**
 * Daemon-raised event when canUseTool fires for a tool that needs UI gating
 * (ExitPlanMode, AskUserQuestion, or any tool we configure to ask). App
 * responds via a ControlMessage (`plan_accept`/`plan_reject`/
 * `answer_question`/generic `resolve_permission`) carrying the requestId.
 */
export interface SessionEventPermissionRequest {
  kind: 'permission_request';
  requestId: string;
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  /** Prompt sentence supplied by the SDK bridge, if any. */
  title?: string;
  description?: string;
  /** Permission-update suggestions ("always allow this tool"). */
  suggestions?: PermissionUpdate[];
  /** Set for sub-agent tool calls. */
  agentId?: string;
}

/**
 * Walccy-internal error. Use for translator/transport failures. API errors
 * surface as `turn_complete` with `isError: true`.
 */
export interface SessionEventError {
  kind: 'error';
  code: string;
  message: string;
  fatal: boolean;
}

// ──────────────────────────────────────────────
// SDK message variants intentionally NOT mapped
// ──────────────────────────────────────────────
//
// The SDKMessage union covers a few wire types the translator drops or
// folds into other events. F2 must keep this list current:
//
//   - SDKUserMessageReplay        — debugging replay, never user-visible.
//   - SDKAPIRetryMessage          — TODO: surface as status banner.
//   - SDKLocalCommandOutputMessage — TODO: render output (/voice, /usage).
//   - SDKNotificationMessage      — TODO: surface as toast.
//   - SDKSessionStateChangedMessage — TODO: SessionUpdatedMessage fan-out.
//   - SDKFilesPersistedEvent      — TODO: file-checkpoint UI.
//   - SDKPromptSuggestionMessage  — TODO: composer suggestion chips.
//   - SDKTaskNotificationMessage  — folded into task_updated.
//   - SDKToolUseSummaryMessage    — folded into the matching tool_use card.

// ──────────────────────────────────────────────
// Union + wrapper
// ──────────────────────────────────────────────

export type SessionEvent =
  | SessionEventInit
  | SessionEventStatus
  | SessionEventRateLimit
  | SessionEventAssistantTextDelta
  | SessionEventAssistantTextDone
  | SessionEventThinkingDelta
  | SessionEventThinkingDone
  | SessionEventToolUse
  | SessionEventToolResult
  | SessionEventTurnComplete
  | SessionEventHookStarted
  | SessionEventHookProgress
  | SessionEventHookResponse
  | SessionEventPluginInstall
  | SessionEventAuthStatus
  | SessionEventTaskStarted
  | SessionEventTaskProgress
  | SessionEventTaskUpdated
  | SessionEventToolProgress
  | SessionEventMemoryRecall
  | SessionEventCompactBoundary
  | SessionEventPermissionDenied
  | SessionEventElicitationComplete
  | SessionEventPermissionRequest
  | SessionEventError;

export type SessionEventKind = SessionEvent['kind'];

/** Map of kind → event variant — useful for typed switches downstream. */
export type SessionEventByKind = {
  [K in SessionEventKind]: Extract<SessionEvent, { kind: K }>;
};

/** Daemon → app WS broadcast envelope. */
export interface SessionEventMessage {
  type: 'SESSION_EVENT';
  sessionId: string;
  /** Monotonic index in the daemon's per-session ring buffer. */
  eventIndex: number;
  event: SessionEvent;
}

// ──────────────────────────────────────────────
// EventBuffer interface (daemon-side)
// ──────────────────────────────────────────────

/**
 * Per-session ring of `SessionEvent`s. Replaces the old `LineBuffer`. The
 * daemon writes events as they arrive from the SDK stream; clients read via
 * `getFrom(eventIndex)` to fill scrollback after reconnect (analogous to
 * the old `firstAvailableLine` gap-detection mechanic).
 */
export interface EventBuffer {
  push(event: SessionEvent): { event: SessionEvent; index: number };
  getFrom(startIndex: number): { events: SessionEvent[]; firstAvailableIndex: number };
  getTail(count: number): SessionEvent[];
  clear(): void;
  readonly size: number;
  readonly totalCount: number;
  /** Lowest event index still resident in the ring (0 when empty). */
  readonly firstAvailableIndex: number;
}

// ──────────────────────────────────────────────
// Re-export referenced enums for downstream consumers
// ──────────────────────────────────────────────

export type { PermissionMode, EffortLevel } from './claude-stream.js';
