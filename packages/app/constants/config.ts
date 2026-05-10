export const DEFAULT_PORT = 7779;

// Reconnect backoff base delays. Each attempt picks the next entry (or the
// last one once exhausted) and adds ±25% jitter to avoid lockstep retries
// across multiple devices on the same flaky cell tower.
export const WS_RECONNECT_DELAYS = [1500, 3000, 6000, 12000, 24000, 45000]; // ms
export const WS_RECONNECT_JITTER = 0.25;

// Heartbeat tuned for high-latency mobile (PH cellular, weak Wi-Fi):
// ping every 30s, give the daemon up to 15s to PONG before treating
// the link as dead. The previous 5s timeout produced spurious drops.
export const PING_INTERVAL = 30000;
export const PING_TIMEOUT = 15000;

export const AUTH_TIMEOUT = 10000;
export const HISTORY_LINES = 500;
export const INPUT_LOCK_DURATION = 2000;
export const CLIPBOARD_BUBBLE_TIMEOUT = 8000;
export const DEV_HOST = '127.0.0.1';
