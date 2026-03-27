// ──────────────────────────────────────────────
// Walccy — useSession hook
// ──────────────────────────────────────────────

import { useSessionsStore } from '../stores/sessions.store';
import { useOutputStore } from '../stores/output.store';
import { wsClient } from '../services/ws-client';
import type { Session, BufferedLine } from '../types';

export interface OutputBuffer {
  lines: BufferedLine[];
  isLoadingHistory: boolean;
  historyFullyLoaded: boolean;
  totalLines: number;
}

const EMPTY_BUFFER: OutputBuffer = {
  lines: [],
  isLoadingHistory: false,
  historyFullyLoaded: false,
  totalLines: 0,
};

export interface UseSessionReturn {
  session: Session | undefined;
  outputBuffer: OutputBuffer;
  sendInput: (data: string) => void;
  subscribe: (fromLine?: number) => void;
  unsubscribe: () => void;
  sendResize: (cols: number, rows: number) => void;
}

export function useSession(sessionId: string): UseSessionReturn {
  const session = useSessionsStore((s) => s.sessions[sessionId]);
  const outputBuffer = useOutputStore((s) => s.buffers[sessionId] ?? EMPTY_BUFFER);

  function sendInput(data: string): void {
    wsClient.sendInput(sessionId, data);
  }

  function subscribe(fromLine?: number): void {
    wsClient.subscribe(sessionId, fromLine);
  }

  function unsubscribe(): void {
    wsClient.unsubscribe(sessionId);
  }

  function sendResize(cols: number, rows: number): void {
    wsClient.sendResize(sessionId, cols, rows);
  }

  return {
    session,
    outputBuffer,
    sendInput,
    subscribe,
    unsubscribe,
    sendResize,
  };
}
