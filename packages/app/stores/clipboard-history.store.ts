// ──────────────────────────────────────────────
// Walccy — Clipboard history store
// Tracks recent clipboard contents from system + manual copies, with
// pin/delete management. Persisted in MMKV so history survives restarts.
// ──────────────────────────────────────────────

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { MMKV } from 'react-native-mmkv';
import * as SecureStore from 'expo-secure-store';
import { v4 as uuid } from 'uuid';

// ── Storage adapter ──────────────────────────
//
// Clipboard history can contain anything the user has copied — chat
// contents, snippets, occasional sensitive bits that slip past the
// sensitive-content filter. We persist it inside an MMKV instance keyed
// by a 32-byte secret stored in OS keystore (expo-secure-store).
//
// The unencrypted v1 MMKV (id: walccy-clipboard-history) used to hold
// plaintext. On first encrypted boot we attempt a one-shot copy from v1
// into v2, then wipe v1. If anything goes wrong we fall through to a
// fresh empty v2 — clipboard history is non-critical state.

const SECURE_STORE_KEY = 'walccy.mmkv.clipboard.key';
const V1_ID = 'walccy-clipboard-history';
const V2_ID = 'walccy-clipboard-history-v2';

function generateHexKey(): string {
  // react-native-get-random-values is imported at app entry so
  // crypto.getRandomValues is polyfilled on RN.
  const buf = new Uint8Array(32);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cryptoRef: any = (globalThis as any).crypto;
  if (cryptoRef && typeof cryptoRef.getRandomValues === 'function') {
    cryptoRef.getRandomValues(buf);
  } else {
    // Last-resort fallback. Not cryptographically strong, but better than
    // a constant key. Should only fire if the polyfill failed to load.
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  let hex = '';
  for (let i = 0; i < buf.length; i++) {
    hex += buf[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

interface MmkvLike {
  getString: (name: string) => string | undefined;
  set: (name: string, value: string) => void;
  delete: (name: string) => void;
  getAllKeys: () => string[];
  clearAll: () => void;
}

/** In-memory fallback used when SecureStore + MMKV are unavailable. */
function makeMemoryMmkv(): MmkvLike {
  const map = new Map<string, string>();
  return {
    getString: (n) => map.get(n),
    set: (n, v) => { map.set(n, v); },
    delete: (n) => { map.delete(n); },
    getAllKeys: () => Array.from(map.keys()),
    clearAll: () => map.clear(),
  };
}

let mmkvInstance: MmkvLike = makeMemoryMmkv();
let mmkvReady: Promise<void> | null = null;

async function initEncryptedMmkv(): Promise<void> {
  try {
    let hexKey = await SecureStore.getItemAsync(SECURE_STORE_KEY);
    if (!hexKey) {
      hexKey = generateHexKey();
      await SecureStore.setItemAsync(SECURE_STORE_KEY, hexKey);
    }
    const enc = new MMKV({ id: V2_ID, encryptionKey: hexKey });

    // Migration: copy v1 (plaintext) entries into v2 if v2 is empty.
    try {
      if (enc.getAllKeys().length === 0) {
        const v1 = new MMKV({ id: V1_ID });
        const keys = v1.getAllKeys();
        for (const k of keys) {
          const v = v1.getString(k);
          if (typeof v === 'string') enc.set(k, v);
        }
        if (keys.length > 0) v1.clearAll();
      }
    } catch (err) {
      // Lossy migration is acceptable — clipboard history is non-critical.
      console.warn('[clipboard-history] v1 → v2 migration skipped:', err);
    }

    mmkvInstance = enc;
  } catch (err) {
    console.warn(
      '[clipboard-history] encrypted MMKV init failed; using in-memory store:',
      err
    );
    // Leave mmkvInstance as the memory fallback set above.
  }
}

// Kick off init eagerly but don't block module load.
mmkvReady = initEncryptedMmkv();

const mmkvStorage = {
  getItem: (name: string): string | null => mmkvInstance.getString(name) ?? null,
  setItem: (name: string, value: string): void => mmkvInstance.set(name, value),
  removeItem: (name: string): void => mmkvInstance.delete(name),
};

// Exported for tests / explicit awaiting if needed.
export function clipboardHistoryStorageReady(): Promise<void> {
  return mmkvReady ?? Promise.resolve();
}

// ── Types ────────────────────────────────────

export type ClipboardSource = 'system' | 'terminal' | 'manual';

export interface ClipboardEntry {
  id: string;
  content: string;
  addedAt: number;
  pinned: boolean;
  source: ClipboardSource;
}

interface ClipboardHistoryStore {
  entries: ClipboardEntry[];
  addEntry: (content: string, source: ClipboardSource) => void;
  togglePin: (id: string) => void;
  remove: (id: string) => void;
  clearUnpinned: () => void;
  updateContent: (id: string, content: string) => void;
  search: (query: string) => ClipboardEntry[];
}

// ── Limits ──────────────────────────────────

/** Maximum unpinned entries kept. Pinned entries don't count against this. */
const MAX_UNPINNED = 20;
/** Maximum stored length per entry. Anything longer is truncated to prevent
 *  blowing up persisted state from a giant accidental copy. */
const MAX_CONTENT_LENGTH = 16 * 1024; // 16 KB

// ── Store ────────────────────────────────────

export const useClipboardHistoryStore = create<ClipboardHistoryStore>()(
  persist(
    (set, get) => ({
      entries: [],

      addEntry: (rawContent, source) => {
        const content = rawContent.length > MAX_CONTENT_LENGTH
          ? rawContent.slice(0, MAX_CONTENT_LENGTH)
          : rawContent;
        if (content.trim().length === 0) return;

        set((state) => {
          // Dedupe: if an existing entry already has this exact content, just
          // bump it to the top instead of creating a duplicate. Pinned status
          // is preserved.
          const existingIdx = state.entries.findIndex((e) => e.content === content);
          if (existingIdx >= 0) {
            const existing = state.entries[existingIdx]!;
            const refreshed: ClipboardEntry = {
              ...existing,
              addedAt: Date.now(),
            };
            const others = state.entries.filter((_, i) => i !== existingIdx);
            return { entries: [refreshed, ...others] };
          }

          const fresh: ClipboardEntry = {
            id: uuid(),
            content,
            addedAt: Date.now(),
            pinned: false,
            source,
          };
          const next = [fresh, ...state.entries];

          // Trim unpinned to the cap. Keep all pinned entries.
          const pinned = next.filter((e) => e.pinned);
          const unpinned = next.filter((e) => !e.pinned).slice(0, MAX_UNPINNED);
          // Preserve overall recency order: pinned and unpinned merged by addedAt desc.
          const merged = [...pinned, ...unpinned].sort((a, b) => b.addedAt - a.addedAt);

          return { entries: merged };
        });
      },

      togglePin: (id) =>
        set((state) => ({
          entries: state.entries.map((e) =>
            e.id === id ? { ...e, pinned: !e.pinned } : e
          ),
        })),

      remove: (id) =>
        set((state) => ({
          entries: state.entries.filter((e) => e.id !== id),
        })),

      clearUnpinned: () =>
        set((state) => ({
          entries: state.entries.filter((e) => e.pinned),
        })),

      updateContent: (id, content) =>
        set((state) => ({
          entries: state.entries.map((e) =>
            e.id === id ? { ...e, content, addedAt: Date.now() } : e
          ),
        })),

      search: (query) => {
        const q = query.trim().toLowerCase();
        if (!q) return get().entries;
        return get().entries.filter((e) => e.content.toLowerCase().includes(q));
      },
    }),
    {
      name: 'clipboard-history',
      storage: createJSONStorage(() => mmkvStorage),
    }
  )
);

export const clipboardHistoryStore = useClipboardHistoryStore;
