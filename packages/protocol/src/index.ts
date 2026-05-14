// ──────────────────────────────────────────────
// @walccy/protocol — v2 stream-json/SDK era
// ──────────────────────────────────────────────
//
// Breaking change vs v1: lines are gone. Daemon emits typed `SessionEvent`s
// sourced from the Claude Agent SDK; app sends `ControlMessage`s back through
// a unified envelope. See docs/stream-json-migration.md +
// docs/stream-json-spike-addendum.md.

import type { PermissionMode, EffortLevel } from './claude-stream.js';
import type { ControlMessageEnvelope } from './control-messages.js';
import type { SessionEventMessage } from './session-events.js';

// ──────────────────────────────────────────────
// Core domain types
// ──────────────────────────────────────────────

export type SessionStatus = 'active' | 'idle' | 'waiting_input' | 'ended';

export interface Session {
  id: string;
  pid: number;
  name: string;
  cwd: string;
  status: SessionStatus;
  startedAt: number;
  lastActivityAt: number;
  waitingForInput: boolean;
  connectedClients: string[];
  owned: boolean;
  /**
   * SDK session id — the value `claude --resume` accepts. Captured from the
   * init event and persisted here so it survives app reconnects (the init
   * event itself only fires once, before a relaunched app is listening).
   */
  sdkSessionId?: string;
  model?: string;
  permissionMode?: PermissionMode;
  effortLevel?: EffortLevel;
  /** Accumulated USD spent across all turns in this session. */
  costSoFar?: number;
  /** Highest event index currently in the daemon ring buffer. */
  lastEventIndex?: number;
}

// ──────────────────────────────────────────────
// WebSocket message types  (Client → Daemon)
// ──────────────────────────────────────────────

export interface AuthMessage {
  type: 'AUTH';
  secret: string;
  clientId: string;
  clientName: string;
}

export interface ListSessionsMessage {
  type: 'LIST_SESSIONS';
}

export interface PingMessage {
  type: 'PING';
}

export interface RegisterPushTokenMessage {
  type: 'REGISTER_PUSH_TOKEN';
  token: string;
  platform: 'android' | 'ios';
}

export interface ListDirectoriesMessage {
  type: 'LIST_DIRECTORIES';
  /** Optional substring filter applied server-side. */
  query?: string;
}

/**
 * Spawn a new session. All fields beyond `cwd` + `requestId` are optional
 * and map to SDK `Options` at spawn time.
 */
export interface SpawnSessionMessage {
  type: 'SPAWN_SESSION';
  /** Absolute working directory for the new session. */
  cwd: string;
  /** Client-generated correlation id, echoed back in SPAWN_RESULT. */
  requestId: string;
  /** Optional explicit display name. */
  name?: string;
  /** Spawn-time permission mode. May be changed mid-session via control msg. */
  permissionMode?: PermissionMode;
  /** Model alias or full id. */
  model?: string;
  /** Effort level for the session. */
  effortLevel?: EffortLevel;
  /** Output style (default | concise | …). */
  outputStyle?: string;
  /** Worktree name; truthy enables `--worktree`. */
  worktree?: string | boolean;
  /** Resume a prior session id (e.g., after interrupt-respawn). */
  resumeSessionId?: string;
  /** Pick a built-in or settings-defined agent as the main thread. */
  agent?: string;
}

/**
 * Subscribe to a session's event stream. `fromEventIndex` allows gap-fill on
 * reconnect — the daemon replies with all events at index ≥ that value, or
 * a snapshot if the ring buffer has wrapped past it (signalled via
 * `firstAvailableEventIndex`).
 */
export interface SubscribeMessage {
  type: 'SUBSCRIBE';
  sessionId: string;
  fromEventIndex?: number;
}

export interface UnsubscribeMessage {
  type: 'UNSUBSCRIBE';
  sessionId: string;
}

/**
 * Memory viewer request. Lists markdown files under
 * `~/.claude/projects/<encoded-cwd>/memory/` for the given session, and
 * (optionally) returns the contents of one named file in the same response.
 * Empty `fileName` ⇒ list-only; bodies are omitted to keep the snapshot small.
 */
export interface ListMemoryMessage {
  type: 'LIST_MEMORY';
  requestId: string;
  sessionId: string;
  /** Optional — when set, the file's body is included in the reply. */
  fileName?: string;
}

/**
 * Resumable-transcript listing. Returns metadata for `*.jsonl` files under
 * `~/.claude/projects/<encoded-cwd>/`. Used by the New Session sheet to
 * surface a picker for resumes coming from a laptop `claude` session.
 */
export interface ListTranscriptsMessage {
  type: 'LIST_TRANSCRIPTS';
  requestId: string;
  cwd: string;
  /** Cap on returned entries; daemon may apply its own ceiling. */
  limit?: number;
}

