import { describe, it, expect, vi } from 'vitest';
import type { ServerMessage, SubscribeMessage } from '@walccy/protocol';
import { MessageRouter } from '../src/message-router.js';
import { DirectoryScanner } from '../src/directory-scanner.js';
import { LineBuffer } from '../src/buffer.js';
import type { ConnectedClient } from '../src/client-registry.js';

// ──────────────────────────────────────────────
// Harness
// ──────────────────────────────────────────────

function makeClient(): ConnectedClient {
  return {
    id: 'client-1',
    name: 'fake',
    ws: {} as any,
    subscribedSessions: new Set(),
    isAuthenticated: true,
  };
}

function makeRouterWithBufferLines(count: number): {
  router: MessageRouter;
  sent: ServerMessage[];
  buffer: LineBuffer;
} {
  const buffer = new LineBuffer(100);
  for (let i = 0; i < count; i++) {
    buffer.push({
      rawContent: `line ${i}`,
      content: `line ${i}`,
      timestamp: Date.now(),
      source: 'stdout',
    });
  }
  const fakeSession = { id: 'sess', buffer, info: { id: 'sess', cwd: '/' } };
  const sessionManager: any = {
    getAllSessions: () => [fakeSession],
    getSession: (id: string) => (id === 'sess' ? fakeSession : undefined),
    addClientToSession: vi.fn(),
    removeClientFromSession: vi.fn(),
    spawnSession: vi.fn(),
  };
  const config: any = {
    authSecret: 'x',
    historyOnConnect: 500,
    maxSpawnedSessions: 8,
  };
  const sent: ServerMessage[] = [];
  const registry: any = {
    send: (_ws: unknown, m: ServerMessage) => sent.push(m),
    sendError: (_ws: unknown, code: string, message: string) => {
      sent.push({ type: 'ERROR', code, message } as ServerMessage);
    },
    addSubscription: vi.fn(),
    removeSubscription: vi.fn(),
  };
  const router = new MessageRouter({
    sessionManager,
    config,
    registry,
    directoryScanner: new DirectoryScanner(),
  });
  return { router, sent, buffer };
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('MessageRouter SUBSCRIBE / RESUME', () => {
  it('replies with HISTORY when fromLine is omitted', () => {
    const { router, sent } = makeRouterWithBufferLines(5);
    const msg: SubscribeMessage = {
      type: 'SUBSCRIBE',
      sessionId: 'sess',
    };
    router.dispatch(makeClient(), msg);
    const reply = sent.find((m) => m.type === 'HISTORY' || m.type === 'RESUME');
    expect(reply).toBeDefined();
    expect(reply?.type).toBe('HISTORY');
    if (reply?.type === 'HISTORY') {
      expect(reply.lines).toHaveLength(5);
      expect(reply.totalLines).toBe(5);
      expect(typeof reply.firstAvailableLine).toBe('number');
    }
  });

  it('replies with RESUME when fromLine is provided', () => {
    const { router, sent } = makeRouterWithBufferLines(5);
    const msg: SubscribeMessage = {
      type: 'SUBSCRIBE',
      sessionId: 'sess',
      fromLine: 2,
    };
    router.dispatch(makeClient(), msg);
    const reply = sent.find((m) => m.type === 'HISTORY' || m.type === 'RESUME');
    expect(reply).toBeDefined();
    expect(reply?.type).toBe('RESUME');
    if (reply?.type === 'RESUME') {
      expect(reply.sessionId).toBe('sess');
      expect(reply.totalLines).toBe(5);
      expect(reply.lines.length).toBeGreaterThan(0);
      expect(reply.lines.every((l) => l.index >= 2)).toBe(true);
      expect(reply.lines.map((l) => l.index)).toEqual([2, 3, 4]);
    }
  });

  it('RESUME with fromLine beyond tail returns empty lines', () => {
    const { router, sent } = makeRouterWithBufferLines(5);
    const msg: SubscribeMessage = {
      type: 'SUBSCRIBE',
      sessionId: 'sess',
      fromLine: 100,
    };
    router.dispatch(makeClient(), msg);
    const reply = sent.find((m) => m.type === 'RESUME');
    expect(reply).toBeDefined();
    if (reply?.type === 'RESUME') {
      expect(reply.lines).toEqual([]);
      expect(reply.totalLines).toBe(5);
    }
  });
});
