# Stream-JSON Verification Spike — Results

Phase 1 of the stream-json migration plan. Five experiments run against `claude` CLI v2.1.138, model `claude-opus-4-7[1m]`, from `/tmp`, all using the universal flags:

```
claude -p --input-format stream-json --output-format stream-json \
       --include-partial-messages --verbose --no-session-persistence \
       [experiment-specific flags]
```

Raw captures are in `packages/protocol/fixtures/*.jsonl`. All sessions used `--no-session-persistence`.

---

## EXP-1 — Plan-mode control flow

**Command:** universal flags + `--permission-mode plan`
**Prompt:** `"Plan a simple two-step refactor: rename a variable in one file. Don't execute, just plan."`
**Fixture:** `packages/protocol/fixtures/exp-1-plan-mode.jsonl` (52 lines)

**Captured event sequence (summarised):**

- `system/init` — `permissionMode:"plan"`, full tool list includes both `EnterPlanMode` and `ExitPlanMode`.
- `system/status status:"requesting"`.
- Assistant turn 1: `tool_use{name:"AskUserQuestion", id:"toolu_01SAKZK…"}` with options "Provide details now / Use a placeholder example".
- Synthetic harness reply: `tool_use_result` for AskUserQuestion was **auto-denied** (recorded in `permission_denials[0]`). The harness replied with a synthetic user `tool_result` "The question was cancelled." (see EXP-2 — same path).
- Assistant turn 2: `tool_use{name:"ToolSearch", input:{query:"select:ExitPlanMode"…}}` — model self-loads the tool schema.
- Assistant turn 3: `tool_use{name:"Write", input:{file_path:"…plan-…-sparkling-garden.md", content:"# Plan: Simple Two-Step…"}}` — wrote the plan to disk (the model treated plan mode as "write a plan file").
- Assistant turn 4: `tool_use{name:"ExitPlanMode", id:"toolu_01G4GRy28CdhoRW8res9vA1G", input:{plan:"# Plan: Simple Two-Step Variable Rename\\n\\n## Context\\nA single-variable rename in one file…", planFilePath:"/home/gabriel/.claude/plans/plan-a-simple-two-step-sparkling-garden.md"}}` — **this is the gate event.**
- `permission_denials` records this `ExitPlanMode` call was **auto-denied** by the harness (no interactive approver attached).
- Final `type:"result" subtype:"success" stop_reason:"end_turn" num_turns:5` — process **terminated cleanly**, did NOT wait for stdin response.

**Exact `tool_use` shape:**

```json
{"type":"tool_use",
 "id":"toolu_01G4GRy28CdhoRW8res9vA1G",
 "name":"ExitPlanMode",
 "input":{
   "plan":"# Plan: Simple Two-Step Variable Rename\n\n## Context\n...",
   "planFilePath":"/home/gabriel/.claude/plans/plan-a-simple-two-step-sparkling-garden.md"
 },
 "caller":{"type":"direct"}}
```

The `input` object is `{plan: string, planFilePath?: string}`. The `planFilePath` is opportunistic — the model wrote the plan to disk first and then referenced it.

**Why the process did not wait:** In non-interactive (`-p`) stream-json mode with no permission-tool callback registered, the harness applies its default policy — which is to deny any tool requiring approval (AskUserQuestion, ExitPlanMode, etc.). This bakes a `permission_denial` entry into the final `result` payload and continues the turn, eventually ending with `end_turn`. A daemon-side interactive loop is required to gate it.

**Decision: BRANCH A (with caveat).** `tool_use{name:"ExitPlanMode"}` is emitted with `{plan, planFilePath?}` input. To turn this into a user-gated UI:

1. The daemon must intercept ExitPlanMode tool_use events (before the harness auto-denies) by registering a permission-tool callback. This is done via the SDK's `canUseTool` hook OR by spawning with `--permission-prompt-tool <mcp-tool>` to route approvals through stdin. **The plain `-p` CLI we used has no such hook wired**, so denial is automatic.
2. Walccy daemon options:
   - **Option A1:** Use the official `@anthropic-ai/claude-agent-sdk` library instead of the CLI; it supports a `canUseTool` callback that fires before each tool runs and yields back `{ behavior: 'allow' | 'deny' }`. The daemon would await the app's `plan_accept`/`plan_reject` ControlMessage and resolve from there.
   - **Option A2:** Use `--permission-prompt-tool` pointing to a custom MCP tool that the daemon owns; ExitPlanMode permission requests would be dispatched to that MCP tool, where the daemon can block until the app responds.
