// ──────────────────────────────────────────────
// Walccy — WebSocket client service
// Thin orchestrator over modular collaborators (PendingRequests,
// ReconnectController, PingWatchdog, PowerPolicy). Public API is
// stable — see grep('wsClient.') for call sites.
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
import { PendingRequests } from './ws/PendingRequests';
import { ReconnectController } from './ws/ReconnectController';
import { PingWatchdog } from './ws/PingWatchdog';
import { PowerPolicy } from './ws/PowerPolicy';

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

const DIRECTORY_LIST_KEY = 'directory-list';
const RECONNECT_MAX_ATTEMPTS = 12;

// ──────────────────────────────────────────────
// WsClient
// ──────────────────────────────────────────────

class WsClient {
  private ws: WebSocket | null = null;
  private authTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private pingSentAt = 0;

  private readonly clientId: string = PERSISTENT_CLIENT_ID;
  private readonly clientName: string = 'Walccy Mobile';

  private currentHost: string | null = null;
  private currentPort: number | null = null;
  private currentSecret: string | null = null;

  /** Sessions we should be subscribed to (survives reconnects). Value unused. */
  private activeSubscriptions: Map<string, number | undefined> = new Map();

  /** Highest line index we've delivered to the buffer per session. */
  private lastSeenIndex: Map<string, number> = new Map();

  /** Last successfully registered FCM token, for debounce. */
  private lastFcmTokenRegistered: string | null = null;

  private pendingSpawns = new PendingRequests<string>();
  private pendingDirectoryListing = new PendingRequests<DirectoryEntry[]>();

  private reconnect: ReconnectController;
  private ping: PingWatchdog;
  private power: PowerPolicy;

  /** Listeners registered via onMessage() */
  private messageListeners: Set<(msg: ServerMessage) => void> = new Set();

  constructor() {
    this.reconnect = new ReconnectController({
      delays: WS_RECONNECT_DELAYS,
      jitter: WS_RECONNECT_JITTER,
      maxAttempts: RECONNECT_MAX_ATTEMPTS,
      isOnline: () => networkStatus.isOnline(),
      onceOnline: (cb) => networkStatus.onceOnline(cb),
      openSocket: () => this.openSocket(),
      setStatus: (status) => connectionStore.getState().setStatus(status),
      onCircuitBreak: () => {
        connectionStore.getState().setDisconnected('reconnect_exhausted');
      },
    });

    this.ping = new PingWatchdog({
      interval: PING_INTERVAL,
      timeout: PING_TIMEOUT,
      isSocketOpen: () => !!this.ws && this.ws.readyState === WebSocket.OPEN,
      sendPing: () => {
        this.pingSentAt = Date.now();
        this.send({ type: 'PING' });
      },
      onTimeout: () => {
        console.warn('[WsClient] Ping timeout — treating as disconnected');
        this.clearAuthTimeout();
        this.closeSocketSilently();
        this.ping.stop();
        connectionStore.getState().setDisconnected('Ping timeout');
        this.reconnect.schedule();
      },
    });

    this.power = new PowerPolicy({
      isLowPowerMode: () => settingsStore.getState().lowPowerMode,
      foregroundService,
    });
  }

