import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DirectoryScanner } from '../src/directory-scanner.js';

// ──────────────────────────────────────────────
// resolveAndValidate
// ──────────────────────────────────────────────

describe('DirectoryScanner.resolveAndValidate', () => {
  const scanner = new DirectoryScanner();
  const home = os.homedir();

  it('returns null for empty string', () => {
    expect(scanner.resolveAndValidate('')).toBe(null);
  });

  it('returns null for whitespace-only', () => {
    expect(scanner.resolveAndValidate('   ')).toBe(null);
  });

  it('returns null for path containing NUL byte', () => {
    expect(scanner.resolveAndValidate('foo\0bar')).toBe(null);
  });

  it('returns null for over-long path', () => {
    expect(scanner.resolveAndValidate('a'.repeat(5000))).toBe(null);
  });

  it('resolves ~ to home directory', () => {
    const got = scanner.resolveAndValidate('~');
    expect(got).toBe(fs.realpathSync.native(home));
  });

  it('rejects /etc (outside home)', () => {
    expect(scanner.resolveAndValidate('/etc')).toBe(null);
  });

  it('returns null for a non-existent path under home', () => {
    const bogus = path.join(home, '__walccy_does_not_exist_' + Date.now());
    expect(scanner.resolveAndValidate(bogus)).toBe(null);
  });
});

// ──────────────────────────────────────────────
// resolveAndValidate symlink-escape protection
// ──────────────────────────────────────────────
//
// Synthesise a fake $HOME with a symlink that escapes to /tmp. The scanner
// reads HOME at construction time, so we instantiate one inside the fake home.

describe('DirectoryScanner.resolveAndValidate symlink escape', () => {
  let fakeHome: string;
  let escapeTarget: string;
  let escapeLink: string;
  const origHome = process.env.HOME;

  beforeAll(() => {
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'walccy-fakehome-'));
    escapeTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'walccy-escape-'));
    fs.mkdirSync(path.join(escapeTarget, 'somesubdir'));
    escapeLink = path.join(fakeHome, 'tmp-link');
    fs.symlinkSync(escapeTarget, escapeLink);
    process.env.HOME = fakeHome;
  });

  afterAll(() => {
    process.env.HOME = origHome;
    try {
      fs.rmSync(fakeHome, { recursive: true, force: true });
    } catch {}
    try {
      fs.rmSync(escapeTarget, { recursive: true, force: true });
    } catch {}
  });

  it('rejects ~/<symlink>/subdir when realpath escapes home', () => {
    const scanner = new DirectoryScanner();
    const result = scanner.resolveAndValidate('~/tmp-link/somesubdir');
    expect(result).toBe(null);
  });

  it('accepts a path that stays within home', () => {
    const scanner = new DirectoryScanner();
    const inside = fs.mkdtempSync(path.join(fakeHome, 'inside-'));
    const result = scanner.resolveAndValidate(inside);
    expect(result).toBe(fs.realpathSync.native(inside));
  });
});

// ──────────────────────────────────────────────
// findGitRepos: symlinks must not be followed
// ──────────────────────────────────────────────

describe('DirectoryScanner.scan does not follow symlinks', () => {
  let fakeHome: string;
  let realRepoRoot: string;
  const origHome = process.env.HOME;

  beforeAll(() => {
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'walccy-fakehome-'));
    // create a "Documents" root that the scanner probes
    fs.mkdirSync(path.join(fakeHome, 'Documents'));
    // a real git repo OUTSIDE the fakeHome
    realRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'walccy-realrepo-'));
    fs.mkdirSync(path.join(realRepoRoot, 'fake-git-repo'));
    fs.mkdirSync(path.join(realRepoRoot, 'fake-git-repo', '.git'));
    // Symlink Documents/linked → realRepoRoot
    fs.symlinkSync(realRepoRoot, path.join(fakeHome, 'Documents', 'linked'));
    process.env.HOME = fakeHome;
  });

  afterAll(() => {
    process.env.HOME = origHome;
    try { fs.rmSync(fakeHome, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(realRepoRoot, { recursive: true, force: true }); } catch {}
  });

  it('does not surface entries discovered through a symlink', () => {
    const scanner = new DirectoryScanner();
    const entries = scanner.scan();
    const offending = entries.filter((e) =>
      e.path.includes(path.join('Documents', 'linked'))
    );
    expect(offending).toEqual([]);
  });
});
