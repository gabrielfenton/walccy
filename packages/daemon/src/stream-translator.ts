// ──────────────────────────────────────────────
// stream-translator — SDKMessage → SessionEvent
// ──────────────────────────────────────────────
//
// Pure functions. No I/O, no state outside what the caller threads through.
// One `translate(msg, ctx)` per SDKMessage; returns 0..N SessionEvents.
//
// The translator is intentionally lossy on a known set of SDK message
// variants (UserMessageReplay, APIRetry, LocalCommandOutput, Notification,
// SessionStateChanged, FilesPersisted, PromptSuggestion, ToolUseSummary,
// TaskNotification) — these get either dropped or folded into other
// events. See session-events.ts for the documented drop list.
//
// Coalescing of streaming deltas happens at the buffer layer
// (event-buffer.ts), not here. This module emits one delta event per SDK
// chunk; the buffer merges adjacent same-message entries.

import type {
  SessionEvent,
  SessionInitAgent,
  SessionInitMcpServer,
} from '@walccy/protocol';
import type {
  SDKMessage,
  SDKSystemMessage,
  SDKStatusMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKPartialAssistantMessage,
  SDKRateLimitEvent,
  SDKHookStartedMessage,
  SDKHookProgressMessage,
  SDKHookResponseMessage,
  SDKPluginInstallMessage,
  SDKAuthStatusMessage,
  SDKCompactBoundaryMessage,
  SDKTaskStartedMessage,
  SDKTaskProgressMessage,
  SDKTaskUpdatedMessage,
  SDKTaskNotificationMessage,
  SDKToolProgressMessage,
  SDKMemoryRecallMessage,
  SDKPermissionDeniedMessage,
  SDKElicitationCompleteMessage,
  SDKMirrorErrorMessage,
} from '@walccy/protocol';

/**
 * Per-session translator state. The SDK emits `SDKAssistantMessage` events
 * containing a list of content blocks; we expand each block into either a
 * `tool_use` or `assistant_text_done`/`thinking_done`. We do not need to
 * remember anything across calls — the SDK message is self-describing —
 * but a context object is reserved for future cases (e.g., turn-level
 * cost accumulation).
 */
export interface TranslatorContext {
  /** Reserved for per-session counters; unused today. */
  readonly sessionId?: string;
}

/**
 * Translate one SDKMessage into 0..N SessionEvents.
 *
 * Returning an empty array means "drop" (the SDK variant has no UI surface
 * in the current design).
 */
export function translate(
  msg: SDKMessage,
  _ctx?: TranslatorContext
): SessionEvent[] {
  switch (msg.type) {
    case 'system':
      return translateSystem(msg);
    case 'assistant':
      return translateAssistant(msg);
    case 'user':
      return translateUser(msg);
    case 'stream_event':
      return translateStreamEvent(msg as SDKPartialAssistantMessage);
    case 'result':
      return [translateResult(msg)];
    case 'rate_limit_event':
      return [translateRateLimit(msg)];
    case 'tool_progress':
      return [translateToolProgress(msg as SDKToolProgressMessage)];
    default:
      return translateFallback(msg);
  }
}

// ──────────────────────────────────────────────
// system/* — init, status, compact_boundary, task_*, plugin_install,
//             auth_status, memory_recall, permission_denied, mirror_error
// ──────────────────────────────────────────────