export type ClientMessage =
  | AuthMessage
  | ListSessionsMessage
  | SubscribeMessage
  | UnsubscribeMessage
  | PingMessage
  | RegisterPushTokenMessage
  | ListDirectoriesMessage
  | SpawnSessionMessage
  | ListMemoryMessage
  | ListTranscriptsMessage
  | ControlMessageEnvelope;

// Note: session termination is delivered via `ControlMessage` of kind
// `kill_session` wrapped in `ControlMessageEnvelope` — there is no separate
// top-level KILL_SESSION wire message in v2. Clients observe via
// SESSION_REMOVED on success or ERROR (`SESSION_NOT_FOUND`) on failure.

// ──────────────────────────────────────────────
// WebSocket message types  (Daemon → Client)
// ──────────────────────────────────────────────

export interface AuthOkMessage {
  type: 'AUTH_OK';
  clientId: string;
  daemonVersion: string;
}

export interface AuthFailMessage {
  type: 'AUTH_FAIL';
  reason: string;
}

export interface SessionsMessage {
  type: 'SESSIONS';
  sessions: Session[];
}

export interface SessionAddedMessage {
  type: 'SESSION_ADDED';
  session: Session;
}

export interface SessionUpdatedMessage {
  type: 'SESSION_UPDATED';
  sessionId: string;
  changes: Partial<Session>;
}

export interface SessionRemovedMessage {
  type: 'SESSION_REMOVED';
  sessionId: string;
}

/**
 * Snapshot of events resident in the daemon's ring buffer for a session.
 * Sent in response to SUBSCRIBE. `firstAvailableEventIndex` lets clients
 * detect ring-wrap gaps the same way the old `firstAvailableLine` worked.
 */
export interface HistoryMessage {
  type: 'HISTORY';
  sessionId: string;
  events: import('./session-events.js').SessionEvent[];
  totalEvents: number;
  firstAvailableEventIndex: number;
}

export interface PongMessage {
  type: 'PONG';
  timestamp: number;
}

export interface ErrorMessage {
  type: 'ERROR';
  code: string;
  message: string;
}

export type DirectoryEntryKind = 'recent' | 'git' | 'home' | 'custom';

export interface DirectoryEntry {
  /** Absolute path. */
  path: string;
  /** Display label (usually basename, or a friendly tag). */
  label: string;
  /** Where this suggestion came from. */
  kind: DirectoryEntryKind;
  /** Optional secondary text — e.g., parent dir or git branch. */
  detail?: string;
}

export interface DirectoryListMessage {
  type: 'DIRECTORY_LIST';
  directories: DirectoryEntry[];
}

export interface SpawnResultMessage {
  type: 'SPAWN_RESULT';
  requestId: string;
  /** Set on success — id of the new session. */
  sessionId?: string;
  /** Set on failure — short reason. */
  error?: string;
}

export interface MemoryFileEntry {
  /** Filename, e.g. `walccy_session_lifecycle.md`. */
  name: string;
  /** Bytes on disk — display only; do not use for body-allocation. */
  size: number;
  /** mtime epoch ms. */
  modifiedAt: number;
}

export interface MemoryListMessage {
  type: 'MEMORY_LIST';
  requestId: string;
  sessionId: string;
  /** Absolute directory the entries were read from. */
  dir: string;
  files: MemoryFileEntry[];
  /** Present iff request specified a `fileName` AND the file existed. */
  file?: {
    name: string;
    content: string;
  };
  /** Set on failure — short reason. `files` will be empty when set. */
  error?: string;
}

export interface TranscriptEntry {
  /** Claude session UUID — equals the JSONL filename stem. */
  sessionId: string;
  /** mtime epoch ms. */
  modifiedAt: number;
  /** Bytes on disk. */
  sizeBytes: number;
  /**
   * First user-message text, truncated to ~80 chars. `null` when the file
   * has been opened but no user message was found in the first 4KB window.
   */
  preview: string | null;
  /** Line count of the JSONL — cheap message-count proxy. */
  messageCount: number;
  /** True when this sessionId is currently live in the daemon. */
  isLive: boolean;
}

export interface TranscriptListMessage {
  type: 'TRANSCRIPT_LIST';
  requestId: string;
  cwd: string;
  /** Absolute directory the entries were read from. */
  dir: string;
  entries: TranscriptEntry[];
  /** Set on failure — short reason. `entries` will be empty when set. */
  error?: string;
}

export type ServerMessage =
  | AuthOkMessage
  | AuthFailMessage
  | SessionsMessage
  | SessionAddedMessage
  | SessionUpdatedMessage
  | SessionRemovedMessage
  | HistoryMessage
  | SessionEventMessage
  | PongMessage
  | ErrorMessage
  | DirectoryListMessage
  | SpawnResultMessage
  | MemoryListMessage
  | TranscriptListMessage;

// ──────────────────────────────────────────────
// Re-exports
// ──────────────────────────────────────────────

export * from './session-events.js';
export * from './control-messages.js';
export * from './claude-stream.js';
/** Namespace alias kept for app-side consumers that prefer the prefix. */
export * as ClaudeStream from './claude-stream.js';
