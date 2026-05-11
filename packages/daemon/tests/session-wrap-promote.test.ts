import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import type * as net from 'net';
import { Session } from '../src/session.js';
import { SessionManager } from '../src/session-manager.js';
import { TranscriptWatcher } from '../src/transcript-watcher.js';
import * as os from 'os';
import * as path from 'path';

function makeNoOpWatcher(): TranscriptWatcher {
  return new TranscriptWatcher({
    baseDir: path.join(os.tmpdir(), 'walccy-test-' + Math.random()),
    pollIntervalMs: 10_000,
  });
}

describe('Session.promoteToWrap', () => {
  it('transitions a wrap session to a new socket, retiring the old one', async () => {
    const session = new Session(1234, '/tmp', 'x', 100);
    const oldSock = new PassThrough();
    session.attachWrapper(oldSock as unknown as net.Socket);
    expect(session.info.owned).toBe(true);

    // Track exit emissions — should NOT fire across promotion.
    let exits = 0;
    session.on('exit', () => exits++);

    const newSock = new PassThrough();
    const received: string[] = [];
    newSock.on('data', (chunk) => received.push(chunk.toString('utf8')));
    session.promoteToWrap(newSock as unknown as net.Socket);

    // Old socket's 'close' fires asynchronously — flush.
    await new Promise((r) => setImmediate(r));
    expect(exits).toBe(0);
    expect(session.info.owned).toBe(true);

    // Writes go to the NEW socket, not the old (destroyed) one.
    session.write('hi\n');
    await new Promise((r) => setImmediate(r));
    expect(received.join('')).toContain('"type":"INPUT"');
  });
});

describe('SessionManager.createWrappedSession (promotion path)', () => {
  it('promotes an existing attach session for the same pid instead of duplicating', () => {
    const mgr = new SessionManager(100, makeNoOpWatcher());
    const updates: Array<{ id: string; changes: Record<string, unknown> }> = [];
    mgr.on('session-updated', (id, changes) =>
      updates.push({ id, changes: changes as Record<string, unknown> })
    );

    const pid = 90001;
    const attach = mgr.createSession(pid, '/home/u/repo');
    expect(attach.info.owned).toBe(false);
    expect(attach.info.name).toBe('repo');

    const sock = new PassThrough();
    const wrap = mgr.createWrappedSession(
      pid,
      '/home/u/repo',
      undefined,
      sock as unknown as net.Socket
    );

    // Same session id — tab survives.
    expect(wrap.id).toBe(attach.id);
    expect(wrap.info.owned).toBe(true);
    expect(wrap.info.status).toBe('active');
    expect(mgr.getAllSessions()).toHaveLength(1);

    // Broadcast for clients to flip the RO badge off.
    const promote = updates.find(
      (u) => u.id === wrap.id && u.changes['owned'] === true
    );
    expect(promote).toBeDefined();
  });

  it('creates a fresh wrap session when no existing one matches the pid', () => {
    const mgr = new SessionManager(100, makeNoOpWatcher());
    const sock = new PassThrough();
    const wrap = mgr.createWrappedSession(
      90002,
      '/home/u/other',
      undefined,
      sock as unknown as net.Socket
    );
    expect(wrap.info.owned).toBe(true);
    expect(mgr.getAllSessions()).toHaveLength(1);
  });
});
