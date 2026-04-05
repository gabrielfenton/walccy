import { create } from 'zustand';
import type { BufferedLine } from '../types';

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
      const combined = [...existing.lines, ...lines];
      return {
        buffers: {
          ...state.buffers,
          [sessionId]: {
            ...existing,
            lines: clampLines(combined),
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
