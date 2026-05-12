import * as crypto from 'crypto';
import type { AuthMessage, ServerMessage } from '@walccy/protocol';
import type { WalccyConfig } from './config.js';
import {
  ClientRegistry,
  ConnectedClient,
} from './client-registry.js';
import { PushService } from './push.js';
import logger from './logger.js';
import pkg from '../package.json' with { type: 'json' };

const DAEMON_VERSION: string = pkg.version;

export interface AuthHandlerDeps {
  config: WalccyConfig;
  registry: ClientRegistry;
  pushService?: PushService;
}

export function handleAuth(
  client: ConnectedClient,
  msg: AuthMessage,
  deps: AuthHandlerDeps
): void {
  const { config, registry } = deps;

  const secretBuf = Buffer.from(String(msg.secret));
  const expectedBuf = Buffer.from(config.authSecret);
  const isValid =
    secretBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(secretBuf, expectedBuf);

  if (!isValid) {
    logger.warn(`WS client ${client.id}: auth failed`);
    const fail: ServerMessage = {
      type: 'AUTH_FAIL',
      reason: 'Invalid secret',
    };
    registry.send(client.ws, fail);
    client.ws.close(1008, 'Auth failed');
    return;
  }

  client.isAuthenticated = true;
  client.name = msg.clientName || 'unknown';
  if (client.authTimeout) {
    clearTimeout(client.authTimeout);
    client.authTimeout = undefined;
  }

  const requested = msg.clientId;
  if (
    typeof requested === 'string' &&
    requested.length > 0 &&
    requested.length <= 100 &&
    !requested.includes('\0')
  ) {
    const rebindOk = registry.rebind(client, requested);
    void rebindOk;
  }

  const ok: ServerMessage = { type: 'AUTH_OK', clientId: client.id, daemonVersion: DAEMON_VERSION };
  registry.send(client.ws, ok);
  logger.info(`WS client authenticated: ${client.id} (${client.name})`);
}
