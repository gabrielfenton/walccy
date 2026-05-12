import { loadConfig } from './config.js';
import type { WalccyConfig } from './config.js';
import { SessionManager } from './session-manager.js';
import { WsServer } from './ws-server.js';
import { PushService } from './push.js';
import { waitForTailscale } from './tailscale.js';
import logger, { setLogLevel } from './logger.js';

export class Daemon {
  private config!: WalccyConfig;
  private sessionManager!: SessionManager;
  private wsServer!: WsServer;

  async start(): Promise<void> {
    this.config = loadConfig();
    setLogLevel(this.config.logLevel);

    logger.info('Walccy daemon starting…');

    let bindAddress: string;
    if (process.env['WALCCY_DEV_MODE'] === '1') {
      bindAddress = '127.0.0.1';
      logger.info('Dev mode: binding to 127.0.0.1');
    } else {
      logger.info('Waiting for Tailscale IP…');
      bindAddress = await waitForTailscale();
    }

    this.sessionManager = new SessionManager(this.config.maxBufferLines);
    const pushService = new PushService();
    this.wsServer = new WsServer(
      this.sessionManager,
      this.config,
      bindAddress,
      pushService
    );

    await this.wsServer.start();

    if (this.config.attachIdlePruneMs > 0) {
      this.sessionManager.startIdlePrune(this.config.attachIdlePruneMs);
    }

    logger.info(
      `Walccy daemon started on ws://${bindAddress}:${this.config.port}`
    );
  }

  async stop(): Promise<void> {
    logger.info('Walccy daemon stopping…');
    this.sessionManager?.stopIdlePrune();
    this.sessionManager?.stopTranscriptWatcher();
    this.wsServer?.stop();

    for (const session of this.sessionManager?.getAllSessions() ?? []) {
      this.sessionManager.removeSession(session.id);
    }

    logger.info('Walccy daemon stopped');
  }
}
