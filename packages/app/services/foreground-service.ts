// ──────────────────────────────────────────────
// Walccy — Foreground service
// On Android, runs a foreground service backed by a persistent
// notification so the OS won't kill the app while it holds the
// long-lived WebSocket connection to the daemon.
//
// Implementation is via @notifee/react-native. If the native module
// isn't installed (e.g. Expo Go, JS-only dev builds), every method
// becomes a no-op so the rest of the app keeps working.
// ──────────────────────────────────────────────

import { Platform } from 'react-native';
import { connectionStore } from '../stores/connection.store';
import type { ConnectionStatus } from '../stores/connection.store';

const CHANNEL_ID = 'walccy-foreground';
const CHANNEL_NAME = 'Connection';
const NOTIFICATION_ID = 'walccy-fg';

// ── Lazy native module load ──────────────────

interface NotifeeDisplayParams {
  id: string;
  title: string;
  body: string;
  android: {
    channelId: string;
    asForegroundService: boolean;
    ongoing: boolean;
    pressAction: { id: string };
    smallIcon?: string;
    color?: string;
    colorized?: boolean;
    visibility?: number;
    style?: { type: number; text: string };
  };
}

type AndroidImportanceEnum = { LOW: number; DEFAULT: number; HIGH: number };

interface NotifeeModule {
  createChannel: (channel: { id: string; name: string; importance?: number }) => Promise<string>;
  displayNotification: (params: NotifeeDisplayParams) => Promise<string>;
  stopForegroundService: () => Promise<void>;
  registerForegroundService: (runner: (notification: unknown) => Promise<void>) => void;
  AndroidImportance?: AndroidImportanceEnum;
  AndroidVisibility?: { SECRET: number; PRIVATE: number; PUBLIC: number };
}

let notifee: NotifeeModule | null = null;
let AndroidImportance: AndroidImportanceEnum | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@notifee/react-native');
  // The default export is the API instance (displayNotification, etc.).
  // The enum (AndroidImportance) is a separate NAMED export on the module
  // — not a property of the default — so resolve it independently.
  notifee = mod.default ?? mod;
  AndroidImportance = mod.AndroidImportance ?? mod.default?.AndroidImportance ?? null;
} catch {
  notifee = null;
  AndroidImportance = null;
}

// ── Status copy ──────────────────────────────

/** Lock-screen-safe body. No host / IP / latency — visible on lock screen. */
function bodyForStatus(status: ConnectionStatus): string {
  switch (status) {
    case 'connected':    return 'Connected';
    case 'connecting':   return 'Connecting…';
    case 'disconnected': return 'Offline';
    case 'error':        return 'Connection error';
  }
}

/** Detail body used in the expanded notification (only seen after unlock). */
function detailForStatus(status: ConnectionStatus, host: string, latencyMs: number | null): string {
  switch (status) {
    case 'connected': {
      const latency = latencyMs != null && latencyMs < 5000 ? ` · ${latencyMs}ms` : '';
      return `Connected to ${host}${latency}`;
    }
    case 'connecting':   return `Connecting to ${host}…`;
    case 'disconnected': return `Offline — will reconnect to ${host}`;
    case 'error':        return `Error connecting to ${host}`;
  }
}

// AndroidStyle.BIGTEXT is enum value 0 in @notifee/react-native, but to
// avoid a hard import we resolve it lazily.
function bigTextStyleType(): number {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('@notifee/react-native');
    return m.AndroidStyle?.BIGTEXT ?? 0;
  } catch {
    return 0;
  }
}

// ── Service ──────────────────────────────────

interface StartParams {
  host: string;
  port: number;
}

class ForegroundService {
  private running = false;
  private current: StartParams | null = null;
  private storeUnsub: (() => void) | null = null;
  private channelReady: Promise<void> | null = null;
  private initialized = false;

  /**
   * Register the foreground-service runner with notifee. Must be called
   * once after app start (e.g. from RootLayout). Idempotent. No-op on iOS
   * or when the native module is missing.
   */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    if (Platform.OS !== 'android') return;
    if (!notifee) return;
    try {
      notifee.registerForegroundService(
        () =>
          new Promise(() => {
            // Long-running task — never resolves. Stays alive as long as
            // the foreground notification does.
          })
      );
    } catch (err) {
      console.warn('[foregroundService] registerForegroundService failed:', err);
    }
  }

  private async ensureChannel(): Promise<void> {
    if (!notifee) return;
    if (!this.channelReady) {
      this.channelReady = (async () => {
        await notifee!.createChannel({
          id: CHANNEL_ID,
          name: CHANNEL_NAME,
          // Fall back to the literal LOW value (2) if the enum wasn't found
          // — channel creation should not fail just because of import shape.
          importance: AndroidImportance?.LOW ?? 2,
        });
      })();
    }
    return this.channelReady;
  }

  async start(params: StartParams): Promise<void> {
    if (Platform.OS !== 'android') return;
    if (!notifee) return;

    this.current = params;
    await this.ensureChannel();
    await this.display(connectionStore.getState().status);
    this.running = true;

    // Keep the notification body in sync with the connection state.
    if (!this.storeUnsub) {
      this.storeUnsub = connectionStore.subscribe((state, prev) => {
        if (state.status === prev.status && state.latencyMs === prev.latencyMs) return;
        if (this.running) {
          this.display(state.status).catch(() => {});
        }
      });
    }
  }

  async stop(): Promise<void> {
    if (Platform.OS !== 'android') return;
    if (!notifee) return;
    this.running = false;
    if (this.storeUnsub) {
      this.storeUnsub();
      this.storeUnsub = null;
    }
    try {
      await notifee.stopForegroundService();
    } catch (err) {
      console.warn('[foregroundService] stop failed:', err);
    }
    // Clear stored params so a stale host can't leak into a later display().
    this.current = null;
  }

  private async display(status: ConnectionStatus): Promise<void> {
    if (!notifee || !this.current) return;
    const { latencyMs } = connectionStore.getState();
    const body = bodyForStatus(status);
    const detail = detailForStatus(status, this.current.host, latencyMs);
    const visibilitySecret = notifee.AndroidVisibility?.SECRET ?? -1;
    try {
      await notifee.displayNotification({
        id: NOTIFICATION_ID,
        title: 'Walccy',
        body,
        android: {
          channelId: CHANNEL_ID,
          asForegroundService: true,
          ongoing: true,
          pressAction: { id: 'default' },
          smallIcon: 'notification_icon',
          color: '#7B61FF',
          colorized: true,
          visibility: visibilitySecret,
          style: { type: bigTextStyleType(), text: detail },
        },
      });
    } catch (err) {
      console.warn('[foregroundService] displayNotification failed:', err);
    }
  }
}

export const foregroundService = new ForegroundService();
