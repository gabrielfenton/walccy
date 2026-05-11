# Walccy — Stream-JSON Migration Spec

**Status:** proposed · **Date:** 2026-05-11 · **Owner:** gabriel

## Problem

The mobile terminal is unusable. Claude Code is a TUI that uses ANSI cursor
positioning (`ESC[H`, `ESC[K`, alternate screen, padding rows) to overdraw a
fixed region. The daemon's `LineBuffer` (`packages/daemon/src/buffer.ts`,
`session.ts:_handleRawData`) treats PTY output as append-only lines and strips
ANSI without applying cursor moves. Result: every spinner frame and padding
row accumulates as a new "line", and the input box renders as scattered
fragments (`____`, lone `❯`, footer pieces) separated by hundreds of phantom
blanks. Screenshot evidence: `/tmp/walccy-shot2.png`.

## Decision

Stop mirroring a TUI. Spawn Claude Code in **stream-json mode** and render a
chat UI. Drop `walccy wrap` (TUI mirror of an already-running session).

```
claude -p \
  --input-format stream-json \
  --output-format stream-json \
  --include-partial-messages \
  --verbose \                       # required with --print + stream-json
  --no-session-persistence          # daemon owns persistence
```

Daemon writes user messages to claude's stdin as `{"type":"user",…}` JSON
lines; reads stdout JSON lines and rebroadcasts as typed protocol events. The
claude child stays alive across turns while stdin is open.

## Event taxonomy (verified 2026-05-11 against claude-code 2.1.138)

| Event | Use |
|---|---|
| `system/init` | session_id, model, tools[], agents[], skills[], slash_commands[], mcp_servers[], memory_paths |
| `system/status` | "requesting" etc. → drives thinking indicator |
| `rate_limit_event` | banner: 5h window, overage status |
| `stream_event/content_block_start` | begin assistant block (text \| tool_use \| thinking) |
| `stream_event/content_block_delta` | token delta — drives streaming text |
| `stream_event/content_block_stop` | end block |
| `stream_event/message_stop` | end assistant message |
| `assistant` | full assembled assistant message (checkpoint) |
| `user` (tool_result) | structured tool result: `content`, `is_error`, sibling `tool_use_result:{stdout,stderr,interrupted,isImage,noOutputExpected}` |
| `result` | turn-end: cost, duration, usage, stop_reason, permission_denials, modelUsage |

Tool_use shape: `{id, name, input:{…}, caller:{type:"direct"}}`. Sub-agent
tool calls carry `parent_tool_use_id` — use to group into agent cards.

## Protocol changes (`@walccy/protocol`)

Retire `BufferedLine`. Add:

```ts
type SessionEvent =
  | { kind: 'init', sessionId, model, tools, agents, skills }
  | { kind: 'status', status: 'requesting' | 'idle' }
  | { kind: 'rate_limit', info }
  | { kind: 'assistant_text_delta', messageId, text }
  | { kind: 'assistant_text_done', messageId, fullText }
  | { kind: 'thinking_delta' / 'thinking_done' }
  | { kind: 'tool_use', messageId, toolUseId, name, input, parentToolUseId? }
  | { kind: 'tool_result', toolUseId, content, isError, structured? }
  | { kind: 'turn_complete', stopReason, cost, usage }
```

Keep ws-server transport, auth, KILL_SESSION, idle-attach prune. Buffer
becomes a ring of `SessionEvent` (not lines).

## Daemon changes

- `session.ts`: replace `node-pty` spawn with `child_process.spawn('claude', […flags])`. Pipe stdin/stdout as JSON-line streams. Parse with line-delimited JSON reader.
- `buffer.ts`: replace `LineBuffer` with `EventBuffer` (same ring semantics, holds `SessionEvent`).
- Remove `wrap-cli.ts`, `walccy wrap` command, partial-line stitching.
- Sessions are now always daemon-spawned; no detection of external `claude` PIDs (the entire `ProcessScanner` module can be retired — also kills the "phantom tabs" class of bugs).
- KILL_SESSION sends SIGTERM as before; idle-attach prune still applies.

## App changes

**Retire:** `TerminalOutput`, `TerminalLine`, `ControlBar`, `services/ansi-parser`, `stores/output.store` (becomes `messages.store`).

**New components:**
- `MessageList` — FlashList of typed events, virtualized
- `UserBubble` — right-aligned, accent surface
- `AssistantMessage` — markdown-rendered prose (`react-native-marked` or `react-native-markdown-display`), blinking caret while streaming
- `ToolCard` — base card with pending/running/done states; per-tool variants:
  - `BashCard` — command (mono header), collapsed stdout/stderr, exit chip
  - `EditCard` — file path, diff hunk, +N/-N counts
  - `ReadCard` — path + line-range chip, expand for excerpt
  - `GrepCard`/`GlobCard` — query + match count + collapsed results
  - `WebFetchCard`/`WebSearchCard` — URL/query, result preview
  - `TodoCard` — checklist
  - Generic fallback for unknown tools
- `ThinkingCard` — single collapsed "Thought for 12s"
- `Composer` — text input, `+` for files/images, send/stop button
- `SessionHeader` — name, status pill, model badge, cost-so-far

**Replacements for dropped TUI affordances:**

| TUI | Chat-UI |
|---|---|
| `/clear` | "New session" button in header |
| `/resume` picker | Session tab strip (already exists) |
| `/memory`, `/agents`, `/plugin` | Settings sections |
| Plan mode (Shift+Tab) | "Plan first" toggle on composer → prepends system instruction |
| `@file` completion | `+` → file picker → inserts `@path` |
| Image paste | `+` → camera/library → multipart user message |
| `↑` history | Long-press prior user message → "Edit & resend" |
| Esc/Ctrl-C interrupt | Stop button (replaces send while streaming) |
| `?` shortcuts overlay | Removed — no shortcuts to teach |

**Typography:** Inter for UI/prose (1.4 line-height), JetBrains Mono only in
code blocks and tool-card headers (1.2 line-height). 16px message padding,
12px between messages.

## Caveats / known unknowns

- Slash commands in `system/init` are **not** invokable via stream-json stdin;
  they're TUI-only. Don't expose them in UI.
- `--include-partial-messages` requires `--verbose`. Will require this flag
  combo in the spawn args.
- `parent_tool_use_id` semantics for nested Agent calls need a small UI
  test to confirm card-grouping looks right.
- AskUserQuestion tool when invoked by Claude in stream-json — does it emit
  a tool_use awaiting our app to respond, or does it fail? **Verify before
  shipping.** If supported, render as an inline question card.
- Permission UX: stream-json honors `--permission-mode acceptEdits` or
  `bypassPermissions`. Decide whether walccy is "your own machine, accept
  everything" or "prompt the phone for risky ops" (the existing
  PushNotification flow could feed this).

## Out of scope

- Cloud sessions / multi-user. Daemon is still single-user, Tailscale-only.
- Web build. Native Android/iOS only.

## Rollout

1. Branch `feat/stream-json-migration` from `main`.
2. New protocol package version (breaking; bump major).
3. Daemon implementation behind no flag — full replacement (the wrap mode is
   the casualty).
4. App: build chat UI in parallel; keep terminal screen in a hidden route
   during dev for diffing until parity.
5. Manual QA on Pixel 6 Pro over Tailscale (the working test rig:
   `adb connect 100.117.214.41:37537` + `adb exec-out screencap -p`).
6. Cut walccy 2.0 release; old TUI-mirror clients can no longer talk to the
   new daemon (acceptable — single user, single device).
