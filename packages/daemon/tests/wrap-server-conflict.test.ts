import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { SessionManager } from '../src/session-manager.js';
import { WrapServer } from '../src/wrap-server.js';

// Override socket path for tests by stubbing the homedir env. We can't easily
// override getWrapSocketPath without code changes, so we monkey-patch HOME so
// os.homedir() returns a tmp dir. WrapServer reads it on construction.
let tmpHome: string;
let prevHome: string | undefined;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'walccy-wrap-test-'));
  prevHome = process.env['HOME'];
  process.env['HOME'] = tmpHome;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = prevHome;
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

describe('WrapServer.start — conflict detection', () => {
  it('refuses to start when another listener is already bound', async () => {
    const sm = new SessionManager(100);
    const first = new WrapServer(sm);
    await first.start();

    const second = new WrapServer(sm);
    await expect(second.start()).rejects.toThrow(/already listening/);

    // First listener should still be functional after the failed conflict.
    const sockPath = path.join(tmpHome, '.walccy', 'wrap.sock');
    await new Promise<void>((resolve, reject) => {
      const c = net.createConnection(sockPath);
      c.once('connect', () => {
        c.destroy();
        resolve();
      });
      c.once('error', reject);
    });

    await first.stop();
  });

  it('cleans up a stale socket file (no listener) and starts', async () => {
    const sockDir = path.join(tmpHome, '.walccy');
    fs.mkdirSync(sockDir, { recursive: true, mode: 0o700 });
    const sockPath = path.join(sockDir, 'wrap.sock');
    // Touch a file at the socket path with no listener behind it.
    fs.writeFileSync(sockPath, '');

    const sm = new SessionManager(100);
    const server = new WrapServer(sm);
    await server.start();

    // Connecting now should succeed (the new server is listening).
    await new Promise<void>((resolve, reject) => {
      const c = net.createConnection(sockPath);
      c.once('connect', () => {
        c.destroy();
        resolve();
      });
      c.once('error', reject);
    });

    await server.stop();
  });

  it('starts cleanly when nothing exists at the socket path', async () => {
    const sm = new SessionManager(100);
    const server = new WrapServer(sm);
    await server.start();
    await server.stop();
  });
});
