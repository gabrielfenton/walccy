// ──────────────────────────────────────────────
// init-metadata.store — captures the SessionEventInit payload per session
// ──────────────────────────────────────────────
//
// The daemon emits exactly one `init` event per session, carrying the
// agents/skills/MCP-servers/plugins/memory-paths snapshot from the SDK.
// The chat view doesn't need this data — but Settings (F25) and the
// Memory viewer (F26) do, and they're modal screens that may open before
// or after a session is selected. Keeping it in its own store lets either
// surface read it without coupling Settings to the message buffer.

import { create } from 'zustand';
import type { SessionEventInit } from '@walccy/protocol';

interface InitMetadataStore {
  byId: Record<string, SessionEventInit>;
  set: (sessionId: string, init: SessionEventInit) => void;
  clear: (sessionId: string) => void;
}

export const useInitMetadataStore = create<InitMetadataStore>((set) => ({
  byId: {},
  set: (sessionId, init) =>
    set((state) => ({ byId: { ...state.byId, [sessionId]: init } })),
  clear: (sessionId) =>
    set((state) => {
      if (!(sessionId in state.byId)) return state;
      const next = { ...state.byId };
      delete next[sessionId];
      return { byId: next };
    }),
}));

export const initMetadataStore = useInitMetadataStore;
