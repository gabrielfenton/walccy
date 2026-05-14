// ──────────────────────────────────────────────
// transcript-handler — read-only transcript listing for resume picker
// ──────────────────────────────────────────────
//
// Claude Code persists each session as a JSONL transcript at
// `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`. This handler scans
// that directory for a given cwd and returns metadata only (no bodies) so
// the app can present a resume picker without loading megabytes of chat
// history. A small (4KB) head read per file is used to extract a short
// preview of the first user message.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type {
  ListTranscriptsMessage,
  TranscriptEntry,
  TranscriptListMessage,
} from '@walccy/protocol';
import { SessionManager } from './session-manager.js';
import { ClientRegistry, ConnectedClient } from './client-registry.js';
import logger from './logger.js';

const PREVIEW_HEAD_BYTES = 4 * 1024;
const PREVIEW_MAX_CHARS = 80;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface TranscriptHandlerDeps {
  sessionManager: SessionManager;
  registry: ClientRegistry;
}

function encodeCwdForClaudeProjects(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

function transcriptDirFor(cwd: string): string {
  return path.join(
    os.homedir(),
    '.claude',
    'projects',
    encodeCwdForClaudeProjects(cwd),
  );
}

function sendError(
  registry: ClientRegistry,
  client: ConnectedClient,
  msg: ListTranscriptsMessage,
  reason: string,
): void {
  const reply: TranscriptListMessage = {
    type: 'TRANSCRIPT_LIST',
    requestId: msg.requestId,
    cwd: msg.cwd,
    dir: '',
    entries: [],
    error: reason,
  };
  registry.send(client.ws, reply);
}

function extractFirstUserMessagePreview(head: string): string | null {
  // Transcripts are line-delimited JSON. Walk lines until we find a user
  // message; tolerate the head-read landing mid-line for the final entry.
  const lines = head.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const p = parsed as Record<string, unknown>;
    // Two shapes have appeared in the wild: top-level `{type:'user', message:{content:...}}`
    // and bare `{type:'user', content:...}`. Handle both.
    if (p.type !== 'user') continue;
    let content: unknown = undefined;
    const inner = p.message;
    if (inner && typeof inner === 'object' && inner !== null) {
      content = (inner as Record<string, unknown>).content;
    }
    if (content === undefined) {
      content = p.content;
    }
    const text = stringifyContent(content);
    if (text === null) continue;
    const trimmed = text.trim();
    if (trimmed.length === 0) continue;
    return trimmed.length > PREVIEW_MAX_CHARS
      ? trimmed.slice(0, PREVIEW_MAX_CHARS - 1) + '…'
      : trimmed;
  }
  return null;
}

function stringifyContent(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === 'string') {
      parts.push(part);
    } else if (part && typeof part === 'object') {
      const obj = part as Record<string, unknown>;
      if (obj.type === 'text' && typeof obj.text === 'string') {
        parts.push(obj.text);
      }
    }
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

async function readEntry(
  dir: string,
  filename: string,
  liveIds: Set<string>,
): Promise<TranscriptEntry | null> {
  const sessionId = filename.replace(/\.jsonl$/, '');
  const fullPath = path.join(dir, filename);
  let stat;
  try {
    stat = await fs.stat(fullPath);
  } catch {
    return null;
  }
  let preview: string | null = null;
  let messageCount = 0;
  try {
    const handle = await fs.open(fullPath, 'r');
    try {
      const len = Math.min(stat.size, PREVIEW_HEAD_BYTES);
      const buf = Buffer.alloc(len);
      await handle.read(buf, 0, len, 0);
      preview = extractFirstUserMessagePreview(buf.toString('utf8'));
    } finally {
      await handle.close();
    }
    // Cheap line-count proxy for message count: count newlines in the file.
    // Stream rather than slurp; small enough on disk to be fast.
    messageCount = await countLines(fullPath);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    logger.debug?.(`transcript head read failed for ${filename}: ${e.message}`);
  }
  return {
    sessionId,
    modifiedAt: stat.mtimeMs,
    sizeBytes: stat.size,
    preview,
    messageCount,
    isLive: liveIds.has(sessionId),
  };
}

async function countLines(file: string): Promise<number> {
  const handle = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(64 * 1024);
    let count = 0;
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buf, 0, buf.length, position);
      if (bytesRead === 0) break;
      for (let i = 0; i < bytesRead; i++) {
        if (buf[i] === 0x0a) count++;
      }
      position += bytesRead;
    }
    return count;
  } finally {
    await handle.close();
  }
}

export async function handleListTranscripts(
  client: ConnectedClient,
  msg: ListTranscriptsMessage,
  deps: TranscriptHandlerDeps,
): Promise<void> {
  if (typeof msg.cwd !== 'string' || msg.cwd.length === 0) {
    sendError(deps.registry, client, msg, 'INVALID_CWD');
    return;
  }
  const dir = transcriptDirFor(msg.cwd);
  const limit = Math.min(
    Math.max(msg.limit ?? DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );

  let names: string[];
  try {
    const ents = await fs.readdir(dir, { withFileTypes: true });
    names = ents
      .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
      .map((e) => e.name);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') {
      const reply: TranscriptListMessage = {
        type: 'TRANSCRIPT_LIST',
        requestId: msg.requestId,
        cwd: msg.cwd,
        dir,
        entries: [],
      };
      deps.registry.send(client.ws, reply);
      return;
    }
    logger.warn(`transcript listing failed for ${dir}: ${e.message}`);
    sendError(deps.registry, client, msg, `READ_FAILED:${e.code ?? 'EUNKNOWN'}`);
    return;
  }

  const liveIds = new Set(
    deps.sessionManager
      .getAllSessions()
      .map((s) => s.info.id)
      .filter((id): id is string => typeof id === 'string'),
  );

  // Stat all files first so we can sort by mtime cheaply, then only
  // do the (more expensive) head-read + line-count on the top N.
  const stats = await Promise.all(
    names.map(async (name) => {
      try {
        const st = await fs.stat(path.join(dir, name));
        return { name, mtimeMs: st.mtimeMs };
      } catch {
        return null;
      }
    }),
  );
  const sorted = stats
    .filter((s): s is { name: string; mtimeMs: number } => s !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit);

  const entries: TranscriptEntry[] = [];
  for (const s of sorted) {
    const e = await readEntry(dir, s.name, liveIds);
    if (e) entries.push(e);
  }

  const reply: TranscriptListMessage = {
    type: 'TRANSCRIPT_LIST',
    requestId: msg.requestId,
    cwd: msg.cwd,
    dir,
    entries,
  };
  deps.registry.send(client.ws, reply);
}
