import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from '../src/session-manager.js';
import { TranscriptWatcher } from '../src/transcript-watcher.js';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

describe('SessionManager.deriveName disambiguation', () => {
  let mgr: SessionManager;

  beforeEach(() => {
    // Use a non-existent baseDir so the watcher's findCandidateFile is a no-op
    // (won't accidentally pick up real transcripts during tests).
    const tw = new TranscriptWatcher({
      baseDir: path.join(os.tmpdir(), 'walccy-test-' + Math.random()),
      pollIntervalMs: 10_000,
    });
    mgr = new SessionManager(100, tw);
  });

  it('uses basename for the first session in a cwd', () => {
    const s = mgr.createSession(0, '/home/u/projects/walccy');
    expect(s.info.name).toBe('walccy');
  });

  it('appends " 2", " 3" for collisions on the same basename', () => {
    const s1 = mgr.createSession(1001, '/home/u/projects/walccy');
    const s2 = mgr.createSession(1002, '/elsewhere/walccy');
    const s3 = mgr.createSession(1003, '/yet/another/walccy');
    expect(s1.info.name).toBe('walccy');
    expect(s2.info.name).toBe('walccy 2');
    expect(s3.info.name).toBe('walccy 3');
  });

  it('recycles suffixes when an earlier session is removed', () => {
    const s1 = mgr.createSession(2001, '/a/walccy');
    const s2 = mgr.createSession(2002, '/b/walccy');
    expect(s2.info.name).toBe('walccy 2');
    mgr.removeSession(s1.id);
    const s3 = mgr.createSession(2003, '/c/walccy');
    expect(s3.info.name).toBe('walccy');
  });
});

describe('TranscriptWatcher (integration with SessionManager)', () => {
  it('upgrades session.name when a {"type":"summary"} line appears', async () => {
    const cwd = '/home/u/some/project';
    // Encoded dir name = `-home-u-some-project`
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'walccy-tw-'));
    const projectDir = path.join(baseDir, '-home-u-some-project');
    fs.mkdirSync(projectDir, { recursive: true });

    const tw = new TranscriptWatcher({
      baseDir,
      pollIntervalMs: 30,
      mtimeSlackMs: 60_000,
    });
    const mgr = new SessionManager(100, tw);
    const updates: Array<{ id: string; changes: Record<string, unknown> }> = [];
    mgr.on('session-updated', (id, changes) =>
      updates.push({ id, changes: changes as Record<string, unknown> })
    );

    const session = mgr.createSession(3001, cwd);
    expect(session.info.name).toBe('project');

    // Create the transcript file AFTER the session, with a summary line.
    const file = path.join(projectDir, 'abc-def.jsonl');
    fs.writeFileSync(
      file,
      JSON.stringify({ type: 'user', message: { role: 'user' } }) +
        '\n' +
        JSON.stringify({
          type: 'summary',
          summary: 'Refactor session manager naming',
          leafUuid: 'x',
        }) +
        '\n'
    );

    // Wait for the poller to pick it up.
    await waitFor(() => session.info.name === 'Refactor session manager naming', 2000);
    expect(session.info.name).toBe('Refactor session manager naming');
    const nameChange = updates.find((u) => 'name' in u.changes);
    expect(nameChange?.changes['name']).toBe('Refactor session manager naming');

    // Appending another summary updates the name again.
    fs.appendFileSync(
      file,
      JSON.stringify({ type: 'summary', summary: 'Better tab labels', leafUuid: 'y' }) +
        '\n'
    );
    await waitFor(() => session.info.name === 'Better tab labels', 2000);
    expect(session.info.name).toBe('Better tab labels');

    mgr.removeSession(session.id);
    mgr.stopTranscriptWatcher();
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it('handles partial-line writes without losing a summary', async () => {
    const cwd = '/x/y/z';
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'walccy-tw-'));
    const projectDir = path.join(baseDir, '-x-y-z');
    fs.mkdirSync(projectDir, { recursive: true });

    const tw = new TranscriptWatcher({
      baseDir,
      pollIntervalMs: 20,
      mtimeSlackMs: 60_000,
    });
    const mgr = new SessionManager(100, tw);
    const session = mgr.createSession(4001, cwd);
    const file = path.join(projectDir, 's.jsonl');

    const summaryLine = JSON.stringify({
      type: 'summary',
      summary: 'Half then half',
      leafUuid: 'z',
    });
    // Write first half — invalid JSON until the rest arrives.
    const half = Math.floor(summaryLine.length / 2);
    fs.writeFileSync(file, summaryLine.slice(0, half));
    await sleep(80);
    expect(session.info.name).toBe('z'); // unchanged so far

    // Append the rest plus terminator.
    fs.appendFileSync(file, summaryLine.slice(half) + '\n');
    await waitFor(() => session.info.name === 'Half then half', 2000);
    expect(session.info.name).toBe('Half then half');

    mgr.removeSession(session.id);
    mgr.stopTranscriptWatcher();
    fs.rmSync(baseDir, { recursive: true, force: true });
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(20);
  }
  throw new Error(`waitFor: timed out after ${timeoutMs}ms`);
}
