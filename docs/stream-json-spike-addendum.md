# Stream-JSON Spike — Addendum: SDK vs CLI decision

**Status:** locked · **Date:** 2026-05-11 · supersedes/clarifies the open questions in `docs/stream-json-spike-results.md`.

## The fork the spike exposed

EXP-1 and EXP-2 confirmed that `ExitPlanMode` and `AskUserQuestion` emit `tool_use` events but the plain `claude -p` binary auto-denies them — there's no permission callback wired. To gate those tools on user input, the daemon needs one of:

- **Path A:** `--permission-prompt-tool <mcp-tool>` flag on the CLI, pointing at a daemon-owned MCP server.
- **Path B:** Switch the daemon from `child_process.spawn('claude')` to the official `@anthropic-ai/claude-agent-sdk` library, which exposes a `canUseTool` callback.

## Verification

`claude --help 2>&1 | grep permission-prompt-tool` → empty. The flag is not wired in CLI v2.1.138. **Path A is dead.**

`npm view @anthropic-ai/claude-agent-sdk@latest` → v0.2.138 (versioned in lockstep with the CLI). Type definitions (`/tmp/sdk-spike/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`) include:

- `CanUseTool` callback type — fires before each tool, async-returns `{ behavior: 'allow' | 'deny' | 'ask' }`.
- `Query` interface — `AsyncGenerator<SDKMessage>` with first-class control methods:
  - `interrupt(): Promise<void>` (replaces our planned `control_request` JSON-line interrupt).
  - `setPermissionMode(mode): Promise<void>` — **mid-session permission mode change** (collapses F23's "respawn for mode switch" fallback).
  - `setModel(model?): Promise<void>` — **mid-session model swap** (collapses F24/F16's "respawn for model switch" fallback).
- `SDKMessage` union — 30+ typed variants covering everything our planned `SessionEvent` needed plus hook events, MCP auth status, plugin install events, elicitation, tool-use summaries, memory recall, etc.

## Locked decision

**F2 daemon uses `@anthropic-ai/claude-agent-sdk`'s `query()` API, not `child_process.spawn('claude')`.**

## Consequences for the plan

### F1 — protocol package

- `SessionEvent` becomes a thin re-export / mapping layer over `SDKMessage`. Most of our planned 11 kinds correspond 1:1 to existing SDK types. Map (not redefine):

| Our plan | SDK source | Notes |
|---|---|---|
| `init` | `SDKSystemMessage` (subtype init) | Direct passthrough |
| `status` | `SDKStatusMessage` | Direct |
| `rate_limit` | `SDKRateLimitEvent` | Direct |
| `assistant_text_delta` | `SDKPartialAssistantMessage` (text_delta) | Filter content block kind |
| `assistant_text_done` | `SDKAssistantMessage` (assembled) | Take final assembled |
| `thinking_delta` / `done` | `SDKPartialAssistantMessage` (thinking) + `SDKAssistantMessage` | |
| `tool_use` | parsed from `SDKAssistantMessage.message.content[]` where `type==='tool_use'` | |
| `tool_result` | `SDKUserMessage` w/ `tool_use_result` sibling | |
| `turn_complete` | `SDKResultMessage` | |
| `error` | `SDKMirrorErrorMessage` / `SDKPermissionDeniedMessage` | Two sub-shapes |

The SDK gives us extras the plan didn't anticipate — keep them as additional `SessionEvent` kinds:

- **`hook_started` / `hook_progress` / `hook_response`** — surfaces PreToolUse / PostToolUse / Stop hooks. Lets the UI show "running pre-commit hook…" indicators. Implements F25 "Hooks read-only" + better.
- **`plugin_install`** — for `--plugin-dir` / `--plugin-url` install progress.
- **`auth_status`** — for MCP servers transitioning between needs-auth / ready (drives F25 MCP list updates).
- **`elicitation_complete`** — relates to AskUserQuestion result.
- **`tool_progress`** — long-running tool progress reports.
- **`task_started` / `task_progress` / `task_updated` / `task_notification`** — for sub-agent activity (powers F16 AgentCard better).
- **`memory_recall`** — when claude reads from auto-memory.
- **`compact_boundary`** — when /compact runs.
- **`permission_denied`** — when canUseTool / hooks deny a tool.

These flow through the same `SessionEventMessage` wrapper.

### `ControlMessage` revisions

- `interrupt` ControlMessage → `await query.interrupt()` (no JSON wire format needed — first-class method).
- `change_permission_mode` ControlMessage → `await query.setPermissionMode(mode)` (no respawn needed; F23 simplification).
- `respawn` ControlMessage → **delete from plan.** No longer needed for mode/model switching. Still needed for hard restart but rare.
- `plan_accept` / `plan_reject` ControlMessage → resolves a pending `canUseTool` promise the daemon is awaiting for the `ExitPlanMode` tool. Correlation by `tool_use_id`.
- `answer_question` ControlMessage → same pattern — resolves the pending `canUseTool` for `AskUserQuestion` with `behavior: 'allow'` and supplies the `updatedInput` containing the chosen answer (SDK convention; details in F2 implementation).
- New: `set_model` ControlMessage → `await query.setModel(model)`.
- New: `set_effort_level` (if SDK supports — check; if not, respawn).

### F2 — daemon core

Replace `claude-spawner.ts` (was: `spawn('claude')` + JSON-line reader) with **`claude-driver.ts`**:

```ts
import { query, type Query, type SDKMessage, type CanUseTool } from '@anthropic-ai/claude-agent-sdk';

class ClaudeDriver {
  private query: Query | null = null;
  private pendingPermissions = new Map<string, PendingPermission>();

  async start(options: SpawnOptions) {
    const userMessages = new SimpleAsyncQueue<SDKUserMessage>();
    this.query = query({
      prompt: userMessages,                 // AsyncIterable for streaming input
      options: {
        cwd: options.cwd,
        model: options.model,
        agents: options.agents,
        tools: options.tools ?? { type: 'preset', preset: 'claude_code' },
        canUseTool: this.handlePermissionRequest.bind(this),
        permissionMode: options.permissionMode,
        resume: options.resumeSessionId,
        // ... etc
      },
    });
    // Consume the SDKMessage stream and translate to SessionEvent
    for await (const msg of this.query) {
      this.emit('event', translateSdkMessage(msg));
    }
  }

  async sendUserMessage(content: UserContentBlock[]) { this.userMessages.push({...}); }
  async interrupt() { return this.query?.interrupt(); }
  async setPermissionMode(mode: PermissionMode) { return this.query?.setPermissionMode(mode); }
  async setModel(model: string) { return this.query?.setModel(model); }

  private handlePermissionRequest: CanUseTool = (toolName, input, opts) => {
    const id = randomUUID();
    return new Promise((resolve) => {
      this.pendingPermissions.set(id, { resolve, toolName, input });
      this.emit('permission_request', { id, toolName, input });
      // App will call resolvePermission(id, decision)
    });
  };

  resolvePermission(id: string, decision: 'allow' | 'deny') {
    const p = this.pendingPermissions.get(id);
    if (!p) return;
    this.pendingPermissions.delete(id);
    p.resolve({ behavior: decision });
  }
}
```

`event-buffer.ts` (ring of `SessionEvent`) and `stream-translator.ts` (SDKMessage → SessionEvent) are still needed but simpler — no JSON-line parsing.

### F3 — daemon integration

Same shape as planned. `Session` owns a `ClaudeDriver` instance instead of a child process. `message-router.ts` routes `ControlMessage` to driver methods (`sendUserMessage`, `interrupt`, `setPermissionMode`, `setModel`, `resolvePermission`).

### F19 (QuestionCard) + F20 (PlanCard)

Ungated. Both work via `canUseTool` + `permission_request` event + `answer_question` / `plan_accept` resolution. Plan card's `input.plan` is rendered as markdown; Accept resolves with `behavior: 'allow'`, Reject with `behavior: 'deny'`.

### F22 (Stop button)

Trivial — `await driver.interrupt()`. After interrupt, `Query.next()` ends; daemon spawns a new Query with `resume: <prevSessionId>` to continue. UI doesn't need a "session interrupted, restart?" surface — the daemon hides the respawn from the app.

### F23 (Permission mode picker)

Trivial — `await driver.setPermissionMode(mode)`.

### F24 (Settings: model)

Mid-session swap via `driver.setModel(model)`. Settings picker reflects the live state via the next `system/init`-like event or local optimism.

### F27 (Slash commands)

Confirmed: send `/cmd` as plain user text. The driver just forwards user messages — slash commands are intercepted by the SDK/CLI internally. Quick-action buttons in SessionHeader emit the right `send_user_message`.

### Deps to add for daemon

```json
"@anthropic-ai/claude-agent-sdk": "^0.2.138"
```

Removed from daemon (no longer needed):
- The whole "parse JSON lines from stdout" code path (since SDK gives typed AsyncGenerator).
- The `--permission-prompt-tool` MCP shim concept (Path A, dead).

## Net effect on the plan

| Plan item | Change |
|---|---|
| F1 protocol types | Map onto SDK types; add ~10 extra `SessionEvent` kinds for hooks/MCP-auth/elicitation/tasks/memory |
| F2 spawn strategy | Use `@anthropic-ai/claude-agent-sdk` `query()` instead of `child_process.spawn` |
| F2 control plane | Use `Query` methods, not stdin `control_request` lines |
| F19 / F20 | Ungated; ship as planned with `canUseTool` resolution |
| F22 | Trivial `Query.interrupt()`; daemon respawns transparently with `resume` |
| F23 | Mid-session via `Query.setPermissionMode()` — no respawn |
| F24 | Mid-session via `Query.setModel()` — no respawn |
| `respawn` ControlMessage | Removed from F1 |
| `--permission-prompt-tool` MCP path | Dead, no implementation |

The migration is now **simpler** than the original plan: fewer fallbacks, fewer respawns, fully typed. Net effect — faster to ship and lower risk.
