import { SessionManager } from './session-manager.js';
import { DirectoryScanner } from './directory-scanner.js';
import { PushService } from './push.js';
import type { WalccyConfig } from './config.js';
import { ClientRegistry } from './client-registry.js';
import { MessageRouter } from './message-router.js';
import { WsTransport } from './ws-transport.js';
import { NotificationDispatcher } from './notification-dispatcher.js';

/**
 * WsServer
 *
 * Thin orchestrator. Composes:
 *   - ClientRegistry          — connected clients + input locks + fan-out
 *   - DirectoryScanner        — directory listing + cwd validation
 *   - MessageRouter           — wire-message dispatch table
 *   - WsTransport             — HTTP+WSS lifecycle + per-conn framing
 *   - NotificationDispatcher  — SessionManager events → WS + push
 *
 * Public API (`new WsServer(...)`, `start()`, `stop()`) is unchanged so
 * Daemon construction is identical.
 */
export class WsServer {
  private readonly registry: ClientRegistry;
  private readonly transport: WsTransport;
  private readonly notifications: NotificationDispatcher;

  constructor(
    sessionManager: SessionManager,
    config: WalccyConfig,
    bindAddress: string,
    pushService?: PushService
  ) {
    this.registry = new ClientRegistry(sessionManager, pushService);

    const directoryScanner = new DirectoryScanner();
    const router = new MessageRouter({
      sessionManager,
      config,
      registry: this.registry,
      directoryScanner,
      pushService,
    });

    this.transport = new WsTransport(config, bindAddress, this.registry, router);
    this.notifications = new NotificationDispatcher(
      sessionManager,
      this.registry,
      pushService
    );
  }

  async start(): Promise<void> {
    await this.transport.start();
    this.notifications.start();
  }

  stop(): void {
    this.transport.stop();
  }
}
