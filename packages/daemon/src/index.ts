#!/usr/bin/env node
import { Command } from 'commander';
import * as os from 'os';
import * as path from 'path';
import { Daemon } from './daemon.js';
import { loadConfig, getConfigPath } from './config.js';
import { getTailscaleIP } from './tailscale.js';
import {
  installSystemdService,
  uninstallSystemdService,
  getServiceStatus,
} from './installer.js';

// ──────────────────────────────────────────────
// qrcode-terminal lacks type declarations — use require
// ──────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-var-requires
const qrcode = require('qrcode-terminal') as {
  generate(text: string, opts: { small: boolean }, cb: (qr: string) => void): void;
};

// ──────────────────────────────────────────────
// CLI
// ──────────────────────────────────────────────

const program = new Command();

program
  .name('walccy')
  .version('1.0.0')
  .description('Walccy — Claude session daemon');

// ── start ────────────────────────────────────

program
  .command('start')
  .description('Start the Walccy daemon')
  .option('-f, --foreground', 'Run in the foreground (blocks)', false)
  .action(async (opts: { foreground: boolean }) => {
    if (!opts.foreground) {
      console.log(
        'Use --foreground to run in the foreground, or install as a systemd service:\n' +
          '  walccy install-service\n' +
          '  systemctl --user start walccy'
      );
      process.exit(0);
    }

    process.env['WALCCY_FOREGROUND'] = '1';

    const daemon = new Daemon();

    // Graceful shutdown
    const shutdown = async (): Promise<void> => {
      console.log('\nShutting down…');
      await daemon.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => { void shutdown(); });
    process.on('SIGTERM', () => { void shutdown(); });

    try {
      await daemon.start();
    } catch (err) {
      console.error('Failed to start daemon:', err);
      process.exit(1);
    }
  });

// ── stop ─────────────────────────────────────

program
  .command('stop')
  .description('Stop the Walccy daemon (via systemd)')
  .action(async () => {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    try {
      await execFileAsync('systemctl', ['--user', 'stop', 'walccy.service']);
      console.log('Walccy daemon stopped.');
    } catch {
      console.error(
        'Could not stop via systemctl. Is the service installed?\n' +
          'Try: systemctl --user stop walccy'
      );
    }
  });

// ── status ───────────────────────────────────

program
  .command('status')
  .description('Show daemon status')
  .action(async () => {
    const status = await getServiceStatus();
    const config = loadConfig();
    const tailscaleIP = await getTailscaleIP();

    console.log(`Service status : ${status}`);
    console.log(`Config file    : ${getConfigPath()}`);
    console.log(`Port           : ${config.port}`);
    console.log(`Auth secret    : ${config.authSecret.slice(0, 8)}… (truncated)`);
    console.log(`Tailscale IP   : ${tailscaleIP ?? '(not available)'}`);
    console.log(`Dev mode       : ${process.env['WALCCY_DEV_MODE'] === '1' ? 'yes' : 'no'}`);
  });

// ── sessions ─────────────────────────────────

program
  .command('sessions')
  .description('List active sessions as JSON (reads daemon state via WS)')
  .action(async () => {
    const config = loadConfig();
    const { WebSocket } = await import('ws');

    const bindAddr = process.env['WALCCY_DEV_MODE'] === '1'
      ? '127.0.0.1'
      : await getTailscaleIP() ?? '127.0.0.1';

    const ws = new WebSocket(`ws://${bindAddr}:${config.port}`);

    const timeout = setTimeout(() => {
      console.error('Connection timed out');
      ws.close();
      process.exit(1);
    }, 5000);
    timeout.unref();

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'AUTH',
          secret: config.authSecret,
          clientId: 'walccy-cli',
          clientName: 'walccy-cli',
        })
      );
    });

    let authed = false;
    ws.on('message', (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as { type: string; sessions?: unknown[] };
      if (msg.type === 'AUTH_OK') {
        authed = true;
        ws.send(JSON.stringify({ type: 'LIST_SESSIONS' }));
      } else if (msg.type === 'SESSIONS') {
        clearTimeout(timeout);
        console.log(JSON.stringify(msg.sessions, null, 2));
        ws.close();
      } else if (msg.type === 'AUTH_FAIL') {
        clearTimeout(timeout);
        console.error('Auth failed');
        ws.close();
        process.exit(1);
      }
      void authed; // suppress unused warning
    });

    ws.on('error', (err: Error) => {
      clearTimeout(timeout);
      console.error('WebSocket error:', err.message);
      console.error('Is the daemon running? Try: walccy start --foreground');
      process.exit(1);
    });
  });

