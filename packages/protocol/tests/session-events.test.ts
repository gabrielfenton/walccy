import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionEvent, SessionEventKind } from '../src/session-events.js';
import type { SDKMessage } from '../src/claude-stream.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '..', 'fixtures');

// ──────────────────────────────────────────────
// Compile-time exhaustiveness
// ──────────────────────────────────────────────
//
// If a new SessionEvent kind is added without a case here, TS errors out
// because the function would lack a return for that kind (strict +
// noImplicitReturns is set in tsconfig). Forces fan-out updates downstream.

function assertNever(_x: never): never {
  throw new Error('non-exhaustive switch');
}

function describeEvent(e: SessionEvent): string {
  switch (e.kind) {
    case 'init': return `init:${e.model}`;
    case 'status': return `status:${e.status}`;
    case 'rate_limit': return `rate_limit:${e.info.status}`;
    case 'assistant_text_delta': return `text_delta:${e.text.length}`;
    case 'assistant_text_done': return `text_done:${e.fullText.length}`;
    case 'thinking_delta': return `thinking_delta:${e.text.length}`;
    case 'thinking_done': return `thinking_done:${e.fullText.length}`;
    case 'tool_use': return `tool_use:${e.name}`;
    case 'tool_result': return `tool_result:${e.isError ? 'err' : 'ok'}`;
    case 'turn_complete': return `turn:${e.stopReason ?? 'null'}`;
    case 'hook_started': return `hook_start:${e.event}`;
    case 'hook_progress': return `hook_prog:${e.hookId}`;
    case 'hook_response': return `hook_resp:${e.decision}`;
    case 'plugin_install': return `plugin:${e.status}`;
    case 'auth_status': return `auth:${e.isAuthenticating}`;
    case 'task_started': return `task_start:${e.taskId}`;
    case 'task_progress': return `task_prog:${e.taskId}`;
    case 'task_updated': return `task:${e.status}`;
    case 'tool_progress': return `tool_prog:${e.progress}`;
    case 'memory_recall': return `memory:${e.path}`;
    case 'compact_boundary': return `compact:${e.trigger}:${e.preTokens}`;
    case 'permission_denied': return `denied:${e.reason}`;
    case 'elicitation_complete': return `elicit:${e.toolUseId}`;
    case 'permission_request': return `permreq:${e.toolName}`;
    case 'error': return `error:${e.code}`;
    default: return assertNever(e);
  }
}

describe('SessionEvent — exhaustiveness', () => {
  it('every kind is handled by the discriminator switch', () => {
    // Smoke: build one fake event of every kind and pass it through
    // describeEvent. Compile success is the real test; this run-time call
    // just ensures the switch returns something for each.
    const fakes: SessionEvent[] = [
      { kind: 'init', sessionId: 's', model: 'opus', cwd: '/', tools: [], agents: [], skills: [], slashCommands: [], mcpServers: [], plugins: [], permissionMode: 'default', memoryPaths: {} },
      { kind: 'status', status: 'requesting' },
      { kind: 'rate_limit', info: { status: 'allowed' } },
      { kind: 'assistant_text_delta', messageId: 'm', text: 'x' },
      { kind: 'assistant_text_done', messageId: 'm', fullText: 'x' },
      { kind: 'thinking_delta', messageId: 'm', text: 'x' },
      { kind: 'thinking_done', messageId: 'm', fullText: 'x' },
      { kind: 'tool_use', messageId: 'm', toolUseId: 't', name: 'Bash', input: {}, parentToolUseId: null },
      { kind: 'tool_result', toolUseId: 't', content: '', isError: false },
      { kind: 'turn_complete', stopReason: 'end_turn', durationMs: 100, cost: { total: 0, inputTokens: 0, outputTokens: 0 }, isError: false },
      { kind: 'hook_started', hookId: 'h', event: 'PreToolUse' },
      { kind: 'hook_progress', hookId: 'h', message: '' },
      { kind: 'hook_response', hookId: 'h', decision: 'allow' },
      { kind: 'plugin_install', pluginId: 'p', status: 'ready' },
      { kind: 'auth_status', isAuthenticating: false, output: [] },
      { kind: 'task_started', taskId: 't' },
      { kind: 'task_progress', taskId: 't', message: '' },
      { kind: 'task_updated', taskId: 't', status: 'running' },
      { kind: 'tool_progress', toolUseId: 't', progress: 0.5 },
      { kind: 'memory_recall', path: '/m' },
      { kind: 'compact_boundary', trigger: 'manual', preTokens: 100 },
      { kind: 'permission_denied', toolUseId: 't', toolName: 'Bash', reason: 'auto_deny' },
      { kind: 'elicitation_complete', toolUseId: 't', result: null },
      { kind: 'permission_request', requestId: 'r', toolUseId: 't', toolName: 'ExitPlanMode', input: {} },
      { kind: 'error', code: 'X', message: 'm', fatal: false },
    ];

    // Verify each fake produces a non-empty descriptor.
    for (const e of fakes) {
      expect(describeEvent(e).length).toBeGreaterThan(0);
    }

    // Verify the fake set covers every declared kind exactly once.
    const allKinds: SessionEventKind[] = [
      'init', 'status', 'rate_limit', 'assistant_text_delta', 'assistant_text_done',
      'thinking_delta', 'thinking_done', 'tool_use', 'tool_result', 'turn_complete',
      'hook_started', 'hook_progress', 'hook_response', 'plugin_install', 'auth_status',
      'task_started', 'task_progress', 'task_updated', 'tool_progress', 'memory_recall',
      'compact_boundary', 'permission_denied', 'elicitation_complete', 'permission_request',
      'error',
    ];
    const fakeKinds = fakes.map(f => f.kind).sort();
    expect(fakeKinds).toEqual([...allKinds].sort());
  });
});

