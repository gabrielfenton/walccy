import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ServerMessage, SpawnSessionMessage } from '@walccy/protocol';
import { MessageRouter } from '../src/message-router.js';
import { DirectoryScanner } from '../src/directory-scanner.js';
import type { ConnectedClient } from '../src/client-registry.js';

// ──────────────────────────────────────────────
// Test harness
// ──────────────────────────────────────────────

interface FakeClient extends ConnectedClient {}

function makeClient(): FakeClient {
  return {
    id: 'client-1',
    name: 'fake',
    ws: {} as any,
    subscribedSessions: new Set(),
    isAuthenticated: true,
  };
}

function makeRouter(opts: {
  spawnImpl?: (cwd: string) => Promise<any>;
  sent: ServerMessage[];
}): MessageRouter {
  const sessionManager: any = {
    getAllSessions: () => [],
    spawnSession:
      opts.spawnImpl ??
      (async (cwd: string) => ({ id: 'session-' + cwd, info: { cwd, owned: true } })),
    addClientToSession: vi.fn(),
    removeClientFromSession: vi.fn(),
    getSession: vi.fn(),
  };
  const config: any = {
    authSecret: 'x',
    historyOnConnect: 100,
    maxSpawnedSessions: 8,
  };
  const registry: any = {
    send: (_ws: unknown, msg: ServerMessage) => {
      opts.sent.push(msg);
    },
    sendError: (_ws: unknown, code: string, message: string) => {
      opts.sent.push({ type: 'ERROR', code, message } as ServerMessage);
    },
  };
  return new MessageRouter({
    sessionManager,
    config,
    registry,
    directoryScanner: new DirectoryScanner(),
  });
}

// ──────────────────────────────────────────────
// SPAWN_SESSION validation
// ──────────────────────────────────────────────

describe('MessageRouter SPAWN_SESSION', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects when cwd contains NUL byte', () => {
    const sent: ServerMessage[] = [];
    const router = makeRouter({ sent });
    const msg: SpawnSessionMessage = {
      type: 'SPAWN_SESSION',
      cwd: '/tmp\0evil',
      requestId: 'r1',
    };
    router.dispatch(makeClient(), msg);
    // _validateMessage allows NUL (it only checks type/length), so the path
    // continues to resolveAndValidate which rejects NUL → SPAWN_RESULT error.
    const result = sent.find((m) => m.type === 'SPAWN_RESULT' || m.type === 'ERROR');
    expect(result).toBeDefined();
    if (result?.type === 'SPAWN_RESULT') {
      expect(result.error).toBeTruthy();
      expect(result.sessionId).toBeUndefined();
    }
  });

  it('rejects when cwd is outside the home directory', () => {
    const sent: ServerMessage[] = [];
    const router = makeRouter({ sent });
    const msg: SpawnSessionMessage = {
      type: 'SPAWN_SESSION',
      cwd: '/etc',
      requestId: 'r2',
    };
    router.dispatch(makeClient(), msg);
    const result = sent.find((m) => m.type === 'SPAWN_RESULT');
    expect(result).toBeDefined();
    if (result?.type === 'SPAWN_RESULT') {
      expect(result.error).toMatch(/not accessible/i);
      expect(result.sessionId).toBeUndefined();
    }
  });

  it('rejects when cwd does not exist', () => {
    const sent: ServerMessage[] = [];
    const router = makeRouter({ sent });
    const msg: SpawnSessionMessage = {
      type: 'SPAWN_SESSION',
      cwd: path.join(os.homedir(), '__walccy_no_such_dir_' + Date.now()),
      requestId: 'r3',
    };
    router.dispatch(makeClient(), msg);
    const result = sent.find((m) => m.type === 'SPAWN_RESULT');
    expect(result).toBeDefined();
    if (result?.type === 'SPAWN_RESULT') {
      expect(result.error).toBeTruthy();
      expect(result.sessionId).toBeUndefined();
    }
  });

  it('accepts a valid cwd under home and calls spawnSession', async () => {
    const sent: ServerMessage[] = [];
    const tmpDir = fs.mkdtempSync(path.join(os.homedir(), '.walccy-spawn-test-'));
    try {
      const spawnSpy = vi.fn(async (cwd: string) => ({
        id: 'sess-1',
        info: { cwd, owned: true },
      }));
      const router = makeRouter({ sent, spawnImpl: spawnSpy });
      const msg: SpawnSessionMessage = {
        type: 'SPAWN_SESSION',
        cwd: tmpDir,
        requestId: 'r4',
      };
      router.dispatch(makeClient(), msg);
      // Allow the async handler to resolve.
      await new Promise((r) => setTimeout(r, 10));
      expect(spawnSpy).toHaveBeenCalledTimes(1);
      const result = sent.find((m) => m.type === 'SPAWN_RESULT');
      expect(result).toBeDefined();
      if (result?.type === 'SPAWN_RESULT') {
        expect(result.sessionId).toBe('sess-1');
        expect(result.error).toBeUndefined();
      }
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });
});
