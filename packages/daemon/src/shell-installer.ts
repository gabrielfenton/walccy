// ──────────────────────────────────────────────
// Walccy — shell integration installer
//
// Adds a guarded snippet to the user's shell rc files that defines a
// `claude` shell function which transparently runs the real `claude`
// binary under `walccy wrap`.  Re-entrant: if WALCCY_WRAPPED is set
// (we already are inside a wrap), it bypasses and calls the real
// binary so nesting is safe.
// ──────────────────────────────────────────────

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Single source of truth for the re-entrancy env var.  Imported by
// wrap-cli when spawning the wrapped child so the snippet's check
// matches what wrap actually sets.
export const WRAPPED_ENV_VAR = 'WALCCY_WRAPPED';

const BEGIN = '# >>> walccy shell integration >>>';
const END = '# <<< walccy shell integration <<<';
// Bumped on snippet changes — survives re-installs and lets future
// versions detect/replace older blocks deliberately.
const VERSION_TAG = '# walccy-shell-integration v1';

function buildSnippet(): string {
  // Built by concatenation rather than a template literal so the bash
  // `${VAR:-}` syntax doesn't collide with JS interpolation.
  return [
    BEGIN,
    VERSION_TAG,
    '# Auto-wrap `claude` so output is mirrored to the walccy daemon.',
    '# Skipped when ' + WRAPPED_ENV_VAR + '=1 (already inside a wrap),',
    '# or when walccy/claude are not on PATH.',
    'claude() {',
    '  if [ -n "${' + WRAPPED_ENV_VAR + ':-}" ]; then',
    '    command claude "$@"',
    '    return',
    '  fi',
    '  if ! command -v walccy >/dev/null 2>&1 || ! command -v claude >/dev/null 2>&1; then',
    '    command claude "$@"',
    '    return',
    '  fi',
    '  walccy wrap claude "$@"',
    '}',
    END,
    '',
  ].join('\n');
}

interface RcTarget {
  path: string;
  shell: 'bash' | 'zsh';
}

function candidateRcFiles(home: string = os.homedir()): RcTarget[] {
  return [
    { path: path.join(home, '.bashrc'), shell: 'bash' },
    { path: path.join(home, '.zshrc'), shell: 'zsh' },
  ];
}

/**
 * Strip *all* walccy blocks (defensive: a buggy prior install or a
 * user copy/paste accident may have left duplicates).  An orphan BEGIN
 * with no matching END is treated as corrupted and removed from BEGIN
 * to EOF — re-installing then writes a clean block.
 */
export function stripAllBlocks(content: string): string {
  let out = content;
  while (true) {
    const beginIdx = out.indexOf(BEGIN);
    if (beginIdx === -1) break;
    const endIdx = out.indexOf(END, beginIdx);
    let cutEnd: number;
    if (endIdx === -1) {
      // Orphan BEGIN — drop everything from here to EOF.
      cutEnd = out.length;
    } else {
      cutEnd = endIdx + END.length;
    }
    // Trim the newline immediately after the end marker, and the one
    // before BEGIN, so we don't leave a blank gap in the file.
    let cutStart = beginIdx;
    if (cutStart > 0 && out[cutStart - 1] === '\n') cutStart -= 1;
    let trailing = cutEnd;
    if (trailing < out.length && out[trailing] === '\n') trailing += 1;
    out = out.slice(0, cutStart) + (cutStart > 0 ? '\n' : '') + out.slice(trailing);
  }
  return out;
}

export interface ShellInstallResult {
  modified: string[];
  skipped: string[];
}

/**
 * Atomic file write that:
 *  - refuses to follow symlinks (lstat check)
 *  - preserves the original mode
 *  - writes via temp-file + rename in the same dir
 */
function safeRewrite(filePath: string, nextContent: string): void {
  const lst = fs.lstatSync(filePath);
  if (lst.isSymbolicLink()) {
    throw new Error(`refusing to follow symlink: ${filePath}`);
  }
  const mode = lst.mode & 0o777;
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.walccy.${process.pid}.tmp`);
  fs.writeFileSync(tmp, nextContent, { encoding: 'utf8', mode });
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* best-effort cleanup */ }
    throw err;
  }
}

export function installShellIntegration(
  home: string = os.homedir()
): ShellInstallResult {
  const result: ShellInstallResult = { modified: [], skipped: [] };
  const snippet = buildSnippet();
  for (const rc of candidateRcFiles(home)) {
    if (!fs.existsSync(rc.path)) {
      result.skipped.push(`${rc.path} (does not exist)`);
      continue;
    }
    try {
      const original = fs.readFileSync(rc.path, 'utf8');
      const stripped = stripAllBlocks(original);
      const needsLeadingNl =
        stripped.length > 0 && !stripped.endsWith('\n');
      const next = stripped + (needsLeadingNl ? '\n' : '') + snippet;
      if (next === original) {
        result.skipped.push(`${rc.path} (already up to date)`);
        continue;
      }
      safeRewrite(rc.path, next);
      result.modified.push(rc.path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.skipped.push(`${rc.path} (${msg})`);
    }
  }
  return result;
}

export function uninstallShellIntegration(
  home: string = os.homedir()
): ShellInstallResult {
  const result: ShellInstallResult = { modified: [], skipped: [] };
  for (const rc of candidateRcFiles(home)) {
    if (!fs.existsSync(rc.path)) {
      result.skipped.push(`${rc.path} (does not exist)`);
      continue;
    }
    try {
      const original = fs.readFileSync(rc.path, 'utf8');
      const stripped = stripAllBlocks(original);
      if (stripped === original) {
        result.skipped.push(`${rc.path} (no walccy block found)`);
        continue;
      }
      safeRewrite(rc.path, stripped);
      result.modified.push(rc.path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.skipped.push(`${rc.path} (${msg})`);
    }
  }
  return result;
}
