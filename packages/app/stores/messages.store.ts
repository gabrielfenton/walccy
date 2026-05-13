// ──────────────────────────────────────────────
// messages.store — chat-side reducer over SessionEvent
// ──────────────────────────────────────────────
//
// Replaces output.store. The reducer turns a daemon SessionEvent stream
// into an ordered list of view-model entries that map 1:1 onto components
// in MessageList (UserBubble, AssistantMessage, ThinkingCard, ToolCard,
// QuestionCard / PlanCard, ErrorCard, TurnSummary). One entry per visible
// thing in the chat.
//
// Events the reducer ignores today (silently dropped) will land in their
// own entry types as F9..F20 add their cards (hook, task, plugin install,
// memory recall, compact boundary, etc.). Adding a new kind doesn't break
// existing renders — the registry maps known kinds to components and
// unknown kinds fall through.

import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type {
  SessionEvent,
  UserContentBlock,
  RateLimitInfo,
  TurnCost,
} from '@walccy/protocol';

const MAX_ENTRIES_PER_SESSION = 2000;

// ──────────────────────────────────────────────
// View-model entry shapes
// ──────────────────────────────────────────────

export interface ChatEntryUser {
  kind: 'user';
  id: string;
  timestamp: number;
  content: UserContentBlock[];
}

export interface ChatEntryAssistant {
  kind: 'assistant';
  id: string;
  /** SDK message id; used to coalesce subsequent deltas. */
  messageId: string;
  timestamp: number;
  text: string;
  streaming: boolean;
}

export interface ChatEntryThinking {
  kind: 'thinking';
  id: string;
  messageId: string;
  timestamp: number;
  text: string;
  streaming: boolean;
}

export type ToolState = 'running' | 'complete' | 'error';

export interface ChatEntryTool {
  kind: 'tool';
  id: string;
  /** Toolu_… from the SDK; used to pair tool_use with tool_result. */
  toolUseId: string;
  /** Parent toolUseId when the call came from a sub-agent. */
  parentToolUseId: string | null;
  toolName: string;
  input: Record<string, unknown>;
  state: ToolState;
  result?: unknown;
  structured?: {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    isImage?: boolean;
    interrupted?: boolean;
    noOutputExpected?: boolean;
  };
  timestamp: number;
}

export interface ChatEntryPermissionRequest {
  kind: 'permission_request';
  id: string;
  requestId: string;
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  title?: string;
  description?: string;
  /** Set after the user answers; UI dims the card. */
  resolved?: 'allowed' | 'denied';
  timestamp: number;
}

export interface ChatEntryTurnSummary {
  kind: 'turn_summary';
  id: string;
  stopReason: string | null;
  durationMs: number;
  cost: TurnCost;
  isError: boolean;
  timestamp: number;
}

export interface ChatEntryError {
  kind: 'error';
  id: string;
  code: string;
  message: string;
  fatal: boolean;
  timestamp: number;
}

export type ChatEntry =
  | ChatEntryUser
  | ChatEntryAssistant
  | ChatEntryThinking
  | ChatEntryTool
  | ChatEntryPermissionRequest
  | ChatEntryTurnSummary
  | ChatEntryError;

// ──────────────────────────────────────────────
// Per-session buffer
// ──────────────────────────────────────────────

interface MessagesBuffer {
  entries: ChatEntry[];
  /** Highest event index applied (for gap detection on resume). */
  lastEventIndex: number;
  /** Set after the daemon's HISTORY snapshot lands. */
  historyLoaded: boolean;
  /** Latest rate-limit info; drives the banner. */
  rateLimit?: RateLimitInfo;
}

function emptyBuffer(): MessagesBuffer {
  return {
    entries: [],
    lastEventIndex: -1,
    historyLoaded: false,
  };
}

function clamp(entries: ChatEntry[]): ChatEntry[] {
  if (entries.length <= MAX_ENTRIES_PER_SESSION) return entries;
  return entries.slice(entries.length - MAX_ENTRIES_PER_SESSION);
}

// ──────────────────────────────────────────────
// Reducer — apply one SessionEvent to a buffer (in place)
// ──────────────────────────────────────────────