function translateSystem(
  msg: SDKMessage & { type: 'system' }
): SessionEvent[] {
  const sub = (msg as { subtype?: string }).subtype;
  switch (sub) {
    case 'init':
      return [translateInit(msg as SDKSystemMessage)];
    case 'status':
      return [translateStatus(msg as SDKStatusMessage)];
    case 'compact_boundary':
      return [translateCompactBoundary(msg as SDKCompactBoundaryMessage)];
    case 'task_started':
      return [translateTaskStarted(msg as SDKTaskStartedMessage)];
    case 'task_progress':
      return [translateTaskProgress(msg as SDKTaskProgressMessage)];
    case 'task_updated':
      return [translateTaskUpdated(msg as SDKTaskUpdatedMessage)];
    case 'task_notification':
      return [translateTaskNotification(msg as SDKTaskNotificationMessage)];
    case 'plugin_install':
      return [translatePluginInstall(msg as SDKPluginInstallMessage)];
    case 'memory_recall':
      return translateMemoryRecall(msg as SDKMemoryRecallMessage);
    case 'permission_denied':
      return [translatePermissionDenied(msg as SDKPermissionDeniedMessage)];
    case 'elicitation_complete':
      return [translateElicitationComplete(msg as SDKElicitationCompleteMessage)];
    case 'hook_started':
      return [translateHookStarted(msg as SDKHookStartedMessage)];
    case 'hook_progress':
      return [translateHookProgress(msg as SDKHookProgressMessage)];
    case 'hook_response':
      return [translateHookResponse(msg as SDKHookResponseMessage)];
    case 'mirror_error':
      return [translateMirrorError(msg as SDKMirrorErrorMessage)];
    default:
      return [];
  }
}

function translateInit(msg: SDKSystemMessage): SessionEvent {
  // SDK's `agents` is `string[]`; we flatten to {name} until the SDK
  // surfaces descriptions at init time.
  const agents: SessionInitAgent[] = (msg.agents ?? []).map((name) => ({
    name,
  }));
  const mcpServers: SessionInitMcpServer[] = (msg.mcp_servers ?? []).map(
    (s) => ({
      name: s.name,
      status: s.status as SessionInitMcpServer['status'],
    })
  );
  return {
    kind: 'init',
    sessionId: msg.session_id,
    model: msg.model,
    cwd: msg.cwd,
    tools: msg.tools,
    agents,
    skills: msg.skills,
    slashCommands: msg.slash_commands,
    mcpServers,
    plugins: msg.plugins.map((p) => ({ name: p.name, path: p.path })),
    permissionMode: msg.permissionMode,
    memoryPaths: {},
    outputStyle: msg.output_style,
    claudeCodeVersion: msg.claude_code_version,
  };
}

function translateStatus(msg: SDKStatusMessage): SessionEvent {
  // SDK `status` is `'compacting' | 'requesting' | null`. Null collapses to
  // a daemon-synthesised `idle`.
  const status =
    msg.status === null
      ? 'idle'
      : msg.status === 'requesting' || msg.status === 'compacting'
        ? msg.status
        : 'idle';
  return {
    kind: 'status',
    status,
    permissionMode: msg.permissionMode,
  };
}

function translateCompactBoundary(
  msg: SDKCompactBoundaryMessage
): SessionEvent {
  return {
    kind: 'compact_boundary',
    trigger: msg.compact_metadata.trigger,
    preTokens: msg.compact_metadata.pre_tokens,
    postTokens: msg.compact_metadata.post_tokens,
    durationMs: msg.compact_metadata.duration_ms,
  };
}

function translateTaskStarted(msg: SDKTaskStartedMessage): SessionEvent {
  return {
    kind: 'task_started',
    taskId: msg.task_id,
    parentToolUseId: msg.tool_use_id,
    description: msg.description,
  };
}

function translateTaskProgress(msg: SDKTaskProgressMessage): SessionEvent {
  return {
    kind: 'task_progress',
    taskId: msg.task_id,
    message: msg.description,
  };
}

function translateTaskUpdated(msg: SDKTaskUpdatedMessage): SessionEvent {
  return {
    kind: 'task_updated',
    taskId: msg.task_id,
    status: (msg.patch.status ?? 'running') as
      | 'pending'
      | 'running'
      | 'completed'
      | 'failed'
      | 'killed'
      | 'stopped',
    description: msg.patch.description,
    error: msg.patch.error,
    isBackgrounded: msg.patch.is_backgrounded,
  };
}

function translateTaskNotification(
  msg: SDKTaskNotificationMessage
): SessionEvent {
  return {
    kind: 'task_updated',
    taskId: msg.task_id,
    status: msg.status,
    description: msg.summary,
  };
}

