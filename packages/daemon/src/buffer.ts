import { BufferedLine } from './types.js';

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
  private lines: BufferedLine[] = [];
  private readonly maxLines: number;
  private totalReceived: number = 0;
  // Global monotonically increasing line index (never resets)
  private nextIndex: number = 0;

  constructor(maxLines = 10000) {
    this.maxLines = maxLines;
  }

  /**
   * Append a new line to the buffer. Returns the stored BufferedLine.
   */
  push(line: Omit<BufferedLine, 'index'>): BufferedLine {
    const stored: BufferedLine = {
      ...line,
      index: this.nextIndex++,
      content: stripAnsi(line.rawContent),
    };

    this.lines.push(stored);
    this.totalReceived++;

    // Enforce circular capacity: drop the oldest line
    if (this.lines.length > this.maxLines) {
      this.lines.shift();
    }

    return stored;
  }

  /**
   * Return lines starting from `fromIndex` (global index), up to `count` lines.
   * If `fromIndex` is undefined, returns from the start of the current buffer.
   * If `count` is undefined, returns all available lines from `fromIndex`.
   */
  getLines(fromIndex?: number, count?: number): BufferedLine[] {
    let result = this.lines;

    if (fromIndex !== undefined) {
      result = result.filter((l) => l.index >= fromIndex);
    }

    if (count !== undefined) {
      result = result.slice(0, count);
    }

    return result;
  }

  /**
   * Return the most recent `count` lines.
   */
  getRecent(count: number): BufferedLine[] {
    if (count >= this.lines.length) {
      return [...this.lines];
    }
    return this.lines.slice(this.lines.length - count);
  }

  get totalLinesReceived(): number {
    return this.totalReceived;
  }

  get size(): number {
    return this.lines.length;
  }

  clear(): void {
    this.lines = [];
  }
}
