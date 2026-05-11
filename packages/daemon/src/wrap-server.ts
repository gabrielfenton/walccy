// ──────────────────────────────────────────────
// Walccy — Wrapper IPC server
//
// Hosts a Unix-domain socket that `walccy wrap <cmd>` connects to.
// Each connection registers a wrapped session (the wrapper owns the
// PTY in its own process; we mirror its output and forward keyboard
// input that arrives from mobile clients).
// ──────────────────────────────────────────────

import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import type { SessionManager } from './session-manager.js';
import type { Session } from './session.js';
import logger from './logger.js';

export function getWrapSocketPath(): string {
  return path.join(os.homedir(), '.walccy', 'wrap.sock');
}

interface RegisterMsg {
  type: 'REGISTER';
  pid: number;
  cwd: string;
  name?: string;
  cols: number;
  rows: number;
}

interface OutputMsg {
  type: 'OUTPUT';
  data: string; // base64
}

interface ExitMsg {
  type: 'EXIT';
  exitCode: number;
}

type WrapperToDaemon = RegisterMsg | OutputMsg | ExitMsg;

export class WrapServer {
  private server: net.Server | null = null;
  private socketPath: string;

  constructor(private readonly sessionManager: SessionManager) {
    this.socketPath = getWrapSocketPath();
  }

  async start(): Promise<void> {
    const dir = path.dirname(this.socketPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Defensive: tighten an existing-but-loose dir (logger may have created it
    // first under default umask, leaving 0775 readable by group/other).
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      // best effort
    }

    // Probe before unlinking: if another daemon is already listening on this
    // socket, ripping the file out from under it would leave both daemons in
    // a broken state (the original keeps its FD on a now-unlinked inode, so
    // new clients get ENOENT). Only unlink when the socket is demonstrably
    // stale (ECONNREFUSED = no listener) or already gone (ENOENT).
    const probeErr = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
      const probe = net.createConnection(this.socketPath);
      probe.once('connect', () => {
        probe.destroy();
        resolve(null);
      });
      probe.once('error', (err) => {
        probe.destroy();
        resolve(err as NodeJS.ErrnoException);
      });
    });

    if (probeErr === null) {
      throw new Error(
        `wrap: another daemon is already listening on ${this.socketPath} — refusing to start`
      );
    }

    if (probeErr.code !== 'ENOENT') {
      try {
        fs.unlinkSync(this.socketPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.warn(`wrap: failed to remove stale socket: ${(err as Error).message}`);
        }
      }
    }

    this.server = net.createServer((socket) => this.handleConnection(socket));

    await new Promise<void>((resolve, reject) => {
      if (!this.server) return reject(new Error('server not initialized'));
      this.server.once('error', reject);
      this.server.listen(this.socketPath, () => {
        fs.chmodSync(this.socketPath, 0o600);
        resolve();
      });
    });

    logger.info(`Wrap IPC listening on ${this.socketPath}`);
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    if (fs.existsSync(this.socketPath)) {
      try {
        fs.unlinkSync(this.socketPath);
      } catch {
        // already gone
      }
    }
    this.server = null;
  }

  private handleConnection(socket: net.Socket): void {
    let session: Session | null = null;
    let buffer = '';

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line) continue;

        let msg: WrapperToDaemon;
        try {
          msg = JSON.parse(line) as WrapperToDaemon;
        } catch {
          logger.warn(`wrap: malformed JSON from wrapper: ${line.slice(0, 120)}`);
          continue;
        }

        if (msg.type === 'REGISTER') {
          if (session) {
            logger.warn('wrap: REGISTER received twice on the same socket');
            continue;
          }
          session = this.sessionManager.createWrappedSession(
            msg.pid,
            msg.cwd,
            msg.name,
            socket
          );
          // Acknowledge so the wrapper knows registration succeeded.
          socket.write(JSON.stringify({ type: 'REGISTERED', sessionId: session.id }) + '\n');
        } else if (msg.type === 'OUTPUT') {
          if (!session) {
            logger.warn('wrap: OUTPUT before REGISTER, dropping');
            continue;
          }
          const data = Buffer.from(msg.data, 'base64').toString('utf8');
          session.pushExternalData(data);
        } else if (msg.type === 'EXIT') {
          // Wrapper announcing clean exit; close the session.
          if (session) this.sessionManager.removeSession(session.id);
          session = null;
          socket.end();
        }
      }
    });

    socket.on('close', () => {
      if (session && this.sessionManager.getSession(session.id)) {
        this.sessionManager.removeSession(session.id);
      }
      session = null;
    });

    socket.on('error', (err) => {
      logger.warn(`wrap: socket error: ${err.message}`);
    });
  }
}
