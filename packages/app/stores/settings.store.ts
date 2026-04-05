import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { MMKV } from 'react-native-mmkv';
import { v4 as uuid } from 'uuid';
import type { MonoFontFamily } from '../constants/typography';

// ──────────────────────────────────────────────
// MMKV storage adapter for Zustand persist
// ──────────────────────────────────────────────

const mmkvInstance = new MMKV({ id: 'walccy-settings' });

const mmkvStorage = {
  getItem: (name: string): string | null => mmkvInstance.getString(name) ?? null,
  setItem: (name: string, value: string): void => mmkvInstance.set(name, value),
  removeItem: (name: string): void => mmkvInstance.delete(name),
};

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface SavedHost {
  id: string;
  label: string;
  host: string;
  port: number;
  lastConnectedAt: number;
  avatarColor: string;
}

const AVATAR_COLOR_PALETTE = [
  '#7B61FF',
  '#3DDC84',
  '#FF4D4D',
  '#FFB347',
  '#61DAFB',
  '#E879F9',
  '#FB923C',
  '#34D399',
];

function randomAvatarColor(): string {
  return AVATAR_COLOR_PALETTE[Math.floor(Math.random() * AVATAR_COLOR_PALETTE.length)]!;
}

interface Settings {
  savedHosts: SavedHost[];
  lastConnectedHostId: string | null;
  fontSize: number;
  fontFamily: MonoFontFamily;
  lineHeight: number;
  scrollbackLines: number;
  autoReconnect: boolean;
  autoReconnectDelay: number;
  keepScreenOn: boolean;
  vibrationOnWaitingInput: boolean;
  showClipboardPopupOnCopy: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  savedHosts: [],
  lastConnectedHostId: null,
  fontSize: 13,
  fontFamily: 'JetBrains Mono',
  lineHeight: 1.4,
  scrollbackLines: 500,
  autoReconnect: true,
  autoReconnectDelay: 2000,
  keepScreenOn: true,
  vibrationOnWaitingInput: true,
  showClipboardPopupOnCopy: true,
};

interface SettingsStore extends Settings {
  addHost: (host: Omit<SavedHost, 'id' | 'lastConnectedAt' | 'avatarColor'>) => SavedHost;
  removeHost: (id: string) => void;
  updateHost: (id: string, changes: Partial<SavedHost>) => void;
  setLastConnected: (id: string) => void;
  updateSettings: (changes: Partial<Settings>) => void;
}

// ──────────────────────────────────────────────
// Store
// ──────────────────────────────────────────────

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,

      addHost: (host) => {
        const newHost: SavedHost = {
          ...host,
          id: uuid(),
          lastConnectedAt: Date.now(),
          avatarColor: randomAvatarColor(),
        };
        set((state) => ({
          savedHosts: [...state.savedHosts, newHost],
        }));
        return newHost;
      },

      removeHost: (id) =>
        set((state) => ({
          savedHosts: state.savedHosts.filter((h) => h.id !== id),
          lastConnectedHostId:
            state.lastConnectedHostId === id ? null : state.lastConnectedHostId,
        })),

      updateHost: (id, changes) =>
        set((state) => ({
          savedHosts: state.savedHosts.map((h) =>
            h.id === id ? { ...h, ...changes } : h
          ),
        })),

      setLastConnected: (id) => {
        set((state) => ({
          lastConnectedHostId: id,
          savedHosts: state.savedHosts.map((h) =>
            h.id === id ? { ...h, lastConnectedAt: Date.now() } : h
          ),
        }));
      },

      updateSettings: (changes) =>
        set((state) => ({ ...state, ...changes })),
    }),
    {
      name: 'settings',
      storage: mmkvStorage,
    }
  )
);

/** Direct store reference for use outside of React components */
export const settingsStore = useSettingsStore;
