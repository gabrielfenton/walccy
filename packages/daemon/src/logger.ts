import * as winston from 'winston';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const logDir = path.join(os.homedir(), '.walccy', 'logs');

// Ensure log directory exists at module load time, locked down to the owning user.
// Logs contain cwds, session names, FCM project_id, Tailscale IP, hostname — must
// not be world/group readable on multi-user hosts.
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
}
// Defensive: tighten an existing-but-loose dir (e.g. created earlier with default umask).
try {
  fs.chmodSync(logDir, 0o700);
} catch {
  // best effort
}

const logFile = path.join(logDir, 'daemon.log');

// Determine if we are running in foreground mode (console output enabled)
const isForeground = process.env['WALCCY_FOREGROUND'] === '1';

const transports: winston.transport[] = [
  new winston.transports.File({
    filename: logFile,
    maxsize: 10 * 1024 * 1024, // 10 MB
    maxFiles: 3,
    tailable: true,
    // Forwarded to fs.createWriteStream so the log file lands at 0600.
    options: { mode: 0o600 },
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
  }),
];

// Defensive: chmod the log file in case it was created earlier with a looser mode.
try {
  if (fs.existsSync(logFile)) {
    fs.chmodSync(logFile, 0o600);
  }
} catch {
  // best effort
}

if (isForeground) {
  transports.push(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
          const metaStr = Object.keys(meta).length
            ? ' ' + JSON.stringify(meta)
            : '';
          return `${timestamp as string} [${level}] ${message as string}${metaStr}`;
        })
      ),
    })
  );
}

const logger = winston.createLogger({
  level: process.env['WALCCY_LOG_LEVEL'] ?? 'info',
  transports,
});

export function setLogLevel(level: string): void {
  logger.level = level;
}

export default logger;
