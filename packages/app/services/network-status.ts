// ──────────────────────────────────────────────
// Walccy — Network status
// Thin wrapper over @react-native-community/netinfo so the WS client
// can pause reconnect attempts when the OS reports no network.
//
// Falls back to "always online" if the native module isn't installed,
// so existing dev builds keep working until the next native rebuild.
// ──────────────────────────────────────────────

type Listener = () => void;

interface NetInfoState {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}

interface NetInfoModule {
  addEventListener: (listener: (state: NetInfoState) => void) => () => void;
  fetch: () => Promise<NetInfoState>;
}

// Optional native module — load lazily and tolerate absence.
let netInfo: NetInfoModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  netInfo = require('@react-native-community/netinfo').default ?? require('@react-native-community/netinfo');
} catch {
  netInfo = null;
}

class NetworkStatus {
  /**
   * Most recent known online state. Pessimistic default: assume offline
   * until netinfo's first apply() tells us otherwise. This avoids the
   * cold-start footgun where the WS client would burn through its first
   * few reconnect delays before NetInfo had a chance to report no link.
   */
  private online = false;
  private onceOnlineQueue: Listener[] = [];
  private initialized = false;

  /**
   * Subscribe to NetInfo events. Must be called once at app start (e.g.
   * from RootLayout). Idempotent. No-op when the native module is absent.
   */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    if (!netInfo) return;
    // Seed initial state from netinfo, then keep it fresh.
    netInfo.fetch().then((s) => this.apply(s)).catch(() => {});
    netInfo.addEventListener((s) => this.apply(s));
  }

  private apply(state: NetInfoState): void {
    // `isInternetReachable` is null on initial load — fall back to isConnected.
    const reachable =
      state.isInternetReachable === null
        ? state.isConnected !== false
        : state.isInternetReachable !== false;
    const next = state.isConnected !== false && reachable;
    const wasOnline = this.online;
    this.online = next;
    if (!wasOnline && next) {
      const queue = this.onceOnlineQueue;
      this.onceOnlineQueue = [];
      for (const fn of queue) {
        try { fn(); } catch (err) { console.warn('[networkStatus] onceOnline listener error:', err); }
      }
    }
  }

  /** True when the device has a network we can plausibly reach the daemon over. */
  isOnline(): boolean {
    return this.online;
  }

  /**
   * Schedule a one-shot callback to fire the next time the device transitions
   * from offline → online. Used by the WS client to wake up immediately when
   * the link returns instead of waiting on a backoff timer.
   */
  onceOnline(fn: Listener): void {
    if (this.online) {
      // Already online — don't queue, fire on the next tick so callers stay async.
      setTimeout(fn, 0);
      return;
    }
    this.onceOnlineQueue.push(fn);
  }
}

export const networkStatus = new NetworkStatus();
