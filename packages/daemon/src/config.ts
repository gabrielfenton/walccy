import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

export interface WalccyConfig {
  port: number;
  maxBufferLines: number;
  historyOnConnect: number;
  authSecret: string;
  autoDetect: boolean;
  autoDetectInterval: number;
  logLevel: string;
  sessionNameStrategy: 'cwd-basename' | 'pid';
}

const DEFAULTS: WalccyConfig = {
  port: 7779,
  maxBufferLines: 10000,
  historyOnConnect: 500,
  authSecret: '',
  autoDetect: true,
  autoDetectInterval: 3000,
  logLevel: 'info',
  sessionNameStrategy: 'cwd-basename',
};

export function getConfigPath(): string {
  return path.join(os.homedir(), '.config', 'walccy', 'config.json');
}

export function loadConfig(): WalccyConfig {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);

  let saved: Partial<WalccyConfig> = {};

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      saved = JSON.parse(raw) as Partial<WalccyConfig>;
    } catch {
      // Corrupted config — start fresh
      saved = {};
    }
  }

  const merged: WalccyConfig = {
    ...DEFAULTS,
    ...saved,
  };

  // Auto-generate authSecret if missing or empty
  if (!merged.authSecret) {
    merged.authSecret = crypto.randomBytes(32).toString('hex');
  }

  // Always persist to disk (creates file + directory if needed)
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  saveConfig(merged);

  return merged;
}

export function saveConfig(config: WalccyConfig): void {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}
