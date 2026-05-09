import { describe, it, expect, beforeEach } from 'vitest';
import { PassThrough } from 'node:stream';
import type * as net from 'net';
import { Session } from '../src/session.js';

function makeSession(): { session: Session; sock: PassThrough; received: string[] } {
  const session = new Session(0, '/tmp', 'test', 100);
  const sock = new PassThrough();
  const received: string[] = [];
  sock.on('data', (chunk) => received.push(chunk.toString('utf8')));
  session.attachWrapper(sock as unknown as net.Socket);
  return { session, sock, received };
}

describe('Session.write (wrap mode)', () => {
  let ctx: ReturnType<typeof makeSession>;

  beforeEach(() => {
    ctx = makeSession();
  });

  it('writes a single NDJSON INPUT line to the wrapper socket', async () => {
    ctx.session.write('hello\n', 'client-id');
    // Allow microtask flush for PassThrough
    await new Promise((r) => setImmediate(r));

    const joined = ctx.received.join('');
    expect(joined.endsWith('\n')).toBe(true);

    const line = joined.trimEnd();
    const msg = JSON.parse(line);
    expect(msg.type).toBe('INPUT');
    expect(msg.data).toBe(Buffer.from('hello\n', 'utf8').toString('base64'));
  });

  it('does NOT push an input-line into the session buffer (dedup fix)', async () => {
    expect(ctx.session.buffer.size).toBe(0);
    ctx.session.write('hello\n', 'client-id');
    await new Promise((r) => setImmediate(r));
    expect(ctx.session.buffer.size).toBe(0);
  });

  it('returns nothing but updates lastActivityAt', async () => {
    const before = ctx.session.info.lastActivityAt;
    // Force a measurable gap
    await new Promise((r) => setTimeout(r, 5));
    const ret = ctx.session.write('x\n', 'cid');
    expect(ret).toBeUndefined();
    expect(ctx.session.info.lastActivityAt).toBeGreaterThan(before);
  });

  it('truncates payloads larger than MAX_INPUT_LENGTH (64 KB)', async () => {
    const MAX = 64 * 1024;
    const big = 'a'.repeat(MAX + 1000);
    ctx.session.write(big, 'cid');
    await new Promise((r) => setImmediate(r));

    const joined = ctx.received.join('');
    const msg = JSON.parse(joined.trimEnd());
    expect(msg.type).toBe('INPUT');
    const decoded = Buffer.from(msg.data, 'base64').toString('utf8');
    expect(decoded.length).toBe(MAX);
    expect(decoded.length).toBeLessThan(big.length);
  });
});
