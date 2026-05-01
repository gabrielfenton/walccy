// ──────────────────────────────────────────────
// Walccy — WebSocket client service
// ──────────────────────────────────────────────

import { MMKV } from 'react-native-mmkv';
import { v4 as uuid } from 'uuid';
import { connectionStore } from '../stores/connection.store';
import { sessionsStore } from '../stores/sessions.store';
import { outputStore } from '../stores/output.store';
import {
  WS_RECONNECT_DELAYS,
  WS_RECONNECT_JITTER,
  PING_INTERVAL,
  PING_TIMEOUT,
  AUTH_TIMEOUT,
} from '../constants/config';
import { networkStatus } from './network-status';
import { foregroundService } from './foreground-service';
import { settingsStore } from '../stores/settings.store';
import { scheduleLocalNotification } from './notification.service';
import { getPushToken } from './push-token';
import type { ServerMessage, DirectoryEntry } from '@walccy/protocol';

// ──────────────────────────────────────────────
// Persistent client identity
// ──────────────────────────────────────────────

const _idStorage = new MMKV({ id: 'walccy-client' });
let _clientId = _idStorage.getString('clientId');
if (!_clientId) {
  _clientId = uuid();
  _idStorage.set('clientId', _clientId);
}
const PERSISTENT_CLIENT_ID: string = _clientId;

// ──────────────────────────────────────────────
// WsClient
// ──────────────────────────────────────────────

class WsClient {
  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pingTimeout: ReturnType<typeof setTimeout> | null = null;
  private pingSentAt = 0;
  private authTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  /** Listeners registered via onMessage() */
  private messageListeners: Set<(msg: ServerMessage) => void> = new Set();