function translatePluginInstall(msg: SDKPluginInstallMessage): SessionEvent {
  // SDK shape varies; we surface the minimum useful info.
  type M = { plugin_id?: string; pluginId?: string; status: string; message?: string };
  const m = msg as unknown as M;
  return {
    kind: 'plugin_install',
    pluginId: m.plugin_id ?? m.pluginId ?? 'unknown',
    status: (m.status as 'fetching' | 'installing' | 'ready' | 'failed') ?? 'installing',
    message: m.message,
  };
}

function translateMemoryRecall(
  msg: SDKMemoryRecallMessage
): SessionEvent[] {
  // SDK shape: { memories: Array<{ path, ... }> }. Emit one event per
  // recalled memory so consumers can render per-file recall UI.
  type M = { memories?: Array<{ path: string; summary?: string }> };
  const m = msg as unknown as M;
  const out: SessionEvent[] = [];
  for (const mem of m.memories ?? []) {
    out.push({ kind: 'memory_recall', path: mem.path, summary: mem.summary });
  }
  return out;
}

function translatePermissionDenied(
  msg: SDKPermissionDeniedMessage
): SessionEvent {
  type M = {
    tool_use_id?: string;
    tool_name?: string;
    reason?: string;
    detail?: string;
  };
  const m = msg as unknown as M;
  const reason: 'auto_deny' | 'user_reject' | 'hook_deny' | 'rule_deny' | 'other' =
    m.reason === 'auto_deny' ||
    m.reason === 'user_reject' ||
    m.reason === 'hook_deny' ||
    m.reason === 'rule_deny'
      ? m.reason
      : 'other';
  return {
    kind: 'permission_denied',
    toolUseId: m.tool_use_id ?? '',
    toolName: m.tool_name ?? '',
    reason,
    detail: m.detail,
  };
}

function translateElicitationComplete(
  msg: SDKElicitationCompleteMessage
): SessionEvent {
  type M = { tool_use_id?: string; result: unknown };
  const m = msg as unknown as M;
  return {
    kind: 'elicitation_complete',
    toolUseId: m.tool_use_id ?? '',
    result: m.result,
  };
}

function translateHookStarted(msg: SDKHookStartedMessage): SessionEvent {
  type M = {
    hook_id?: string;
    hookId?: string;
    event: import('@walccy/protocol').ClaudeStream.HookEvent;
    tool_use_id?: string;
    matcher?: string;
  };
  const m = msg as unknown as M;
  return {
    kind: 'hook_started',
    hookId: m.hook_id ?? m.hookId ?? '',
    event: m.event,
    toolUseId: m.tool_use_id,
    matcher: m.matcher,
  };
}

function translateHookProgress(msg: SDKHookProgressMessage): SessionEvent {
  type M = { hook_id?: string; hookId?: string; message?: string; data?: unknown };
  const m = msg as unknown as M;
  return {
    kind: 'hook_progress',
    hookId: m.hook_id ?? m.hookId ?? '',
    message: m.message ?? '',
    data: m.data,
  };
}

function translateHookResponse(msg: SDKHookResponseMessage): SessionEvent {
  type M = {
    hook_id?: string;
    hookId?: string;
    decision: 'allow' | 'deny' | 'ask' | 'defer';
    reason?: string;
  };
  const m = msg as unknown as M;
  return {
    kind: 'hook_response',
    hookId: m.hook_id ?? m.hookId ?? '',
    decision: m.decision,
    reason: m.reason,
  };
}

function translateMirrorError(msg: SDKMirrorErrorMessage): SessionEvent {
  type M = { code?: string; message?: string; fatal?: boolean };
  const m = msg as unknown as M;
  return {
    kind: 'error',
    code: m.code ?? 'mirror_error',
    message: m.message ?? 'mirror error',
    fatal: m.fatal ?? false,
  };
}

// ──────────────────────────────────────────────
// assistant — text / thinking / tool_use blocks
// ──────────────────────────────────────────────