// ──────────────────────────────────────────────
// Fixture round-trip: every captured line parses as JSON
// ──────────────────────────────────────────────
//
// The fixtures came from `claude -p` CLI captures during the verification
// spike. The daemon will instead consume the SDK's typed AsyncGenerator, so
// these fixtures aren't a perfect schema target for SessionEvent — but they
// MUST remain valid JSON, and each top-level line must have a `type` field
// that the SDK recognises. If the SDK upgrades and renames a `type`, this
// catches it.

const KNOWN_SDK_TYPES = new Set<string>([
  'system', 'assistant', 'user', 'result', 'rate_limit_event',
  'stream_event', 'control_request', 'control_response',
  // newer SDK additions (sample — not exhaustive, just must-recognise)
  'status', 'hook_started', 'hook_progress', 'hook_response',
  'plugin_install', 'auth_status', 'task_started', 'task_progress',
  'task_updated', 'task_notification', 'memory_recall', 'compact_boundary',
  'permission_denied', 'elicitation_complete', 'mirror_error',
  'tool_use_summary', 'tool_progress', 'partial_assistant', 'user_replay',
]);

describe('Fixtures parse as JSON-line streams', () => {
  const files = fs.existsSync(FIXTURES)
    ? fs.readdirSync(FIXTURES).filter(f => f.endsWith('.jsonl'))
    : [];

  if (files.length === 0) {
    it.skip('no fixtures present', () => { /* no-op */ });
    return;
  }

  for (const file of files) {
    it(`parses ${file}`, () => {
      const content = fs.readFileSync(path.join(FIXTURES, file), 'utf8');
      const lines = content.split('\n').filter(l => l.trim().length > 0);
      expect(lines.length).toBeGreaterThan(0);

      let unknownTypes = 0;
      for (const line of lines) {
        // Some fixtures have separator lines like "=== /foo ===" — skip non-JSON.
        if (!line.trimStart().startsWith('{')) continue;
        const parsed = JSON.parse(line) as { type?: string };
        // Top-level `type` should exist for SDK messages.
        if (parsed.type && !KNOWN_SDK_TYPES.has(parsed.type)) {
          unknownTypes++;
        }
      }
      // Allow a small number of unknown types so that an SDK that adds new
      // event kinds without renaming existing ones doesn't break this test.
      expect(unknownTypes).toBeLessThanOrEqual(3);
    });
  }
});

// Type-level only: ensure SDKMessage is reachable through claude-stream.
// (Runtime import wouldn't fail compilation; this is more of a smoke import.)
const _typeSmoke: SDKMessage | null = null;
void _typeSmoke;
