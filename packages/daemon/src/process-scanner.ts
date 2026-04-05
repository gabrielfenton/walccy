import { EventEmitter } from 'events';
import * as fs from 'fs';
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
      entries = fs.readdirSync('/proc');
    } catch (err) {
      logger.error(`Cannot read /proc: ${String(err)}`);
      return;
    }

    for (const entry of entries) {
      const pid = parseInt(entry, 10);
      if (isNaN(pid) || pid <= 0) continue;

      const isClaudeProcess = this.isClaude(pid);
      if (!isClaudeProcess) continue;

      currentPids.add(pid);

      if (!this.knownPids.has(pid)) {
        // New process found
        const cwd = this.readCwd(pid);
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
   */
  private isClaude(pid: number): boolean {
    const cmdlinePath = path.join('/proc', String(pid), 'cmdline');
    try {
      const raw = fs.readFileSync(cmdlinePath, 'utf8');
      // cmdline entries are separated by null bytes
      const args = raw.split('\0').filter(Boolean);
      // Match the binary name 'claude' anywhere in args[0] (the executable path)
      // Also check args[1..] in case it's run via node/npx as `node .../claude`
      return args.some((arg) => {
        // Match bare binary name or path ending with /claude or /claude.js etc.
        return (
          arg === 'claude' ||
          /[/\\]claude(?:\.[jt]s)?$/.test(arg) ||
          arg.endsWith('/claude')
        );
      });
    } catch {
      // Process may have exited or we don't have permission
      return false;
    }
  }

  /**
   * Read the CWD of a process via /proc/{pid}/cwd symlink.
   * Returns null if not readable.
   */
  private readCwd(pid: number): string | null {
    const cwdLink = path.join('/proc', String(pid), 'cwd');
    try {
      return fs.readlinkSync(cwdLink);
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

// Satisfy TS unused import check
export type { ProcessScannerEvents };
