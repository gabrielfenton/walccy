import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { translate } from '../src/stream-translator.js';
import type { SDKMessage } from '@walccy/protocol';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(
  __dirname,
  '..',
  '..',
  'protocol',
  'fixtures'
);

function readJsonLines(file: string): SDKMessage[] {
  const text = fs.readFileSync(file, 'utf8');
  const out: SDKMessage[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    out.push(JSON.parse(t) as SDKMessage);
  }
  return out;
}

describe('stream-translator — fixture round-trip', () => {
  const files = fs.existsSync(FIXTURES)
    ? fs
        .readdirSync(FIXTURES)
        .filter((f) => f.endsWith('.jsonl'))
        .sort()
    : [];

  if (files.length === 0) {
    it.skip('no fixtures present', () => {
      /* no-op */
    });
    return;
  }

  for (const f of files) {
    it(`translates ${f} without throwing`, () => {
      const msgs = readJsonLines(path.join(FIXTURES, f));
      expect(msgs.length).toBeGreaterThan(0);
      for (const m of msgs) {
        const out = translate(m);
        // Output must be an array of valid SessionEvent objects (or empty).
        expect(Array.isArray(out)).toBe(true);
        for (const ev of out) {
          expect(typeof ev.kind).toBe('string');
        }
      }
    });
  }
});

describe('stream-translator — init event', () => {
  it('maps SDKSystemMessage(init) to SessionEventInit', () => {
    const msg = {
      type: 'system',
      subtype: 'init',
      session_id: 'sess-1',
      uuid: 'u1',
      cwd: '/tmp',
      model: 'claude-opus-4-7',
      tools: ['Bash', 'Read'],
      agents: ['Plan'],
      skills: ['simplify'],
      slash_commands: ['/clear'],
      mcp_servers: [{ name: 'gmail', status: 'needs-auth' }],
      plugins: [],
      permissionMode: 'default',
      output_style: 'default',
      claude_code_version: '2.1.138',
      apiKeySource: 'oauth',
    } as unknown as SDKMessage;
    const events = translate(msg);
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    if (ev.kind !== 'init') throw new Error('expected init');
    expect(ev.sessionId).toBe('sess-1');
    expect(ev.model).toBe('claude-opus-4-7');
    expect(ev.tools).toEqual(['Bash', 'Read']);
    expect(ev.skills).toEqual(['simplify']);
    expect(ev.mcpServers[0]!.name).toBe('gmail');
    expect(ev.permissionMode).toBe('default');
  });
});

describe('stream-translator — assistant tool_use', () => {
  it('extracts tool_use blocks from an assistant message', () => {
    const msg = {
      type: 'assistant',
      session_id: 'sess-1',
      uuid: 'u2',
      parent_tool_use_id: null,
      message: {
        id: 'msg-1',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Running it now.' },
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'Bash',
            input: { command: 'uname -s' },
          },
        ],
      },
    } as unknown as SDKMessage;
    const events = translate(msg);
    expect(events).toHaveLength(2);
    expect(events[0]!.kind).toBe('assistant_text_done');
    expect(events[1]!.kind).toBe('tool_use');
    if (events[1]!.kind !== 'tool_use') throw new Error('unreachable');
    expect(events[1]!.name).toBe('Bash');
    expect(events[1]!.input).toEqual({ command: 'uname -s' });
  });
});

describe('stream-translator — user tool_result', () => {
  it('extracts a tool_result block and lifts structured stdout', () => {
    const msg = {
      type: 'user',
      session_id: 'sess-1',
      uuid: 'u3',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: 'Linux',
            is_error: false,
          },
        ],
      },
      tool_use_result: {
        stdout: 'Linux',
        stderr: '',
        interrupted: false,
        isImage: false,
        noOutputExpected: false,
      },
    } as unknown as SDKMessage;
    const events = translate(msg);
    expect(events).toHaveLength(1);
    if (events[0]!.kind !== 'tool_result') throw new Error('unreachable');
    expect(events[0]!.toolUseId).toBe('toolu_1');
    expect(events[0]!.isError).toBe(false);
    expect(events[0]!.structured?.stdout).toBe('Linux');
    expect(events[0]!.structured?.interrupted).toBe(false);
  });
});

describe('stream-translator — turn_complete cost', () => {
  it('maps result.success to turn_complete with cost', () => {
    const msg = {
      type: 'result',
      subtype: 'success',
      session_id: 'sess-1',
      uuid: 'u4',
      duration_ms: 2169,
      duration_api_ms: 3097,
      is_error: false,
      api_error_status: null,
      num_turns: 1,
      result: 'hi',
      stop_reason: 'end_turn',
      total_cost_usd: 0.05773075,
      usage: {
        input_tokens: 6,
        output_tokens: 6,
        cache_read_input_tokens: 17713,
        cache_creation_input_tokens: 7729,
      },
      modelUsage: {},
      permission_denials: [],
    } as unknown as SDKMessage;
    const events = translate(msg);
    expect(events).toHaveLength(1);
    if (events[0]!.kind !== 'turn_complete') throw new Error('unreachable');
    expect(events[0]!.cost.total).toBeCloseTo(0.05773075, 5);
    expect(events[0]!.cost.inputTokens).toBe(6);
    expect(events[0]!.cost.cacheReadTokens).toBe(17713);
    expect(events[0]!.isError).toBe(false);
    expect(events[0]!.stopReason).toBe('end_turn');
  });
});

describe('stream-translator — stream_event deltas', () => {
  it('translates content_block_delta text_delta to assistant_text_delta', () => {
    const msg = {
      type: 'stream_event',
      session_id: 'sess-1',
      uuid: 'msg-stream-1',
      parent_tool_use_id: null,
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'h' },
      },
    } as unknown as SDKMessage;
    const events = translate(msg);
    expect(events).toHaveLength(1);
    if (events[0]!.kind !== 'assistant_text_delta') {
      throw new Error('unreachable');
    }
    expect(events[0]!.text).toBe('h');
  });

  it('drops content_block_start / message_stop wrappers', () => {
    const msgs = [
      {
        type: 'stream_event',
        event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      },
      { type: 'stream_event', event: { type: 'message_stop' } },
    ];
    for (const m of msgs) {
      const events = translate(m as unknown as SDKMessage);
      expect(events).toEqual([]);
    }
  });
});

describe('stream-translator — rate_limit_event', () => {
  it('maps rate_limit_info verbatim', () => {
    const msg = {
      type: 'rate_limit_event',
      session_id: 'sess-1',
      uuid: 'rl-1',
      rate_limit_info: {
        status: 'allowed',
        resetsAt: 1778490000,
        rateLimitType: 'five_hour',
        overageStatus: 'rejected',
        isUsingOverage: false,
      },
    } as unknown as SDKMessage;
    const events = translate(msg);
    expect(events).toHaveLength(1);
    if (events[0]!.kind !== 'rate_limit') throw new Error('unreachable');
    expect(events[0]!.info.status).toBe('allowed');
    expect(events[0]!.info.rateLimitType).toBe('five_hour');
    expect(events[0]!.info.isUsingOverage).toBe(false);
  });
});
