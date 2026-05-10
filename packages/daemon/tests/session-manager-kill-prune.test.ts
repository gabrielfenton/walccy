import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from '../src/session-manager.js';

describe('SessionManager.killSession', () => {
  let mgr: SessionManager;
  let removed: string[];

  beforeEach(() => {
    mgr = new SessionManager(100);
    removed = [];
    mgr.on('session-removed', (id) => removed.push(id));
  });

  it('returns false for an unknown id and emits nothing', () => {
    expect(mgr.killSession('nope')).toBe(false);
    expect(removed).toEqual([]);
  });

  it('removes the session and emits session-removed for a known id', () => {
    // pid=0 so killSession's process.kill branch is skipped — we're only
    // exercising the remove path here.
    const s = mgr.createSession(0, '/tmp');
    expect(mgr.killSession(s.id)).toBe(true);
    expect(removed).toEqual([s.id]);
    expect(mgr.getSession(s.id)).toBeUndefined();
  });

  it('attempts SIGTERM on the recorded pid and swallows ESRCH', () => {
    const spy = vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = new Error('No such process') as NodeJS.ErrnoException;
      err.code = 'ESRCH';
      throw err;
    });
    const s = mgr.createSession(987654321, '/tmp');
    expect(mgr.killSession(s.id)).toBe(true);
    expect(spy).toHaveBeenCalledWith(987654321, 'SIGTERM');
    expect(removed).toEqual([s.id]);
    spy.mockRestore();
  });
});

describe('SessionManager._pruneOnce (idle attach prune)', () => {
  let mgr: SessionManager;
  let removed: string[];

  beforeEach(() => {
    mgr = new SessionManager(100);
    removed = [];
    mgr.on('session-removed', (id) => removed.push(id));
  });

  afterEach(() => {
    mgr.stopIdlePrune();
  });

  it('prunes attach-mode sessions older than idleMs with no clients', () => {
    const s = mgr.createSession(0, '/tmp');
    // createSession leaves session in pre-init mode (not 'spawn'/'wrap'),
    // so .info.owned === false → it counts as attach for prune purposes.
    expect(s.info.owned).toBe(false);

    // Force lastActivityAt deep into the past via the underlying field.
    // The Session's _info is private; we exploit the fact that createSession
    // set lastActivityAt to Date.now(). Advance fake time instead.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 10_000);

    const n = mgr._pruneOnce(5_000);
    expect(n).toBe(1);
    expect(removed).toEqual([s.id]);
    vi.useRealTimers();
  });

  it('does not prune sessions with connected clients', () => {
    const s = mgr.createSession(0, '/tmp');
    mgr.addClientToSession(s.id, 'client-a');

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 10_000);

    const n = mgr._pruneOnce(5_000);
    expect(n).toBe(0);
    expect(removed).toEqual([]);
    vi.useRealTimers();
  });

  it('does not prune recently-active sessions', () => {
    const s = mgr.createSession(0, '/tmp');
    void s;
    const n = mgr._pruneOnce(60_000); // idleMs much larger than age
    expect(n).toBe(0);
    expect(removed).toEqual([]);
  });
});
