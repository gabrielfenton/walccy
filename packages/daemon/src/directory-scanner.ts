// ──────────────────────────────────────────────
// Walccy — Directory scanner
// Builds the suggestion list shown when the app
// asks the user "where should I start a session?"
// ──────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import logger from './logger.js';
import type { DirectoryEntry, Session as SessionInfo } from './types.js';

// Common roots searched for git repositories. We probe each one and skip those
// that don't exist; missing roots are not errors.
const COMMON_DEV_ROOTS = [
  'Documents',
  'Documents/dev',
  'Documents/code',
  'Documents/projects',
  'dev',
  'code',
  'src',
  'projects',
  'work',
  'repos',
  'workspace',
  'go/src',
];

/** Max directories to descend into per root. Guards against pathological trees. */
const MAX_DIRS_PER_ROOT = 200;
/** How deep to descend looking for `.git`. */
const MAX_DEPTH = 3;
/** Hard cap on returned suggestions. */
const MAX_RESULTS = 80;

interface ScanOptions {
  /** Cwds of currently active sessions — surfaced as "Recent". */
  recentCwds?: string[];
  /** Substring filter (case-insensitive) applied to path + label. */
  query?: string;
}

export class DirectoryScanner {
  private homeDir: string;

  constructor() {
    this.homeDir = os.homedir();
  }

  // ────────────────────────────────────────────
  // Public
  // ────────────────────────────────────────────

  scan(options: ScanOptions = {}): DirectoryEntry[] {
    const out: DirectoryEntry[] = [];
    const seen = new Set<string>();

    // 1. Home directory always first.
    out.push({
      path: this.homeDir,
      label: '~',
      kind: 'home',
      detail: 'Home directory',
    });
    seen.add(this.homeDir);

    // 2. Recent (active session) cwds.
    for (const cwd of options.recentCwds ?? []) {
      if (seen.has(cwd)) continue;
      if (!this.isReadableDir(cwd)) continue;
      out.push({
        path: cwd,
        label: path.basename(cwd) || cwd,
        kind: 'recent',
        detail: this.friendlyParent(cwd),
      });
      seen.add(cwd);
    }

    // 3. Git repos under common dev roots.
    for (const rel of COMMON_DEV_ROOTS) {
      const root = path.resolve(this.homeDir, rel);
      if (!this.isReadableDir(root)) continue;
      this.findGitRepos(root, 0, seen, out);
      if (out.length >= MAX_RESULTS) break;
    }

    // 4. Apply query filter.
    const q = options.query?.trim().toLowerCase();
    const filtered = q
      ? out.filter(
          (e) =>
            e.path.toLowerCase().includes(q) ||
            e.label.toLowerCase().includes(q)
        )
      : out;

    return filtered.slice(0, MAX_RESULTS);
  }

  /**
   * Validate a user-supplied path — used by SPAWN_SESSION before we hand it to
   * node-pty. Expands `~`, resolves to absolute, and checks it exists.
   * Returns the resolved path or null if invalid.
   */
  resolveAndValidate(input: string): string | null {
    if (!input || typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (trimmed.length === 0) return null;

    let expanded = trimmed;
    if (expanded === '~') {
      expanded = this.homeDir;
    } else if (expanded.startsWith('~/')) {
      expanded = path.join(this.homeDir, expanded.slice(2));
    }

    const resolved = path.resolve(expanded);
    if (!this.isUnderHome(resolved)) return null;
    if (!this.isReadableDir(resolved)) return null;
    return resolved;
  }

  /** True iff `p` is the user's home directory or a descendant. */
  isUnderHome(p: string): boolean {
    return p === this.homeDir || p.startsWith(this.homeDir + path.sep);
  }

  // ────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────

  private findGitRepos(
    root: string,
    depth: number,
    seen: Set<string>,
    out: DirectoryEntry[]
  ): void {
    if (depth > MAX_DEPTH) return;
    if (out.length >= MAX_RESULTS) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch (err) {
      logger.debug(`directory-scanner: readdir failed for ${root}: ${String(err)}`);
      return;
    }

    let visited = 0;
    for (const entry of entries) {
      if (visited >= MAX_DIRS_PER_ROOT) break;
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules') continue;

      const full = path.join(root, entry.name);

      // .git child → this dir is a repo.
      const gitDir = path.join(full, '.git');
      let isRepo = false;
      try {
        if (fs.existsSync(gitDir)) isRepo = true;
      } catch {
        // ignore
      }

      if (isRepo) {
        if (!seen.has(full)) {
          out.push({
            path: full,
            label: entry.name,
            kind: 'git',
            detail: this.friendlyParent(full),
          });
          seen.add(full);
        }
        // Don't recurse into the repo — submodules clutter the list.
      } else {
        this.findGitRepos(full, depth + 1, seen, out);
      }

      visited++;
      if (out.length >= MAX_RESULTS) return;
    }
  }

  private isReadableDir(p: string): boolean {
    try {
      const stat = fs.statSync(p);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  /** Return parent path with $HOME collapsed to "~". */
  private friendlyParent(p: string): string {
    const parent = path.dirname(p);
    if (parent === this.homeDir) return '~';
    if (parent.startsWith(this.homeDir + path.sep)) {
      return '~' + parent.slice(this.homeDir.length);
    }
    return parent;
  }
}

/**
 * Helper for ws-server: collect distinct cwds from active sessions, most
 * recently active first.
 */
export function recentCwdsFromSessions(sessions: SessionInfo[]): string[] {
  const sorted = [...sessions].sort(
    (a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of sorted) {
    if (!s.cwd) continue;
    if (seen.has(s.cwd)) continue;
    seen.add(s.cwd);
    out.push(s.cwd);
  }
  return out;
}
