import { execFile } from 'child_process';
import { promisify } from 'util';
import logger from './logger.js';

const execFileAsync = promisify(execFile);

interface TailscaleStatus {
  Self?: {
    TailscaleIPs?: string[];
  };
}

/**
 * Returns the Tailscale IP of this machine (Self.TailscaleIPs[0]).
 * In WALCCY_DEV_MODE=1 returns '127.0.0.1' immediately.
 * Returns null if Tailscale is not running or the binary is not found.
 */
export async function getTailscaleIP(): Promise<string | null> {
  if (process.env['WALCCY_DEV_MODE'] === '1') {
    return '127.0.0.1';
  }

  try {
    const { stdout } = await execFileAsync('tailscale', ['status', '--json'], {
      timeout: 5000,
    });

    const status = JSON.parse(stdout) as TailscaleStatus;
    const ips = status?.Self?.TailscaleIPs;

    if (Array.isArray(ips) && ips.length > 0 && ips[0]) {
      return ips[0];
    }

    logger.warn('tailscale status returned no IPs');
    return null;
  } catch (err) {
    if (err instanceof Error) {
      logger.debug(`getTailscaleIP failed: ${err.message}`);
    }
    return null;
  }
}

/**
 * Polls getTailscaleIP every `intervalMs` ms until it resolves.
 * Gives up after `maxRetries` attempts and throws an error.
 */
export async function waitForTailscale(
  intervalMs = 10000,
  maxRetries = 30
): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const ip = await getTailscaleIP();
    if (ip !== null) {
      return ip;
    }
    logger.warn(
      `Tailscale not available yet — retrying in ${intervalMs / 1000}s (attempt ${attempt + 1}/${maxRetries})`
    );
    await delay(intervalMs);
  }
  throw new Error(
    `Tailscale not available after ${maxRetries} attempts (${(maxRetries * intervalMs) / 1000}s). Is tailscaled running?`
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
