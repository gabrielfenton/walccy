// ──────────────────────────────────────────────
// ControlMessage — app→daemon control plane
// ──────────────────────────────────────────────
//
// One discriminated union. Each variant maps to a daemon-side action on
// the Query handle returned by `query()` from @anthropic-ai/claude-agent-sdk.
//
// Resolution model: every "the user wants to answer / accept / reject / change"
// flows through here. The plan's `respawn` is gone — `setPermissionMode` and
// `setModel` are mid-session SDK methods.

import type { PermissionMode, EffortLevel } from './claude-stream.js';

// ──────────────────────────────────────────────
// User content blocks (multimodal)
// ──────────────────────────────────────────────

export interface UserContentBlockText {
  type: 'text';
  text: string;
}

export interface UserContentBlockImageBase64 {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export interface UserContentBlockImageUrl {
  type: 'image';
  source: {
    type: 'url';
    url: string;
  };
}

export type UserContentBlock =
  | UserContentBlockText
  | UserContentBlockImageBase64
  | UserContentBlockImageUrl;

// ──────────────────────────────────────────────
// ControlMessage variants
// ──────────────────────────────────────────────

/**
 * User submitted a turn. Daemon writes through to the SDK input stream.
 * `content` is a multipart MessageParam-style array — text and images
 * interleave. Slash commands (e.g. `/clear`, `/init`) ride as text blocks
 * and are intercepted by Claude Code internally; the daemon doesn't parse
 * them.
 */
export interface CtrlSendUserMessage {
  type: 'send_user_message';
  content: UserContentBlock[];
}

/**
 * Stop the in-flight turn. Daemon calls `Query.interrupt()`. The SDK ends
 * the current generator; the daemon transparently respawns the Query with
 * `resume: <sessionId>` for the next user message.
 */
export interface CtrlInterrupt {
  type: 'interrupt';
}

/** Terminate the session entirely (process exit + tab removal). */
export interface CtrlKillSession {
  type: 'kill_session';
  sessionId: string;
}

/**
 * Approve a pending ExitPlanMode. Daemon's `canUseTool` resolver for the
 * matching tool_use_id returns `{ behavior: 'allow' }`.
 */
export interface CtrlPlanAccept {
  type: 'plan_accept';
  toolUseId: string;
}

/**
 * Reject a pending ExitPlanMode. Daemon resolves with `behavior: 'deny'`.
 */
export interface CtrlPlanReject {
  type: 'plan_reject';
  toolUseId: string;
  reason?: string;
}

/**
 * Answer to an AskUserQuestion. `answers[i]` corresponds to
 * `input.questions[i]`. Daemon resolves the canUseTool with `allow` and
 * supplies the answers as `updatedInput`.
 */
export interface CtrlAnswerQuestion {
  type: 'answer_question';
  toolUseId: string;
  answers: string[];
}

/**
 * Generic resolver for any other tool that the daemon configured to gate
 * (e.g., dangerous Bash, Edit on protected paths). UI shows a generic
 * approve/deny card; this carries the decision.
 */
export interface CtrlResolvePermission {
  type: 'resolve_permission';
  requestId: string;
  decision: 'allow' | 'deny';
  /** Optional rewritten input the model should see — supported by SDK. */
  updatedInput?: Record<string, unknown>;
  /** Optional permission-update suggestions to persist ("always allow X"). */
  updatedPermissions?: unknown[];
}

/**
 * Mid-session permission mode change. Daemon calls
 * `Query.setPermissionMode(mode)`.
 */
export interface CtrlChangePermissionMode {
  type: 'change_permission_mode';
  mode: PermissionMode;
}

/**
 * Mid-session model swap. Daemon calls `Query.setModel(model)`. Passing
 * `undefined` requests the SDK's default.
 */
export interface CtrlSetModel {
  type: 'set_model';
  model?: string;
}

/**
 * Effort level change. The SDK currently exposes this at spawn-time only;
 * daemon falls back to a respawn-with-resume if a mid-session API isn't
 * available.
 */
export interface CtrlSetEffortLevel {
  type: 'set_effort_level';
  level: EffortLevel;
}

export type ControlMessage =
  | CtrlSendUserMessage
  | CtrlInterrupt
  | CtrlKillSession
  | CtrlPlanAccept
  | CtrlPlanReject
  | CtrlAnswerQuestion
  | CtrlResolvePermission
  | CtrlChangePermissionMode
  | CtrlSetModel
  | CtrlSetEffortLevel;

export type ControlMessageKind = ControlMessage['type'];

/** App → daemon WS envelope. */
export interface ControlMessageEnvelope {
  type: 'CONTROL_MESSAGE';
  sessionId: string;
  message: ControlMessage;
}
