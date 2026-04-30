// ──────────────────────────────────────────────
// Walccy — FCM Push Notification Service
// Sends push notifications via Firebase Cloud Messaging v1 API.
// ──────────────────────────────────────────────

import * as fs from 'fs';
import * as https from 'https';
import * as crypto from 'crypto';
import logger from './logger.js';

interface ServiceAccount {
  project_id: string;
  private_key: string;
  client_email: string;
  token_uri: string;
}

interface PushToken {
  token: string;
  platform: 'android' | 'ios';
  clientId: string;
}

// ──────────────────────────────────────────────
// JWT / OAuth2 helpers for FCM v1 API
// ──────────────────────────────────────────────

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function createJwt(sa: ServiceAccount): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  };

  const segments = [
    base64url(Buffer.from(JSON.stringify(header))),
    base64url(Buffer.from(JSON.stringify(payload))),
  ];

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(segments.join('.'));
  const signature = base64url(sign.sign(sa.private_key));

  return `${segments.join('.')}.${signature}`;
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const jwt = createJwt(sa);

  return new Promise((resolve, reject) => {
    const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
    const url = new URL(sa.token_uri);

    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data) as { access_token?: string };
            if (parsed.access_token) {
              resolve(parsed.access_token);
            } else {
              reject(new Error(`OAuth token response missing access_token: ${data}`));
            }
          } catch (err) {
            reject(new Error(`Failed to parse OAuth response: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ──────────────────────────────────────────────
// PushService
// ──────────────────────────────────────────────

export class PushService {
  private serviceAccount: ServiceAccount | null = null;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private pushTokens: Map<string, PushToken> = new Map(); // clientId → PushToken

  constructor(serviceAccountPath?: string) {
    const saPath =
      serviceAccountPath ??
      process.env['WALCCY_FCM_SERVICE_ACCOUNT'] ??
      `${process.env['HOME']}/.config/walccy/fcm-service-account.json`;

    try {
      if (fs.existsSync(saPath)) {
        const stat = fs.statSync(saPath);
        const looseBits = stat.mode & 0o077;
        if (looseBits !== 0) {
          const modeStr = (stat.mode & 0o777).toString(8).padStart(3, '0');
          logger.warn(
            `fcm-service-account.json mode is 0${modeStr} — readable by group/other. FCM private key should be 0600. Run: chmod 600 ${saPath}`
          );
        }
        const raw = fs.readFileSync(saPath, 'utf-8');
        this.serviceAccount = JSON.parse(raw) as ServiceAccount;
        logger.info(`FCM push service loaded (project: ${this.serviceAccount.project_id})`);
      } else {
        logger.info('FCM service account not found — push notifications disabled');
      }
    } catch (err) {
      logger.warn(`Failed to load FCM service account: ${String(err)}`);
    }
  }

  get isEnabled(): boolean {
    return this.serviceAccount !== null;
  }

  registerToken(clientId: string, token: string, platform: 'android' | 'ios'): void {
    this.pushTokens.set(clientId, { token, platform, clientId });
    logger.info(`Push token registered for client ${clientId} (${platform})`);
  }

  unregisterClient(clientId: string): void {
    this.pushTokens.delete(clientId);
  }

  async sendToAll(title: string, body: string, data?: Record<string, string>): Promise<void> {
    if (!this.serviceAccount || this.pushTokens.size === 0) return;

    const token = await this.getToken();
    if (!token) return;

    const promises: Promise<void>[] = [];
    for (const pushToken of this.pushTokens.values()) {
      promises.push(this.sendOne(token, pushToken, title, body, data));
    }

    await Promise.allSettled(promises);
  }

  private async getToken(): Promise<string | null> {
    if (!this.serviceAccount) return null;

    // Reuse token if not expired (with 5-min buffer)
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 300_000) {
      return this.accessToken;
    }

    try {
      this.accessToken = await getAccessToken(this.serviceAccount);
      this.tokenExpiresAt = Date.now() + 3600_000;
      return this.accessToken;
    } catch (err) {
      logger.error(`Failed to get FCM access token: ${String(err)}`);
      return null;
    }
  }

  private async sendOne(
    accessToken: string,
    pushToken: PushToken,
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<void> {
    const projectId = this.serviceAccount!.project_id;

    const message: Record<string, unknown> = {
      message: {
        token: pushToken.token,
        notification: { title, body },
        android: {
          priority: 'high',
          notification: {
            channel_id: 'walccy-sessions',
            sound: 'default',
          },
        },
        ...(data ? { data } : {}),
      },
    };

    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(message);
      const req = https.request(
        {
          hostname: 'fcm.googleapis.com',
          path: `/v1/projects/${projectId}/messages:send`,
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          let responseData = '';
          res.on('data', (chunk: Buffer) => (responseData += chunk.toString()));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              logger.debug(`FCM push sent to ${pushToken.clientId}`);
              resolve();
            } else {
              logger.warn(
                `FCM push failed (${res.statusCode}): ${responseData}`
              );
              // Remove invalid tokens
              if (res.statusCode === 404 || res.statusCode === 400) {
                const parsed = JSON.parse(responseData) as { error?: { details?: Array<{ errorCode?: string }> } };
                const errorCode = parsed?.error?.details?.[0]?.errorCode;
                if (errorCode === 'UNREGISTERED') {
                  logger.info(`Removing unregistered push token for ${pushToken.clientId}`);
                  this.pushTokens.delete(pushToken.clientId);
                }
              }
              resolve(); // Don't reject — best-effort
            }
          });
        }
      );
      req.on('error', (err) => {
        logger.warn(`FCM request error: ${err.message}`);
        resolve(); // Best-effort
      });
      req.write(payload);
      req.end();
    });
  }
}