  /**
   * Register a listener for all incoming ServerMessages.
   * Returns an unsubscribe function — call it in useEffect cleanup.
   */
  onMessage(listener: (msg: ServerMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  // ── Public API ────────────────────────────────

  connect(host: string, port: number, secret: string): void {
    this.reconnect.cancel();
    this.reconnect.reset();
    this.closeSocketSilently();

    this.currentHost = host;
    this.currentPort = port;
    this.currentSecret = secret;

    this.power.onConnect(host, port);

    connectionStore.getState().setStatus('connecting');
    this.openSocket();
  }

  disconnect(): void {
    this.reconnect.cancel();
    this.reconnect.reset();
    this.ping.stop();
    this.clearAuthTimeout();
    this.activeSubscriptions.clear();
    this.lastSeenIndex.clear();
    this.rejectAllPending(new Error('Disconnected'));

    this.closeSocketSilently();

    this.power.onDisconnect();

    connectionStore.getState().setDisconnected();
  }

  /** Manual retry after the circuit-breaker has tripped. */
  retry(): void {
    if (!this.currentHost || !this.currentPort || !this.currentSecret) return;
    this.reconnect.reset();
    connectionStore.getState().setStatus('connecting');
    this.openSocket();
  }

  sendInput(sessionId: string, data: string): void {
    this.send({ type: 'INPUT', sessionId, data });
  }

  subscribe(sessionId: string, fromLine?: number): void {
    this.activeSubscriptions.set(sessionId, fromLine);
    this.send({ type: 'SUBSCRIBE', sessionId, ...(fromLine !== undefined ? { fromLine } : {}) });
  }

  unsubscribe(sessionId: string): void {
    this.activeSubscriptions.delete(sessionId);
    this.lastSeenIndex.delete(sessionId);
    this.send({ type: 'UNSUBSCRIBE', sessionId });
  }

  sendResize(sessionId: string, cols: number, rows: number): void {
    this.send({ type: 'RESIZE', sessionId, cols, rows });
  }

  listSessions(): void {
    this.send({ type: 'LIST_SESSIONS' });
  }

  /**
   * Sync foreground-service state with the user's low-power-mode toggle.
   */
  applyLowPowerMode(_lowPowerMode: boolean): void {
    const connected =
      this.currentHost && this.currentPort
        ? { host: this.currentHost, port: this.currentPort }
        : null;
    this.power.onPolicyChange(connected);
  }

  listDirectories(query?: string, timeoutMs = 8000): Promise<DirectoryEntry[]> {
    // Single-flight: cancel any prior request before issuing the new one.
    this.pendingDirectoryListing.rejectAll(
      new Error('Superseded by newer listDirectories')
    );
    const { promise } = this.pendingDirectoryListing.send<DirectoryEntry[]>({
      requestId: DIRECTORY_LIST_KEY,
      timeoutMs,
    });
    this.send({ type: 'LIST_DIRECTORIES', ...(query ? { query } : {}) });
    return promise;
  }

  spawnSession(cwd: string, timeoutMs = 15000): Promise<string> {
    const requestId = uuid();
    const { promise } = this.pendingSpawns.send<string>({
      requestId,
      timeoutMs,
    });
    this.send({ type: 'SPAWN_SESSION', cwd, requestId });
    return promise;
  }

  // ── Private helpers ───────────────────────────

  private closeSocketSilently(): void {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
  }

  private openSocket(): void {
    if (!this.currentHost || !this.currentPort || !this.currentSecret) return;

    // Always start fresh: any prior auth timer or socket is stale.
    this.clearAuthTimeout();

    const url = `ws://${this.currentHost}:${this.currentPort}`;
    try {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        this.send({
          type: 'AUTH',
          secret: this.currentSecret!,
          clientId: this.clientId,
          clientName: this.clientName,
        });

        this.authTimeoutTimer = setTimeout(() => {
          console.warn('[WsClient] Auth timeout — no response from daemon');
          this.clearAuthTimeout();
          this.closeSocketSilently();
          connectionStore.getState().setDisconnected('Auth timeout');
          this.reconnect.schedule();
        }, AUTH_TIMEOUT);
      };

      ws.onmessage = (event: MessageEvent) => {
        this.handleMessage(event.data as string);
      };

      ws.onerror = (_err: Event) => {
        // onerror is always followed by onclose — let onclose handle reconnect
      };

      ws.onclose = () => {
        this.clearAuthTimeout();
        this.ping.stop();
        connectionStore.getState().setDisconnected('Connection lost');
        this.reconnect.schedule();
      };
    } catch (err) {
      this.clearAuthTimeout();
      connectionStore.getState().setDisconnected(String(err));
      this.reconnect.schedule();
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
        this.reconnect.reset();
        connectionStore.getState().setConnected(
          this.currentHost!,
          this.currentPort!,
          this.currentHost!,
          msg.daemonVersion
        );
        this.ping.start();
        this.listSessions();
        // Re-subscribe using the index cursor so the daemon ships only the
        // gap (RESUME) instead of replacing scrollback (HISTORY).
        for (const sessionId of Array.from(this.activeSubscriptions.keys())) {
          const cursor = this.lastSeenIndex.get(sessionId);
          const fromLine = cursor !== undefined ? cursor + 1 : undefined;
          this.activeSubscriptions.set(sessionId, fromLine);
          this.send({
            type: 'SUBSCRIBE',
            sessionId,
            ...(fromLine !== undefined ? { fromLine } : {}),
          });
        }
        this.registerPushToken();
        break;
      }

      case 'AUTH_FAIL': {
        this.clearAuthTimeout();
        this.reconnect.cancel();
        this.rejectAllPending(new Error(msg.reason ?? 'Authentication failed'));
        connectionStore.getState().setDisconnected(msg.reason ?? 'Authentication failed');
        if (this.ws) {
          this.ws.onclose = null;
          try { this.ws.close(); } catch { /* ignore */ }
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
        this.bumpLastSeen(msg.sessionId, msg.lines);
        // Detect scrollback truncation.
        const requestedFrom = this.activeSubscriptions.get(msg.sessionId);
        if (
          typeof requestedFrom === 'number' &&
          requestedFrom > 0 &&
          msg.firstAvailableLine > requestedFrom
        ) {
          const dropped = msg.firstAvailableLine - requestedFrom;
          outputStore.getState().insertGapMarker(msg.sessionId, dropped, msg.firstAvailableLine);
        }
        break;
      }

      case 'RESUME': {
        outputStore.getState().appendResume(msg.sessionId, msg.lines, msg.totalLines);
        this.bumpLastSeen(msg.sessionId, msg.lines);
        break;
      }

      case 'OUTPUT': {
        outputStore.getState().appendLines(msg.sessionId, msg.lines);
        this.bumpLastSeen(msg.sessionId, msg.lines);
        break;
      }

      case 'PONG': {
        const latency = Date.now() - this.pingSentAt;
        connectionStore.getState().setLatency(latency);
        this.ping.notePongReceived(latency);
        break;
      }

      case 'INPUT_LOCK': {
        break;
      }

      case 'ERROR': {
        console.warn('[WsClient] Daemon error:', msg.code, msg.message);
        break;
      }

      case 'DIRECTORY_LIST': {
        this.pendingDirectoryListing.resolve(DIRECTORY_LIST_KEY, msg.directories);
        break;
      }

      case 'SPAWN_RESULT': {
        if (msg.sessionId) {
          this.pendingSpawns.resolve(msg.requestId, msg.sessionId);
        } else {
          this.pendingSpawns.reject(msg.requestId, new Error(msg.error ?? 'Spawn failed'));
        }
        break;
      }

      default: {
        const _exhaustive: never = msg;
        console.warn('[WsClient] Unknown message type:', _exhaustive);
      }
    }
  }

  private bumpLastSeen(sessionId: string, lines: { index: number }[]): void {
    if (lines.length === 0) return;
    let max = this.lastSeenIndex.get(sessionId) ?? -1;
    for (const l of lines) {
      if (l.index > max) max = l.index;
    }
    this.lastSeenIndex.set(sessionId, max);
  }

  private registerPushToken(): void {
    getPushToken()
      .then((result) => {
        if (!result) return;
        if (result.token === this.lastFcmTokenRegistered) return;
        this.send({
          type: 'REGISTER_PUSH_TOKEN',
          token: result.token,
          platform: result.platform,
        });
        this.lastFcmTokenRegistered = result.token;
        console.log(`[WsClient] Push token registered (${result.platform})`);
      })
      .catch((err) => {
        console.warn('[WsClient] Failed to register push token:', err);
      });
  }

  private rejectAllPending(err: Error): void {
    this.pendingSpawns.rejectAll(err);
    this.pendingDirectoryListing.rejectAll(err);
  }

  private clearAuthTimeout(): void {
    if (this.authTimeoutTimer) {
      clearTimeout(this.authTimeoutTimer);
      this.authTimeoutTimer = null;
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
