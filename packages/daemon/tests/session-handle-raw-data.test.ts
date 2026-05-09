import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BufferedLine } from '@walccy/protocol';
import { Session } from '../src/session.js';

const IDLE_TIMEOUT_MS = 3000;

describe('Session._handleRawData (via pushExternalData) and idle timer', () => {
  let session: Session;
  let dataEvents: BufferedLine[][];

  beforeEach(() => {
    vi.useFakeTimers();
    session = new Session(0, '/tmp', 'test', 100);
    dataEvents = [];
    session.on('data', (lines) => {
      dataEvents.push(lines);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('produces 2 buffered lines from a two-line chunk', () => {
    session.pushExternalData('line one\nline two\n');
    expect(session.buffer.size).toBe(2);
    expect(dataEvents).toHaveLength(1);
    expect(dataEvents[0]!.map((l) => l.content)).toEqual(['line one', 'line two']);
  });

  it('joins partial lines across chunks via _partialLine', () => {
    session.pushExternalData('partial');
    expect(session.buffer.size).toBe(0);
    expect(dataEvents).toHaveLength(0);

    session.pushExternalData(' continued\n');
    expect(session.buffer.size).toBe(1);
    const all = session.buffer.getRecent(10);
    expect(all[0]!.content).toBe('partial continued');
  });

  it('flips waitingForInput to true after IDLE_TIMEOUT_MS and emits empty data', () => {
    session.pushExternalData('hello\n');
    expect(session.info.waitingForInput).toBe(false);
    dataEvents.length = 0;

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS + 10);

    expect(session.info.waitingForInput).toBe(true);
    expect(dataEvents).toHaveLength(1);
    expect(dataEvents[0]).toEqual([]);
  });

  it('resets the idle timer on subsequent data (waitingForInput stays false)', () => {
    session.pushExternalData('first\n');
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 500);
    // Second arrival before original timer fires
    session.pushExternalData('second\n');
    // Advance just past the original deadline — should NOT have fired
    vi.advanceTimersByTime(600);
    expect(session.info.waitingForInput).toBe(false);
    // Now advance past the new deadline
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS);
    expect(session.info.waitingForInput).toBe(true);
  });

  it('handles \\r\\n (Windows-style) line endings', () => {
    session.pushExternalData('alpha\r\nbeta\r\n');
    expect(session.buffer.size).toBe(2);
    const lines = session.buffer.getRecent(10).map((l) => l.content);
    expect(lines).toEqual(['alpha', 'beta']);
  });

  it('clears waitingForInput when new data arrives after idle', () => {
    session.pushExternalData('first\n');
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS + 10);
    expect(session.info.waitingForInput).toBe(true);

    session.pushExternalData('more\n');
    expect(session.info.waitingForInput).toBe(false);
  });
});
