import { WebSocket } from 'ws';
import type { ServerMessage } from '@walccy/protocol';
import { SessionManager } from './session-manager.js';
import { PushService } from './push.js';
import logger from './logger.js';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface ConnectedClient {
  id: string;
  name: string;
  ws: WebSocket;
  subscribedSessions: Set<string>;
  isAuthenticated: boolean;
  authTimeout?: ReturnType<typeof setTimeout>;
}

export interface InputLock {
  clientId: string;
  clientName: string;
  expiresAt: number;
}

export const INPUT_LOCK_TTL_MS = 2000;

// ──────────────────────────────────────────────
// ClientRegistry
// ──────────────────────────────────────────────
//
// Owns the set of connected websocket clients, their per-client subscribed
// session list, and the per-session input-lock TTL table. Centralises all
// fan-out (broadcastAll, broadcastToSession) and the push-token un-register
// hook on disconnect.

export class ClientRegistry {
  private clients: Map<string, ConnectedClient> = new Map();
  private inputLocks: Map<string, InputLock> = new Map();

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly pushService?: PushService
  ) {}

  // ────────── client lifecycle ──────────

  add(client: ConnectedClient): void {
    this.clients.set(client.id, client);
  }

  get(clientId: string): ConnectedClient | undefined {
    return this.clients.get(clientId);
  }

  /**
   * Rebind a client to a new (persistent) id — used during AUTH so device-
   * supplied stable ids survive reconnects (push-token bookkeeping).
   */
  rebind(client: ConnectedClient, newId: string): boolean {
    if (newId === client.id) return true;
    if (this.clients.has(newId)) {
      logger.warn(
        `ClientRegistry.rebind: id collision — refusing to remap ${client.id} → ${newId} (already in use)`
      );
      return false;
    }
    this.clients.delete(client.id);
    client.id = newId;
    this.clients.set(client.id, client);
    return true;
  }

  /**
   * Disconnect cleanup. Always uses client.id (current) so that AUTH-rebound
   * persistent ids are correctly removed from the push-service registry.
   */
  remove(client: ConnectedClient): void {
    for (const sessionId of client.subscribedSessions) {
      this.sessionManager.removeClientFromSession(sessionId, client.id);
    }
    this.pushService?.unregisterClient(client.id);
    this.clients.delete(client.id);
  }

  // ────────── input locks ──────────

  getInputLock(sessionId: string): InputLock | undefined {
    return this.inputLocks.get(sessionId);
  }

  setInputLock(sessionId: string, lock: InputLock): void {
    this.inputLocks.set(sessionId, lock);
  }

  clearInputLock(sessionId: string): void {
    this.inputLocks.delete(sessionId);
  }

  // ────────── send / broadcast ──────────

  send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      logger.debug(`WS send error: ${String(err)}`);
    }
  }

  sendError(ws: WebSocket, code: string, message: string): void {
    const msg: ServerMessage = { type: 'ERROR', code, message };
    this.send(ws, msg);
  }

  broadcastAll(msg: ServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const client of this.clients.values()) {
      if (client.isAuthenticated && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(payload);
        } catch (err) {
          logger.debug(`Broadcast error to ${client.id}: ${String(err)}`);
        }
      }
    }
  }

  broadcastToSession(sessionId: string, msg: ServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const client of this.clients.values()) {
      if (
        client.isAuthenticated &&
        client.subscribedSessions.has(sessionId) &&
        client.ws.readyState === WebSocket.OPEN
      ) {
        try {
          client.ws.send(payload);
        } catch (err) {
          logger.debug(`Session broadcast error to ${client.id}: ${String(err)}`);
        }
      }
    }
  }
}
