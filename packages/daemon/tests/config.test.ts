import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfig, saveConfig, getConfigPath } from '../src/config.js';

let tmpDir: string;
const originalHome = process.env['HOME'];

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'walccy-test-'));
  process.env['HOME'] = tmpDir;
});

afterEach(() => {
  process.env['HOME'] = originalHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('config', () => {
  it('creates config with defaults and auto-generated secret', () => {
    const config = loadConfig();

    expect(config.port).toBe(7779);
    expect(config.maxBufferLines).toBe(10000);
    expect(config.historyOnConnect).toBe(500);
    expect(config.autoDetect).toBe(true);
    expect(config.autoDetectInterval).toBe(3000);
    expect(config.logLevel).toBe('info');
    expect(config.sessionNameStrategy).toBe('cwd-basename');
    expect(config.authSecret).toMatch(/^[0-9a-f]{64}$/);

    // Should have written the config file
    const configPath = getConfigPath();
    expect(fs.existsSync(configPath)).toBe(true);

    // Should have restrictive permissions
    const stat = fs.statSync(configPath);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('loads existing config and merges with defaults', () => {
    // Write a partial config
    const configDir = path.join(tmpDir, '.config', 'walccy');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({ port: 9999, authSecret: 'a'.repeat(64) }),
      { mode: 0o600 }
    );

    const config = loadConfig();
    expect(config.port).toBe(9999);
    expect(config.maxBufferLines).toBe(10000); // default
    expect(config.authSecret).toBe('a'.repeat(64)); // preserved
  });

  it('handles corrupted JSON gracefully', () => {
    const configDir = path.join(tmpDir, '.config', 'walccy');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      'not valid json{{{',
      { mode: 0o600 }
    );

    const config = loadConfig();
    // Should fall back to defaults
    expect(config.port).toBe(7779);
    expect(config.authSecret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('preserves existing secret on reload', () => {
    const config1 = loadConfig();
    const config2 = loadConfig();

    // Secret should be the same on second load
    expect(config2.authSecret).toBe(config1.authSecret);
  });

  it('saveConfig writes with 0o600 permissions', () => {
    const config = loadConfig();
    config.port = 1234;
    saveConfig(config);

    const configPath = getConfigPath();
    const raw = fs.readFileSync(configPath, 'utf-8');
    const saved = JSON.parse(raw);
    expect(saved.port).toBe(1234);

    const stat = fs.statSync(configPath);
    expect(stat.mode & 0o777).toBe(0o600);
  });
});
