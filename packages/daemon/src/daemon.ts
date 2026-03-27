import { loadConfig } from './config.js';
import type { WalccyConfig } from './config.js';
import { SessionManager } from './session-manager.js';
import { ProcessScanner } from './process-scanner.js';
import { WsServer } from './ws-server.js';
import { waitForTailscale } from './tailscale.js';
import logger, { setLogLevel } from './logger.js';

export class Daemon {
  private config!: WalccyConfig;
  private sessionManager!: SessionManager;
  private processScanner!: ProcessScanner;
  private wsServer!: WsServer;

  async start(): Promise<void> {
    // 1. Load config
    this.config = loadConfig();
    setLogLevel(this.config.logLevel);

    logger.info('Walccy daemon starting…');

    // 2. Resolve bind address
    let bindAddress: string;
    if (process.env['WALCCY_DEV_MODE'] === '1') {
      bindAddress = '127.0.0.1';
      logger.info('Dev mode: binding to 127.0.0.1');
    } else {
      logger.info('Waiting for Tailscale IP…');
      bindAddress = await waitForTailscale();
    }

    // 3. Initialize subsystems
    this.sessionManager = new SessionManager(this.config.maxBufferLines);
    this.processScanner = new ProcessScanner();
    this.wsServer = new WsServer(this.sessionManager, this.config, bindAddress);

    // 4. Wire process scanner → session manager
    this.processScanner.on('process-found', async (pid: number, cwd: string) => {
      // Skip if already tracked
      if (this.sessionManager.getSessionByPid(pid)) return;

      const session = this.sessionManager.createSession(pid, cwd);
      // Attempt to attach (read-only monitor)
      try {
        await session.attach();
      } catch (err) {
        logger.warn(`Failed to attach to pid=${pid}: ${String(err)}`);
      }
    });

    this.processScanner.on('process-lost', (pid: number) => {
      const session = this.sessionManager.getSessionByPid(pid);
      if (session) {
        this.sessionManager.removeSession(session.id);
      }
    });

    // 5. Start WS server
    await this.wsServer.start();

    // 6. Start process scanner (if auto-detect enabled)
    if (this.config.autoDetect) {
      this.processScanner.start(this.config.autoDetectInterval);
    }

    logger.info(
      `Walccy daemon started on ws://${bindAddress}:${this.config.port}`
    );
  }

  async stop(): Promise<void> {
    logger.info('Walccy daemon stopping…');
    this.processScanner?.stop();
    this.wsServer?.stop();

    // Remove all sessions
    for (const session of this.sessionManager?.getAllSessions() ?? []) {
      this.sessionManager.removeSession(session.id);
    }

    logger.info('Walccy daemon stopped');
  }
}
