// ──────────────────────────────────────────────
// Walccy — `walccy wrap <cmd>` CLI
//
// Spawns the wrapped command (default: `claude`) inside a node-pty,
// forwards the user's terminal stdin/stdout to the PTY, and tees
// the PTY output to the daemon over a Unix socket.  Mobile-side
// input arrives back over the same socket and is fed into the PTY.
// ──────────────────────────────────────────────

import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { getWrapSocketPath } from './wrap-server.js';
import { WRAPPED_ENV_VAR } from './shell-installer.js';

/**
 * Resolve `cmd` against PATH (or as a literal path if it contains `/`).
 * pty.spawn does NOT throw for a missing binary — its helper fails async
 * with exit=1, which gives a confusing "execvp(3) failed" line and no
 * actionable message — so we probe up front.
 */
export function findInPath(cmd: string): string | null {
  if (cmd.includes('/')) {
    try {
      fs.accessSync(cmd, fs.constants.X_OK);
      return cmd;
    } catch {
      return null;
    }
  }
  const PATH = process.env['PATH'] ?? '';
  for (const dir of PATH.split(':')) {
    if (!dir) continue;
    const full = path.join(dir, cmd);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      return full;
    } catch {
      // keep searching
    }
  }
  return null;
}

interface DaemonToWrapper {
  type: 'REGISTERED' | 'INPUT' | 'RESIZE';
  sessionId?: string;
  data?: string; // base64
  cols?: number;
  rows?: number;
}

export async function runWrapper(argv: string[]): Promise<never> {
  if (argv.length === 0) argv = ['claude'];

  const cmd = argv[0]!;
  const args = argv.slice(1);

  // Single TTY restorer wired to every exit path so a crash mid-setup
  // can't leave the user's shell stuck in raw mode.
  const restoreTty = () => {
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        // already non-tty / already restored
      }
    }
  };
  process.on('exit', restoreTty);
  process.on('uncaughtException', (err) => {
    restoreTty();
    console.error(err);
    process.exit(1);
  });
  process.on('SIGINT', () => {
    restoreTty();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    restoreTty();
    process.exit(143);
  });

  if (!findInPath(cmd)) {
    process.stderr.write(`walccy: command not found: ${cmd}\n`);
    process.exit(127);
  }

  // Lazy require so importing this module doesn't drag node-pty into the
  // daemon's hot path unless the wrap subcommand is actually used.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pty = require('node-pty') as typeof import('node-pty');

  const cols = process.stdout.columns ?? 80;
  const rows = process.stdout.rows ?? 24;

  let term: import('node-pty').IPty;
  try {
    term = pty.spawn(cmd, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: process.cwd(),
      env: {
        ...(process.env as Record<string, string>),
        [WRAPPED_ENV_VAR]: '1',
      },
    });
  } catch (err) {
    restoreTty();
    const e = err as NodeJS.ErrnoException;
    if (e && e.code === 'ENOENT') {
      process.stderr.write(`walccy: command not found: ${cmd}\n`);
    } else {
      const msg = (e && e.message) || String(err);
      process.stderr.write(`walccy: failed to spawn ${cmd}: ${msg}\n`);
    }
    process.exit(127);
  }

  const socket = net.createConnection(getWrapSocketPath());

  // ── Wrapper → daemon: REGISTER on connect, then OUTPUT as PTY produces it
  socket.once('connect', () => {
    socket.write(
      JSON.stringify({
        type: 'REGISTER',
        pid: term.pid,
        cwd: process.cwd(),
        name: path.basename(process.cwd()) || process.cwd(),
        cols,
        rows,
      }) + '\n'
    );
  });

  let socketReady = false;
  socket.on('data', (chunk) => {
    let buffer = chunk.toString('utf8');
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg: DaemonToWrapper;
      try {
        msg = JSON.parse(line) as DaemonToWrapper;
      } catch {
        continue;
      }
      if (msg.type === 'REGISTERED') {
        socketReady = true;
      } else if (msg.type === 'INPUT' && msg.data) {
        const data = Buffer.from(msg.data, 'base64').toString('utf8');
        term.write(data);
      } else if (msg.type === 'RESIZE' && msg.cols && msg.rows) {
        try {
          term.resize(msg.cols, msg.rows);
        } catch {
          // PTY already gone
        }
      }
    }
  });

  socket.on('error', (err) => {
    socketReady = false;
    process.stderr.write(`\n[walccy] daemon socket error: ${err.message} (continuing without mirror)\n`);
  });
  socket.on('close', () => {
    socketReady = false;
  });

  // ── PTY → user terminal AND daemon (with backpressure-aware mirror)
  // Local stdout is never throttled; only the daemon mirror gets dropped
  // when the kernel buffer is saturated, to keep wrapper RSS bounded.
  const MAX_PENDING_BYTES = 1 * 1024 * 1024; // 1 MB
  let pendingBytes = 0;
  let warnedDropping = false;
  socket.on('drain', () => {
    pendingBytes = 0;
    warnedDropping = false;
  });

  term.onData((data: string) => {
    process.stdout.write(data);
    if (socketReady) {
      if (pendingBytes > MAX_PENDING_BYTES) {
        if (!warnedDropping) {
          warnedDropping = true;
          process.stderr.write('\n[walccy] mirror dropping frames (daemon stalled)\n');
        }
        return;
      }
      const payload =
        JSON.stringify({
          type: 'OUTPUT',
          data: Buffer.from(data, 'utf8').toString('base64'),
        }) + '\n';
      const flushed = socket.write(payload);
      if (!flushed) {
        pendingBytes += Buffer.byteLength(payload);
      }
    }
  });

  // ── User terminal stdin → PTY
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.on('data', (b: Buffer) => {
    term.write(b.toString('utf8'));
  });

  // ── Window resize → resize PTY (and notify daemon implicitly via output reflow)
  process.on('SIGWINCH', () => {
    const c = process.stdout.columns ?? 80;
    const r = process.stdout.rows ?? 24;
    try {
      term.resize(c, r);
    } catch {
      // PTY gone
    }
  });

  // ── PTY exit → restore stdin, tell daemon, exit with same code
  await new Promise<void>((resolve) => {
    term.onExit(({ exitCode }) => {
      if (process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(false);
        } catch {
          // already non-tty
        }
      }
      if (socket.writable) {
        socket.write(JSON.stringify({ type: 'EXIT', exitCode }) + '\n');
        socket.end();
      }
      // Give the socket a tick to flush, then exit.
      setTimeout(() => {
        process.exit(exitCode);
      }, 50);
      resolve();
    });
  });

  // Unreachable — process.exit above.
  return undefined as never;
}
