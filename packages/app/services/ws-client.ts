// ──────────────────────────────────────────────
// Walccy — WebSocket client service
// ──────────────────────────────────────────────
//
// v2 stream-json era. Consumes typed SessionEvent broadcasts from the
// daemon, dispatches them into messages.store. Sends ControlMessage
// envelopes for the user input / interrupt / plan-accept / etc. control
// plane.

import { MMKV } from 'react-native-mmkv';
import { v4 as uuid } from 'uuid';
import { connectionStore } from '../stores/connection.store';
import { sessionsStore } from '../stores/sessions.store';
import { messagesStore } from '../stores/messages.store';
import { initMetadataStore } from '../stores/init-metadata.store';
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
import type {
  ServerMessage,
  ClientMessage,
  ControlMessage,
  DirectoryEntry,
  UserContentBlock,
  PermissionMode,
  EffortLevel,
  SpawnSessionMessage,
} from '@walccy/protocol';
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
// Spawn parameters surfaced to the UI
// ──────────────────────────────────────────────

export type SpawnSessionParams = Omit<
  SpawnSessionMessage,
  'type' | 'requestId' | 'cwd'
>;

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

  /** Sessions we should be subscribed to (survives reconnects). */
  private activeSubscriptions: Set<string> = new Set();

  /** Highest event index we've applied per session (for resume gap-fill). */
  private lastEventIndex: Map<string, number> = new Map();

  private lastFcmTokenRegistered: string | null = null;

  private pendingSpawns = new PendingRequests<string>();
  private pendingDirectoryListing = new PendingRequests<DirectoryEntry[]>();

  private reconnect: ReconnectController;
  private ping: PingWatchdog;
  private power: PowerPolicy;

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
    this.lastEventIndex.clear();
    this.rejectAllPending(new Error('Disconnected'));

    this.closeSocketSilently();
    this.power.onDisconnect();
    connectionStore.getState().setDisconnected();
  }

  retry(): void {
    if (!this.currentHost || !this.currentPort || !this.currentSecret) return;
    this.reconnect.reset();
    connectionStore.getState().setStatus('connecting');
    this.openSocket();
  }

  // ── Subscription ──────────────────────────────

  subscribe(sessionId: string): void {
    this.activeSubscriptions.add(sessionId);
    const cursor = this.lastEventIndex.get(sessionId);
    const fromEventIndex = cursor !== undefined ? cursor + 1 : 0;
    this.send({ type: 'SUBSCRIBE', sessionId, fromEventIndex });
  }

  unsubscribe(sessionId: string): void {
    this.activeSubscriptions.delete(sessionId);
    this.lastEventIndex.delete(sessionId);
    this.send({ type: 'UNSUBSCRIBE', sessionId });
  }

  // ── Control plane (CONTROL_MESSAGE envelope) ──

  sendUserMessage(sessionId: string, content: UserContentBlock[]): void {
    messagesStore.getState().pushUserMessage(sessionId, content);
    this.sendControl(sessionId, { type: 'send_user_message', content });
  }

  /** Convenience: send a plain text turn from the composer. */
  sendUserText(sessionId: string, text: string): void {
    this.sendUserMessage(sessionId, [{ type: 'text', text }]);
  }

  // ── Legacy shims (kept until F6/F30 cleanup) ──
  // The v1 protocol had `INPUT` and `RESIZE` top-level messages. Several
  // existing components and hooks still call wsClient.sendInput / sendResize.
  // For F5 we keep them functional by mapping sendInput → sendUserText (so
  // anything that fed terminal input now ships a stream-json user turn) and
  // making sendResize a no-op (the SDK has no concept of terminal size).
  // F6 (Composer) replaces InputBar/ControlBar and F30 removes the remaining
  // callers.
  sendInput(sessionId: string, data: string): void {
    const trimmed = data.endsWith('\n') ? data.slice(0, -1) : data;
    if (!trimmed) return;
    this.sendUserText(sessionId, trimmed);
  }

  sendResize(_sessionId: string, _cols: number, _rows: number): void {
    // No-op: stream-json sessions don't have a terminal geometry.
  }

  interrupt(sessionId: string): void {
    this.sendControl(sessionId, { type: 'interrupt' });
  }

  killSession(sessionId: string): void {
    this.activeSubscriptions.delete(sessionId);
    this.lastEventIndex.delete(sessionId);
    this.sendControl(sessionId, { type: 'kill_session', sessionId });
  }

  planAccept(sessionId: string, toolUseId: string): void {
    this.sendControl(sessionId, { type: 'plan_accept', toolUseId });
  }

  planReject(sessionId: string, toolUseId: string, reason?: string): void {
    this.sendControl(sessionId, { type: 'plan_reject', toolUseId, reason });
  }

  answerQuestion(
    sessionId: string,
    toolUseId: string,
    answers: string[]
  ): void {
    this.sendControl(sessionId, { type: 'answer_question', toolUseId, answers });
  }

  resolvePermission(
    sessionId: string,
    requestId: string,
    decision: 'allow' | 'deny',
    updatedInput?: Record<string, unknown>
  ): void {
    messagesStore
      .getState()
      .markPermissionResolved(
        sessionId,
        requestId,
        decision === 'allow' ? 'allowed' : 'denied'
      );
    this.sendControl(sessionId, {
      type: 'resolve_permission',
      requestId,
      decision,
      updatedInput,
    });
  }

  changePermissionMode(sessionId: string, mode: PermissionMode): void {
    this.sendControl(sessionId, { type: 'change_permission_mode', mode });
  }

  setModel(sessionId: string, model?: string): void {
    this.sendControl(sessionId, { type: 'set_model', model });
  }

  setEffortLevel(sessionId: string, level: EffortLevel): void {
    this.sendControl(sessionId, { type: 'set_effort_level', level });
  }

  // ── Misc ──────────────────────────────────────

  listSessions(): void {
    this.send({ type: 'LIST_SESSIONS' });
  }

  applyLowPowerMode(_lowPowerMode: boolean): void {
    const connected =
      this.currentHost && this.currentPort
        ? { host: this.currentHost, port: this.currentPort }
        : null;
    this.power.onPolicyChange(connected);
  }

  listDirectories(query?: string, timeoutMs = 8000): Promise<DirectoryEntry[]> {
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

  spawnSession(
    cwd: string,
    params: SpawnSessionParams = {},
    timeoutMs = 15000
  ): Promise<string> {
    const requestId = uuid();
    const { promise } = this.pendingSpawns.send<string>({
      requestId,
      timeoutMs,
    });
    this.send({ type: 'SPAWN_SESSION', cwd, requestId, ...params });
    return promise;
  }

  // ── Private helpers ───────────────────────────

  private sendControl(sessionId: string, message: ControlMessage): void {
    this.send({ type: 'CONTROL_MESSAGE', sessionId, message });
  }

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
        // onerror is always followed by onclose
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
      try { listener(msg); } catch (err) {
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
        // Re-subscribe (resumes from lastEventIndex+1).
        for (const sessionId of Array.from(this.activeSubscriptions)) {
          this.subscribe(sessionId);
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
              'Claude is waiting for your response.'
            ).catch(() => {});
          }
        }
        sessionsStore.getState().updateSession(msg.sessionId, msg.changes);
        break;
      }

      case 'SESSION_REMOVED': {
        sessionsStore.getState().removeSession(msg.sessionId);
        messagesStore.getState().clear(msg.sessionId);
        initMetadataStore.getState().clear(msg.sessionId);
        this.lastEventIndex.delete(msg.sessionId);
        break;
      }

      case 'HISTORY': {
        messagesStore.getState().setHistory(
          msg.sessionId,
          msg.events,
          msg.totalEvents,
          msg.firstAvailableEventIndex
        );
        // Re-hydrate init metadata from history (e.g. on reconnect after the
        // live init event has already left our local stream).
        for (const e of msg.events) {
          if (e.kind === 'init') {
            initMetadataStore.getState().set(msg.sessionId, e);
            break;
          }
        }
        // History events came from the ring buffer (which is index-tracked
        // on the daemon side). The HISTORY envelope doesn't carry per-event
        // indices, so we trust the daemon's totalEvents - 1 as the highest
        // index we've now seen.
        if (msg.totalEvents > 0) {
          this.lastEventIndex.set(msg.sessionId, msg.totalEvents - 1);
        }
        break;
      }

      case 'SESSION_EVENT': {
        messagesStore
          .getState()
          .applyEvent(msg.sessionId, msg.event, msg.eventIndex);
        if (msg.event.kind === 'init') {
          initMetadataStore.getState().set(msg.sessionId, msg.event);
        }
        const prev = this.lastEventIndex.get(msg.sessionId) ?? -1;
        if (msg.eventIndex > prev) {
          this.lastEventIndex.set(msg.sessionId, msg.eventIndex);
        }
        break;
      }

      case 'PONG': {
        const latency = Date.now() - this.pingSentAt;
        connectionStore.getState().setLatency(latency);
        this.ping.notePongReceived(latency);
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

  private send(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      this.ws.send(JSON.stringify(msg));
    } catch (err) {
      console.warn('[WsClient] send() error:', err);
    }
  }
}

export const wsClient = new WsClient();
