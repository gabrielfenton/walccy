// ──────────────────────────────────────────────
// memory-handler — read-only memory viewer endpoint
// ──────────────────────────────────────────────
//
// Claude Code stores per-project memory under
// `~/.claude/projects/<encoded-cwd>/memory/*.md` where the encoding swaps
// every '/' for '-' on the absolute cwd. Surfaces those files to the app
// so users can browse what auto-memory has captured without leaving the
// session view.
//
// Safety: never reads anything outside the project-specific memory dir.
// The session's recorded cwd is the only input used to derive the path.
// Filenames returned to the app are passed through `path.basename` and
// rejected if they don't end with `.md` (defense against any future drift
// in what gets dropped into the memory dir).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type {
  ListMemoryMessage,
  MemoryFileEntry,
  MemoryListMessage,
} from '@walccy/protocol';
import { SessionManager } from './session-manager.js';
import { ClientRegistry, ConnectedClient } from './client-registry.js';
import logger from './logger.js';

const MAX_BODY_BYTES = 256 * 1024; // 256 KB cap per file read

export interface MemoryHandlerDeps {
  sessionManager: SessionManager;
  registry: ClientRegistry;
}

function encodeCwdForClaudeProjects(cwd: string): string {
  // Claude's convention: replace forward slashes with hyphens. The leading
  // slash becomes a leading hyphen.
  return cwd.replace(/\//g, '-');
}

function memoryDirFor(cwd: string): string {
  const encoded = encodeCwdForClaudeProjects(cwd);
  return path.join(os.homedir(), '.claude', 'projects', encoded, 'memory');
}

function sendError(
  registry: ClientRegistry,
  client: ConnectedClient,
  msg: ListMemoryMessage,
  reason: string,
): void {
  const reply: MemoryListMessage = {
    type: 'MEMORY_LIST',
    requestId: msg.requestId,
    sessionId: msg.sessionId,
    dir: '',
    files: [],
    error: reason,
  };
  registry.send(client.ws, reply);
}

export async function handleListMemory(
  client: ConnectedClient,
  msg: ListMemoryMessage,
  deps: MemoryHandlerDeps,
): Promise<void> {
  const session = deps.sessionManager.getSession(msg.sessionId);
  if (!session) {
    sendError(deps.registry, client, msg, 'SESSION_NOT_FOUND');
    return;
  }
  const dir = memoryDirFor(session.info.cwd);

  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') {
      const reply: MemoryListMessage = {
        type: 'MEMORY_LIST',
        requestId: msg.requestId,
        sessionId: msg.sessionId,
        dir,
        files: [],
      };
      deps.registry.send(client.ws, reply);
      return;
    }
    logger.warn(`memory listing failed for ${dir}: ${e.message}`);
    sendError(deps.registry, client, msg, `READ_FAILED:${e.code ?? 'EUNKNOWN'}`);
    return;
  }

  const files: MemoryFileEntry[] = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (!ent.name.endsWith('.md')) continue;
    try {
      const stat = await fs.stat(path.join(dir, ent.name));
      files.push({
        name: ent.name,
        size: stat.size,
        modifiedAt: stat.mtimeMs,
      });
    } catch {
      // Skip files that vanished between readdir and stat.
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name));

  let bodyEntry: MemoryListMessage['file'];
  if (msg.fileName) {
    // Strip path components — never honor `../` or absolute paths.
    const safeName = path.basename(msg.fileName);
    if (!safeName.endsWith('.md')) {
      sendError(deps.registry, client, msg, 'INVALID_FILENAME');
      return;
    }
    if (!files.some((f) => f.name === safeName)) {
      sendError(deps.registry, client, msg, 'FILE_NOT_FOUND');
      return;
    }
    const fullPath = path.join(dir, safeName);
    try {
      const handle = await fs.open(fullPath, 'r');
      try {
        const stat = await handle.stat();
        const len = Math.min(stat.size, MAX_BODY_BYTES);
        const buf = Buffer.alloc(len);
        await handle.read(buf, 0, len, 0);
        bodyEntry = {
          name: safeName,
          content:
            stat.size > MAX_BODY_BYTES
              ? buf.toString('utf8') + '\n\n…(truncated)'
              : buf.toString('utf8'),
        };
      } finally {
        await handle.close();
      }
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      sendError(deps.registry, client, msg, `READ_FAILED:${e.code ?? 'EUNKNOWN'}`);
      return;
    }
  }

  const reply: MemoryListMessage = {
    type: 'MEMORY_LIST',
    requestId: msg.requestId,
    sessionId: msg.sessionId,
    dir,
    files,
    ...(bodyEntry ? { file: bodyEntry } : {}),
  };
  deps.registry.send(client.ws, reply);
}
