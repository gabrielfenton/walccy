import { describe, it, expect } from 'vitest';
import { LineBuffer, stripAnsi } from '../src/buffer.js';

// ──────────────────────────────────────────────
// stripAnsi
// ──────────────────────────────────────────────

describe('stripAnsi', () => {
  it('strips CSI color codes', () => {
    expect(stripAnsi('\x1b[31mhello\x1b[0m')).toBe('hello');
  });

  it('strips 256-color codes', () => {
    expect(stripAnsi('\x1b[38;5;196mred\x1b[0m')).toBe('red');
  });

  it('strips 24-bit true color codes', () => {
    expect(stripAnsi('\x1b[38;2;255;0;0mtrue red\x1b[0m')).toBe('true red');
  });

  it('strips OSC sequences', () => {
    expect(stripAnsi('\x1b]0;title\x07text')).toBe('text');
  });

  it('strips cursor movement sequences', () => {
    expect(stripAnsi('\x1b[2Jhello\x1b[H')).toBe('hello');
  });

  it('strips control characters but preserves tabs', () => {
    expect(stripAnsi('a\x01b\tc')).toBe('ab\tc');
  });

  it('returns empty string for empty input', () => {
    expect(stripAnsi('')).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });
});

// ──────────────────────────────────────────────
// LineBuffer (ring buffer)
// ──────────────────────────────────────────────

function makeLine(content: string) {
  return {
    rawContent: content,
    content,
    timestamp: Date.now(),
    source: 'stdout' as const,
  };
}

describe('LineBuffer', () => {
  it('stores and retrieves lines', () => {
    const buf = new LineBuffer(100);
    buf.push(makeLine('line 1'));
    buf.push(makeLine('line 2'));

    expect(buf.size).toBe(2);
    expect(buf.totalLinesReceived).toBe(2);

    const lines = buf.getRecent(10);
    expect(lines).toHaveLength(2);
    expect(lines[0].content).toBe('line 1');
    expect(lines[1].content).toBe('line 2');
  });

  it('assigns monotonically increasing indices', () => {
    const buf = new LineBuffer(100);
    const l1 = buf.push(makeLine('a'));
    const l2 = buf.push(makeLine('b'));
    const l3 = buf.push(makeLine('c'));

    expect(l1.index).toBe(0);
    expect(l2.index).toBe(1);
    expect(l3.index).toBe(2);
  });

  it('strips ANSI from rawContent into content', () => {
    const buf = new LineBuffer(100);
    const line = buf.push({
      rawContent: '\x1b[32mgreen text\x1b[0m',
      content: 'ignored',
      timestamp: Date.now(),
      source: 'stdout',
    });

    expect(line.content).toBe('green text');
    expect(line.rawContent).toBe('\x1b[32mgreen text\x1b[0m');
  });

  it('evicts oldest lines when capacity is exceeded (circular)', () => {
    const buf = new LineBuffer(3);
    buf.push(makeLine('a'));
    buf.push(makeLine('b'));
    buf.push(makeLine('c'));
    buf.push(makeLine('d')); // evicts 'a'

    expect(buf.size).toBe(3);
    expect(buf.totalLinesReceived).toBe(4);

    const lines = buf.getRecent(10);
    expect(lines.map((l) => l.content)).toEqual(['b', 'c', 'd']);
  });

  it('handles many evictions correctly', () => {
    const buf = new LineBuffer(3);
    for (let i = 0; i < 100; i++) {
      buf.push(makeLine(`line ${i}`));
    }

    expect(buf.size).toBe(3);
    expect(buf.totalLinesReceived).toBe(100);

    const lines = buf.getRecent(10);
    expect(lines.map((l) => l.content)).toEqual([
      'line 97',
      'line 98',
      'line 99',
    ]);
  });

  it('getRecent returns correct subset', () => {
    const buf = new LineBuffer(100);
    for (let i = 0; i < 10; i++) {
      buf.push(makeLine(`line ${i}`));
    }

    const recent = buf.getRecent(3);
    expect(recent.map((l) => l.content)).toEqual([
      'line 7',
      'line 8',
      'line 9',
    ]);
  });

  it('getRecent returns all when count exceeds size', () => {
    const buf = new LineBuffer(100);
    buf.push(makeLine('a'));
    buf.push(makeLine('b'));

    const recent = buf.getRecent(50);
    expect(recent).toHaveLength(2);
  });

  it('getLines with fromIndex returns correct subset', () => {
    const buf = new LineBuffer(100);
    for (let i = 0; i < 5; i++) {
      buf.push(makeLine(`line ${i}`));
    }

    // Lines have indices 0-4; get from index 3
    const lines = buf.getLines(3);
    expect(lines.map((l) => l.content)).toEqual(['line 3', 'line 4']);
  });

  it('getLines with fromIndex and count', () => {
    const buf = new LineBuffer(100);
    for (let i = 0; i < 10; i++) {
      buf.push(makeLine(`line ${i}`));
    }

    const lines = buf.getLines(2, 3);
    expect(lines.map((l) => l.content)).toEqual([
      'line 2',
      'line 3',
      'line 4',
    ]);
  });

  it('getLines with fromIndex after eviction', () => {
    const buf = new LineBuffer(5);
    for (let i = 0; i < 10; i++) {
      buf.push(makeLine(`line ${i}`));
    }

    // Lines 0-4 have been evicted. Buffer has lines 5-9 (indices 5-9).
    const lines = buf.getLines(7);
    expect(lines.map((l) => l.content)).toEqual([
      'line 7',
      'line 8',
      'line 9',
    ]);
  });

  it('getLines with fromIndex beyond buffer returns empty', () => {
    const buf = new LineBuffer(5);
    for (let i = 0; i < 3; i++) {
      buf.push(makeLine(`line ${i}`));
    }

    const lines = buf.getLines(100);
    expect(lines).toEqual([]);
  });

  it('clear resets the buffer', () => {
    const buf = new LineBuffer(100);
    buf.push(makeLine('a'));
    buf.push(makeLine('b'));

    buf.clear();
    expect(buf.size).toBe(0);
    expect(buf.getRecent(10)).toEqual([]);
  });

  it('works correctly with maxLines=1', () => {
    const buf = new LineBuffer(1);
    buf.push(makeLine('a'));
    buf.push(makeLine('b'));
    buf.push(makeLine('c'));

    expect(buf.size).toBe(1);
    const lines = buf.getRecent(10);
    expect(lines[0].content).toBe('c');
  });

  it('indices continue after eviction', () => {
    const buf = new LineBuffer(2);
    buf.push(makeLine('a')); // index 0
    buf.push(makeLine('b')); // index 1
    buf.push(makeLine('c')); // index 2, evicts 'a'

    const lines = buf.getRecent(10);
    expect(lines[0].index).toBe(1);
    expect(lines[1].index).toBe(2);
  });
});
