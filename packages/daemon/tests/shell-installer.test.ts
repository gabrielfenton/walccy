import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  installShellIntegration,
  uninstallShellIntegration,
  stripAllBlocks,
  WRAPPED_ENV_VAR,
} from '../src/shell-installer.js';

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'walccy-shell-test-'));
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function rcPath(name = '.bashrc'): string {
  return path.join(tmpHome, name);
}

describe('shell-installer', () => {
  it('installs into an empty rc and emits the bash function', () => {
    fs.writeFileSync(rcPath(), '', { mode: 0o644 });
    const result = installShellIntegration(tmpHome);
    expect(result.modified).toContain(rcPath());

    const content = fs.readFileSync(rcPath(), 'utf8');
    expect(content).toContain('claude()');
    expect(content).toContain(WRAPPED_ENV_VAR);
    expect(content).toContain('walccy wrap claude');
    expect(content).toContain('# >>> walccy shell integration >>>');
    expect(content).toContain('# <<< walccy shell integration <<<');
  });

  it('is idempotent — second install reports already up to date', () => {
    fs.writeFileSync(rcPath(), '# user config\nexport FOO=1\n', { mode: 0o644 });
    installShellIntegration(tmpHome);
    const first = fs.readFileSync(rcPath(), 'utf8');

    const result = installShellIntegration(tmpHome);
    expect(result.modified).toEqual([]);
    expect(result.skipped.some((s) => s.includes('already up to date'))).toBe(true);
    expect(fs.readFileSync(rcPath(), 'utf8')).toBe(first);
  });

  it('preserves surrounding rc content on uninstall', () => {
    const before = '# user config\nexport FOO=1\nalias ll="ls -la"\n';
    fs.writeFileSync(rcPath(), before, { mode: 0o644 });

    installShellIntegration(tmpHome);
    expect(fs.readFileSync(rcPath(), 'utf8')).toContain('claude()');

    const result = uninstallShellIntegration(tmpHome);
    expect(result.modified).toContain(rcPath());

    const after = fs.readFileSync(rcPath(), 'utf8');
    expect(after).toContain('export FOO=1');
    expect(after).toContain('alias ll');
    expect(after).not.toContain('claude()');
    expect(after).not.toContain('walccy shell integration');
  });

  it('strips multiple duplicate blocks on reinstall', () => {
    fs.writeFileSync(rcPath(), '', { mode: 0o644 });
    installShellIntegration(tmpHome);
    // Simulate a second buggy install by appending the block again manually.
    const content = fs.readFileSync(rcPath(), 'utf8');
    fs.writeFileSync(rcPath(), content + content, { mode: 0o644 });

    const before = fs.readFileSync(rcPath(), 'utf8');
    const blockCount = (before.match(/walccy shell integration >>>/g) ?? []).length;
    expect(blockCount).toBe(2);

    installShellIntegration(tmpHome);
    const after = fs.readFileSync(rcPath(), 'utf8');
    const afterCount = (after.match(/walccy shell integration >>>/g) ?? []).length;
    expect(afterCount).toBe(1);
  });

  it('handles an orphan BEGIN with no END (corrupted rc)', () => {
    const corrupted =
      '# user config\nexport FOO=1\n# >>> walccy shell integration >>>\nclaude() { broken\n';
    fs.writeFileSync(rcPath(), corrupted, { mode: 0o644 });

    installShellIntegration(tmpHome);
    const content = fs.readFileSync(rcPath(), 'utf8');
    // Original orphan content removed; one clean block present.
    expect(content).toContain('export FOO=1');
    expect(content).not.toContain('claude() { broken');
    const count = (content.match(/walccy shell integration >>>/g) ?? []).length;
    expect(count).toBe(1);
  });

  it('skips a missing rc file rather than erroring', () => {
    // No .bashrc/.zshrc exist in tmpHome
    const result = installShellIntegration(tmpHome);
    expect(result.modified).toEqual([]);
    expect(result.skipped.length).toBeGreaterThan(0);
    expect(result.skipped.every((s) => s.includes('does not exist'))).toBe(true);
  });

  it('refuses to follow a symlinked rc file', () => {
    const realFile = path.join(tmpHome, 'real-bashrc');
    fs.writeFileSync(realFile, '# real\n', { mode: 0o644 });
    fs.symlinkSync(realFile, rcPath());

    const result = installShellIntegration(tmpHome);
    expect(result.modified).toEqual([]);
    const skipped = result.skipped.find((s) => s.includes('.bashrc'));
    expect(skipped).toMatch(/symlink/);
    // Real file should be untouched.
    expect(fs.readFileSync(realFile, 'utf8')).toBe('# real\n');
  });

  it('preserves the original file mode', () => {
    fs.writeFileSync(rcPath(), '# user\n', { mode: 0o600 });
    installShellIntegration(tmpHome);
    const stat = fs.statSync(rcPath());
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('uninstall is a no-op on a file with no walccy block', () => {
    fs.writeFileSync(rcPath(), '# user only\n', { mode: 0o644 });
    const result = uninstallShellIntegration(tmpHome);
    expect(result.modified).toEqual([]);
    expect(result.skipped.some((s) => s.includes('no walccy block'))).toBe(true);
    expect(fs.readFileSync(rcPath(), 'utf8')).toBe('# user only\n');
  });

  describe('stripAllBlocks', () => {
    it('returns input unchanged when no markers present', () => {
      expect(stripAllBlocks('hello\nworld\n')).toBe('hello\nworld\n');
    });

    it('removes a single block and tightens surrounding newlines', () => {
      const input = 'before\n# >>> walccy shell integration >>>\nbody\n# <<< walccy shell integration <<<\nafter\n';
      expect(stripAllBlocks(input)).toBe('before\nafter\n');
    });
  });
});
