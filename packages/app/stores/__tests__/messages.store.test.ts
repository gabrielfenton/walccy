// Unit tests for messages.store reducer.
// Covers the three reducer bug-fixes on feat/stream-json-migration:
//   - 98cc243 produce new entry references on in-place mutations
//   - 001f3b2 coalesce streaming deltas by most-recent-streaming entry
//   - eac2592 reconcile assistant_text delta/done across messageId mismatch
// Plus permission auto-resolve, denial, out-of-order drop, history replay,
// user-message append, and max-entries clamp.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import type {
  SessionEvent,
  SessionEventAssistantTextDelta,
  SessionEventAssistantTextDone,
  SessionEventToolUse,
  SessionEventToolResult,
  SessionEventPermissionRequest,
  SessionEventPermissionDenied,
  SessionEventTurnComplete,
  SessionEventStatus,
  SessionEventInit,
  TurnCost,
  UserContentBlock,
} from '@walccy/protocol';

// Fresh-store helper — resets module cache so each test gets its own
// Zustand singleton. The store wraps the inner `applyEvent(buf, event)` in
// a Zustand action that owns the out-of-order index guard, so we must
// drive every assertion through the action — that means the store itself.
async function freshStore() {
  vi.resetModules();
  const mod = await import('../messages.store');
  return mod.useMessagesStore;
}

const SESSION = 's1';

function getBuf(store: any) {
  return store.getState().buffers[SESSION];
}

function getEntries(store: any) {
  return getBuf(store)?.entries ?? [];
}

// ── Minimal event fixtures ──
const ev = {
  delta(messageId: string, text: string): SessionEventAssistantTextDelta {
    return { kind: 'assistant_text_delta', messageId, text };
  },
  done(messageId: string, fullText: string): SessionEventAssistantTextDone {
    return { kind: 'assistant_text_done', messageId, fullText };
  },
  toolUse(toolUseId: string, name = 'Bash', input: Record<string, unknown> = {}): SessionEventToolUse {
    return {
      kind: 'tool_use',
      messageId: 'm-' + toolUseId,
      toolUseId,
      name,
      input,
      parentToolUseId: null,
    };
  },
  toolResult(toolUseId: string, content: unknown = 'ok', isError = false): SessionEventToolResult {
    return {
      kind: 'tool_result',
      toolUseId,
      content,
      isError,
      structured: { stdout: 'out', exitCode: 0 },
    };
  },
  permReq(toolUseId: string, requestId: string, toolName = 'Bash'): SessionEventPermissionRequest {
    return {
      kind: 'permission_request',
      requestId,
      toolUseId,
      toolName,
      input: {},
    };
  },
  permDenied(toolUseId: string, toolName = 'Bash'): SessionEventPermissionDenied {
    return {
      kind: 'permission_denied',
      toolUseId,
      toolName,
      reason: 'user_reject',
    };
  },
  status(status: 'requesting' | 'compacting' | 'idle'): SessionEventStatus {
    return { kind: 'status', status };
  },
  turn(): SessionEventTurnComplete {
    const cost: TurnCost = {
      total: 0.001,
      inputTokens: 10,
      outputTokens: 5,
    };
    return {
      kind: 'turn_complete',
      stopReason: 'end_turn',
      durationMs: 100,
      cost,
      isError: false,
    };
  },
  init(sessionId: string): SessionEventInit {
    return {
      kind: 'init',
      sessionId,
      model: 'claude-x',
      cwd: '/tmp',
      tools: [],
      agents: [],
      skills: [],
      slashCommands: [],
      mcpServers: [],
      plugins: [],
      permissionMode: 'default' as any,
      memoryPaths: {},
    };
  },
};

