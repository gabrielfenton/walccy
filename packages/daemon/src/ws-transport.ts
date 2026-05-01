import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type { WalccyConfig } from './config.js';
import {
  ClientRegistry,
  ConnectedClient,
} from './client-registry.js';
import { MessageRouter } from './message-router.js';
import logger from './logger.js';

const MAX_PAYLOAD_BYTES = 1024 * 1024; // 1 MB max message size
const AUTH_TIMEOUT_MS = 10_000;

/**
 * WsTransport
 *
 * Owns the HTTP server + WebSocketServer and the per-connection lifecycle:
 *   - listen / close
 *   - max-payload enforcement
 *   - JSON parse + framing
 *   - 10-second auth timeout
 *   - close/error cleanup (delegated to ClientRegistry)
 *
 * Knows nothing about message semantics — every parsed message is forwarded
 * to MessageRouter.dispatch().
 */
export class WsTransport {
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;

  constructor(
    private readonly config: WalccyConfig,
    private readonly bindAddress: string,
    private readonly registry: ClientRegistry,
    private readonly router: MessageRouter
  ) {}

  async start(): Promise<void> {
    this.httpServer = http.createServer();
    this.wss = new WebSocketServer({
      server: this.httpServer,
      maxPayload: MAX_PAYLOAD_BYTES,
    });

    this.wss.on('connection', (ws: WebSocket) => {
      this._handleConnection(ws);
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(this.config.port, this.bindAddress, () => {
        logger.info(
          `WebSocket server listening on ws://${this.bindAddress}:${this.config.port}`
        );
        resolve();
      });
      this.httpServer!.once('error', reject);
    });
  }

  stop(): void {
    this.wss?.close();
    this.httpServer?.close();
    logger.info('WebSocket server stopped');
  }

  // ────────────────────────────────────────────
  // Per-connection lifecycle
  // ────────────────────────────────────────────

  private _handleConnection(ws: WebSocket): void {
    const clientId = uuidv4();
    const client: ConnectedClient = {
      id: clientId,
      name: '',
      ws,
      subscribedSessions: new Set(),
      isAuthenticated: false,
    };

    this.registry.add(client);
    logger.debug(`WS client connected: ${clientId}`);

    ws.on('message', (raw: Buffer | string) => {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      let msg: unknown;
      try {
        msg = JSON.parse(text);
      } catch {
        logger.warn(`WS client ${clientId}: invalid JSON, closing`);
        this.registry.sendError(ws, 'PARSE_ERROR', 'Invalid JSON');
        ws.close(1002, 'Invalid JSON');
        return;
      }

      this.router.dispatch(client, msg);
    });

    ws.on('close', () => {
      // Note: client.id may have been rebound during AUTH to the device-side
      // persistent id. The registry uses client.id (current) for cleanup so
      // the push-token entry registered post-AUTH is removed correctly.
      logger.debug(`WS client disconnected: ${client.id}`);
      this.registry.remove(client);
    });

    ws.on('error', (err: Error) => {
      logger.warn(`WS client ${clientId} error: ${err.message}`);
    });

    // Set auth timeout — cleared once authenticated
    const authTimeout = setTimeout(() => {
      if (!client.isAuthenticated) {
        logger.warn(`WS client ${clientId}: auth timeout, closing`);
        ws.close(1008, 'Auth timeout');
      }
    }, AUTH_TIMEOUT_MS);
    authTimeout.unref();
    client.authTimeout = authTimeout;
  }
}
