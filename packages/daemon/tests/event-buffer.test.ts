import { describe, expect, it } from 'vitest';
import { RingEventBuffer } from '../src/event-buffer.js';
import type { SessionEvent } from '@walccy/protocol';

function status(s: 'requesting' | 'compacting' | 'idle'): SessionEvent {
  return { kind: 'status', status: s };
}

function delta(messageId: string, text: string): SessionEvent {
  return { kind: 'assistant_text_delta', messageId, text };
}

function thinkingDelta(messageId: string, text: string): SessionEvent {
  return { kind: 'thinking_delta', messageId, text };
}

describe('RingEventBuffer — basic semantics', () => {
  it('assigns monotonic indices starting at 0', () => {
    const buf = new RingEventBuffer({ maxEvents: 8 });
    const a = buf.push(status('requesting'));
    const b = buf.push(status('idle'));
    expect(a.index).toBe(0);
    expect(b.index).toBe(1);
    expect(buf.size).toBe(2);
    expect(buf.totalCount).toBe(2);
  });

  it('returns empty getFrom on fresh buffer', () => {
    const buf = new RingEventBuffer();
    const { events, firstAvailableIndex } = buf.getFrom(0);
    expect(events).toEqual([]);
    expect(firstAvailableIndex).toBe(0);
  });

  it('evicts oldest entries past capacity (FIFO)', () => {
    const buf = new RingEventBuffer({ maxEvents: 3 });
    buf.push(status('requesting')); // index 0, will be evicted
    buf.push(status('idle'));        // index 1, will be evicted
    buf.push(status('requesting')); // index 2
    buf.push(status('idle'));        // index 3
    buf.push(status('compacting'));  // index 4
    expect(buf.size).toBe(3);
    expect(buf.firstAvailableIndex).toBe(2);
    expect(buf.totalCount).toBe(5);
    const { events, firstAvailableIndex } = buf.getFrom(0);
    expect(events.length).toBe(3);
    expect(firstAvailableIndex).toBe(2);
  });

  it('getFrom binary-searches the start index', () => {
    const buf = new RingEventBuffer({ maxEvents: 16 });
    for (let i = 0; i < 10; i++) buf.push(status('requesting'));
    const { events } = buf.getFrom(7);
    expect(events.length).toBe(3); // indices 7, 8, 9
  });

  it('getTail returns trailing events in order', () => {
    const buf = new RingEventBuffer({ maxEvents: 16 });
    for (let i = 0; i < 5; i++) buf.push(status('requesting'));
    const tail = buf.getTail(2);
    expect(tail.length).toBe(2);
    // both are `status` events; just confirm we got events (not entries)
    expect(tail.every((e) => e.kind === 'status')).toBe(true);
  });

  it('clear() empties the ring but keeps the monotonic index moving', () => {
    const buf = new RingEventBuffer({ maxEvents: 4 });
    buf.push(status('requesting'));
    buf.push(status('idle'));
    buf.clear();
    expect(buf.size).toBe(0);
    expect(buf.firstAvailableIndex).toBe(0);
    const next = buf.push(status('compacting'));
    expect(next.index).toBe(2); // continues monotonically
  });
});

describe('RingEventBuffer — delta coalescing', () => {
  it('merges consecutive assistant_text_delta for the same messageId', () => {
    const buf = new RingEventBuffer({ maxEvents: 8 });
    const a = buf.push(delta('m1', 'Hel'));
    const b = buf.push(delta('m1', 'lo,'));
    const c = buf.push(delta('m1', ' world'));
    expect(a.index).toBe(0);
    expect(b.index).toBe(0); // same entry — merged
    expect(c.index).toBe(0);
    expect(buf.size).toBe(1);
    expect(buf.totalCount).toBe(1);
    const { events } = buf.getFrom(0);
    expect(events.length).toBe(1);
    const merged = events[0];
    if (merged?.kind !== 'assistant_text_delta') throw new Error('unexpected');
    expect(merged.text).toBe('Hello, world');
  });

  it('does NOT merge across messageId boundary', () => {
    const buf = new RingEventBuffer({ maxEvents: 8 });
    buf.push(delta('m1', 'a'));
    buf.push(delta('m2', 'b'));
    expect(buf.size).toBe(2);
  });

  it('does NOT merge across event-kind boundary (delta then status)', () => {
    const buf = new RingEventBuffer({ maxEvents: 8 });
    buf.push(delta('m1', 'a'));
    buf.push(status('idle'));
    buf.push(delta('m1', 'b')); // status broke the run; cannot merge backward
    expect(buf.size).toBe(3);
  });

  it('merges thinking_delta the same way as text_delta', () => {
    const buf = new RingEventBuffer({ maxEvents: 8 });
    buf.push(thinkingDelta('m1', 'first'));
    buf.push(thinkingDelta('m1', ' second'));
    const { events } = buf.getFrom(0);
    expect(events.length).toBe(1);
    if (events[0]?.kind !== 'thinking_delta') throw new Error('unexpected');
    expect(events[0].text).toBe('first second');
  });
});
