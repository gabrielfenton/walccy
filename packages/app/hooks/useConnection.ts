// ──────────────────────────────────────────────
// Walccy — useConnection hook
// ──────────────────────────────────────────────

import { useConnectionStore, type ConnectionStatus } from '../stores/connection.store';
import { wsClient } from '../services/ws-client';

export interface UseConnectionReturn {
  status: ConnectionStatus;
  daemonHost: string | null;
  daemonHostname: string | null;
  latencyMs: number | null;
  lastError: string | null;
  connect: (host: string, port: number, secret: string) => void;
  disconnect: () => void;
}

export function useConnection(): UseConnectionReturn {
  const status = useConnectionStore((s) => s.status);
  const daemonHost = useConnectionStore((s) => s.daemonHost);
  const daemonHostname = useConnectionStore((s) => s.daemonHostname);
  const latencyMs = useConnectionStore((s) => s.latencyMs);
  const lastError = useConnectionStore((s) => s.lastError);

  function connect(host: string, port: number, secret: string): void {
    wsClient.connect(host, port, secret);
  }

  function disconnect(): void {
    wsClient.disconnect();
  }

  return {
    status,
    daemonHost,
    daemonHostname,
    latencyMs,
    lastError,
    connect,
    disconnect,
  };
}
