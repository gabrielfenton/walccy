import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { findInPath } from '../src/wrap-cli.js';

let tmpDir: string;
const originalPath = process.env['PATH'];

function makeExecutable(dir: string, name: string): string {
  const full = path.join(dir, name);
  fs.writeFileSync(full, '#!/bin/sh\necho hi\n');
  fs.chmodSync(full, 0o755);
  return full;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'walccy-findpath-'));
});

afterEach(() => {
  process.env['PATH'] = originalPath;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('findInPath', () => {
  it('returns the absolute path when given a literal path that is executable', () => {
    const exe = makeExecutable(tmpDir, 'mybin');
    expect(findInPath(exe)).toBe(exe);
  });

  it('returns null when literal path does not exist', () => {
    const missing = path.join(tmpDir, 'does-not-exist');
    expect(findInPath(missing)).toBeNull();
  });

  it('returns null when literal path exists but is not executable', () => {
    const nonExec = path.join(tmpDir, 'noexec');
    fs.writeFileSync(nonExec, 'data');
    fs.chmodSync(nonExec, 0o644);
    expect(findInPath(nonExec)).toBeNull();
  });

  it('returns the first match when walking $PATH', () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'walccy-pathA-'));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'walccy-pathB-'));
    try {
      const first = makeExecutable(dirA, 'mytool');
      makeExecutable(dirB, 'mytool');
      process.env['PATH'] = `${dirA}:${dirB}`;
      expect(findInPath('mytool')).toBe(first);
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });

  it('returns null when no PATH entry has the binary', () => {
    process.env['PATH'] = tmpDir;
    expect(findInPath('definitely-not-here-xyz')).toBeNull();
  });

  it('skips empty PATH segments without crashing', () => {
    makeExecutable(tmpDir, 'tool');
    process.env['PATH'] = `:${tmpDir}:`;
    expect(findInPath('tool')).toBe(path.join(tmpDir, 'tool'));
  });
});
