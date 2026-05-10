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
  lineCount: number;
  waitingForInput: boolean;
  connectedClients: string[];
  owned: boolean;
}

export interface BufferedLine {
  index: number;
  content: string;       // ANSI stripped
  rawContent: string;    // with ANSI codes
  timestamp: number;
  source: 'stdout' | 'stderr' | 'input';
  inputClientId?: string;
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

export interface SubscribeMessage {
  type: 'SUBSCRIBE';
  sessionId: string;
  /**
   * When provided, the daemon replies with `RESUME` (append-style gap-fill)
   * instead of `HISTORY` (replace-style snapshot).
   */
  fromLine?: number;
}

export interface UnsubscribeMessage {
  type: 'UNSUBSCRIBE';
  sessionId: string;
}

export interface InputMessage {
  type: 'INPUT';
  sessionId: string;
  data: string;
}

export interface ResizeMessage {
  type: 'RESIZE';
  sessionId: string;
  cols: number;
  rows: number;
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

export interface SpawnSessionMessage {
  type: 'SPAWN_SESSION';
  /** Absolute working directory for the new session. */
  cwd: string;
  /** Client-generated correlation id, echoed back in SPAWN_RESULT. */
  requestId: string;
}

export type ClientMessage =
  | AuthMessage
  | ListSessionsMessage
  | SubscribeMessage
  | UnsubscribeMessage
  | InputMessage
  | ResizeMessage
  | PingMessage
  | RegisterPushTokenMessage
  | ListDirectoriesMessage
  | SpawnSessionMessage;

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

export interface HistoryMessage {
  type: 'HISTORY';
  sessionId: string;
  lines: BufferedLine[];
  totalLines: number;
  /**
   * Lowest line index still present in the daemon's ring buffer for this
   * session at the moment of the response. Clients compare this against the
   * `fromLine` they requested to detect scrollback truncation:
   *  - `firstAvailableLine <= fromLine` → no gap; all requested lines were
   *    available and have been delivered.
   *  - `firstAvailableLine >  fromLine` → the buffer wrapped past the
   *    requested cursor while the client was disconnected; exactly
   *    `firstAvailableLine - fromLine` lines were dropped between the
   *    requested point and the contiguous tail returned in `lines`.
   * For empty buffers this is 0.
   */
  firstAvailableLine: number;
}

export interface ResumeMessage {
  type: 'RESUME';
  sessionId: string;
  /** Lines with index >= the SUBSCRIBE.fromLine the client supplied. */
  lines: BufferedLine[];
  /** Daemon's current totalLinesReceived after these lines. */
  totalLines: number;
}

export interface OutputMessage {
  type: 'OUTPUT';
  sessionId: string;
  lines: BufferedLine[];
}

export interface InputLockMessage {
  type: 'INPUT_LOCK';
  sessionId: string;
  lockedByClientId: string;
  lockedByClientName: string;
  expiresAt: number;
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

export type ServerMessage =
  | AuthOkMessage
  | AuthFailMessage
  | SessionsMessage
  | SessionAddedMessage
  | SessionUpdatedMessage
  | SessionRemovedMessage
  | HistoryMessage
  | ResumeMessage
  | OutputMessage
  | InputLockMessage
  | PongMessage
  | ErrorMessage
  | DirectoryListMessage
  | SpawnResultMessage;