3. The `tool_use_id` is the correlation key. App protocol `plan_accept{toolUseId}` / `plan_reject{toolUseId}` map to permission resolutions, not to writing `tool_result` content directly.

**Daemon implication:** must register a permission callback (SDK `canUseTool` or `--permission-prompt-tool` MCP). Without it, plan mode produces a denial trace and ends. The simple "write tool_result to stdin" pattern documented in the plan does NOT apply for ExitPlanMode — it's a permission gate, not a normal tool result loop.
**App implication:** PlanCard renders `input.plan` (markdown), Accept/Reject buttons emit `plan_accept`/`plan_reject` ControlMessages tagged with the tool_use_id; resolution flows through the daemon's permission callback.
**Open questions:**
- Confirm whether `--permission-prompt-tool` is wired in CLI v2.1.138 — docs vary. Pre-F3, verify with a 10-line spike that registers an MCP permission tool and observes claude pausing on ExitPlanMode.
- Decide CLI-vs-SDK before F2. The CLI is what the walccy plan currently mandates; if SDK is required for `canUseTool`, F2/F3 designs change shape.

---

## EXP-2 — AskUserQuestion tool behaviour

**Command:** universal flags
**Prompt:** `"Use the AskUserQuestion tool to ask me whether to proceed. Give me 2 options: yes or no."`
**Fixture:** `packages/protocol/fixtures/exp-2-ask-question.jsonl` (25 lines)

**Captured event sequence (summarised):**

- `system/init`.
- Assistant turn 1: `tool_use{name:"AskUserQuestion", id:"toolu_01Y3XvKD4fRzwXryi14Ktg1H", input:{questions:[{question:"Proceed?", header:"Proceed", multiSelect:false, options:[{label:"Yes", description:"Proceed"}, {label:"No", description:"Do not proceed"}]}]}}`.
- Harness auto-resolves: synthetic assistant message `text:"The question was cancelled."` — same auto-denial path as EXP-1.
- `result subtype:"success" stop_reason:"end_turn" num_turns:2 result:"The question was cancelled."` — process terminated.

**Exact `tool_use.input` shape:**

```json
{"questions":[
  {"question": string,
   "header":   string,
   "multiSelect": boolean,
   "options": [
     {"label": string, "description": string},
     ...]}
]}
```

(Top-level `questions` is an array; multiple questions can be asked in one tool call.)

**Decision: BRANCH A (same caveat as EXP-1).** AskUserQuestion is emitted as a `tool_use` with a well-typed `questions` array. Auto-cancellation occurs unless a permission/tool callback intervenes. The fix path is identical to EXP-1: register `canUseTool` (SDK) or `--permission-prompt-tool` (MCP) so the daemon can stall until the app supplies an answer, then resolve the tool with `tool_result` content like `{"type":"tool_result","tool_use_id":"…","content":[{"type":"text","text":"<chosen label>"}]}`.