function translateAssistant(msg: SDKAssistantMessage): SessionEvent[] {
  const out: SessionEvent[] = [];
  const messageId =
    typeof msg.message?.id === 'string' ? msg.message.id : 'unknown';
  const content = Array.isArray(msg.message?.content) ? msg.message.content : [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const type = (block as { type?: string }).type;
    if (type === 'text') {
      const text = (block as { text?: string }).text ?? '';
      out.push({ kind: 'assistant_text_done', messageId, fullText: text });
    } else if (type === 'thinking') {
      const text = (block as { thinking?: string }).thinking ?? '';
      out.push({ kind: 'thinking_done', messageId, fullText: text });
    } else if (type === 'tool_use') {
      const tu = block as {
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      };
      out.push({
        kind: 'tool_use',
        messageId,
        toolUseId: tu.id ?? '',
        name: tu.name ?? '',
        input: tu.input ?? {},
        parentToolUseId: msg.parent_tool_use_id ?? null,
      });
    }
  }
  return out;
}

// ──────────────────────────────────────────────
// user — tool_result echoes from previous tool_use
// ──────────────────────────────────────────────

function translateUser(msg: SDKUserMessage): SessionEvent[] {
  const content = Array.isArray(msg.message?.content) ? msg.message.content : [];
  const out: SessionEvent[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if ((block as { type?: string }).type !== 'tool_result') continue;
    const tr = block as {
      tool_use_id?: string;
      content?: unknown;
      is_error?: boolean;
    };
    out.push({
      kind: 'tool_result',
      toolUseId: tr.tool_use_id ?? '',
      content: tr.content,
      isError: tr.is_error ?? false,
      structured: extractStructured(msg.tool_use_result),
    });
  }
  return out;
}

