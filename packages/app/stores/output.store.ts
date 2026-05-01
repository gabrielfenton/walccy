import { create } from 'zustand';
import type { BufferedLine } from '@walccy/protocol';

const MAX_LINES_PER_BUFFER = 2000;

interface OutputBuffer {
  lines: BufferedLine[];
  isLoadingHistory: boolean;
  historyFullyLoaded: boolean;
  totalLines: number;
}

interface OutputStore {
  buffers: Record<string, OutputBuffer>;
  setHistory: (sessionId: string, lines: BufferedLine[], totalLines: number) => void;
  appendLines: (sessionId: string, lines: BufferedLine[]) => void;
  clearBuffer: (sessionId: string) => void;
  setLoadingHistory: (sessionId: string, loading: boolean) => void;
  /**
   * Prepend a synthetic line to the visible scrollback indicating that
   * `droppedCount` lines were lost to ring-buffer wrap-around between the
   * client's last-seen index and `atIndex` (the daemon's first-available
   * line). The marker is rendered as ordinary stdout so existing line
   * components style it correctly without protocol/UI churn.
   */
  insertGapMarker: (sessionId: string, droppedCount: number, atIndex: number) => void;
}

function emptyBuffer(): OutputBuffer {
  return {
    lines: [],
    isLoadingHistory: false,
    historyFullyLoaded: false,
    totalLines: 0,
  };
}

function clampLines(lines: BufferedLine[]): BufferedLine[] {
  if (lines.length <= MAX_LINES_PER_BUFFER) return lines;
  return lines.slice(lines.length - MAX_LINES_PER_BUFFER);
}

export const useOutputStore = create<OutputStore>((set) => ({
  buffers: {},

  setHistory: (sessionId, lines, totalLines) =>
    set((state) => {
      const existing = state.buffers[sessionId] ?? emptyBuffer();
      return {
        buffers: {
          ...state.buffers,
          [sessionId]: {
            ...existing,
            lines: clampLines(lines),
            totalLines,
            historyFullyLoaded: true,
            isLoadingHistory: false,
          },
        },
      };
    }),

  appendLines: (sessionId, lines) =>
    set((state) => {
      const existing = state.buffers[sessionId] ?? emptyBuffer();
      // If a single chunk exceeds capacity, slice it down first to avoid
      // a giant push() followed by a long shift loop.
      const incoming =
        lines.length > MAX_LINES_PER_BUFFER
          ? lines.slice(lines.length - MAX_LINES_PER_BUFFER)
          : lines;
      // Mutate in place: push new lines, then trim from the front.
      // This avoids the [...existing.lines, ...lines] double-spread that
      // re-allocated the entire scrollback on every OUTPUT message.
      const buf = existing.lines;
      buf.push(...incoming);
      const overflow = buf.length - MAX_LINES_PER_BUFFER;
      if (overflow > 0) buf.splice(0, overflow);
      // Single allocation: a new outer array reference so FlashList sees a
      // changed prop and re-renders, but contents are shared with `buf`.
      return {
        buffers: {
          ...state.buffers,
          [sessionId]: {
            ...existing,
            lines: [...buf],
            totalLines: existing.totalLines + lines.length,
          },
        },
      };
    }),

  clearBuffer: (sessionId) =>
    set((state) => ({
      buffers: {
        ...state.buffers,
        [sessionId]: emptyBuffer(),
      },
    })),

  insertGapMarker: (sessionId, droppedCount, atIndex) =>
    set((state) => {
      const existing = state.buffers[sessionId] ?? emptyBuffer();
      const text = `── scrollback truncated: ${droppedCount} line${droppedCount === 1 ? '' : 's'} lost ──`;
      // Use a fractional index just below `atIndex` so the marker sorts
      // before the contiguous tail and produces a unique FlashList key
      // (item.index.toString() won't collide with any integer line index).
      // Subtract a small jitter so repeated gap insertions for the same
      // atIndex still produce unique keys instead of overwriting each other.
      const marker: BufferedLine = {
        index: atIndex - 0.5 - Math.random() * 0.25,
        content: text,
        rawContent: text,
        timestamp: Date.now(),
        source: 'stdout',
      };
      const next = [marker, ...existing.lines];
      const trimmed = next.length > MAX_LINES_PER_BUFFER
        ? next.slice(next.length - MAX_LINES_PER_BUFFER)
        : next;
      return {
        buffers: {
          ...state.buffers,
          [sessionId]: {
            ...existing,
            lines: trimmed,
          },
        },
      };
    }),

  setLoadingHistory: (sessionId, loading) =>
    set((state) => {
      const existing = state.buffers[sessionId] ?? emptyBuffer();
      return {
        buffers: {
          ...state.buffers,
          [sessionId]: {
            ...existing,
            isLoadingHistory: loading,
          },
        },
      };
    }),
}));

/** Direct store reference for use outside of React components */
export const outputStore = useOutputStore;
