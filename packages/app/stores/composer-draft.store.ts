// ──────────────────────────────────────────────
// Walccy — Composer draft store
// Lets the Prompt Board / clipboard sheets push text into the active
// Composer's input field (paste-into-composer flow). One pending slot per
// sessionId; nonce changes signal the Composer to consume it.
// ──────────────────────────────────────────────

import { create } from 'zustand';

export interface PendingPaste {
  text: string;
  nonce: number;
}

interface ComposerDraftStore {
  pending: Record<string, PendingPaste | undefined>;
  pushPaste: (sessionId: string, text: string) => void;
  clearPaste: (sessionId: string) => void;
}

let nonceCounter = 0;

export const useComposerDraftStore = create<ComposerDraftStore>((set) => ({
  pending: {},

  pushPaste: (sessionId, text) =>
    set((state) => ({
      pending: {
        ...state.pending,
        [sessionId]: { text, nonce: ++nonceCounter },
      },
    })),

  clearPaste: (sessionId) =>
    set((state) => {
      if (!state.pending[sessionId]) return state;
      const next = { ...state.pending };
      delete next[sessionId];
      return { pending: next };
    }),
}));
