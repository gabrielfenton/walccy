import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// ──────────────────────────────────────────────
// Paths
// ──────────────────────────────────────────────

function getServiceDir(): string {
  return path.join(os.homedir(), '.config', 'systemd', 'user');
}

function getServicePath(): string {
  return path.join(getServiceDir(), 'walccy.service');
}

// ──────────────────────────────────────────────
// Systemd unit file template
// ──────────────────────────────────────────────

function buildUnitFile(): string {
  // Use `which walccy` result or fallback to npx
  const execPath = process.execPath; // node binary
  const scriptPath = path.resolve(__dirname, '..', 'dist', 'index.js');

  return `[Unit]
Description=Walccy Claude session daemon
After=network.target tailscaled.service
Wants=tailscaled.service

[Service]
Type=simple
ExecStart=${execPath} ${scriptPath} start --foreground
Restart=on-failure
RestartSec=5
Environment=WALCCY_FOREGROUND=1
StandardOutput=journal
StandardError=journal
SyslogIdentifier=walccy

[Install]
WantedBy=default.target
`;
}

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

export async function installSystemdService(): Promise<void> {
  const serviceDir = getServiceDir();
  const servicePath = getServicePath();

  if (!fs.existsSync(serviceDir)) {
    fs.mkdirSync(serviceDir, { recursive: true });
  }

  fs.writeFileSync(servicePath, buildUnitFile(), { encoding: 'utf-8', mode: 0o644 });
  console.log(`Wrote systemd unit: ${servicePath}`);

  // Reload daemon and enable/start service
  try {
    await execFileAsync('systemctl', ['--user', 'daemon-reload']);
    await execFileAsync('systemctl', ['--user', 'enable', 'walccy.service']);
    await execFileAsync('systemctl', ['--user', 'start', 'walccy.service']);
    console.log('Walccy service enabled and started.');
  } catch (err) {
    console.warn(
      `systemctl command failed (is systemd running for your user?): ${String(err)}`
    );
    console.warn(`You can start manually: systemctl --user start walccy`);
  }
}

export async function uninstallSystemdService(): Promise<void> {
  const servicePath = getServicePath();

  // Stop and disable first (best-effort)
  try {
    await execFileAsync('systemctl', ['--user', 'stop', 'walccy.service']);
  } catch { /* already stopped */ }

  try {
    await execFileAsync('systemctl', ['--user', 'disable', 'walccy.service']);
  } catch { /* already disabled */ }

  if (fs.existsSync(servicePath)) {
    fs.unlinkSync(servicePath);
    console.log(`Removed systemd unit: ${servicePath}`);
  } else {
    console.log('No systemd unit file found.');
  }

  try {
    await execFileAsync('systemctl', ['--user', 'daemon-reload']);
  } catch { /* best-effort */ }

  console.log('Walccy service uninstalled.');
}

export async function getServiceStatus(): Promise<'running' | 'stopped' | 'not-installed'> {
  const servicePath = getServicePath();

  if (!fs.existsSync(servicePath)) {
    return 'not-installed';
  }

  try {
    const { stdout } = await execFileAsync('systemctl', [
      '--user',
      'is-active',
      'walccy.service',
    ]);
    const status = stdout.trim();
    return status === 'active' ? 'running' : 'stopped';
  } catch {
    return 'stopped';
  }
}
