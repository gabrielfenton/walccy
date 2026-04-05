import { create } from 'zustand';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface ConnectionStore {
  status: ConnectionStatus;
  daemonHost: string | null;
  daemonPort: number;
  daemonHostname: string | null;
  daemonVersion: string | null;
  latencyMs: number | null;
  lastError: string | null;
  setStatus: (status: ConnectionStatus) => void;
  setConnected: (host: string, port: number, hostname: string, version: string) => void;
  setDisconnected: (error?: string) => void;
  setLatency: (ms: number) => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  status: 'disconnected',
  daemonHost: null,
  daemonPort: 7779,
  daemonHostname: null,
  daemonVersion: null,
  latencyMs: null,
  lastError: null,

  setStatus: (status) => set({ status }),

  setConnected: (host, port, hostname, version) =>
    set({
      status: 'connected',
      daemonHost: host,
      daemonPort: port,
      daemonHostname: hostname,
      daemonVersion: version,
      lastError: null,
    }),

  setDisconnected: (error) =>
    set({
      status: error ? 'error' : 'disconnected',
      daemonHost: null,
      daemonHostname: null,
      daemonVersion: null,
      latencyMs: null,
      lastError: error ?? null,
    }),

  setLatency: (ms) => set({ latencyMs: ms }),
}));

/** Direct store reference for use outside of React components */
export const connectionStore = useConnectionStore;
