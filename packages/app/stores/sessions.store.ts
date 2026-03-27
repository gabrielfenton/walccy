import { create } from 'zustand';
import type { Session } from '../types';

interface SessionsStore {
  sessions: Record<string, Session>;
  activeSessionId: string | null;
  setActiveSession: (id: string) => void;
  addSession: (session: Session) => void;
  updateSession: (id: string, changes: Partial<Session>) => void;
  removeSession: (id: string) => void;
  setSessions: (sessions: Session[]) => void;
}

export const useSessionsStore = create<SessionsStore>((set) => ({
  sessions: {},
  activeSessionId: null,

  setActiveSession: (id) => set({ activeSessionId: id }),

  addSession: (session) =>
    set((state) => ({
      sessions: { ...state.sessions, [session.id]: session },
    })),

  updateSession: (id, changes) =>
    set((state) => {
      const existing = state.sessions[id];
      if (!existing) return state;
      return {
        sessions: {
          ...state.sessions,
          [id]: { ...existing, ...changes },
        },
      };
    }),

  removeSession: (id) =>
    set((state) => {
      const next = { ...state.sessions };
      delete next[id];
      return {
        sessions: next,
        activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
      };
    }),

  setSessions: (sessions) =>
    set({
      sessions: sessions.reduce<Record<string, Session>>((acc, s) => {
        acc[s.id] = s;
        return acc;
      }, {}),
    }),
}));

/** Direct store reference for use outside of React components */
export const sessionsStore = useSessionsStore;