  /**
   * Register a listener for all incoming ServerMessages.
   * Returns an unsubscribe function — call it in useEffect cleanup.
   */
  onMessage(listener: (msg: ServerMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  /** Persistent UUID for this device */
  private readonly clientId: string = PERSISTENT_CLIENT_ID;
  /** Human-readable device name */
  private readonly clientName: string = 'Walccy Mobile';

  private currentHost: string | null = null;
  private currentPort: number | null = null;
  private currentSecret: string | null = null;

  /** Sessions we should be subscribed to (survives reconnects) */
  private activeSubscriptions: Map<string, number | undefined> = new Map();

  /** Pending SPAWN_SESSION requests, keyed by requestId. */
  private pendingSpawns: Map<
    string,
    { resolve: (sessionId: string) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
  > = new Map();

  /** Pending LIST_DIRECTORIES request — at most one in flight. */
  private pendingDirectoryListing: {
    resolve: (entries: DirectoryEntry[]) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  // ── Public API ────────────────────────────────

  connect(host: string, port: number, secret: string): void {
    // Cancel any pending reconnect
    this.clearReconnectTimer();

    // Close existing socket silently
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }

    this.currentHost = host;
    this.currentPort = port;
    this.currentSecret = secret;
    this.reconnectAttempt = 0;

    // Start the Android foreground service so the OS keeps us alive
    // while in the background. Skipped when the user has enabled
    // low-power mode (cellular / metered networks). No-op on iOS or
    // when the native module isn't installed yet.
    if (!settingsStore.getState().lowPowerMode) {
      foregroundService.start({ host, port }).catch((err) => {
        console.warn('[WsClient] Foreground service start failed:', err);
      });
    }

    connectionStore.getState().setStatus('connecting');
    this.openSocket();
  }

  disconnect(): void {
    this.reconnectAttempt = 0;
    this.clearReconnectTimer();
    this.stopPing();
    this.activeSubscriptions.clear();
    this.rejectPending(new Error('Disconnected'));

    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }

    foregroundService.stop().catch(() => {});

    connectionStore.getState().setDisconnected();
  }

  /** Send keyboard input to a session */
  sendInput(sessionId: string, data: string): void {
    this.send({ type: 'INPUT', sessionId, data });
  }

  /** Subscribe to a session's live output stream */
  subscribe(sessionId: string, fromLine?: number): void {
    this.activeSubscriptions.set(sessionId, fromLine);
    this.send({ type: 'SUBSCRIBE', sessionId, ...(fromLine !== undefined ? { fromLine } : {}) });
  }

  /** Unsubscribe from a session */
  unsubscribe(sessionId: string): void {
    this.activeSubscriptions.delete(sessionId);
    this.send({ type: 'UNSUBSCRIBE', sessionId });
  }

  /** Send a terminal resize event */
  sendResize(sessionId: string, cols: number, rows: number): void {
    this.send({ type: 'RESIZE', sessionId, cols, rows });
  }

  /** Request the full session list from the daemon */
  listSessions(): void {
    this.send({ type: 'LIST_SESSIONS' });
  }

  /**
   * Sync the foreground-service state with the user's low-power-mode toggle.
   * Call this when the toggle flips so the change takes effect without
   * needing to disconnect/reconnect.
   */
  applyLowPowerMode(lowPowerMode: boolean): void {
    if (lowPowerMode) {
      foregroundService.stop().catch(() => {});
    } else if (this.currentHost && this.currentPort) {
      foregroundService.start({ host: this.currentHost, port: this.currentPort }).catch(() => {});
    }
  }

  /**
   * Ask the daemon for a directory suggestion list (recent cwds + git repos).
   * Resolves with the entries, or rejects on timeout / disconnect.
   */
  listDirectories(query?: string, timeoutMs = 8000): Promise<DirectoryEntry[]> {
    // Cancel any prior pending request
    if (this.pendingDirectoryListing) {
      clearTimeout(this.pendingDirectoryListing.timer);
      this.pendingDirectoryListing.reject(new Error('Superseded by newer listDirectories'));
      this.pendingDirectoryListing = null;
    }

    return new Promise<DirectoryEntry[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingDirectoryListing) {
          this.pendingDirectoryListing = null;
          reject(new Error('Timed out waiting for directory list'));
        }
      }, timeoutMs);
      this.pendingDirectoryListing = { resolve, reject, timer };
      this.send({ type: 'LIST_DIRECTORIES', ...(query ? { query } : {}) });
    });
  }

  /**
   * Spawn a new claude session on the daemon at the given cwd.
   * Resolves with the new sessionId, or rejects on timeout / failure.
   */
  spawnSession(cwd: string, timeoutMs = 15000): Promise<string> {
    const requestId = uuid();
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingSpawns.delete(requestId)) {
          reject(new Error('Timed out spawning session'));
        }
      }, timeoutMs);
      this.pendingSpawns.set(requestId, { resolve, reject, timer });
      this.send({ type: 'SPAWN_SESSION', cwd, requestId });
    });
  }

  // ── Private helpers ───────────────────────────

  private openSocket(): void {
    if (!this.currentHost || !this.currentPort || !this.currentSecret) return;

    const url = `ws://${this.currentHost}:${this.currentPort}`;
    try {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        this.reconnectAttempt = 0;
        // Authenticate immediately
        this.send({
          type: 'AUTH',
          secret: this.currentSecret!,
          clientId: this.clientId,
          clientName: this.clientName,
        });

        // Enforce auth timeout — if no AUTH_OK/AUTH_FAIL arrives, close
        this.authTimeoutTimer = setTimeout(() => {
          console.warn('[WsClient] Auth timeout — no response from daemon');
          if (this.ws) {
            this.ws.onclose = null;
            this.ws.onerror = null;
            this.ws.close();
            this.ws = null;
          }
          connectionStore.getState().setDisconnected('Auth timeout');
          this.reconnect();
        }, AUTH_TIMEOUT);
      };

      ws.onmessage = (event: MessageEvent) => {
        this.handleMessage(event.data as string);
      };

      ws.onerror = (_err: Event) => {
        // onerror is always followed by onclose — let onclose handle reconnect
      };

      ws.onclose = () => {
        this.stopPing();
        connectionStore.getState().setDisconnected('Connection lost');
        this.reconnect();
      };
    } catch (err) {
      connectionStore.getState().setDisconnected(String(err));
      this.reconnect();
    }
  }

  private handleMessage(data: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(data) as ServerMessage;
    } catch {
      console.warn('[WsClient] Failed to parse message:', data);
      return;
    }

    // Notify all registered listeners before processing
    for (const listener of Array.from(this.messageListeners)) {
      try {
        listener(msg);
      } catch (err) {
        console.warn('[WsClient] Message listener error:', err);
      }
    }

    switch (msg.type) {
      case 'AUTH_OK': {
        this.clearAuthTimeout();
        connectionStore.getState().setConnected(
          this.currentHost!,
          this.currentPort!,
          this.currentHost!,
          msg.daemonVersion
        );
        this.startPing();
        // Immediately fetch session list
        this.listSessions();
        // Re-subscribe to any sessions from a previous connection.
        // Resume from the highest line index we've already received so the
        // daemon only ships the gap — critical on flaky connections that
        // drop and reconnect mid-session.
        const buffers = outputStore.getState().buffers;
        for (const sessionId of Array.from(this.activeSubscriptions.keys())) {
          const buf = buffers[sessionId];
          const resumeFromLine = buf?.totalLines ?? this.activeSubscriptions.get(sessionId);
          // Update our cached cursor so a future reconnect resumes correctly.
          this.activeSubscriptions.set(sessionId, resumeFromLine);
          this.send({
            type: 'SUBSCRIBE',
            sessionId,
            ...(resumeFromLine !== undefined ? { fromLine: resumeFromLine } : {}),
          });
        }
        // Register push token for FCM notifications
        this.registerPushToken();
        break;
      }

      case 'AUTH_FAIL': {
        this.clearAuthTimeout();
        connectionStore.getState().setDisconnected(msg.reason ?? 'Authentication failed');
        // Don't reconnect on auth failure
        this.clearReconnectTimer();
        if (this.ws) {
          this.ws.onclose = null;
          this.ws.close();
          this.ws = null;
        }
        break;
      }

      case 'SESSIONS': {
        sessionsStore.getState().setSessions(msg.sessions);
        break;
      }

      case 'SESSION_ADDED': {
        sessionsStore.getState().addSession(msg.session);
        break;
      }

      case 'SESSION_UPDATED': {
        // Detect waitingForInput transition (false → true) to fire notification
        if (msg.changes.waitingForInput === true) {
          const prev = sessionsStore.getState().sessions[msg.sessionId];
          if (prev && !prev.waitingForInput) {
            const name = prev.name || 'Claude';
            scheduleLocalNotification(
              `${name} needs input`,
              'Claude has finished its task and is waiting for your response.'
            ).catch(() => {});
          }
        }
        sessionsStore.getState().updateSession(msg.sessionId, msg.changes);
        break;
      }

      case 'SESSION_REMOVED': {
        sessionsStore.getState().removeSession(msg.sessionId);
        break;
      }

      case 'HISTORY': {
        outputStore.getState().setHistory(msg.sessionId, msg.lines, msg.totalLines);
        break;
      }

      case 'OUTPUT': {
        outputStore.getState().appendLines(msg.sessionId, msg.lines);
        break;
      }

      case 'PONG': {
        const latency = Date.now() - this.pingSentAt;
        connectionStore.getState().setLatency(latency);
        // Clear the pong-timeout watchdog
        if (this.pingTimeout) {
          clearTimeout(this.pingTimeout);
          this.pingTimeout = null;
        }
        break;
      }

      case 'INPUT_LOCK': {
        // Informational — future UI will surface this
        break;
      }

      case 'ERROR': {
        console.warn('[WsClient] Daemon error:', msg.code, msg.message);
        break;
      }

      case 'DIRECTORY_LIST': {
        if (this.pendingDirectoryListing) {
          clearTimeout(this.pendingDirectoryListing.timer);
          this.pendingDirectoryListing.resolve(msg.directories);
          this.pendingDirectoryListing = null;
        }
        break;
      }

      case 'SPAWN_RESULT': {
        const pending = this.pendingSpawns.get(msg.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingSpawns.delete(msg.requestId);
          if (msg.sessionId) {
            pending.resolve(msg.sessionId);
          } else {
            pending.reject(new Error(msg.error ?? 'Spawn failed'));
          }
        }
        break;
      }

      default: {
        // Exhaustive check — TypeScript will flag unhandled cases
        const _exhaustive: never = msg;
        console.warn('[WsClient] Unknown message type:', _exhaustive);
      }
    }
  }

  private reconnect(): void {
    if (!this.currentHost || !this.currentPort || !this.currentSecret) return;

    // Don't burn battery and data spamming retries when the OS knows
    // we have no network. Park here and let the NetInfo listener kick
    // us back into action when the link returns.
    if (!networkStatus.isOnline()) {
      connectionStore.getState().setStatus('connecting');
      networkStatus.onceOnline(() => {
        // Reset attempt count so the first try after reconnect is fast.
        this.reconnectAttempt = 0;
        this.openSocket();
      });
      return;
    }

    const delays = WS_RECONNECT_DELAYS;
    const base = delays[Math.min(this.reconnectAttempt, delays.length - 1)] ?? delays[delays.length - 1]!;
    // Symmetric jitter: ±WS_RECONNECT_JITTER (e.g. ±25%) of the base delay.
    const jitter = base * WS_RECONNECT_JITTER * (Math.random() * 2 - 1);
    const delay = Math.max(500, Math.round(base + jitter));
    this.reconnectAttempt++;

    connectionStore.getState().setStatus('connecting');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private registerPushToken(): void {
    getPushToken()
      .then((result) => {
        if (result) {
          this.send({
            type: 'REGISTER_PUSH_TOKEN',
            token: result.token,
            platform: result.platform,
          });
          console.log(`[WsClient] Push token registered (${result.platform})`);
        }
      })
      .catch((err) => {
        console.warn('[WsClient] Failed to register push token:', err);
      });
  }

  private rejectPending(err: Error): void {
    for (const [id, pending] of Array.from(this.pendingSpawns.entries())) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pendingSpawns.delete(id);
    }
    if (this.pendingDirectoryListing) {
      clearTimeout(this.pendingDirectoryListing.timer);
      this.pendingDirectoryListing.reject(err);
      this.pendingDirectoryListing = null;
    }
  }

  private clearAuthTimeout(): void {
    if (this.authTimeoutTimer) {
      clearTimeout(this.authTimeoutTimer);
      this.authTimeoutTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      this.pingSentAt = Date.now();
      this.send({ type: 'PING' });

      // If no PONG arrives within PING_TIMEOUT, treat as disconnected.
      // The longer window (15s) avoids spurious drops on jittery cellular.
      this.pingTimeout = setTimeout(() => {
        console.warn('[WsClient] Ping timeout — treating as disconnected');
        if (this.ws) {
          this.ws.onclose = null;
          this.ws.onerror = null;
          this.ws.close();
          this.ws = null;
        }
        this.stopPing();
        connectionStore.getState().setDisconnected('Ping timeout');
        this.reconnect();
      }, PING_TIMEOUT);
    }, PING_INTERVAL);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pingTimeout) {
      clearTimeout(this.pingTimeout);
      this.pingTimeout = null;
    }
  }

  private send(msg: object): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Drop silently — the reconnect cycle will handle it
      return;
    }
    try {
      this.ws.send(JSON.stringify(msg));
    } catch (err) {
      console.warn('[WsClient] send() error:', err);
    }
  }
}

// ──────────────────────────────────────────────
// Singleton export
// ──────────────────────────────────────────────

export const wsClient = new WsClient();
