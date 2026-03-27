import * as winston from 'winston';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const logDir = path.join(os.homedir(), '.walccy', 'logs');

// Ensure log directory exists at module load time
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
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
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
  }),
];

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