function extractStructured(
  raw: unknown
):
  | {
      stdout?: string;
      stderr?: string;
      exitCode?: number;
      isImage?: boolean;
      interrupted?: boolean;
      noOutputExpected?: boolean;
    }
  | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: ReturnType<typeof extractStructured> = {};
  if (typeof r.stdout === 'string') out.stdout = r.stdout;
  if (typeof r.stderr === 'string') out.stderr = r.stderr;
  if (typeof r.exitCode === 'number') out.exitCode = r.exitCode;
  if (typeof r.isImage === 'boolean') out.isImage = r.isImage;
  if (typeof r.interrupted === 'boolean') out.interrupted = r.interrupted;
  if (typeof r.noOutputExpected === 'boolean') {
    out.noOutputExpected = r.noOutputExpected;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

// ──────────────────────────────────────────────
// stream_event — content_block_start / delta / stop, message_stop
// ──────────────────────────────────────────────

function translateStreamEvent(
  msg: SDKPartialAssistantMessage
): SessionEvent[] {
  // The SDK wraps the wire `stream_event` shape; the inner `event` is an
  // Anthropic API message-streaming event. We care about content_block_delta
  // for text and thinking.
  type Inner =
    | {
        type: 'content_block_start';
        index: number;
        content_block: { type: string };
      }
    | {
        type: 'content_block_delta';
        index: number;
        delta:
          | { type: 'text_delta'; text: string }
          | { type: 'input_json_delta'; partial_json: string }
          | { type: 'thinking_delta'; thinking: string }
          | { type: string };
      }
    | { type: 'content_block_stop'; index: number }
    | { type: 'message_stop' }
    | { type: string };
  const inner = (msg as unknown as { event?: Inner }).event;
  const parent = (msg as unknown as { uuid?: string; session_id?: string });
  const messageId = parent?.uuid ?? '';
  if (!inner || typeof inner !== 'object') return [];
  if (inner.type === 'content_block_delta' && 'delta' in inner) {
    const delta = inner.delta;
    if (delta.type === 'text_delta' && 'text' in delta) {
      return [
        {
          kind: 'assistant_text_delta',
          messageId,
          text: delta.text,
        },
      ];
    }
    if (delta.type === 'thinking_delta' && 'thinking' in delta) {
      return [
        {
          kind: 'thinking_delta',
          messageId,
          text: delta.thinking,
        },
      ];
    }
  }
  return [];
}

// ──────────────────────────────────────────────
// result — turn_complete
// ──────────────────────────────────────────────

function translateResult(msg: SDKResultMessage): SessionEvent {
  const isSuccess = msg.subtype === 'success';
  const successUsage = isSuccess
    ? (msg as Extract<SDKResultMessage, { subtype: 'success' }>).usage
    : null;
  return {
    kind: 'turn_complete',
    stopReason: msg.stop_reason,
    durationMs: msg.duration_ms,
    cost: {
      total: msg.total_cost_usd ?? 0,
      inputTokens: successUsage?.input_tokens ?? 0,
      outputTokens: successUsage?.output_tokens ?? 0,
      cacheReadTokens: successUsage?.cache_read_input_tokens,
      cacheCreateTokens: successUsage?.cache_creation_input_tokens,
    },
    modelUsage: (msg as { modelUsage?: Record<string, import('@walccy/protocol').ClaudeStream.ModelUsage> }).modelUsage,
    permissionDenials: isSuccess
      ? (msg as Extract<SDKResultMessage, { subtype: 'success' }>).permission_denials
      : undefined,
    isError: msg.is_error,
    result: isSuccess
      ? (msg as Extract<SDKResultMessage, { subtype: 'success' }>).result
      : undefined,
  };
}

// ──────────────────────────────────────────────
// rate_limit_event
// ──────────────────────────────────────────────

function translateRateLimit(msg: SDKRateLimitEvent): SessionEvent {
  return {
    kind: 'rate_limit',
    info: {
      status: msg.rate_limit_info.status,
      resetsAt: msg.rate_limit_info.resetsAt,
      rateLimitType: msg.rate_limit_info.rateLimitType,
      utilization: msg.rate_limit_info.utilization,
      overageStatus: msg.rate_limit_info.overageStatus,
      overageResetsAt: msg.rate_limit_info.overageResetsAt,
      isUsingOverage: msg.rate_limit_info.isUsingOverage,
      surpassedThreshold: msg.rate_limit_info.surpassedThreshold,
    },
  };
}

// ──────────────────────────────────────────────
// tool_progress
// ──────────────────────────────────────────────

function translateToolProgress(msg: SDKToolProgressMessage): SessionEvent {
  type M = {
    tool_use_id?: string;
    progress?: number;
    message?: string;
  };
  const m = msg as unknown as M;
  return {
    kind: 'tool_progress',
    toolUseId: m.tool_use_id ?? '',
    progress: m.progress ?? 0,
    message: m.message,
  };
}

// ──────────────────────────────────────────────
// fallback — unmapped SDK variants drop silently
// ──────────────────────────────────────────────

function translateFallback(_msg: SDKMessage): SessionEvent[] {
  // See session-events.ts "intentionally NOT mapped" comment for the list.
  return [];
}

// ──────────────────────────────────────────────
// Auth status — invoked directly by daemon, not via translate()
// ──────────────────────────────────────────────

/**
 * Build a `permission_request` event for canUseTool to surface to the app.
 * Lives here so all SDK→walccy translation has one home.
 */
export function buildPermissionRequest(args: {
  requestId: string;
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  title?: string;
  description?: string;
  suggestions?: import('@walccy/protocol').ClaudeStream.PermissionUpdate[];
  agentId?: string;
}): SessionEvent {
  return {
    kind: 'permission_request',
    requestId: args.requestId,
    toolUseId: args.toolUseId,
    toolName: args.toolName,
    input: args.input,
    title: args.title,
    description: args.description,
    suggestions: args.suggestions,
    agentId: args.agentId,
  };
}

/** Build the SDKAuthStatusMessage→SessionEventAuthStatus mapping helper. */
export function translateAuthStatus(
  msg: SDKAuthStatusMessage,
  server?: import('@walccy/protocol').McpServerStatus | undefined
): SessionEvent {
  return {
    kind: 'auth_status',
    isAuthenticating: msg.isAuthenticating,
    output: msg.output,
    error: msg.error,
    server,
  };
}
