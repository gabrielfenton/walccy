import { describe, it, expect } from 'vitest';
import { isClaudeProcessArgv } from '../src/process-scanner.js';

describe('isClaudeProcessArgv', () => {
  it('matches bare claude binary', () => {
    expect(isClaudeProcessArgv(['claude'])).toBe(true);
    expect(isClaudeProcessArgv(['/usr/local/bin/claude'])).toBe(true);
    expect(isClaudeProcessArgv(['claude', '--resume', 'abc'])).toBe(true);
  });

  it('matches node-launched claude JS entry', () => {
    expect(isClaudeProcessArgv(['node', '/some/path/claude.js'])).toBe(true);
    expect(isClaudeProcessArgv(['node', '/some/path/claude.ts'])).toBe(true);
    expect(isClaudeProcessArgv(['bun', '/x/claude'])).toBe(true);
    expect(isClaudeProcessArgv(['npx', '/y/claude'])).toBe(true);
  });

  it('does NOT match walccy wrapper invoking claude as a subcommand', () => {
    // The real-world false positive: `node /…/walccy claude` should not be
    // treated as a claude process — it's the wrap-cli wrapper, whose child
    // claude PTY is reported separately via REGISTER.
    expect(
      isClaudeProcessArgv(['node', '/home/u/.nvm/versions/node/v24.11.0/bin/walccy', 'claude'])
    ).toBe(false);
    expect(isClaudeProcessArgv(['/usr/bin/walccy', 'claude'])).toBe(false);
  });

  it('rejects empty/unrelated argv', () => {
    expect(isClaudeProcessArgv([])).toBe(false);
    expect(isClaudeProcessArgv(['bash'])).toBe(false);
    expect(isClaudeProcessArgv(['node', 'server.js'])).toBe(false);
  });
});
