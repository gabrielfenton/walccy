import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import logger from './logger.js';

// ──────────────────────────────────────────────
// Typed event emitter interface
// ──────────────────────────────────────────────

interface ProcessScannerEvents {
  'process-found': (pid: number, cwd: string) => void;
  'process-lost': (pid: number) => void;
}

export class ProcessScanner extends EventEmitter {
  private interval: NodeJS.Timeout | null = null;
  private knownPids: Set<number> = new Set();

  // ────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────

  start(intervalMs = 3000): void {
    if (this.interval) return;
    // Run an immediate first scan, then schedule
    this.scan().catch((err: unknown) => {
      logger.error(`ProcessScanner initial scan error: ${String(err)}`);
    });
    this.interval = setInterval(() => {
      this.scan().catch((err: unknown) => {
        logger.error(`ProcessScanner scan error: ${String(err)}`);
      });
    }, intervalMs);

    // Don't keep process alive solely due to scanner
    this.interval.unref();
    logger.info(`ProcessScanner started (interval=${intervalMs}ms)`);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    logger.info('ProcessScanner stopped');
  }

  // ────────────────────────────────────────────
  // Scanning logic
  // ────────────────────────────────────────────

  private async scan(): Promise<void> {
    const currentPids = new Set<number>();

    let entries: string[];
    try {
      entries = await fsp.readdir('/proc');
    } catch (err) {
      logger.error(`Cannot read /proc: ${String(err)}`);
      return;
    }

    for (const entry of entries) {
      const pid = parseInt(entry, 10);
      if (isNaN(pid) || pid <= 0) continue;

      const isClaudeProcess = await this.isClaude(pid);
      if (!isClaudeProcess) continue;

      currentPids.add(pid);

      if (!this.knownPids.has(pid)) {
        // New process found
        const cwd = await this.readCwd(pid);
        if (cwd !== null) {
          logger.debug(`ProcessScanner: found claude pid=${pid} cwd=${cwd}`);
          this.knownPids.add(pid);
          this.emit('process-found', pid, cwd);
        }
      }
    }

    // Detect lost processes
    for (const pid of this.knownPids) {
      if (!currentPids.has(pid)) {
        logger.debug(`ProcessScanner: lost claude pid=${pid}`);
        this.knownPids.delete(pid);
        this.emit('process-lost', pid);
      }
    }
  }

  // ────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────

  /**
   * Returns true if the process with `pid` is a `claude` process.
   * Reads /proc/{pid}/cmdline (null-byte separated argv).
   *
   * Only argv[0] (and argv[1] when argv[0] is a JS runtime) are inspected —
   * scanning every argv element causes false positives like `walccy claude`
   * (the wrap-cli wrapper), whose subcommand `claude` would otherwise match
   * and produce a duplicate RO tab alongside the wrapped session.
   */
  private async isClaude(pid: number): Promise<boolean> {
    const cmdlinePath = path.join('/proc', String(pid), 'cmdline');
    try {
      const raw = await fsp.readFile(cmdlinePath, 'utf8');
      const args = raw.split('\0').filter(Boolean);
      return isClaudeProcessArgv(args);
    } catch {
      // Process may have exited or we don't have permission
      return false;
    }
  }

  /**
   * Read the CWD of a process via /proc/{pid}/cwd symlink.
   * Returns null if not readable.
   */
  private async readCwd(pid: number): Promise<string | null> {
    const cwdLink = path.join('/proc', String(pid), 'cwd');
    try {
      return await fsp.readlink(cwdLink);
    } catch {
      return null;
    }
  }

  // Typed overloads
  on(event: 'process-found', listener: (pid: number, cwd: string) => void): this;
  on(event: 'process-lost', listener: (pid: number) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
}

/**
 * Exposed for tests: argv-matching logic used by ProcessScanner.isClaude.
 * Inspects only argv[0] (and argv[1] when argv[0] is a JS runtime) so that
 * subcommands like `walccy claude` don't false-positive as a claude process.
 */
export function isClaudeProcessArgv(args: string[]): boolean {
  if (args.length === 0) return false;
  if (isClaudeArg(args[0])) return true;
  if (isJsRuntime(args[0]) && args.length >= 2 && isClaudeArg(args[1])) {
    return true;
  }
  return false;
}

function isClaudeArg(arg: string): boolean {
  const base = arg.split(/[/\\]/).pop() ?? arg;
  return base === 'claude' || /^claude\.[jt]s$/.test(base);
}

function isJsRuntime(arg: string): boolean {
  const base = arg.split(/[/\\]/).pop() ?? arg;
  return base === 'node' || base === 'bun' || base === 'deno' || base === 'npx';
}

// Satisfy TS unused import check
export type { ProcessScannerEvents };