describe('messages.store reducer', () => {
  let idx: number;
  beforeEach(() => {
    idx = 0;
  });

  function apply(store: any, e: SessionEvent) {
    store.getState().applyEvent(SESSION, e, idx++);
  }

  // ── 1. Immutability — entry references change on mutation ──
  it('produces a NEW entry reference when tool_result mutates the tool entry', async () => {
    const store = await freshStore();
    apply(store, ev.toolUse('T1', 'Bash', { cmd: 'ls' }));
    const beforeEntries = getEntries(store);
    expect(beforeEntries).toHaveLength(1);
    const beforeRef = beforeEntries[0];
    expect(beforeRef.kind).toBe('tool');
    expect((beforeRef as any).state).toBe('running');

    apply(store, ev.toolResult('T1', 'done', false));

    const afterEntries = getEntries(store);
    expect(afterEntries).toHaveLength(1);
    const afterRef = afterEntries[0];
    // Reference inequality — required for React.memo to re-render.
    expect(afterRef).not.toBe(beforeRef);
    // But the mutation IS applied.
    expect((afterRef as any).state).toBe('complete');
    expect((afterRef as any).result).toBe('done');
    expect((afterRef as any).structured?.exitCode).toBe(0);
  });

  // ── 2. Delta coalescing across mismatched messageIds ──
  it('coalesces back-to-back deltas with DIFFERENT messageIds into one entry', async () => {
    const store = await freshStore();
    apply(store, ev.delta('msg-uuid-A', 'Hello, '));
    apply(store, ev.delta('msg-uuid-B', 'world!'));
    apply(store, ev.done('msg-canonical', 'Hello, world!'));

    const entries = getEntries(store);
    const assistants = entries.filter((e: any) => e.kind === 'assistant');
    expect(assistants).toHaveLength(1);
    const a = assistants[0] as any;
    expect(a.text).toBe('Hello, world!');
    expect(a.streaming).toBe(false);
    expect(a.messageId).toBe('msg-canonical');
  });

  // ── 3. tool_result auto-resolves matching permission_request ──
  it('marks permission_request resolved="allowed" when tool_result lands', async () => {
    const store = await freshStore();
    apply(store, ev.toolUse('T2', 'Bash', {}));
    apply(store, ev.permReq('T2', 'R2', 'Bash'));
    apply(store, ev.toolResult('T2', 'ok', false));

    const entries = getEntries(store);
    const perm = entries.find((e: any) => e.kind === 'permission_request') as any;
    const tool = entries.find((e: any) => e.kind === 'tool') as any;
    expect(perm).toBeDefined();
    expect(perm.resolved).toBe('allowed');
    expect(tool.state).toBe('complete');
  });

  // ── 4. permission_denied marks resolved="denied" ──
  it('marks permission_request resolved="denied" on permission_denied', async () => {
    const store = await freshStore();
    apply(store, ev.permReq('T3', 'R3'));
    apply(store, ev.permDenied('T3'));

    const perm = getEntries(store).find((e: any) => e.kind === 'permission_request') as any;
    expect(perm.resolved).toBe('denied');
  });

  // ── 5. Out-of-order eventIndex is dropped ──
  it('drops an event whose eventIndex is <= lastEventIndex', async () => {
    const store = await freshStore();
    // First apply with index=5.
    store.getState().applyEvent(SESSION, ev.toolUse('T-late', 'Bash', {}), 5);
    expect(getEntries(store)).toHaveLength(1);
    expect(getBuf(store).lastEventIndex).toBe(5);

    // Now an event with a lower index — must be ignored.
    store.getState().applyEvent(SESSION, ev.toolUse('T-early', 'Bash', {}), 3);
    expect(getEntries(store)).toHaveLength(1);
    expect((getEntries(store)[0] as any).toolUseId).toBe('T-late');
    expect(getBuf(store).lastEventIndex).toBe(5);
  });

  // ── 6. setHistory replays events in order ──
  it('setHistory replays events in order and matches sequential applyEvent', async () => {
    const events: SessionEvent[] = [
      ev.init(SESSION),
      ev.status('requesting'),
      ev.delta('m-a', 'Hi '),
      ev.done('m-canon', 'Hi there'),
      ev.turn(),
    ];

    // Path A: setHistory.
    const storeA = await freshStore();
    storeA.getState().setHistory(SESSION, events, events.length, 0);
    const aEntries = getEntries(storeA);

    // Path B: sequential applyEvent on a fresh store.
    const storeB = await freshStore();
    let i = 0;
    for (const e of events) {
      storeB.getState().applyEvent(SESSION, e, i++);
    }
    const bEntries = getEntries(storeB);

    // Same kinds in same order.
    expect(aEntries.map((e: any) => e.kind)).toEqual(bEntries.map((e: any) => e.kind));

    // Same visible-content fields.
    const stripVolatile = (e: any) => {
      const { id, timestamp, ...rest } = e;
      return rest;
    };
    expect(aEntries.map(stripVolatile)).toEqual(bEntries.map(stripVolatile));

    // historyLoaded set by setHistory.
    expect(getBuf(storeA).historyLoaded).toBe(true);
  });

  // ── 7. pushUserMessage appends a user entry ──
  it('pushUserMessage appends an entry with kind="user" and unique id', async () => {
    const store = await freshStore();
    const content: UserContentBlock[] = [{ type: 'text', text: 'hello' } as any];
    store.getState().pushUserMessage(SESSION, content);
    store.getState().pushUserMessage(SESSION, content);

    const entries = getEntries(store);
    expect(entries).toHaveLength(2);
    for (const e of entries) {
      expect(e.kind).toBe('user');
      expect(typeof (e as any).id).toBe('string');
      expect((e as any).id.length).toBeGreaterThan(0);
      expect(typeof (e as any).timestamp).toBe('number');
      expect((e as any).content).toBe(content);
    }
    expect((entries[0] as any).id).not.toBe((entries[1] as any).id);
  });

  // ── 8. Max-entries clamp ──
  it('clamps entries to MAX_ENTRIES_PER_SESSION (2000)', async () => {
    const store = await freshStore();
    const N = 2500;
    for (let i = 0; i < N; i++) {
      store.getState().applyEvent(SESSION, ev.toolUse('T-' + i, 'Bash', {}), i);
    }
    const entries = getEntries(store);
    expect(entries.length).toBeLessThanOrEqual(2000);
    expect(entries.length).toBe(2000);
    // Clamp keeps the TAIL — the last toolUseId must be the last pushed.
    expect((entries[entries.length - 1] as any).toolUseId).toBe('T-' + (N - 1));
  });

  // ── 10. Repeat tool_use with same toolUseId replaces existing entry ──
  it('tool_use with an existing toolUseId REPLACES the entry (not append)', async () => {
    const store = await freshStore();
    apply(store, ev.toolUse('Tdup', 'Bash', { cmd: 'first' }));
    const firstEntries = getEntries(store);
    expect(firstEntries).toHaveLength(1);
    const firstId = (firstEntries[0] as any).id;
    const firstTimestamp = (firstEntries[0] as any).timestamp;

    // Land a result so state moves to 'complete' with payload.
    apply(store, ev.toolResult('Tdup', 'done', false));
    const midEntries = getEntries(store);
    expect(midEntries).toHaveLength(1);
    expect((midEntries[0] as any).state).toBe('complete');
    expect((midEntries[0] as any).result).toBe('done');

    // Daemon/SDK re-emits tool_use with the SAME toolUseId (retry / revert).
    apply(store, ev.toolUse('Tdup', 'Bash', { cmd: 'second' }));
    const afterEntries = getEntries(store);

    // No duplicate entry.
    expect(afterEntries).toHaveLength(1);
    // Same memo-stable id — React.memo / list keys stay valid.
    expect((afterEntries[0] as any).id).toBe(firstId);
    // Timestamp preserved (it's a re-emit of the original tool use).
    expect((afterEntries[0] as any).timestamp).toBe(firstTimestamp);
    // State reset to 'running'; result/structured cleared.
    expect((afterEntries[0] as any).state).toBe('running');
    expect((afterEntries[0] as any).result).toBeUndefined();
    expect((afterEntries[0] as any).structured).toBeUndefined();
    // Latest input wins.
    expect((afterEntries[0] as any).input).toEqual({ cmd: 'second' });
  });

  // ── 11. State-machine semantics for cards w/ local optimistic state ──
  // F19 QuestionCard / F20 PlanCard keep their own `submitted`/`decided`
  // flags. The reducer can reset the shared entry on a repeat tool_use,
  // but it CANNOT reach into card-local React state — cards must observe
  // the running→complete→running transition themselves and reset on the
  // edge. This test pins down the reducer-observable half of that contract.
  it("tool_result transitions don't auto-reset card-local optimistic state", async () => {
    const store = await freshStore();

    // 1. tool_use
    apply(store, ev.toolUse('TQ', 'ExitPlanMode', { plan: 'v1' }));
    const e1 = getEntries(store);
    expect(e1).toHaveLength(1);
    expect((e1[0] as any).state).toBe('running');
    const stableId = (e1[0] as any).id;

    // 2. tool_result (not error) — state -> 'complete'
    apply(store, ev.toolResult('TQ', 'accepted', false));
    const e2 = getEntries(store);
    expect(e2).toHaveLength(1);
    expect((e2[0] as any).state).toBe('complete');

    // 3. Repeat tool_use with the SAME toolUseId (daemon revert / retry).
    apply(store, ev.toolUse('TQ', 'ExitPlanMode', { plan: 'v2' }));
    const e3 = getEntries(store);

    // 4. Reducer behavior: same entry index, state reset to 'running',
    //    result cleared. Cards observing this MUST own their local reset.
    expect(e3).toHaveLength(1);
    expect((e3[0] as any).id).toBe(stableId); // not a new entry
    expect((e3[0] as any).state).toBe('running');
    expect((e3[0] as any).result).toBeUndefined();
    expect((e3[0] as any).input).toEqual({ plan: 'v2' });
  });

  // ── 12. tool_result isError vs user-rejection conflation (documentation) ──
  // The daemon never emits a distinct "user rejected the plan" event — it
  // routes the rejection through `plan_reject` and the SDK's next message
  // surfaces as tool_result with isError=true OR is_error inside content.
  // This test pins the conflation in place so the F20 card knows it must
  // distinguish via its own local `decided` flag.
  it('tool_result isError=true produces state="error" regardless of cause (rejection vs failure)', async () => {
    const store = await freshStore();
    apply(store, ev.toolUse('TR', 'ExitPlanMode', { plan: 'p' }));
    apply(store, ev.toolResult('TR', 'The user doesn\'t want to proceed', true));
    const tool = getEntries(store).find((e: any) => e.kind === 'tool') as any;
    // Reducer cannot tell rejection apart from a real tool failure — both
    // collapse to state='error'. F20 PlanCard must use card-local state.
    expect(tool.state).toBe('error');
  });

  // ── 9. is_error inside content blocks marks state error ──
  it('tool_result with is_error content block marks state error', async () => {
    const store = await freshStore();
    apply(store, ev.toolUse('TE', 'mcp__x__y', {}));
    apply(
      store,
      ev.toolResult('TE', [{ type: 'text', text: 'err', is_error: true }], false),
    );

    const tool = getEntries(store).find((e: any) => e.kind === 'tool') as any;
    expect(tool.state).toBe('error');
  });
});