// ── pair ─────────────────────────────────────

program
  .command('pair')
  .description('Display QR code for mobile pairing')
  .action(async () => {
    const config = loadConfig();
    const tailscaleIP = await getTailscaleIP();
    const hostname = os.hostname();

    const pairingData = {
      v: 1,
      host: tailscaleIP ?? hostname,
      port: config.port,
      secret: config.authSecret,
      label: hostname,
    };

    const pairingJson = JSON.stringify(pairingData);
    console.log('\nWalccy pairing QR code:');
    console.log('Scan with the Walccy mobile app\n');

    qrcode.generate(pairingJson, { small: true }, (qr: string) => {
      console.log(qr);
    });

    console.log('\nPairing data:');
    console.log(JSON.stringify(pairingData, null, 2));

    if (!tailscaleIP) {
      console.warn('\nWarning: Tailscale not detected. The host field may not be reachable.');
    }
  });

// ── config ───────────────────────────────────

program
  .command('config')
  .description('Show current configuration')
  .action(() => {
    const config = loadConfig();
    const configPath = getConfigPath();
    console.log(`Config file: ${configPath}\n`);
    console.log(JSON.stringify(config, null, 2));
  });

// ── init ─────────────────────────────────────

program
  .command('init')
  .description('Initialize configuration (generates auth secret if missing)')
  .action(() => {
    const config = loadConfig(); // auto-generates secret if missing
    const configPath = getConfigPath();
    console.log(`Config initialized at: ${configPath}`);
    console.log(`Auth secret: ${config.authSecret}`);
    console.log('\nRun `walccy pair` to get the QR code for mobile pairing.');
  });

// ── install-service ───────────────────────────

program
  .command('install-service')
  .description('Install Walccy as a systemd user service')
  .action(async () => {
    try {
      await installSystemdService();
    } catch (err) {
      console.error('Failed to install service:', err);
      process.exit(1);
    }
  });

// ── uninstall ─────────────────────────────────

program
  .command('uninstall')
  .description('Uninstall Walccy service and remove config')
  .action(async () => {
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(
      'This will stop and remove the Walccy service. Continue? [y/N] ',
      async (answer: string) => {
        rl.close();
        if (answer.toLowerCase() !== 'y') {
          console.log('Aborted.');
          return;
        }

        try {
          await uninstallSystemdService();

          // Remove config dir
          const configPath = getConfigPath();
          const configDir = path.dirname(configPath);
          const fs = await import('fs');
          if (fs.existsSync(configDir)) {
            fs.rmSync(configDir, { recursive: true, force: true });
            console.log(`Removed config directory: ${configDir}`);
          }

          // Remove log dir
          const logDir = path.join(os.homedir(), '.walccy');
          if (fs.existsSync(logDir)) {
            fs.rmSync(logDir, { recursive: true, force: true });
            console.log(`Removed log directory: ${logDir}`);
          }

          console.log('Walccy uninstalled successfully.');
        } catch (err) {
          console.error('Uninstall error:', err);
          process.exit(1);
        }
      }
    );
  });

// ── register-session / unregister-session ─────
// Used by shell integration (shell-integration.sh)

program
  .command('register-session')
  .description('Register a shell session with the daemon (used by shell integration)')
  .option('--cwd <path>', 'Working directory')
  .option('--pid <pid>', 'Shell PID')
  .action((opts: { cwd?: string; pid?: string }) => {
    // Best-effort: notify daemon about a new session via env/file marker
    // In v1 the process scanner handles discovery; this is a no-op stub
    // that can be expanded in Phase 2.
    const cwd = opts.cwd ?? process.cwd();
    const pid = opts.pid ?? String(process.pid);
    process.stdout.write(`[walccy] session registered: pid=${pid} cwd=${cwd}\n`);
  });

program
  .command('unregister-session')
  .description('Unregister a shell session (used by shell integration)')
  .option('--pid <pid>', 'Shell PID')
  .action((opts: { pid?: string }) => {
    const pid = opts.pid ?? String(process.pid);
    process.stdout.write(`[walccy] session unregistered: pid=${pid}\n`);
  });

// ──────────────────────────────────────────────
// Run
// ──────────────────────────────────────────────

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
