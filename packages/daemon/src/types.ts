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

export type ClientMessage =
  | AuthMessage
  | ListSessionsMessage
  | SubscribeMessage
  | UnsubscribeMessage
  | InputMessage
  | ResizeMessage
  | PingMessage;

// ──────────────────────────────────────────────
// WebSocket message types  (Daemon → Client)
// ──────────────────────────────────────────────

export interface AuthOkMessage {
  type: 'AUTH_OK';
  clientId: string;
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

export type ServerMessage =
  | AuthOkMessage
  | AuthFailMessage
  | SessionsMessage
  | SessionAddedMessage
  | SessionUpdatedMessage
  | SessionRemovedMessage
  | HistoryMessage
  | OutputMessage
  | InputLockMessage
  | PongMessage
  | ErrorMessage;