**Daemon implication:** daemon must own the permission callback; on AskUserQuestion intercept, push a `tool_use` event with `await_user:true`, and on incoming `answer_question{toolUseId, selectedLabel}` ControlMessage, resolve the permission with an `allow` decision **and** synthesise a `tool_result` (or use the SDK's tool-output return path) carrying the chosen label.
**App implication:** QuestionCard renders `input.questions[0]`; one button per option emits `answer_question{toolUseId, selectedLabel}`.
**Open questions:**
- Does the harness expect the tool_result to be inserted via the next `user` stdin message, or via the permission-callback return value? The cleanest answer requires picking the integration path (SDK vs CLI MCP) before F3.
- Multi-question flow (`questions.length > 1`) — does the UI render all at once or step through? Recommend rendering all in one card; tap once per question; ControlMessage carries `answers: string[]`.
- `--disallowedTools AskUserQuestion` remains as the fallback if neither integration path works (Branch B).

---

## EXP-3a — Image input

**Command:** universal flags
**Stdin (single user message):**

```json
{"type":"user","message":{"role":"user","content":[
  {"type":"image","source":{"type":"base64","media_type":"image/png","data":"<1x1 png base64>"}},
  {"type":"text","text":"What color is this pixel? Reply in 5 words."}
]}}
```

**Fixture:** `packages/protocol/fixtures/exp-3a-image.jsonl`

**Captured event sequence:**

- `system/init`.
- `system/status status:"requesting"`.
- Assistant synthetic message: `text:"API Error: 400 Could not process image"`.
- `result subtype:"success" is_error:true api_error_status:400 result:"API Error: 400 Could not process image"`.

**Interpretation:** The stream-json **parser accepted** the multi-part content (`image` block + `text` block). The error came from the upstream Anthropic API rejecting the 1×1 PNG (too small / degenerate IDAT). No schema/validation error from claude. The wire shape `{type:"image", source:{type:"base64", media_type, data}}` is valid for stream-json stdin.

**Decision: BRANCH A.** Images can be sent directly as multi-part content from the Composer through the daemon to claude's stdin without server-side rewriting. (A real PNG/JPEG ≥ a few pixels will be processed by the API; the 1×1 case is an API-side reject, not a protocol issue.)

**Daemon implication:** Pass `content` array through verbatim. To avoid bloating WS frames when broadcasting the user message back to other connected app instances, daemon should strip the base64 `data` field from re-broadcast `SessionEvent`s (replace with `{type:"image", placeholder:true, sizeBytes:N}`) and let the originating app reconstruct the thumbnail locally.
**App implication:** Composer `+` menu's image picker encodes to base64, builds the `image` content block, and sends a `send_user_message` ControlMessage with the multi-part `content` array. UI renders local thumbnails.
**Open questions:**
- Confirm size cap before API rejection — likely 5 MB per image. Composer should downscale to ≤ 1024×1024 client-side.
- Test with a real image in F21 to verify happy path end-to-end.

---

## EXP-3b — `@path` file resolution

**Command:** universal flags + `--allowedTools Read`
**Setup:** `/tmp/spike-test-file.txt` containing `HELLO_SPIKE_TOKEN_42`.
**Prompt:** `"What is the content of @/tmp/spike-test-file.txt? Reply with just the contents, nothing else."`
**Fixture:** `packages/protocol/fixtures/exp-3b-at-file.jsonl`

**Captured event sequence:**

- `system/init`.
- Assistant turn 1: directly emits `text:"HELLO_SPIKE_TOKEN_42"` with no Read tool_use.
- `result subtype:"success" num_turns:1 result:"HELLO_SPIKE_TOKEN_42"`.

**Interpretation:** Claude's CLI **expands `@<path>`** in user text before sending to the model — the file contents arrive inline in the system/user prompt context, so the model answers directly without calling Read. (`num_turns:1` confirms no tool roundtrip occurred.)

**Decision: BRANCH A.** `@<path>` works through stream-json stdin user text exactly the same way it does in the interactive CLI. No daemon-side expansion needed.

**Daemon implication:** None — pass user text through verbatim.
**App implication:** Composer `+` menu's file picker inserts `@<absolute-path>` into the text input; nothing else needed. Optionally pre-validate path existence client-side.
**Open questions:**
- Verify behaviour with paths that don't exist (does claude error, ignore, or pass through literal?).
- Verify quoting / spaces in paths — likely need POSIX-style escape or quotes (e.g. `@"/tmp/has space.txt"`).
- Confirm that multiple `@`-files in one message are all expanded.

---

## EXP-4 — Interrupt method

Three sub-experiments, same long prompt (`"Write a 500-word essay on the history of the typewriter."`).

### EXP-4a — `control_request` line on stdin

**Fixture:** `packages/protocol/fixtures/exp-4a-control.jsonl` (5 lines)

Stdin sequence: user message, sleep 2s, then `{"type":"control_request","request_id":"r1","request":{"subtype":"interrupt"}}\n`.

**Captured event sequence:**

- `system/init`, `system/status requesting`.
- `{"type":"control_response","response":{"subtype":"success","request_id":"r1"}}` — server acknowledged.
- Synthetic `type:"user" content:[{type:"text", text:"[Request interrupted by user]"}]`.
- `result subtype:"error_during_execution" is_error:true num_turns:2`.

(Note: the literal JSON shape `{"type":"control","subtype":"interrupt"}` from the experiment brief was **not** the correct wire shape — the SDK expects `{"type":"control_request","request_id":"<id>","request":{"subtype":"interrupt"}}`. Trying the brief's shape would have been parsed as an unknown event and ignored. The working shape was confirmed by behaviour.)

**Outcome:** Clean interrupt. Process exits with non-zero (in-band `is_error:true`).

### EXP-4b — Close stdin mid-response

**Fixture:** `packages/protocol/fixtures/exp-4b-stdin-close.jsonl` (48 lines)

Stdin sequence: user message, sleep 2s, then EOF (no more bytes).

**Outcome:** **No interrupt.** Turn ran to completion (`stop_reason:"end_turn"`, full essay), then process exited cleanly. Closing stdin signals "no more turns", not "stop the current turn".

### EXP-4c — SIGINT to claude child process

**Fixture:** `packages/protocol/fixtures/exp-4c-sigint.jsonl` (48 lines)

Sent `kill -INT <claude_pid>` ~3s after the user message; stdin kept open via FIFO.

**Outcome:** **No interrupt.** Turn ran to completion (`stop_reason:"end_turn"`, full essay), `terminal_reason:"completed"`. SIGINT was either swallowed by the CLI's signal handler in stream-json mode, or only honoured when attached to a TTY. The model API call kept running and the response was streamed back fully.

**Decision: BRANCH A.** The stdin control-line is the interrupt channel. Wire shape:

```json
{"type":"control_request","request_id":"<unique-id>","request":{"subtype":"interrupt"}}
```

Confirm via `control_response{subtype:"success",request_id}`; expect a synthetic user msg `[Request interrupted by user]` and a `result` with `subtype:"error_during_execution"`.

**Daemon implication:** `interrupt` ControlMessage writes a `control_request` JSON line to claude's stdin, generates a request_id, and resolves when matching `control_response` returns. After interrupt, the daemon should re-prime stdin (the process exits — `is_error:true` is terminal in `-p` mode), so the daemon must **respawn** to continue the session. Closing stdin or sending SIGINT are not viable.
**App implication:** Composer Stop button emits `interrupt` ControlMessage; UI shows "session ended — start new turn?" surface afterwards (because the underlying claude process exits and a fresh spawn is required for the next message; this matches plan F22's "Stop button → interrupt").
**Open questions:**
- Persistent (long-lived) session — does interrupt require respawn, or does claude `-p` support multi-turn after interrupt without dying? In our capture the process exited; daemon design must assume respawn is needed and seamlessly recreate the child while preserving session id via `--resume`.
- The brief's `{"type":"control","subtype":"interrupt"}` literal does not match the actual SDK shape. **Plan F22 and the F1 ControlMessage type must serialise to the canonical `control_request` shape.**

---

## EXP-5 — Slash command interception in stdin

**Command:** universal flags
**Prompts (three runs):** `"/clear"`, `"/init"`, `"/review"`.
**Fixture:** `packages/protocol/fixtures/exp-5-slash-clear.jsonl` (three runs concatenated; separators `=== /<name> ===`)

**Captured event sequences:**

- `/clear`: synthetic assistant message (`model:"<synthetic>"`, empty text), `result subtype:"success" num_turns:0 result:""`. **Slash command was intercepted and executed by claude (no model call, zero cost).**
- `/init`: full model turn — claude inspected `/tmp`, noted "not a project codebase", produced a real assistant response. `num_turns:1`, real cost. **Treated as the actual `/init` command.**
- `/review`: full model turn — claude responded that `/tmp` is not a git repo, asked for a PR number. `num_turns:1`, real cost. **Treated as the actual `/review` command.**

**Interpretation:** Slash commands in stdin user text **are interpreted** by the CLI before reaching the model. `/clear` is a synthetic short-circuit; `/init`/`/review`/etc. are macro-expanded into structured prompts and routed through the model.

**Decision: BRANCH B (whitelist passthrough).** Some commands work cleanly through stdin (`/clear`, `/init`, `/review`, `/security-review`, presumably most others surfaced in `system/init.slash_commands`). The walccy plan's F27 originally framed slash commands as "UI buttons, never stdin" — that's still the right UX for discoverability, but the **implementation can route any user-selected slash command by sending the raw `/cmd` as user text** rather than re-implementing each natively.

**Daemon implication:** None — slash commands are just user text. Optionally, daemon can flag commands that mutate session state (e.g. `/clear`) and forward as separate events for store reset.
**App implication:** F27 quick-action strip emits `send_user_message{content:[{type:"text", text:"/<cmd>"}]}`. UI doesn't need parallel implementations of `/init`, `/review`, etc.
**Open questions:**
- Need to verify which commands take arguments (e.g. `/review owner/repo#123`) and how the UI gathers them.
- `/clear` produces `num_turns:0` — confirm walccy's daemon doesn't treat that as a "failed turn" and that the messages store handles the synthetic assistant message gracefully (likely: filter `model:"<synthetic>"` from view).
- `/agents`, `/plugin`, `/memory` are visible in `system/init.slash_commands` — verify they work through stdin or whether they're TTY-only.

---

## Summary table

| EXP | Question | Decision | Notes |
|---|---|---|---|
| 1 | Plan mode gate event | **A (with caveat)** | `tool_use{ExitPlanMode, input:{plan, planFilePath?}}` emitted but auto-denied without a permission callback. Need SDK `canUseTool` or `--permission-prompt-tool` MCP for the gate to block. |
| 2 | AskUserQuestion gate | **A (same caveat)** | `tool_use{AskUserQuestion, input:{questions:[…]}}` emitted, auto-denied without callback. Same fix path as EXP-1. Otherwise Branch B (`--disallowedTools AskUserQuestion`). |
| 3a | Image input multi-part | **A** | Stream-json accepts `image` content block via stdin; API rejected our 1×1 PNG but the wire path works. Daemon should strip base64 from re-broadcast. |
| 3b | `@path` resolution | **A** | CLI expands `@path` in user text inline; no Read tool roundtrip, no daemon-side expansion needed. |
| 4 | Interrupt method | **A** | `{"type":"control_request","request_id":"…","request":{"subtype":"interrupt"}}` on stdin works. Stdin-close and SIGINT do NOT interrupt. Process exits after interrupt → daemon must respawn (`--resume`) for next turn. **Note: canonical shape is `control_request`, not `control` as in the brief.** |
| 5 | Slash commands | **B (whitelist passthrough)** | `/clear`, `/init`, `/review` all intercepted/expanded by CLI when sent as stdin user text. App can emit `/cmd` as plain text instead of re-implementing. |

## Cross-cutting findings

1. **Permission callback is the linchpin for EXP-1 and EXP-2.** The plain `claude -p` CLI auto-denies any tool needing approval. To preserve plan-mode and AskUserQuestion UX, the daemon must either (a) switch to `@anthropic-ai/claude-agent-sdk` with `canUseTool`, or (b) wire an MCP-based `--permission-prompt-tool`. This is a single design decision that gates F19 (QuestionCard) and F20 (PlanCard).
2. **`control_request` is the canonical control-channel envelope.** Plan documents currently say `{"type":"control","subtype":"interrupt"}` — that shape is silently ignored. F1 protocol types must use `control_request` with `request_id` round-tripped to a `control_response`.
3. **Interrupt causes process exit in `-p` mode.** F22 should expect respawn after stop; pair with `--resume <session_id>` from the prior `system/init` event so the next user message lands in the same logical session.
4. **`image` multi-part and `@path` Just Work** — F21 Composer implementation is the simplest of the gated features.
5. **Slash commands collapse F27 implementation** to "emit `/cmd` as user text". No native shadow implementations required.
