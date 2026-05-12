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
      const last = findOpenAssistant(buf.entries, event.messageId);
      if (last) {
        last.text += event.text;
        last.streaming = true;
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
      const last = findAssistant(buf.entries, event.messageId);
      if (last) {
        last.text = event.fullText;
        last.streaming = false;
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
      const last = findOpenThinking(buf.entries, event.messageId);
      if (last) {
        last.text += event.text;
        last.streaming = true;
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
      const last = findThinking(buf.entries, event.messageId);
      if (last) {
        last.text = event.fullText;
        last.streaming = false;
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
      const tool = findToolByUseId(buf.entries, event.toolUseId);
      if (tool) {
        tool.state = event.isError ? 'error' : 'complete';
        tool.result = event.content;
        tool.structured = event.structured;
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
      const req = findPermRequestByToolUseId(buf.entries, event.toolUseId);
      if (req) req.resolved = 'denied';
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

function findOpenAssistant(
  entries: ChatEntry[],
  messageId: string
): ChatEntryAssistant | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.kind === 'assistant' && e.messageId === messageId && e.streaming) {
      return e;
    }
    if (e.kind === 'assistant' || e.kind === 'thinking') return null;
  }
  return null;
}

function findAssistant(
  entries: ChatEntry[],
  messageId: string
): ChatEntryAssistant | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.kind === 'assistant' && e.messageId === messageId) return e;
  }
  return null;
}

function findOpenThinking(
  entries: ChatEntry[],
  messageId: string
): ChatEntryThinking | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.kind === 'thinking' && e.messageId === messageId && e.streaming) {
      return e;
    }
    if (e.kind === 'assistant' || e.kind === 'thinking') return null;
  }
  return null;
}

function findThinking(
  entries: ChatEntry[],
  messageId: string
): ChatEntryThinking | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.kind === 'thinking' && e.messageId === messageId) return e;
  }
  return null;
}

function findToolByUseId(
  entries: ChatEntry[],
  toolUseId: string
): ChatEntryTool | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.kind === 'tool' && e.toolUseId === toolUseId) return e;
  }
  return null;
}

function findPermRequestByToolUseId(
  entries: ChatEntry[],
  toolUseId: string
): ChatEntryPermissionRequest | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.kind === 'permission_request' && e.toolUseId === toolUseId) return e;
  }
  return null;
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
