import { describe, expect, it } from 'vitest';
import type { ControlMessage, ControlMessageKind } from '../src/control-messages.js';

// ──────────────────────────────────────────────
// Compile-time exhaustiveness — same pattern as session-events.test.ts
// ──────────────────────────────────────────────

function assertNever(_x: never): never {
  throw new Error('non-exhaustive switch');
}

function describeControl(m: ControlMessage): string {
  switch (m.type) {
    case 'send_user_message': return `send:${m.content.length}`;
    case 'interrupt': return 'interrupt';
    case 'kill_session': return `kill:${m.sessionId}`;
    case 'plan_accept': return `plan_accept:${m.toolUseId}`;
    case 'plan_reject': return `plan_reject:${m.toolUseId}`;
    case 'answer_question': return `answer:${m.toolUseId}:${m.answers.length}`;
    case 'resolve_permission': return `resolve:${m.decision}`;
    case 'change_permission_mode': return `mode:${m.mode}`;
    case 'set_model': return `model:${m.model ?? 'default'}`;
    case 'set_effort_level': return `effort:${m.level}`;
    default: return assertNever(m);
  }
}

describe('ControlMessage — exhaustiveness', () => {
  it('every type is handled by the discriminator switch', () => {
    const fakes: ControlMessage[] = [
      { type: 'send_user_message', content: [{ type: 'text', text: 'hi' }] },
      { type: 'interrupt' },
      { type: 'kill_session', sessionId: 's' },
      { type: 'plan_accept', toolUseId: 't' },
      { type: 'plan_reject', toolUseId: 't' },
      { type: 'answer_question', toolUseId: 't', answers: ['Yes'] },
      { type: 'resolve_permission', requestId: 'r', decision: 'allow' },
      { type: 'change_permission_mode', mode: 'plan' },
      { type: 'set_model', model: 'sonnet' },
      { type: 'set_effort_level', level: 'medium' },
    ];
    for (const m of fakes) expect(describeControl(m).length).toBeGreaterThan(0);

    const expected: ControlMessageKind[] = [
      'send_user_message', 'interrupt', 'kill_session', 'plan_accept',
      'plan_reject', 'answer_question', 'resolve_permission',
      'change_permission_mode', 'set_model', 'set_effort_level',
    ];
    const actual = fakes.map(f => f.type).sort();
    expect(actual).toEqual([...expected].sort());
  });
});
