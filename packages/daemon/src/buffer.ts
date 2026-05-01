import { BufferedLine } from '@walccy/protocol';

// ──────────────────────────────────────────────
// ANSI escape sequence stripper
// ──────────────────────────────────────────────

// Matches:
//  - CSI sequences: ESC [ ... final-byte
//  - OSC sequences: ESC ] ... ST  (ST = ESC\ or BEL)
//  - Simple ESC + single char
//  - Raw C0/C1 control characters (except \n, \r, \t)
const ANSI_REGEX =
  // eslint-disable-next-line no-control-regex
  /(?:\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f])/g;

export function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, '');
}

// ──────────────────────────────────────────────
// Circular line buffer
// ──────────────────────────────────────────────

export class LineBuffer {
  /** Fixed-size ring buffer. Slots may be undefined until filled. */
  private ring: (BufferedLine | undefined)[];
  private readonly maxLines: number;
  /** Write position (next slot to write to). */
  private head: number = 0;
  /** Number of items currently stored. */
  private count: number = 0;
  private totalReceived: number = 0;
  /** Global monotonically increasing line index (never resets). */
  private nextIndex: number = 0;

  constructor(maxLines = 10000) {
    this.maxLines = maxLines;
    this.ring = new Array(maxLines);
  }

  /**
   * Append a new line to the buffer (O(1)). Returns the stored BufferedLine.
   */
  push(line: Omit<BufferedLine, 'index'>): BufferedLine {
    const stored: BufferedLine = {
      ...line,
      index: this.nextIndex++,
      content: stripAnsi(line.rawContent),
    };

    this.ring[this.head] = stored;
    this.head = (this.head + 1) % this.maxLines;
    this.totalReceived++;

    if (this.count < this.maxLines) {
      this.count++;
    }

    return stored;
  }

  /**
   * Return lines starting from `fromIndex` (global index), up to `count` lines.
   * Uses binary search on the sorted index field for O(log n) lookup.
   */
  getLines(fromIndex?: number, count?: number): BufferedLine[] {
    const ordered = this._getOrdered();

    if (fromIndex !== undefined) {
      // Binary search for the first line with index >= fromIndex
      let lo = 0;
      let hi = ordered.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (ordered[mid].index < fromIndex) lo = mid + 1;
        else hi = mid;
      }
      const result = ordered.slice(lo);
      return count !== undefined ? result.slice(0, count) : result;
    }

    return count !== undefined ? ordered.slice(0, count) : ordered;
  }

  /**
   * Return the most recent `count` lines.
   */
  getRecent(count: number): BufferedLine[] {
    const ordered = this._getOrdered();
    if (count >= ordered.length) {
      return ordered;
    }
    return ordered.slice(ordered.length - count);
  }

  get totalLinesReceived(): number {
    return this.totalReceived;
  }

  /**
   * Index of the oldest line still present in the ring buffer, or 0 if empty.
   * Used by clients to detect scrollback truncation on reconnect — if this
   * exceeds the `fromLine` they requested, the gap was lost to ring wrap-around.
   */
  firstAvailableLine(): number {
    if (this.count === 0) return 0;
    const start = (this.head - this.count + this.maxLines) % this.maxLines;
    return this.ring[start]!.index;
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.ring = new Array(this.maxLines);
    this.head = 0;
    this.count = 0;
  }

  /**
   * Materialise the ring buffer contents in chronological order.
   */
  private _getOrdered(): BufferedLine[] {
    if (this.count === 0) return [];

    const result: BufferedLine[] = new Array(this.count);
    // The oldest item is at (head - count) mod maxLines
    const start = (this.head - this.count + this.maxLines) % this.maxLines;

    for (let i = 0; i < this.count; i++) {
      result[i] = this.ring[(start + i) % this.maxLines]!;
    }

    return result;
  }
}
