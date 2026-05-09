import type { ServerMessage, SpawnSessionMessage } from '@walccy/protocol';
import { SessionManager } from './session-manager.js';
import { DirectoryScanner } from './directory-scanner.js';
import { ClientRegistry, ConnectedClient } from './client-registry.js';
import type { WalccyConfig } from './config.js';
import logger from './logger.js';

export interface SpawnHandlerDeps {
  sessionManager: SessionManager;
  directoryScanner: DirectoryScanner;
  registry: ClientRegistry;
  config: WalccyConfig;
}

export async function handleSpawnSession(
  client: ConnectedClient,
  msg: SpawnSessionMessage,
  deps: SpawnHandlerDeps
): Promise<void> {
  const { sessionManager, directoryScanner, registry, config } = deps;
  const cwd = directoryScanner.resolveAndValidate(msg.cwd);
  if (!cwd) {
    const reply: ServerMessage = {
      type: 'SPAWN_RESULT',
      requestId: msg.requestId,
      error: `Directory not accessible: ${msg.cwd}`,
    };
    registry.send(client.ws, reply);
    return;
  }

  const cap = config.maxSpawnedSessions;
  if (cap > 0) {
    const ownedCount = sessionManager
      .getAllSessions()
      .filter((s) => s.info.owned).length;
    if (ownedCount >= cap) {
      logger.warn(
        `Rejected SPAWN_SESSION over cap: client=${client.id} owned=${ownedCount} cap=${cap}`
      );
      const reply: ServerMessage = {
        type: 'SPAWN_RESULT',
        requestId: msg.requestId,
        error: `Spawned-session cap reached (${cap}). Close an existing session and try again.`,
      };
      registry.send(client.ws, reply);
      return;
    }
  }

  try {
    const session = await sessionManager.spawnSession(cwd);
    const reply: ServerMessage = {
      type: 'SPAWN_RESULT',
      requestId: msg.requestId,
      sessionId: session.id,
    };
    registry.send(client.ws, reply);
    logger.info(
      `Spawn requested by ${client.id} (${client.name}) cwd=${cwd} → session ${session.id}`
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn(`Spawn failed for ${client.id} cwd=${cwd}: ${reason}`);
    const reply: ServerMessage = {
      type: 'SPAWN_RESULT',
      requestId: msg.requestId,
      error: reason,
    };
    registry.send(client.ws, reply);
  }
}
