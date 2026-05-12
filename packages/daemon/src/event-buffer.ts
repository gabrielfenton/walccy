// ──────────────────────────────────────────────
// EventBuffer — per-session ring of SessionEvents
// ──────────────────────────────────────────────
//
// Replaces the old LineBuffer. Same ring semantics (fixed capacity,
// monotonic indices that never reset, oldest-evicted-on-push) but the
// payload is now structured SessionEvents instead of BufferedLines.
//
// Coalescing: sequential `assistant_text_delta` events for the same
// `messageId` are merged into a single buffer entry whose `text` field
// accumulates. This bounds memory under high-frequency partial-message
// streams (the SDK emits many small deltas per assistant turn). The
// `thinking_delta` kind gets the same treatment.

import type {
  EventBuffer,
  SessionEvent,
} from '@walccy/protocol';

interface BufferedEntry {
  index: number;
  event: SessionEvent;
}

const COALESCE_KINDS = new Set<SessionEvent['kind']>([
  'assistant_text_delta',
  'thinking_delta',
]);

export interface EventBufferOptions {
  /** Maximum events resident in the ring. Default 10_000. */
  maxEvents?: number;
}

export class RingEventBuffer implements EventBuffer {
  private ring: (BufferedEntry | undefined)[];
  private readonly maxEvents: number;
  /** Write position (next slot). */
  private head = 0;
  /** Number of items currently stored. */
  private count = 0;
  /** Monotonic index of the next event to be assigned. */
  private nextIndex = 0;

  constructor(opts: EventBufferOptions = {}) {
    this.maxEvents = opts.maxEvents ?? 10_000;
    this.ring = new Array(this.maxEvents);
  }

  /**
   * Append an event. Returns the stored event plus its assigned index.
   * For coalescable kinds, attempts to merge into the most recent entry
   * sharing the same `messageId`; on a successful merge no new index is
   * minted and the returned `index` is the existing one.
   */
  push(event: SessionEvent): { event: SessionEvent; index: number } {
    if (COALESCE_KINDS.has(event.kind)) {
      const merged = this.tryMerge(event);
      if (merged !== null) return merged;
    }

    const index = this.nextIndex++;
    const entry: BufferedEntry = { index, event };
    this.ring[this.head] = entry;
    this.head = (this.head + 1) % this.maxEvents;
    if (this.count < this.maxEvents) this.count++;
    return { event, index };
  }

  /**
   * Return the most recent entry's event in-place if it can absorb the new
   * delta. Otherwise null (caller should append a fresh entry).
   */
  private tryMerge(
    next: SessionEvent
  ): { event: SessionEvent; index: number } | null {
    if (this.count === 0) return null;
    const lastSlot = (this.head - 1 + this.maxEvents) % this.maxEvents;
    const last = this.ring[lastSlot];
    if (!last) return null;
    if (last.event.kind !== next.kind) return null;

    if (
      next.kind === 'assistant_text_delta' &&
      last.event.kind === 'assistant_text_delta' &&
      last.event.messageId === next.messageId
    ) {
      last.event = {
        ...last.event,
        text: last.event.text + next.text,
      };
      return { event: last.event, index: last.index };
    }
    if (
      next.kind === 'thinking_delta' &&
      last.event.kind === 'thinking_delta' &&
      last.event.messageId === next.messageId
    ) {
      last.event = {
        ...last.event,
        text: last.event.text + next.text,
      };
      return { event: last.event, index: last.index };
    }
    return null;
  }

  /**
   * Return events with index ≥ `startIndex` in chronological order, plus
   * the oldest index still resident (for scrollback-gap detection).
   */
  getFrom(
    startIndex: number
  ): { events: SessionEvent[]; firstAvailableIndex: number } {
    const ordered = this.materialize();
    const firstAvailableIndex =
      ordered.length === 0 ? 0 : ordered[0]!.index;
    // ordered is sorted by index; binary-search the first entry with
    // index >= startIndex.
    let lo = 0;
    let hi = ordered.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (ordered[mid]!.index < startIndex) lo = mid + 1;
      else hi = mid;
    }
    return {
      events: ordered.slice(lo).map((e) => e.event),
      firstAvailableIndex,
    };
  }

  getTail(count: number): SessionEvent[] {
    const ordered = this.materialize();
    if (count >= ordered.length) return ordered.map((e) => e.event);
    return ordered.slice(ordered.length - count).map((e) => e.event);
  }

  clear(): void {
    this.ring = new Array(this.maxEvents);
    this.head = 0;
    this.count = 0;
    // Note: nextIndex is monotonic-forever; we do NOT reset it on clear, so
    // late events arriving after a clear get strictly higher indices than
    // anything previously emitted. Clients can rely on index monotonicity.
  }

  get size(): number {
    return this.count;
  }

  get totalCount(): number {
    return this.nextIndex;
  }

  get firstAvailableIndex(): number {
    if (this.count === 0) return 0;
    const start = (this.head - this.count + this.maxEvents) % this.maxEvents;
    return this.ring[start]!.index;
  }

  private materialize(): BufferedEntry[] {
    if (this.count === 0) return [];
    const out: BufferedEntry[] = new Array(this.count);
    const start = (this.head - this.count + this.maxEvents) % this.maxEvents;
    for (let i = 0; i < this.count; i++) {
      out[i] = this.ring[(start + i) % this.maxEvents]!;
    }
    return out;
  }
}
