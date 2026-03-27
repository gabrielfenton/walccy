import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { MMKV } from 'react-native-mmkv';
import { v4 as uuid } from 'uuid';

// ──────────────────────────────────────────────
// MMKV storage adapter for Zustand persist
// ──────────────────────────────────────────────

const mmkvInstance = new MMKV({ id: 'walccy-prompt-library' });

const mmkvStorage = {
  getItem: (name: string): string | null => mmkvInstance.getString(name) ?? null,
  setItem: (name: string, value: string): void => mmkvInstance.set(name, value),
  removeItem: (name: string): void => mmkvInstance.delete(name),
};

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface Prompt {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: number;
  usedAt: number;
  useCount: number;
  isPinned: boolean;
}

interface PromptLibraryStore {
  prompts: Prompt[];
  addPrompt: (prompt: Omit<Prompt, 'id' | 'createdAt' | 'usedAt' | 'useCount'>) => void;
  updatePrompt: (id: string, changes: Partial<Prompt>) => void;
  deletePrompt: (id: string) => void;
  recordUse: (id: string) => void;
  searchPrompts: (query: string) => Prompt[];
  getPinned: () => Prompt[];
  getRecent: (limit?: number) => Prompt[];
}

// ──────────────────────────────────────────────
// Store
// ──────────────────────────────────────────────

export const usePromptLibraryStore = create<PromptLibraryStore>()(
  persist(
    (set, get) => ({
      prompts: [],

      addPrompt: (prompt) =>
        set((state) => ({
          prompts: [
            ...state.prompts,
            {
              ...prompt,
              id: uuid(),
              createdAt: Date.now(),
              usedAt: Date.now(),
              useCount: 0,
            },
          ],
        })),

      updatePrompt: (id, changes) =>
        set((state) => ({
          prompts: state.prompts.map((p) => (p.id === id ? { ...p, ...changes } : p)),
        })),

      deletePrompt: (id) =>
        set((state) => ({
          prompts: state.prompts.filter((p) => p.id !== id),
        })),

      recordUse: (id) =>
        set((state) => ({
          prompts: state.prompts.map((p) =>
            p.id === id
              ? { ...p, usedAt: Date.now(), useCount: p.useCount + 1 }
              : p
          ),
        })),

      searchPrompts: (query) => {
        const q = query.toLowerCase();
        return get().prompts.filter(
          (p) =>
            p.title.toLowerCase().includes(q) ||
            p.content.toLowerCase().includes(q) ||
            p.tags.some((t) => t.toLowerCase().includes(q))
        );
      },

      getPinned: () => get().prompts.filter((p) => p.isPinned),

      getRecent: (limit = 10) =>
        [...get().prompts]
          .sort((a, b) => b.usedAt - a.usedAt)
          .slice(0, limit),
    }),
    {
      name: 'prompt-library',
      storage: mmkvStorage,
    }
  )
);