function applyEvent(buf: MessagesBuffer, event: SessionEvent): void {
  switch (event.kind) {
    case 'assistant_text_delta': {
      // The SDK tags every `stream_event` envelope with a unique uuid, so
      // delta messageIds differ within one logical message. Coalesce by
      // "most-recent-streaming assistant entry" rather than messageId match
      // — same heuristic the done case uses to reconcile.
      const idx = findLastStreamingAssistantIdx(buf.entries);
      if (idx >= 0) {
        const prev = buf.entries[idx] as ChatEntryAssistant;
        buf.entries[idx] = { ...prev, text: prev.text + event.text, streaming: true };
        return;
      }
      buf.entries.push({
        kind: 'assistant',
        id: uuid(),
        messageId: event.messageId,
        timestamp: Date.now(),
        text: event.text,
        streaming: true,
      });
      return;
    }
    case 'assistant_text_done': {
      // Prefer exact messageId match, but the SDK streams `content_block_delta`
      // events tagged with the envelope `uuid` while `assistant`/`message_start`
      // carries the canonical `msg_…` id — they never match. Fall back to the
      // most recent streaming assistant entry and reconcile its messageId.
      const exactIdx = findAssistantIdx(buf.entries, event.messageId);
      const idx = exactIdx >= 0 ? exactIdx : findLastStreamingAssistantIdx(buf.entries);
      if (idx >= 0) {
        const prev = buf.entries[idx] as ChatEntryAssistant;
        buf.entries[idx] = { ...prev, text: event.fullText, streaming: false, messageId: event.messageId };
      } else {
        buf.entries.push({
          kind: 'assistant',
          id: uuid(),
          messageId: event.messageId,
          timestamp: Date.now(),
          text: event.fullText,
          streaming: false,
        });
      }
      return;
    }
    case 'thinking_delta': {
      // Same delta-uuid-churn issue as assistant_text_delta — coalesce by
      // most-recent-streaming thinking entry, not by messageId.
      const idx = findLastStreamingThinkingIdx(buf.entries);
      if (idx >= 0) {
        const prev = buf.entries[idx] as ChatEntryThinking;
        buf.entries[idx] = { ...prev, text: prev.text + event.text, streaming: true };
        return;
      }
      buf.entries.push({
        kind: 'thinking',
        id: uuid(),
        messageId: event.messageId,
        timestamp: Date.now(),
        text: event.text,
        streaming: true,
      });
      return;
    }
    case 'thinking_done': {
      const exactIdx = findThinkingIdx(buf.entries, event.messageId);
      const idx = exactIdx >= 0 ? exactIdx : findLastStreamingThinkingIdx(buf.entries);
      if (idx >= 0) {
        const prev = buf.entries[idx] as ChatEntryThinking;
        buf.entries[idx] = { ...prev, text: event.fullText, streaming: false, messageId: event.messageId };
      } else {
        buf.entries.push({
          kind: 'thinking',
          id: uuid(),
          messageId: event.messageId,
          timestamp: Date.now(),
          text: event.fullText,
          streaming: false,
        });
      }
      return;
    }
    case 'tool_use': {
      buf.entries.push({
        kind: 'tool',
        id: uuid(),
        toolUseId: event.toolUseId,
        parentToolUseId: event.parentToolUseId,
        toolName: event.name,
        input: event.input,
        state: 'running',
        timestamp: Date.now(),
      });
      return;
    }
    case 'tool_result': {
      const idx = findToolIdxByUseId(buf.entries, event.toolUseId);
      if (idx >= 0) {
        const prev = buf.entries[idx] as ChatEntryTool;
        const isError = event.isError || contentHasError(event.content);
        buf.entries[idx] = {
          ...prev,
          state: isError ? 'error' : 'complete',
          result: event.content,
          structured: event.structured,
        };
      }
      // A tool_result implies the matching permission_request (if any) was
      // approved — the SDK doesn't emit an explicit "permission_resolved"
      // event for allows. Mark it so the card collapses to the resolved
      // state instead of lingering as "awaiting decision".
      const permIdx = findPermRequestIdxByToolUseId(buf.entries, event.toolUseId);
      if (permIdx >= 0) {
        const prev = buf.entries[permIdx] as ChatEntryPermissionRequest;
        if (prev.resolved === undefined) {
          buf.entries[permIdx] = { ...prev, resolved: 'allowed' };
        }
      }
      return;
    }
    case 'permission_request': {
      buf.entries.push({
        kind: 'permission_request',
        id: uuid(),
        requestId: event.requestId,
        toolUseId: event.toolUseId,
        toolName: event.toolName,
        input: event.input,
        title: event.title,
        description: event.description,
        timestamp: Date.now(),
      });
      return;
    }
    case 'permission_denied': {
      const idx = findPermRequestIdxByToolUseId(buf.entries, event.toolUseId);
      if (idx >= 0) {
        const prev = buf.entries[idx] as ChatEntryPermissionRequest;
        buf.entries[idx] = { ...prev, resolved: 'denied' };
      }
      return;
    }
    case 'turn_complete': {
      buf.entries.push({
        kind: 'turn_summary',
        id: uuid(),
        stopReason: event.stopReason,
        durationMs: event.durationMs,
        cost: event.cost,
        isError: event.isError,
        timestamp: Date.now(),
      });
      return;
    }
    case 'rate_limit': {
      buf.rateLimit = event.info;
      return;
    }
    case 'error': {
      buf.entries.push({
        kind: 'error',
        id: uuid(),
        code: event.code,
        message: event.message,
        fatal: event.fatal,
        timestamp: Date.now(),
      });
      return;
    }
    // Events that don't affect the chat-message view (yet). They still
    // bump lastEventIndex, but render only via dedicated UI in later Fs:
    //   - status (header pill)
    //   - init (session metadata → sessions.store)
    //   - hook_started/progress/response
    //   - plugin_install
    //   - auth_status
    //   - task_started/progress/updated
    //   - tool_progress
    //   - memory_recall
    //   - compact_boundary
    //   - elicitation_complete
    default:
      return;
  }
}

