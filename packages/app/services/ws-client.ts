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
  PING_INTERVAL,
} from '../constants/config';
import type { ServerMessage } from '../types';

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

    connectionStore.getState().setStatus('connecting');
    this.openSocket();
  }

  disconnect(): void {
    this.reconnectAttempt = 0;
    this.clearReconnectTimer();
    this.stopPing();

    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }

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
        connectionStore.getState().setConnected(
          this.currentHost!,
          this.currentPort!,
          // AUTH_OK carries the clientId echoed back; hostname comes in a future
          // handshake extension — use host as hostname for now
          this.currentHost!,
          '1.0.0'
        );
        this.startPing();
        // Immediately fetch session list
        this.listSessions();
        // Re-subscribe to any sessions from a previous connection
        for (const [sessionId, fromLine] of Array.from(this.activeSubscriptions.entries())) {
          this.send({
            type: 'SUBSCRIBE',
            sessionId,
            ...(fromLine !== undefined ? { fromLine } : {}),
          });
        }
        break;
      }

      case 'AUTH_FAIL': {
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

      default: {
        // Exhaustive check — TypeScript will flag unhandled cases
        const _exhaustive: never = msg;
        console.warn('[WsClient] Unknown message type:', _exhaustive);
      }
    }
  }

  private reconnect(): void {
    if (!this.currentHost || !this.currentPort || !this.currentSecret) return;

    const delays = WS_RECONNECT_DELAYS;
    const delay = delays[Math.min(this.reconnectAttempt, delays.length - 1)] ?? delays[delays.length - 1]!;
    this.reconnectAttempt++;

    connectionStore.getState().setStatus('connecting');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
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

      // If no PONG arrives within 5 seconds, treat as disconnected
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
      }, 5000);
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