// Helpers — small inline searches that walk back from the tail. The
// streaming hot path appends to the most recent assistant/thinking entry,
// so these terminate immediately under normal flow.

function findAssistantIdx(entries: ChatEntry[], messageId: string): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.kind === 'assistant' && e.messageId === messageId) return i;
  }
  return -1;
}

function findThinkingIdx(entries: ChatEntry[], messageId: string): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.kind === 'thinking' && e.messageId === messageId) return i;
  }
  return -1;
}

function findLastStreamingAssistantIdx(entries: ChatEntry[]): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.kind === 'assistant' && e.streaming) return i;
    if (e.kind === 'assistant' || e.kind === 'thinking') return -1;
  }
  return -1;
}

function findLastStreamingThinkingIdx(entries: ChatEntry[]): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.kind === 'thinking' && e.streaming) return i;
    if (e.kind === 'assistant' || e.kind === 'thinking') return -1;
  }
  return -1;
}

function contentHasError(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(
    (b) => b != null && typeof b === 'object' && (b as { is_error?: unknown }).is_error === true,
  );
}

function findToolIdxByUseId(entries: ChatEntry[], toolUseId: string): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.kind === 'tool' && e.toolUseId === toolUseId) return i;
  }
  return -1;
}

function findPermRequestIdxByToolUseId(entries: ChatEntry[], toolUseId: string): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.kind === 'permission_request' && e.toolUseId === toolUseId) return i;
  }
  return -1;
}

// ──────────────────────────────────────────────
// Zustand store
// ──────────────────────────────────────────────

interface MessagesStore {
  buffers: Record<string, MessagesBuffer>;
  /** Apply a SessionEvent from the daemon's stream. */
  applyEvent: (sessionId: string, event: SessionEvent, eventIndex: number) => void;
  /** Apply a HISTORY snapshot (replaces buffer with a fresh replay). */
  setHistory: (
    sessionId: string,
    events: SessionEvent[],
    totalEvents: number,
    firstAvailableEventIndex: number
  ) => void;
  /** Optimistically append a user message before sending to the daemon. */
  pushUserMessage: (sessionId: string, content: UserContentBlock[]) => void;
  /** Drop a session's buffer (kill / disconnect). */
  clear: (sessionId: string) => void;
  /** Mark a pending permission request as resolved (for optimistic UI). */
  markPermissionResolved: (
    sessionId: string,
    requestId: string,
    decision: 'allowed' | 'denied'
  ) => void;
}

export const useMessagesStore = create<MessagesStore>((set) => ({
  buffers: {},

  applyEvent: (sessionId, event, eventIndex) =>
    set((state) => {
      const buf = state.buffers[sessionId] ?? emptyBuffer();
      // Drop out-of-order or already-applied events.
      if (eventIndex !== -1 && eventIndex <= buf.lastEventIndex) {
        return state;
      }
      const next: MessagesBuffer = {
        entries: buf.entries.slice(),
        lastEventIndex: eventIndex,
        historyLoaded: buf.historyLoaded,
        rateLimit: buf.rateLimit,
      };
      applyEvent(next, event);
      next.entries = clamp(next.entries);
      return {
        buffers: { ...state.buffers, [sessionId]: next },
      };
    }),

  setHistory: (sessionId, events, _totalEvents, _firstAvailableEventIndex) =>
    set((state) => {
      const buf: MessagesBuffer = {
        entries: [],
        lastEventIndex: -1,
        historyLoaded: true,
      };
      for (const ev of events) applyEvent(buf, ev);
      buf.entries = clamp(buf.entries);
      // Preserve highest event index from the replayed batch.
      // The daemon ships ordered events; index is monotonic.
      // We don't have indices per event here (HISTORY carries a flat array
      // — daemon-side ring tracks them but doesn't echo per-event index),
      // so leave lastEventIndex at -1 and let live SESSION_EVENT messages
      // bump it.
      return {
        buffers: { ...state.buffers, [sessionId]: buf },
      };
    }),

  pushUserMessage: (sessionId, content) =>
    set((state) => {
      const buf = state.buffers[sessionId] ?? emptyBuffer();
      const next: MessagesBuffer = {
        ...buf,
        entries: clamp([
          ...buf.entries,
          {
            kind: 'user',
            id: uuid(),
            timestamp: Date.now(),
            content,
          } satisfies ChatEntryUser,
        ]),
      };
      return {
        buffers: { ...state.buffers, [sessionId]: next },
      };
    }),

  clear: (sessionId) =>
    set((state) => {
      const next = { ...state.buffers };
      delete next[sessionId];
      return { buffers: next };
    }),

  markPermissionResolved: (sessionId, requestId, decision) =>
    set((state) => {
      const buf = state.buffers[sessionId];
      if (!buf) return state;
      const entries = buf.entries.map((e) => {
        if (e.kind !== 'permission_request') return e;
        if (e.requestId !== requestId) return e;
        return { ...e, resolved: decision };
      });
      return {
        buffers: {
          ...state.buffers,
          [sessionId]: { ...buf, entries },
        },
      };
    }),
}));

export const messagesStore = useMessagesStore;
