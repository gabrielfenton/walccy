#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/logger.ts
function setLogLevel(level) {
  logger.level = level;
}
var winston, path2, os2, fs2, logDir, logFile, isForeground, transports2, logger, logger_default;
var init_logger = __esm({
  "src/logger.ts"() {
    "use strict";
    winston = __toESM(require("winston"));
    path2 = __toESM(require("path"));
    os2 = __toESM(require("os"));
    fs2 = __toESM(require("fs"));
    logDir = path2.join(os2.homedir(), ".walccy", "logs");
    if (!fs2.existsSync(logDir)) {
      fs2.mkdirSync(logDir, { recursive: true, mode: 448 });
    }
    try {
      fs2.chmodSync(logDir, 448);
    } catch {
    }
    logFile = path2.join(logDir, "daemon.log");
    isForeground = process.env["WALCCY_FOREGROUND"] === "1";
    transports2 = [
      new winston.transports.File({
        filename: logFile,
        maxsize: 10 * 1024 * 1024,
        // 10 MB
        maxFiles: 3,
        tailable: true,
        // Forwarded to fs.createWriteStream so the log file lands at 0600.
        options: { mode: 384 },
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        )
      })
    ];
    try {
      if (fs2.existsSync(logFile)) {
        fs2.chmodSync(logFile, 384);
      }
    } catch {
    }
    if (isForeground) {
      transports2.push(
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp({ format: "HH:mm:ss" }),
            winston.format.printf(({ level, message, timestamp, ...meta }) => {
              const metaStr = Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
              return `${timestamp} [${level}] ${message}${metaStr}`;
            })
          )
        })
      );
    }
    logger = winston.createLogger({
      level: process.env["WALCCY_LOG_LEVEL"] ?? "info",
      transports: transports2
    });
    logger_default = logger;
  }
});

// src/wrap-server.ts
function getWrapSocketPath() {
  return path6.join(os4.homedir(), ".walccy", "wrap.sock");
}
var fs5, net, os4, path6, WrapServer;
var init_wrap_server = __esm({
  "src/wrap-server.ts"() {
    "use strict";
    fs5 = __toESM(require("fs"));
    net = __toESM(require("net"));
    os4 = __toESM(require("os"));
    path6 = __toESM(require("path"));
    init_logger();
    WrapServer = class {
      constructor(sessionManager) {
        this.sessionManager = sessionManager;
        this.socketPath = getWrapSocketPath();
      }
      sessionManager;
      server = null;
      socketPath;
      async start() {
        const dir = path6.dirname(this.socketPath);
        if (!fs5.existsSync(dir)) fs5.mkdirSync(dir, { recursive: true, mode: 448 });
        try {
          fs5.chmodSync(dir, 448);
        } catch {
        }
        const probeErr = await new Promise((resolve3) => {
          const probe = net.createConnection(this.socketPath);
          probe.once("connect", () => {
            probe.destroy();
            resolve3(null);
          });
          probe.once("error", (err) => {
            probe.destroy();
            resolve3(err);
          });
        });
        if (probeErr === null) {
          throw new Error(
            `wrap: another daemon is already listening on ${this.socketPath} \u2014 refusing to start`
          );
        }
        if (probeErr.code !== "ENOENT") {
          try {
            fs5.unlinkSync(this.socketPath);
          } catch (err) {
            if (err.code !== "ENOENT") {
              logger_default.warn(`wrap: failed to remove stale socket: ${err.message}`);
            }
          }
        }
        this.server = net.createServer((socket) => this.handleConnection(socket));
        await new Promise((resolve3, reject) => {
          if (!this.server) return reject(new Error("server not initialized"));
          this.server.once("error", reject);
          this.server.listen(this.socketPath, () => {
            fs5.chmodSync(this.socketPath, 384);
            resolve3();
          });
        });
        logger_default.info(`Wrap IPC listening on ${this.socketPath}`);
      }
      async stop() {
        if (!this.server) return;
        await new Promise((resolve3) => this.server.close(() => resolve3()));
        if (fs5.existsSync(this.socketPath)) {
          try {
            fs5.unlinkSync(this.socketPath);
          } catch {
          }
        }
        this.server = null;
      }
      handleConnection(socket) {
        let session = null;
        let buffer = "";
        socket.on("data", (chunk) => {
          buffer += chunk.toString("utf8");
          let newline;
          while ((newline = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            if (!line) continue;
            let msg;
            try {
              msg = JSON.parse(line);
            } catch {
              logger_default.warn(`wrap: malformed JSON from wrapper: ${line.slice(0, 120)}`);
              continue;
            }
            if (msg.type === "REGISTER") {
              if (session) {
                logger_default.warn("wrap: REGISTER received twice on the same socket");
                continue;
              }
              session = this.sessionManager.createWrappedSession(
                msg.pid,
                msg.cwd,
                msg.name,
                socket
              );
              socket.write(JSON.stringify({ type: "REGISTERED", sessionId: session.id }) + "\n");
            } else if (msg.type === "OUTPUT") {
              if (!session) {
                logger_default.warn("wrap: OUTPUT before REGISTER, dropping");
                continue;
              }
              const data = Buffer.from(msg.data, "base64").toString("utf8");
              session.pushExternalData(data);
            } else if (msg.type === "EXIT") {
              if (session) this.sessionManager.removeSession(session.id);
              session = null;
              socket.end();
            }
          }
        });
        socket.on("close", () => {
          if (session && this.sessionManager.getSession(session.id)) {
            this.sessionManager.removeSession(session.id);
          }
          session = null;
        });
        socket.on("error", (err) => {
          logger_default.warn(`wrap: socket error: ${err.message}`);
        });
      }
    };
  }
});

// src/shell-installer.ts
var shell_installer_exports = {};
__export(shell_installer_exports, {
  WRAPPED_ENV_VAR: () => WRAPPED_ENV_VAR,
  installShellIntegration: () => installShellIntegration,
  stripAllBlocks: () => stripAllBlocks,
  uninstallShellIntegration: () => uninstallShellIntegration
});
function buildSnippet() {
  return [
    BEGIN,
    VERSION_TAG,
    "# Auto-wrap `claude` so output is mirrored to the walccy daemon.",
    "# Skipped when " + WRAPPED_ENV_VAR + "=1 (already inside a wrap),",
    "# or when walccy/claude are not on PATH.",
    "claude() {",
    '  if [ -n "${' + WRAPPED_ENV_VAR + ':-}" ]; then',
    '    command claude "$@"',
    "    return",
    "  fi",
    "  if ! command -v walccy >/dev/null 2>&1 || ! command -v claude >/dev/null 2>&1; then",
    '    command claude "$@"',
    "    return",
    "  fi",
    '  walccy wrap claude "$@"',
    "}",
    END,
    ""
  ].join("\n");
}
function candidateRcFiles(home = os6.homedir()) {
  return [
    { path: path8.join(home, ".bashrc"), shell: "bash" },
    { path: path8.join(home, ".zshrc"), shell: "zsh" }
  ];
}
function stripAllBlocks(content) {
  let out = content;
  while (true) {
    const beginIdx = out.indexOf(BEGIN);
    if (beginIdx === -1) break;
    const endIdx = out.indexOf(END, beginIdx);
    let cutEnd;
    if (endIdx === -1) {
      cutEnd = out.length;
    } else {
      cutEnd = endIdx + END.length;
    }
    let cutStart = beginIdx;
    if (cutStart > 0 && out[cutStart - 1] === "\n") cutStart -= 1;
    let trailing = cutEnd;
    if (trailing < out.length && out[trailing] === "\n") trailing += 1;
    out = out.slice(0, cutStart) + (cutStart > 0 ? "\n" : "") + out.slice(trailing);
  }
  return out;
}
function safeRewrite(filePath, nextContent) {
  const lst = fs8.lstatSync(filePath);
  if (lst.isSymbolicLink()) {
    throw new Error(`refusing to follow symlink: ${filePath}`);
  }
  const mode = lst.mode & 511;
  const dir = path8.dirname(filePath);
  const tmp = path8.join(dir, `.${path8.basename(filePath)}.walccy.${process.pid}.tmp`);
  fs8.writeFileSync(tmp, nextContent, { encoding: "utf8", mode });
  try {
    fs8.renameSync(tmp, filePath);
  } catch (err) {
    try {
      fs8.unlinkSync(tmp);
    } catch {
    }
    throw err;
  }
}
function installShellIntegration(home = os6.homedir()) {
  const result = { modified: [], skipped: [] };
  const snippet = buildSnippet();
  for (const rc of candidateRcFiles(home)) {
    if (!fs8.existsSync(rc.path)) {
      result.skipped.push(`${rc.path} (does not exist)`);
      continue;
    }
    try {
      const original = fs8.readFileSync(rc.path, "utf8");
      const stripped = stripAllBlocks(original);
      const needsLeadingNl = stripped.length > 0 && !stripped.endsWith("\n");
      const next = stripped + (needsLeadingNl ? "\n" : "") + snippet;
      if (next === original) {
        result.skipped.push(`${rc.path} (already up to date)`);
        continue;
      }
      safeRewrite(rc.path, next);
      result.modified.push(rc.path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.skipped.push(`${rc.path} (${msg})`);
    }
  }
  return result;
}
function uninstallShellIntegration(home = os6.homedir()) {
  const result = { modified: [], skipped: [] };
  for (const rc of candidateRcFiles(home)) {
    if (!fs8.existsSync(rc.path)) {
      result.skipped.push(`${rc.path} (does not exist)`);
      continue;
    }
    try {
      const original = fs8.readFileSync(rc.path, "utf8");
      const stripped = stripAllBlocks(original);
      if (stripped === original) {
        result.skipped.push(`${rc.path} (no walccy block found)`);
        continue;
      }
      safeRewrite(rc.path, stripped);
      result.modified.push(rc.path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.skipped.push(`${rc.path} (${msg})`);
    }
  }
  return result;
}
var fs8, os6, path8, WRAPPED_ENV_VAR, BEGIN, END, VERSION_TAG;
var init_shell_installer = __esm({
  "src/shell-installer.ts"() {
    "use strict";
    fs8 = __toESM(require("fs"));
    os6 = __toESM(require("os"));
    path8 = __toESM(require("path"));
    WRAPPED_ENV_VAR = "WALCCY_WRAPPED";
    BEGIN = "# >>> walccy shell integration >>>";
    END = "# <<< walccy shell integration <<<";
    VERSION_TAG = "# walccy-shell-integration v1";
  }
});

// src/wrap-cli.ts
var wrap_cli_exports = {};
__export(wrap_cli_exports, {
  findInPath: () => findInPath,
  runWrapper: () => runWrapper
});
function findInPath(cmd) {
  if (cmd.includes("/")) {
    try {
      fs9.accessSync(cmd, fs9.constants.X_OK);
      return cmd;
    } catch {
      return null;
    }
  }
  const PATH = process.env["PATH"] ?? "";
  for (const dir of PATH.split(":")) {
    if (!dir) continue;
    const full = path9.join(dir, cmd);
    try {
      fs9.accessSync(full, fs9.constants.X_OK);
      return full;
    } catch {
    }
  }
  return null;
}
async function runWrapper(argv) {
  if (argv.length === 0) argv = ["claude"];
  const cmd = argv[0];
  const args = argv.slice(1);
  const restoreTty = () => {
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch {
      }
    }
  };
  process.on("exit", restoreTty);
  process.on("uncaughtException", (err) => {
    restoreTty();
    console.error(err);
    process.exit(1);
  });
  process.on("SIGINT", () => {
    restoreTty();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    restoreTty();
    process.exit(143);
  });
  if (!findInPath(cmd)) {
    process.stderr.write(`walccy: command not found: ${cmd}
`);
    process.exit(127);
  }
  const pty = require("node-pty");
  const cols = process.stdout.columns ?? 80;
  const rows = process.stdout.rows ?? 24;
  let term;
  try {
    term = pty.spawn(cmd, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: process.cwd(),
      env: {
        ...process.env,
        [WRAPPED_ENV_VAR]: "1"
      }
    });
  } catch (err) {
    restoreTty();
    const e = err;
    if (e && e.code === "ENOENT") {
      process.stderr.write(`walccy: command not found: ${cmd}
`);
    } else {
      const msg = e && e.message || String(err);
      process.stderr.write(`walccy: failed to spawn ${cmd}: ${msg}
`);
    }
    process.exit(127);
  }
  const socket = net2.createConnection(getWrapSocketPath());
  socket.once("connect", () => {
    socket.write(
      JSON.stringify({
        type: "REGISTER",
        pid: term.pid,
        cwd: process.cwd(),
        name: path9.basename(process.cwd()) || process.cwd(),
        cols,
        rows
      }) + "\n"
    );
  });
  let socketReady = false;
  socket.on("data", (chunk) => {
    let buffer = chunk.toString("utf8");
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.type === "REGISTERED") {
        socketReady = true;
      } else if (msg.type === "INPUT" && msg.data) {
        const data = Buffer.from(msg.data, "base64").toString("utf8");
        term.write(data);
      } else if (msg.type === "RESIZE" && msg.cols && msg.rows) {
        try {
          term.resize(msg.cols, msg.rows);
        } catch {
        }
      }
    }
  });
  socket.on("error", (err) => {
    socketReady = false;
    process.stderr.write(`
[walccy] daemon socket error: ${err.message} (continuing without mirror)
`);
  });
  socket.on("close", () => {
    socketReady = false;
  });
  const MAX_PENDING_BYTES = 1 * 1024 * 1024;
  let pendingBytes = 0;
  let warnedDropping = false;
  socket.on("drain", () => {
    pendingBytes = 0;
    warnedDropping = false;
  });
  term.onData((data) => {
    process.stdout.write(data);
    if (socketReady) {
      if (pendingBytes > MAX_PENDING_BYTES) {
        if (!warnedDropping) {
          warnedDropping = true;
          process.stderr.write("\n[walccy] mirror dropping frames (daemon stalled)\n");
        }
        return;
      }
      const payload = JSON.stringify({
        type: "OUTPUT",
        data: Buffer.from(data, "utf8").toString("base64")
      }) + "\n";
      const flushed = socket.write(payload);
      if (!flushed) {
        pendingBytes += Buffer.byteLength(payload);
      }
    }
  });
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.on("data", (b) => {
    term.write(b.toString("utf8"));
  });
  process.on("SIGWINCH", () => {
    const c = process.stdout.columns ?? 80;
    const r = process.stdout.rows ?? 24;
    try {
      term.resize(c, r);
    } catch {
    }
  });
  await new Promise((resolve3) => {
    term.onExit(({ exitCode }) => {
      if (process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(false);
        } catch {
        }
      }
      if (socket.writable) {
        socket.write(JSON.stringify({ type: "EXIT", exitCode }) + "\n");
        socket.end();
      }
      setTimeout(() => {
        process.exit(exitCode);
      }, 50);
      resolve3();
    });
  });
  return void 0;
}
var fs9, net2, path9;
var init_wrap_cli = __esm({
  "src/wrap-cli.ts"() {
    "use strict";
    fs9 = __toESM(require("fs"));
    net2 = __toESM(require("net"));
    path9 = __toESM(require("path"));
    init_wrap_server();
    init_shell_installer();
  }
});

// src/index.ts
var import_commander = require("commander");
var crypto4 = __toESM(require("crypto"));
var os7 = __toESM(require("os"));
var path10 = __toESM(require("path"));

// package.json
var package_default = {
  name: "walccyd",
  version: "1.0.0",
  private: true,
  bin: {
    walccy: "./dist/index.js"
  },
  main: "./dist/index.js",
  scripts: {
    dev: "tsx watch src/index.ts",
    build: "tsup src/index.ts --format cjs --dts",
    start: "node dist/index.js",
    test: "vitest run"
  },
  dependencies: {
    "@walccy/protocol": "*",
    commander: "^12.1.0",
    "node-pty": "^1.0.0",
    "qrcode-terminal": "^0.12.0",
    uuid: "^10.0.0",
    winston: "^3.13.0",
    ws: "^8.17.0"
  },
  devDependencies: {
    "@types/node": "^20.0.0",
    "@types/uuid": "^10.0.0",
    "@types/ws": "^8.5.10",
    tsup: "^8.1.0",
    tsx: "^4.15.0",
    typescript: "^5.5.0",
    vitest: "^4.1.2"
  }
};

// src/config.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var os = __toESM(require("os"));
var crypto = __toESM(require("crypto"));
var DEFAULTS = {
  port: 7779,
  maxBufferLines: 1e4,
  historyOnConnect: 500,
  authSecret: "",
  autoDetect: true,
  autoDetectInterval: 3e3,
  logLevel: "info",
  sessionNameStrategy: "cwd-basename",
  maxSpawnedSessions: 8,
  attachIdlePruneMs: 24 * 60 * 60 * 1e3
};
function getConfigPath() {
  return path.join(os.homedir(), ".config", "walccy", "config.json");
}
function loadConfig() {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  let saved = {};
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      saved = JSON.parse(raw);
    } catch {
      saved = {};
    }
  }
  const merged = {
    ...DEFAULTS,
    ...saved
  };
  let needsSave = false;
  if (!merged.authSecret) {
    merged.authSecret = crypto.randomBytes(32).toString("hex");
    needsSave = true;
  }
  if (needsSave || !fs.existsSync(configPath)) {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    saveConfig(merged);
  }
  return merged;
}
function saveConfig(config) {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), {
    encoding: "utf-8",
    mode: 384
  });
}

// src/session-manager.ts
var import_events2 = require("events");
var path3 = __toESM(require("path"));

// src/session.ts
var import_events = require("events");
var fs3 = __toESM(require("fs"));
var import_uuid = require("uuid");

// src/buffer.ts
var ANSI_REGEX = (
  // eslint-disable-next-line no-control-regex
  /(?:\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f])/g
);
function stripAnsi(str) {
  return str.replace(ANSI_REGEX, "");
}
var LineBuffer = class {
  /** Fixed-size ring buffer. Slots may be undefined until filled. */
  ring;
  maxLines;
  /** Write position (next slot to write to). */
  head = 0;
  /** Number of items currently stored. */
  count = 0;
  totalReceived = 0;
  /** Global monotonically increasing line index (never resets). */
  nextIndex = 0;
  constructor(maxLines = 1e4) {
    this.maxLines = maxLines;
    this.ring = new Array(maxLines);
  }
  /**
   * Append a new line to the buffer (O(1)). Returns the stored BufferedLine.
   */
  push(line) {
    const stored = {
      ...line,
      index: this.nextIndex++,
      content: stripAnsi(line.rawContent)
    };
    this.ring[this.head] = stored;
    this.head = (this.head + 1) % this.maxLines;
    this.totalReceived++;
    if (this.count < this.maxLines) {
      this.count++;
    }
    return stored;
  }
  /**
   * Return lines starting from `fromIndex` (global index), up to `count` lines.
   * Uses binary search on the sorted index field for O(log n) lookup.
   */
  getLines(fromIndex, count) {
    const ordered = this._getOrdered();
    if (fromIndex !== void 0) {
      let lo = 0;
      let hi = ordered.length;
      while (lo < hi) {
        const mid = lo + hi >>> 1;
        if (ordered[mid].index < fromIndex) lo = mid + 1;
        else hi = mid;
      }
      const result = ordered.slice(lo);
      return count !== void 0 ? result.slice(0, count) : result;
    }
    return count !== void 0 ? ordered.slice(0, count) : ordered;
  }
  /**
   * Return the most recent `count` lines.
   */
  getRecent(count) {
    const ordered = this._getOrdered();
    if (count >= ordered.length) {
      return ordered;
    }
    return ordered.slice(ordered.length - count);
  }
  get totalLinesReceived() {
    return this.totalReceived;
  }
  /**
   * Index of the oldest line still present in the ring buffer, or 0 if empty.
   * Used by clients to detect scrollback truncation on reconnect — if this
   * exceeds the `fromLine` they requested, the gap was lost to ring wrap-around.
   */
  firstAvailableLine() {
    if (this.count === 0) return 0;
    const start = (this.head - this.count + this.maxLines) % this.maxLines;
    return this.ring[start].index;
  }
  get size() {
    return this.count;
  }
  clear() {
    this.ring = new Array(this.maxLines);
    this.head = 0;
    this.count = 0;
  }
  /**
   * Materialise the ring buffer contents in chronological order.
   */
  _getOrdered() {
    if (this.count === 0) return [];
    const result = new Array(this.count);
    const start = (this.head - this.count + this.maxLines) % this.maxLines;
    for (let i = 0; i < this.count; i++) {
      result[i] = this.ring[(start + i) % this.maxLines];
    }
    return result;
  }
};

// src/session.ts
init_logger();
var Session = class _Session extends import_events.EventEmitter {
  id;
  /** The original detected PID (or 0 for daemon-spawned sessions). */
  pid;
  /** Current runtime mode (null = pre-init / post-kill). */
  mode = null;
  buffer;
  _info;
  /** Accumulates partial lines between data events. */
  _partialLine = "";
  /** Timer for detecting idle state (waiting for input). */
  _idleTimer = null;
  _exitWatcher = null;
  _lastWriteRejectAt = 0;
  static IDLE_TIMEOUT_MS = 3e3;
  static WRITE_REJECT_WARN_INTERVAL_MS = 5e3;
  constructor(pid, cwd, name, maxBufferLines = 1e4) {
    super();
    this.id = (0, import_uuid.v4)();
    this.pid = pid;
    this.buffer = new LineBuffer(maxBufferLines);
    this._info = {
      id: this.id,
      pid,
      name,
      cwd,
      status: "idle",
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      lineCount: 0,
      waitingForInput: false,
      connectedClients: [],
      owned: false
    };
  }
  // ────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────
  /** True when the daemon (or wrapper CLI) accepts writes for this session. */
  get owned() {
    const k = this.mode?.kind;
    return k === "spawn" || k === "wrap";
  }
  get info() {
    return { ...this._info, lineCount: this.buffer.size };
  }
  updateStatus(status) {
    this._info.status = status;
  }
  setConnectedClients(clients) {
    this._info.connectedClients = clients;
  }
  /**
   * Bind a wrapper-CLI socket to this session.  Output bytes will arrive via
   * `pushExternalData()` and writes initiated by daemon clients will be sent
   * back through the socket so the wrapper can feed them to the local PTY.
   * Input is bidirectional, so the session is treated as `owned` for UI
   * purposes — the read-only banner won't show.
   */
  attachWrapper(socket) {
    this.mode = { kind: "wrap", socket };
    this._info.owned = true;
    this._info.status = "active";
    socket.on("close", () => {
      if (this.mode?.kind === "wrap" && this.mode.socket === socket) {
        this.mode = null;
        this._info.owned = false;
        this._info.status = "ended";
        this.emit("exit");
      }
    });
  }
  /** Feed raw output from a wrapper-CLI socket into this session's buffer. */
  pushExternalData(data) {
    this._handleRawData(data, "stdout");
  }
  /**
   * Spawn a new `claude` process in `cwd` via node-pty.
   * The daemon owns this PTY and can send input.
   */
  async spawn(cols = 220, rows = 50) {
    if (this.mode) return;
    const pty = require("node-pty");
    const ptyProc = pty.spawn("claude", [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: this._info.cwd,
      env: this._sanitizedEnv()
    });
    this.mode = { kind: "spawn", pty: ptyProc };
    this._info.owned = true;
    this._info.status = "active";
    ptyProc.onData((data) => {
      this._handleRawData(data, "stdout");
    });
    ptyProc.onExit(() => {
      this._info.status = "ended";
      if (this.mode?.kind === "spawn" && this.mode.pty === ptyProc) {
        this.mode = null;
      }
      this._info.owned = false;
      this.emit("exit");
    });
  }
  /**
   * Attach to an external process by reading its stdout fd via /proc.
   * Creates a read-only (no-write) session.
   *
   * **Limitation:** Reading `/proc/{pid}/fd/1` only works reliably when the
   * fd points to a regular file or a pipe whose other end is not being consumed
   * concurrently. If fd/1 is a TTY, reads may return terminal input rather than
   * output, or race with the terminal driver. For best results, prefer
   * daemon-spawned sessions (where we own the PTY master).
   */
  async attach() {
    if (this.mode) return;
    const fdPath = `/proc/${this.pid}/fd/1`;
    try {
      fs3.accessSync(fdPath, fs3.constants.R_OK);
      const realPath = fs3.readlinkSync(fdPath);
      if (realPath.startsWith("/dev/pts/") || realPath.startsWith("/dev/tty")) {
        logger_default.warn(
          `Session ${this.id}: fd/1 points to ${realPath} (TTY) \u2014 skipping output monitor to avoid stealing terminal input`
        );
        this.mode = { kind: "attach", stream: null };
        this._info.status = "active";
        this._startExitWatcher();
        return;
      }
    } catch {
      logger_default.warn(
        `Session ${this.id}: cannot read ${fdPath} \u2014 monitoring as external-only`
      );
      this.mode = { kind: "attach", stream: null };
      this._info.status = "active";
      this._startExitWatcher();
      return;
    }
    try {
      const stream = fs3.createReadStream(fdPath, {
        encoding: "utf8",
        autoClose: true
      });
      this.mode = { kind: "attach", stream };
      this._info.status = "active";
      stream.on("data", (chunk) => {
        const data = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        this._handleRawData(data, "stdout");
      });
      stream.on("error", (err) => {
        logger_default.debug(`Session ${this.id} monitor stream error: ${err.message}`);
        if (this.mode?.kind === "attach") {
          this.mode = { kind: "attach", stream: null };
        }
      });
      stream.on("close", () => {
        logger_default.debug(`Session ${this.id} monitor stream closed`);
        if (this.mode?.kind === "attach") {
          this.mode = { kind: "attach", stream: null };
        }
      });
    } catch (err) {
      logger_default.debug(`Session ${this.id}: failed to open ${fdPath}: ${String(err)}`);
      this.mode = { kind: "attach", stream: null };
      this._info.status = "active";
    }
    this._startExitWatcher();
  }
  static MAX_INPUT_LENGTH = 64 * 1024;
  // 64 KB
  /**
   * Send input to the owned PTY.
   * No-ops for external (attach) sessions (read-only).
   */
  write(data, clientId) {
    const mode = this.mode;
    if (!mode || mode.kind === "attach") {
      const now = Date.now();
      const msg = `Session ${this.id}: write attempted on non-owned session (clientId=${clientId ?? "unknown"})`;
      if (now - this._lastWriteRejectAt > _Session.WRITE_REJECT_WARN_INTERVAL_MS) {
        logger_default.warn(msg);
        this._lastWriteRejectAt = now;
      } else {
        logger_default.debug(msg);
      }
      return;
    }
    if (data.length > _Session.MAX_INPUT_LENGTH) {
      logger_default.warn(
        `Session ${this.id}: input too large (${data.length} bytes), truncating to ${_Session.MAX_INPUT_LENGTH}`
      );
      data = data.slice(0, _Session.MAX_INPUT_LENGTH);
    }
    this._info.lastActivityAt = Date.now();
    switch (mode.kind) {
      case "wrap":
        mode.socket.write(
          JSON.stringify({
            type: "INPUT",
            data: Buffer.from(data, "utf8").toString("base64")
          }) + "\n"
        );
        return;
      case "spawn":
        mode.pty.write(data);
        return;
      default: {
        const _exhaustive = mode;
        void _exhaustive;
        return;
      }
    }
  }
  resize(cols, rows) {
    const mode = this.mode;
    if (!mode) return;
    switch (mode.kind) {
      case "wrap":
        mode.socket.write(
          JSON.stringify({ type: "RESIZE", cols, rows }) + "\n"
        );
        return;
      case "spawn":
        mode.pty.resize(cols, rows);
        return;
      case "attach":
        return;
      default: {
        const _exhaustive = mode;
        void _exhaustive;
        return;
      }
    }
  }
  kill() {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
    if (this._exitWatcher) {
      clearInterval(this._exitWatcher);
      this._exitWatcher = null;
    }
    const mode = this.mode;
    this.mode = null;
    this._info.owned = false;
    if (mode) {
      switch (mode.kind) {
        case "spawn":
          try {
            mode.pty.kill();
          } catch {
          }
          break;
        case "attach":
          if (mode.stream) {
            mode.stream.destroy();
          }
          break;
        case "wrap":
          try {
            mode.socket.destroy();
          } catch {
          }
          break;
        default: {
          const _exhaustive = mode;
          void _exhaustive;
        }
      }
    }
    this._info.status = "ended";
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event, listener) {
    return super.on(event, listener);
  }
  // ────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────
  _handleRawData(data, source) {
    const combined = this._partialLine + data;
    const segments = combined.split(/\r?\n/);
    const bufferedLines = [];
    this._partialLine = segments.pop() ?? "";
    for (const seg of segments) {
      if (seg === void 0) continue;
      const line = this.buffer.push({
        rawContent: seg,
        content: seg,
        timestamp: Date.now(),
        source
      });
      bufferedLines.push(line);
    }
    if (bufferedLines.length > 0) {
      this._info.lastActivityAt = Date.now();
      this._info.status = "active";
      if (this._info.waitingForInput) {
        this._info.waitingForInput = false;
      }
      this.emit("data", bufferedLines);
      this._resetIdleTimer();
    }
  }
  _resetIdleTimer() {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
    }
    this._idleTimer = setTimeout(() => {
      this._idleTimer = null;
      if (this._info.status === "active" && !this._info.waitingForInput) {
        this._info.waitingForInput = true;
        this.emit("data", []);
      }
    }, _Session.IDLE_TIMEOUT_MS);
    this._idleTimer.unref();
  }
  /**
   * Build a sanitized environment for spawned processes.
   * Only passes through safe, well-known variables.
   */
  _sanitizedEnv() {
    const allowlist = [
      "HOME",
      "USER",
      "SHELL",
      "LANG",
      "LC_ALL",
      "LC_CTYPE",
      "PATH",
      "TERM",
      "COLORTERM",
      "EDITOR",
      "VISUAL",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
      "XDG_CACHE_HOME",
      "XDG_RUNTIME_DIR",
      "SSH_AUTH_SOCK",
      "GPG_AGENT_INFO",
      "NODE_ENV",
      "ANTHROPIC_API_KEY",
      "CLAUDE_API_KEY"
    ];
    const env = {};
    for (const key of allowlist) {
      if (process.env[key] !== void 0) {
        env[key] = process.env[key];
      }
    }
    return env;
  }
  /**
   * Poll /proc/{pid} to detect when the external process exits.
   */
  _startExitWatcher() {
    const procDir = `/proc/${this.pid}`;
    const timer = setInterval(() => {
      if (!fs3.existsSync(procDir)) {
        clearInterval(timer);
        this._exitWatcher = null;
        this._info.status = "ended";
        this.emit("exit");
      }
    }, 2e3);
    this._exitWatcher = timer;
    timer.unref();
  }
};

// src/session-manager.ts
init_logger();
var SessionManager = class extends import_events2.EventEmitter {
  sessions = /* @__PURE__ */ new Map();
  /** Maps detected PID → session ID to avoid duplicate sessions. */
  pidToSessionId = /* @__PURE__ */ new Map();
  maxBufferLines;
  pruneTimer = null;
  constructor(maxBufferLines = 1e4) {
    super();
    this.maxBufferLines = maxBufferLines;
  }
  // ────────────────────────────────────────────
  // Explicit kill (client-initiated)
  // ────────────────────────────────────────────
  /**
   * Terminate a session by id.  Best-effort `SIGTERM` against the recorded
   * pid (covers attach / wrap modes where the underlying process is not
   * directly owned by the daemon — spawn mode would still get killed via
   * pty.kill inside session.kill, but SIGTERM first is harmless and unifies
   * the code path).  Then the session is removed (which emits 'session-removed'
   * so ws-server broadcasts SESSION_REMOVED to clients).
   *
   * Returns true if a session with that id existed, false otherwise.
   */
  killSession(id) {
    const session = this.sessions.get(id);
    if (!session) return false;
    const pid = session.pid;
    if (pid > 0) {
      try {
        process.kill(pid, "SIGTERM");
      } catch (err) {
        const code = err.code;
        if (code !== "ESRCH") {
          logger_default.warn(
            `killSession(${id}): process.kill(${pid}) failed: ${String(err)}`
          );
        }
      }
    }
    this.removeSession(id);
    return true;
  }
  // ────────────────────────────────────────────
  // Idle-attach pruning
  // ────────────────────────────────────────────
  /**
   * Periodically drop attach-mode (non-owned) sessions that have had no
   * activity for `idleMs` and currently have no subscribed clients.  This
   * cleans up long-running orphans (e.g. a months-old detached tmux running
   * `claude`) so they don't permanently litter the tab bar.
   *
   * The underlying process is NOT killed — pruning only stops tracking.
   * The ProcessScanner won't re-emit `process-found` for a still-alive pid
   * already in its `knownPids`, so the pruned session stays gone until the
   * pid dies and a new claude process recycles the id, or the daemon
   * restarts.
   */
  startIdlePrune(idleMs, checkIntervalMs = 15 * 60 * 1e3) {
    if (this.pruneTimer || idleMs <= 0) return;
    this.pruneTimer = setInterval(() => {
      this._pruneOnce(idleMs);
    }, checkIntervalMs);
    this.pruneTimer.unref();
    logger_default.info(
      `SessionManager: idle-attach prune enabled (idleMs=${idleMs}, checkMs=${checkIntervalMs})`
    );
  }
  stopIdlePrune() {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }
  /** Exposed for tests — runs one prune pass without scheduling. */
  _pruneOnce(idleMs) {
    const cutoff = Date.now() - idleMs;
    let removed = 0;
    for (const session of Array.from(this.sessions.values())) {
      const info = session.info;
      if (info.owned) continue;
      if (info.connectedClients.length > 0) continue;
      if (info.lastActivityAt > cutoff) continue;
      logger_default.info(
        `Pruning idle attach session ${session.id} (pid=${session.pid}, idle for ${Date.now() - info.lastActivityAt}ms)`
      );
      this.removeSession(session.id);
      removed++;
    }
    return removed;
  }
  // ────────────────────────────────────────────
  // Session lifecycle
  // ────────────────────────────────────────────
  /**
   * Create a session for a detected external PID.
   * Returns the existing session if one already exists for this PID.
   */
  createSession(pid, cwd) {
    const existingId = this.pidToSessionId.get(pid);
    if (existingId) {
      const existing = this.sessions.get(existingId);
      if (existing) return existing;
    }
    const name = this.deriveName(cwd);
    const session = new Session(pid, cwd, name, this.maxBufferLines);
    this.sessions.set(session.id, session);
    this.pidToSessionId.set(pid, session.id);
    this.wireSessionEvents(session);
    session.on("exit", () => {
      logger_default.info(`Session ${session.id} (pid=${pid}) exited`);
      this.removeSession(session.id);
    });
    logger_default.info(
      `Session created: id=${session.id} pid=${pid} cwd=${cwd} name=${name}`
    );
    this.emit("session-added", session.info);
    return session;
  }
  /**
   * Spawn a new `claude` process owned by the daemon via node-pty.
   */
  async spawnSession(cwd) {
    const name = this.deriveName(cwd);
    const session = new Session(0, cwd, name, this.maxBufferLines);
    this.sessions.set(session.id, session);
    this.wireSessionEvents(session);
    session.on("exit", () => {
      logger_default.info(`Spawned session ${session.id} exited`);
      this.removeSession(session.id);
    });
    await session.spawn();
    logger_default.info(`Spawned session: id=${session.id} cwd=${cwd} name=${name}`);
    this.emit("session-added", session.info);
    return session;
  }
  /**
   * Create a session backed by a `walccy wrap` CLI socket.  The wrapper owns
   * the actual PTY and forwards I/O over `socket`.
   */
  createWrappedSession(pid, cwd, name, socket) {
    const finalName = name ?? this.deriveName(cwd);
    const session = new Session(pid, cwd, finalName, this.maxBufferLines);
    session.attachWrapper(socket);
    this.sessions.set(session.id, session);
    if (pid > 0) this.pidToSessionId.set(pid, session.id);
    this.wireSessionEvents(session);
    session.on("exit", () => {
      logger_default.info(`Wrapped session ${session.id} (pid=${pid}) exited`);
      this.removeSession(session.id);
    });
    logger_default.info(
      `Wrapped session created: id=${session.id} pid=${pid} cwd=${cwd} name=${finalName}`
    );
    this.emit("session-added", session.info);
    return session;
  }
  getSession(id) {
    return this.sessions.get(id);
  }
  getSessionByPid(pid) {
    const id = this.pidToSessionId.get(pid);
    return id ? this.sessions.get(id) : void 0;
  }
  getAllSessions() {
    return Array.from(this.sessions.values());
  }
  removeSession(id) {
    const session = this.sessions.get(id);
    if (!session) return;
    this.pidToSessionId.delete(session.pid);
    session.kill();
    this.sessions.delete(id);
    logger_default.info(`Session removed: id=${id}`);
    this.emit("session-removed", id);
  }
  /**
   * Add or remove a client ID from a session's connectedClients list.
   */
  addClientToSession(sessionId, clientId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const info = session.info;
    if (!info.connectedClients.includes(clientId)) {
      const updated = [...info.connectedClients, clientId];
      session.setConnectedClients(updated);
      this.emit("session-updated", sessionId, { connectedClients: updated });
    }
  }
  removeClientFromSession(sessionId, clientId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const info = session.info;
    const updated = info.connectedClients.filter((c) => c !== clientId);
    session.setConnectedClients(updated);
    this.emit("session-updated", sessionId, { connectedClients: updated });
  }
  // ────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────
  deriveName(cwd) {
    return path3.basename(cwd) || cwd;
  }
  /** Forward session 'data' events as session-updated metadata broadcasts. */
  wireSessionEvents(session) {
    session.on("data", () => {
      const info = session.info;
      this.emit("session-updated", session.id, {
        lastActivityAt: info.lastActivityAt,
        lineCount: info.lineCount,
        status: info.status,
        waitingForInput: info.waitingForInput
      });
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event, listener) {
    return super.on(event, listener);
  }
};

// src/process-scanner.ts
var import_events3 = require("events");
var fsp = __toESM(require("fs/promises"));
var path4 = __toESM(require("path"));
init_logger();
var ProcessScanner = class extends import_events3.EventEmitter {
  interval = null;
  knownPids = /* @__PURE__ */ new Set();
  // ────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────
  start(intervalMs = 3e3) {
    if (this.interval) return;
    this.scan().catch((err) => {
      logger_default.error(`ProcessScanner initial scan error: ${String(err)}`);
    });
    this.interval = setInterval(() => {
      this.scan().catch((err) => {
        logger_default.error(`ProcessScanner scan error: ${String(err)}`);
      });
    }, intervalMs);
    this.interval.unref();
    logger_default.info(`ProcessScanner started (interval=${intervalMs}ms)`);
  }
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    logger_default.info("ProcessScanner stopped");
  }
  // ────────────────────────────────────────────
  // Scanning logic
  // ────────────────────────────────────────────
  async scan() {
    const currentPids = /* @__PURE__ */ new Set();
    let entries;
    try {
      entries = await fsp.readdir("/proc");
    } catch (err) {
      logger_default.error(`Cannot read /proc: ${String(err)}`);
      return;
    }
    for (const entry of entries) {
      const pid = parseInt(entry, 10);
      if (isNaN(pid) || pid <= 0) continue;
      const isClaudeProcess = await this.isClaude(pid);
      if (!isClaudeProcess) continue;
      currentPids.add(pid);
      if (!this.knownPids.has(pid)) {
        const cwd = await this.readCwd(pid);
        if (cwd !== null) {
          logger_default.debug(`ProcessScanner: found claude pid=${pid} cwd=${cwd}`);
          this.knownPids.add(pid);
          this.emit("process-found", pid, cwd);
        }
      }
    }
    for (const pid of this.knownPids) {
      if (!currentPids.has(pid)) {
        logger_default.debug(`ProcessScanner: lost claude pid=${pid}`);
        this.knownPids.delete(pid);
        this.emit("process-lost", pid);
      }
    }
  }
  // ────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────
  /**
   * Returns true if the process with `pid` is a `claude` process.
   * Reads /proc/{pid}/cmdline (null-byte separated argv).
   */
  async isClaude(pid) {
    const cmdlinePath = path4.join("/proc", String(pid), "cmdline");
    try {
      const raw = await fsp.readFile(cmdlinePath, "utf8");
      const args = raw.split("\0").filter(Boolean);
      return args.some((arg) => {
        return arg === "claude" || /[/\\]claude(?:\.[jt]s)?$/.test(arg) || arg.endsWith("/claude");
      });
    } catch {
      return false;
    }
  }
  /**
   * Read the CWD of a process via /proc/{pid}/cwd symlink.
   * Returns null if not readable.
   */
  async readCwd(pid) {
    const cwdLink = path4.join("/proc", String(pid), "cwd");
    try {
      return await fsp.readlink(cwdLink);
    } catch {
      return null;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event, listener) {
    return super.on(event, listener);
  }
};

// src/directory-scanner.ts
var fs4 = __toESM(require("fs"));
var path5 = __toESM(require("path"));
var os3 = __toESM(require("os"));
init_logger();
var COMMON_DEV_ROOTS = [
  "Documents",
  "Documents/dev",
  "Documents/code",
  "Documents/projects",
  "dev",
  "code",
  "src",
  "projects",
  "work",
  "repos",
  "workspace",
  "go/src"
];
var MAX_DIRS_PER_ROOT = 200;
var MAX_DEPTH = 3;
var MAX_RESULTS = 80;
var DirectoryScanner = class {
  homeDir;
  constructor() {
    this.homeDir = os3.homedir();
  }
  // ────────────────────────────────────────────
  // Public
  // ────────────────────────────────────────────
  scan(options = {}) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    out.push({
      path: this.homeDir,
      label: "~",
      kind: "home",
      detail: "Home directory"
    });
    seen.add(this.homeDir);
    for (const cwd of options.recentCwds ?? []) {
      if (seen.has(cwd)) continue;
      if (!this.isReadableDir(cwd)) continue;
      out.push({
        path: cwd,
        label: path5.basename(cwd) || cwd,
        kind: "recent",
        detail: this.friendlyParent(cwd)
      });
      seen.add(cwd);
    }
    for (const rel of COMMON_DEV_ROOTS) {
      const root = path5.resolve(this.homeDir, rel);
      if (!this.isReadableDir(root)) continue;
      this.findGitRepos(root, 0, seen, out);
      if (out.length >= MAX_RESULTS) break;
    }
    const q = options.query?.trim().toLowerCase();
    const filtered = q ? out.filter(
      (e) => e.path.toLowerCase().includes(q) || e.label.toLowerCase().includes(q)
    ) : out;
    return filtered.slice(0, MAX_RESULTS);
  }
  /**
   * Validate a user-supplied path — used by SPAWN_SESSION before we hand it to
   * node-pty. Expands `~`, resolves to absolute, and checks it exists.
   * Returns the resolved path or null if invalid.
   */
  resolveAndValidate(input) {
    if (!input || typeof input !== "string") return null;
    const trimmed = input.trim();
    if (trimmed.length === 0) return null;
    if (trimmed.length > 4096) return null;
    if (trimmed.includes("\0")) return null;
    let expanded = trimmed;
    if (expanded === "~") {
      expanded = this.homeDir;
    } else if (expanded.startsWith("~/")) {
      expanded = path5.join(this.homeDir, expanded.slice(2));
    }
    const resolved = path5.resolve(expanded);
    let real;
    try {
      real = fs4.realpathSync.native(resolved);
    } catch {
      return null;
    }
    if (!this.isUnderHome(real)) return null;
    if (!this.isReadableDir(real)) return null;
    return real;
  }
  /** True iff `p` is the user's home directory or a descendant. */
  isUnderHome(p) {
    return p === this.homeDir || p.startsWith(this.homeDir + path5.sep);
  }
  // ────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────
  findGitRepos(root, depth, seen, out, visited = /* @__PURE__ */ new Set()) {
    if (depth > MAX_DEPTH) return;
    if (out.length >= MAX_RESULTS) return;
    let entries;
    try {
      entries = fs4.readdirSync(root, { withFileTypes: true });
    } catch (err) {
      logger_default.debug(`directory-scanner: readdir failed for ${root}: ${String(err)}`);
      return;
    }
    let visitedCount = 0;
    for (const entry of entries) {
      if (visitedCount >= MAX_DIRS_PER_ROOT) break;
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;
      const full = path5.join(root, entry.name);
      let st;
      try {
        st = fs4.lstatSync(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (!st.isDirectory()) continue;
      const inode = `${st.dev}:${st.ino}`;
      if (visited.has(inode)) continue;
      visited.add(inode);
      const gitDir = path5.join(full, ".git");
      let isRepo = false;
      try {
        if (fs4.existsSync(gitDir)) isRepo = true;
      } catch {
      }
      if (isRepo) {
        if (!seen.has(full)) {
          out.push({
            path: full,
            label: entry.name,
            kind: "git",
            detail: this.friendlyParent(full)
          });
          seen.add(full);
        }
      } else {
        this.findGitRepos(full, depth + 1, seen, out, visited);
      }
      visitedCount++;
      if (out.length >= MAX_RESULTS) return;
    }
  }
  isReadableDir(p) {
    try {
      const stat = fs4.statSync(p);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }
  /** Return parent path with $HOME collapsed to "~". */
  friendlyParent(p) {
    const parent = path5.dirname(p);
    if (parent === this.homeDir) return "~";
    if (parent.startsWith(this.homeDir + path5.sep)) {
      return "~" + parent.slice(this.homeDir.length);
    }
    return parent;
  }
};
function recentCwdsFromSessions(sessions) {
  const sorted = [...sessions].sort(
    (a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)
  );
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const s of sorted) {
    if (!s.cwd) continue;
    if (seen.has(s.cwd)) continue;
    seen.add(s.cwd);
    out.push(s.cwd);
  }
  return out;
}

// src/client-registry.ts
var import_ws = require("ws");
init_logger();
var INPUT_LOCK_TTL_MS = 2e3;
var ClientRegistry = class {
  constructor(sessionManager, pushService) {
    this.sessionManager = sessionManager;
    this.pushService = pushService;
  }
  sessionManager;
  pushService;
  clients = /* @__PURE__ */ new Map();
  inputLocks = /* @__PURE__ */ new Map();
  // Reverse index: sessionId → set of clientIds subscribed to it. Mirrors
  // ConnectedClient.subscribedSessions so broadcastToSession is O(K subscribers)
  // instead of O(N clients). Mutated only via addSubscription/removeSubscription
  // (and remove() on disconnect) — keep the two indexes consistent.
  sessionSubscribers = /* @__PURE__ */ new Map();
  // ────────── client lifecycle ──────────
  add(client) {
    this.clients.set(client.id, client);
  }
  get(clientId) {
    return this.clients.get(clientId);
  }
  /**
   * Rebind a client to a new (persistent) id — used during AUTH so device-
   * supplied stable ids survive reconnects (push-token bookkeeping).
   */
  rebind(client, newId) {
    if (newId === client.id) return true;
    if (this.clients.has(newId)) {
      logger_default.warn(
        `ClientRegistry.rebind: id collision \u2014 refusing to remap ${client.id} \u2192 ${newId} (already in use)`
      );
      return false;
    }
    const oldId = client.id;
    this.clients.delete(oldId);
    client.id = newId;
    this.clients.set(client.id, client);
    for (const sessionId of client.subscribedSessions) {
      this._untrackSubscription(oldId, sessionId);
      this._trackSubscription(newId, sessionId);
    }
    return true;
  }
  /**
   * Disconnect cleanup. Always uses client.id (current) so that AUTH-rebound
   * persistent ids are correctly removed from the push-service registry.
   */
  remove(client) {
    for (const sessionId of client.subscribedSessions) {
      this.sessionManager.removeClientFromSession(sessionId, client.id);
      this._untrackSubscription(client.id, sessionId);
    }
    client.subscribedSessions.clear();
    this.pushService?.unregisterClient(client.id);
    this.clients.delete(client.id);
  }
  // ────────── subscriptions ──────────
  //
  // Public mutation entry points for the per-client subscribedSessions set.
  // External callers MUST use these (not client.subscribedSessions.add/delete
  // directly) so the sessionSubscribers reverse index stays in sync.
  addSubscription(clientId, sessionId) {
    const client = this.clients.get(clientId);
    if (!client) return;
    if (client.subscribedSessions.has(sessionId)) return;
    client.subscribedSessions.add(sessionId);
    this._trackSubscription(clientId, sessionId);
  }
  removeSubscription(clientId, sessionId) {
    const client = this.clients.get(clientId);
    if (!client) return;
    if (!client.subscribedSessions.delete(sessionId)) return;
    this._untrackSubscription(clientId, sessionId);
  }
  _trackSubscription(clientId, sessionId) {
    let subs = this.sessionSubscribers.get(sessionId);
    if (!subs) {
      subs = /* @__PURE__ */ new Set();
      this.sessionSubscribers.set(sessionId, subs);
    }
    subs.add(clientId);
  }
  _untrackSubscription(clientId, sessionId) {
    const subs = this.sessionSubscribers.get(sessionId);
    if (!subs) return;
    subs.delete(clientId);
    if (subs.size === 0) this.sessionSubscribers.delete(sessionId);
  }
  // ────────── input locks ──────────
  getInputLock(sessionId) {
    return this.inputLocks.get(sessionId);
  }
  setInputLock(sessionId, lock) {
    this.inputLocks.set(sessionId, lock);
  }
  clearInputLock(sessionId) {
    this.inputLocks.delete(sessionId);
  }
  // ────────── send / broadcast ──────────
  send(ws, msg) {
    if (ws.readyState !== import_ws.WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      logger_default.debug(`WS send error: ${String(err)}`);
    }
  }
  sendError(ws, code, message) {
    const msg = { type: "ERROR", code, message };
    this.send(ws, msg);
  }
  broadcastAll(msg) {
    const payload = JSON.stringify(msg);
    for (const client of this.clients.values()) {
      if (client.isAuthenticated && client.ws.readyState === import_ws.WebSocket.OPEN) {
        try {
          client.ws.send(payload);
        } catch (err) {
          logger_default.debug(`Broadcast error to ${client.id}: ${String(err)}`);
        }
      }
    }
  }
  broadcastToSession(sessionId, msg) {
    const subs = this.sessionSubscribers.get(sessionId);
    if (!subs || subs.size === 0) return;
    const payload = JSON.stringify(msg);
    for (const clientId of subs) {
      const client = this.clients.get(clientId);
      if (!client || !client.isAuthenticated || client.ws.readyState !== import_ws.WebSocket.OPEN) {
        continue;
      }
      try {
        client.ws.send(payload);
      } catch (err) {
        logger_default.debug(`Session broadcast error to ${client.id}: ${String(err)}`);
      }
    }
  }
};

// src/auth-handler.ts
var crypto2 = __toESM(require("crypto"));
init_logger();
var DAEMON_VERSION = package_default.version;
function handleAuth(client, msg, deps) {
  const { config, registry } = deps;
  const secretBuf = Buffer.from(String(msg.secret));
  const expectedBuf = Buffer.from(config.authSecret);
  const isValid = secretBuf.length === expectedBuf.length && crypto2.timingSafeEqual(secretBuf, expectedBuf);
  if (!isValid) {
    logger_default.warn(`WS client ${client.id}: auth failed`);
    const fail = {
      type: "AUTH_FAIL",
      reason: "Invalid secret"
    };
    registry.send(client.ws, fail);
    client.ws.close(1008, "Auth failed");
    return;
  }
  client.isAuthenticated = true;
  client.name = msg.clientName || "unknown";
  if (client.authTimeout) {
    clearTimeout(client.authTimeout);
    client.authTimeout = void 0;
  }
  const requested = msg.clientId;
  if (typeof requested === "string" && requested.length > 0 && requested.length <= 100 && !requested.includes("\0")) {
    const rebindOk = registry.rebind(client, requested);
    void rebindOk;
  }
  const ok = { type: "AUTH_OK", clientId: client.id, daemonVersion: DAEMON_VERSION };
  registry.send(client.ws, ok);
  logger_default.info(`WS client authenticated: ${client.id} (${client.name})`);
}

// src/spawn-handler.ts
init_logger();
async function handleSpawnSession(client, msg, deps) {
  const { sessionManager, directoryScanner, registry, config } = deps;
  const cwd = directoryScanner.resolveAndValidate(msg.cwd);
  if (!cwd) {
    const reply = {
      type: "SPAWN_RESULT",
      requestId: msg.requestId,
      error: `Directory not accessible: ${msg.cwd}`
    };
    registry.send(client.ws, reply);
    return;
  }
  const cap = config.maxSpawnedSessions;
  if (cap > 0) {
    const ownedCount = sessionManager.getAllSessions().filter((s) => s.info.owned).length;
    if (ownedCount >= cap) {
      logger_default.warn(
        `Rejected SPAWN_SESSION over cap: client=${client.id} owned=${ownedCount} cap=${cap}`
      );
      const reply = {
        type: "SPAWN_RESULT",
        requestId: msg.requestId,
        error: `Spawned-session cap reached (${cap}). Close an existing session and try again.`
      };
      registry.send(client.ws, reply);
      return;
    }
  }
  try {
    const session = await sessionManager.spawnSession(cwd);
    const reply = {
      type: "SPAWN_RESULT",
      requestId: msg.requestId,
      sessionId: session.id
    };
    registry.send(client.ws, reply);
    logger_default.info(
      `Spawn requested by ${client.id} (${client.name}) cwd=${cwd} \u2192 session ${session.id}`
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger_default.warn(`Spawn failed for ${client.id} cwd=${cwd}: ${reason}`);
    const reply = {
      type: "SPAWN_RESULT",
      requestId: msg.requestId,
      error: reason
    };
    registry.send(client.ws, reply);
  }
}

// src/message-router.ts
init_logger();
var MAX_INPUT_LENGTH = 64 * 1024;
var MessageRouter = class _MessageRouter {
  constructor(deps) {
    this.deps = deps;
  }
  deps;
  listDirsCache = null;
  clientListDirsAt = /* @__PURE__ */ new Map();
  static LIST_DIRS_MIN_INTERVAL_MS = 1e3;
  static LIST_DIRS_CACHE_TTL_MS = 2e3;
  /**
   * Entry point invoked by ws-transport for every parsed JSON message.
   */
  dispatch(client, msg) {
    if (typeof msg !== "object" || msg === null || !("type" in msg)) {
      this.deps.registry.sendError(client.ws, "INVALID_MESSAGE", "Missing type field");
      return;
    }
    const typed = msg;
    if (!this._validateMessage(typed)) {
      this.deps.registry.sendError(client.ws, "INVALID_MESSAGE", "Invalid message fields");
      return;
    }
    if (!client.isAuthenticated) {
      if (typed.type !== "AUTH") {
        this.deps.registry.sendError(client.ws, "NOT_AUTHENTICATED", "Send AUTH first");
        client.ws.close(1008, "Not authenticated");
        return;
      }
      handleAuth(client, typed, {
        config: this.deps.config,
        registry: this.deps.registry,
        pushService: this.deps.pushService
      });
      return;
    }
    switch (typed.type) {
      case "AUTH":
        break;
      case "LIST_SESSIONS":
        this._handleListSessions(client);
        break;
      case "SUBSCRIBE":
        this._handleSubscribe(client, typed);
        break;
      case "UNSUBSCRIBE":
        this._handleUnsubscribe(client, typed);
        break;
      case "INPUT":
        this._handleInput(client, typed);
        break;
      case "RESIZE":
        this._handleResize(client, typed);
        break;
      case "PING":
        this._handlePing(client);
        break;
      case "REGISTER_PUSH_TOKEN":
        this._handleRegisterPushToken(client, typed);
        break;
      case "LIST_DIRECTORIES":
        this._handleListDirectories(client, typed);
        break;
      case "SPAWN_SESSION":
        void handleSpawnSession(client, typed, {
          sessionManager: this.deps.sessionManager,
          directoryScanner: this.deps.directoryScanner,
          registry: this.deps.registry,
          config: this.deps.config
        });
        break;
      case "KILL_SESSION":
        this._handleKillSession(client, typed);
        break;
      default:
        this.deps.registry.sendError(client.ws, "UNKNOWN_TYPE", "Unknown message type");
    }
  }
  // ────────────────────────────────────────────
  // Validation
  // ────────────────────────────────────────────
  _validateMessage(msg) {
    switch (msg.type) {
      case "AUTH":
        return typeof msg.secret === "string" && typeof msg.clientId === "string";
      case "LIST_SESSIONS":
      case "PING":
        return true;
      case "SUBSCRIBE":
        return typeof msg.sessionId === "string" && (msg.fromLine === void 0 || typeof msg.fromLine === "number" && Number.isInteger(msg.fromLine) && msg.fromLine >= 0);
      case "UNSUBSCRIBE":
        return typeof msg.sessionId === "string";
      case "INPUT":
        return typeof msg.sessionId === "string" && typeof msg.data === "string" && msg.data.length <= MAX_INPUT_LENGTH;
      case "RESIZE":
        return typeof msg.sessionId === "string" && typeof msg.cols === "number" && Number.isInteger(msg.cols) && msg.cols > 0 && msg.cols <= 1e3 && typeof msg.rows === "number" && Number.isInteger(msg.rows) && msg.rows > 0 && msg.rows <= 500;
      case "REGISTER_PUSH_TOKEN":
        return typeof msg.token === "string" && msg.token.length > 0 && (msg.platform === "android" || msg.platform === "ios");
      case "LIST_DIRECTORIES":
        return msg.query === void 0 || typeof msg.query === "string" && msg.query.length <= 256;
      case "SPAWN_SESSION":
        return typeof msg.cwd === "string" && msg.cwd.length > 0 && msg.cwd.length <= 4096 && typeof msg.requestId === "string" && msg.requestId.length > 0;
      case "KILL_SESSION":
        return typeof msg.sessionId === "string" && msg.sessionId.length > 0;
      default: {
        const _exhaustive = msg;
        void _exhaustive;
        return false;
      }
    }
  }
  // ────────────────────────────────────────────
  // Handlers
  // ────────────────────────────────────────────
  _handleListSessions(client) {
    const sessions = this.deps.sessionManager.getAllSessions().map((s) => s.info);
    const msg = { type: "SESSIONS", sessions };
    this.deps.registry.send(client.ws, msg);
  }
  _handleSubscribe(client, msg) {
    const { sessionManager, registry, config } = this.deps;
    const session = sessionManager.getSession(msg.sessionId);
    if (!session) {
      registry.sendError(client.ws, "SESSION_NOT_FOUND", `Session ${msg.sessionId} not found`);
      return;
    }
    registry.addSubscription(client.id, msg.sessionId);
    sessionManager.addClientToSession(msg.sessionId, client.id);
    if (msg.fromLine !== void 0) {
      const lines = session.buffer.getLines(msg.fromLine);
      const reply = {
        type: "RESUME",
        sessionId: msg.sessionId,
        lines,
        totalLines: session.buffer.totalLinesReceived
      };
      registry.send(client.ws, reply);
      logger_default.debug(
        `Client ${client.id} resumed session ${msg.sessionId} from line ${msg.fromLine}, sent ${lines.length} lines`
      );
    } else {
      const historyCount = config.historyOnConnect;
      const lines = session.buffer.getRecent(historyCount);
      const history = {
        type: "HISTORY",
        sessionId: msg.sessionId,
        lines,
        totalLines: session.buffer.totalLinesReceived,
        firstAvailableLine: session.buffer.firstAvailableLine()
      };
      registry.send(client.ws, history);
      logger_default.debug(
        `Client ${client.id} subscribed to session ${msg.sessionId}, sent ${lines.length} history lines`
      );
    }
  }
  _handleUnsubscribe(client, msg) {
    this.deps.registry.removeSubscription(client.id, msg.sessionId);
    this.deps.sessionManager.removeClientFromSession(msg.sessionId, client.id);
    logger_default.debug(`Client ${client.id} unsubscribed from session ${msg.sessionId}`);
  }
  _handleInput(client, msg) {
    const { sessionManager, registry } = this.deps;
    const session = sessionManager.getSession(msg.sessionId);
    if (!session) {
      registry.sendError(client.ws, "SESSION_NOT_FOUND", `Session ${msg.sessionId} not found`);
      return;
    }
    const lock = registry.getInputLock(msg.sessionId);
    if (lock && lock.expiresAt > Date.now() && lock.clientId !== client.id) {
      const lockMsg = {
        type: "INPUT_LOCK",
        sessionId: msg.sessionId,
        lockedByClientId: lock.clientId,
        lockedByClientName: lock.clientName,
        expiresAt: lock.expiresAt
      };
      registry.send(client.ws, lockMsg);
      return;
    }
    if (!session.owned) {
      session.write(msg.data, client.id);
      return;
    }
    registry.setInputLock(msg.sessionId, {
      clientId: client.id,
      clientName: client.name,
      expiresAt: Date.now() + INPUT_LOCK_TTL_MS
    });
    session.write(msg.data, client.id);
  }
  _handleKillSession(client, msg) {
    const { sessionManager, registry } = this.deps;
    const ok = sessionManager.killSession(msg.sessionId);
    if (!ok) {
      registry.sendError(
        client.ws,
        "SESSION_NOT_FOUND",
        `Session ${msg.sessionId} not found`
      );
      return;
    }
    logger_default.info(`Client ${client.id} killed session ${msg.sessionId}`);
  }
  _handleResize(client, msg) {
    const { sessionManager, registry } = this.deps;
    const session = sessionManager.getSession(msg.sessionId);
    if (!session) {
      registry.sendError(client.ws, "SESSION_NOT_FOUND", `Session ${msg.sessionId} not found`);
      return;
    }
    session.resize(msg.cols, msg.rows);
  }
  _handlePing(client) {
    const pong = { type: "PONG", timestamp: Date.now() };
    this.deps.registry.send(client.ws, pong);
  }
  _handleRegisterPushToken(client, msg) {
    if (this.deps.pushService) {
      this.deps.pushService.registerToken(client.id, msg.token, msg.platform);
    }
  }
  _handleListDirectories(client, msg) {
    const { sessionManager, directoryScanner, registry } = this.deps;
    const now = Date.now();
    const last = this.clientListDirsAt.get(client.id) ?? 0;
    if (now - last < _MessageRouter.LIST_DIRS_MIN_INTERVAL_MS && this.listDirsCache && now - this.listDirsCache.at < _MessageRouter.LIST_DIRS_CACHE_TTL_MS) {
      registry.send(client.ws, {
        type: "DIRECTORY_LIST",
        directories: this.listDirsCache.entries
      });
      return;
    }
    this.clientListDirsAt.set(client.id, now);
    if (this.listDirsCache && now - this.listDirsCache.at < _MessageRouter.LIST_DIRS_CACHE_TTL_MS && !msg.query) {
      registry.send(client.ws, {
        type: "DIRECTORY_LIST",
        directories: this.listDirsCache.entries
      });
      return;
    }
    const recentCwds = recentCwdsFromSessions(
      sessionManager.getAllSessions().map((s) => s.info)
    );
    const directories = directoryScanner.scan({
      recentCwds,
      query: msg.query
    });
    if (!msg.query) {
      this.listDirsCache = { at: now, entries: directories };
    }
    const reply = { type: "DIRECTORY_LIST", directories };
    registry.send(client.ws, reply);
  }
};

// src/ws-transport.ts
var http = __toESM(require("http"));
var import_ws2 = require("ws");
var import_uuid2 = require("uuid");
init_logger();
var MAX_PAYLOAD_BYTES = 1024 * 1024;
var AUTH_TIMEOUT_MS = 1e4;
var WsTransport = class {
  constructor(config, bindAddress, registry, router) {
    this.config = config;
    this.bindAddress = bindAddress;
    this.registry = registry;
    this.router = router;
  }
  config;
  bindAddress;
  registry;
  router;
  httpServer = null;
  wss = null;
  async start() {
    this.httpServer = http.createServer();
    this.wss = new import_ws2.WebSocketServer({
      server: this.httpServer,
      maxPayload: MAX_PAYLOAD_BYTES
    });
    this.wss.on("connection", (ws) => {
      this._handleConnection(ws);
    });
    await new Promise((resolve3, reject) => {
      this.httpServer.listen(this.config.port, this.bindAddress, () => {
        logger_default.info(
          `WebSocket server listening on ws://${this.bindAddress}:${this.config.port}`
        );
        resolve3();
      });
      this.httpServer.once("error", reject);
    });
  }
  stop() {
    this.wss?.close();
    this.httpServer?.close();
    logger_default.info("WebSocket server stopped");
  }
  // ────────────────────────────────────────────
  // Per-connection lifecycle
  // ────────────────────────────────────────────
  _handleConnection(ws) {
    const clientId = (0, import_uuid2.v4)();
    const client = {
      id: clientId,
      name: "",
      ws,
      subscribedSessions: /* @__PURE__ */ new Set(),
      isAuthenticated: false
    };
    this.registry.add(client);
    logger_default.debug(`WS client connected: ${clientId}`);
    ws.on("message", (raw) => {
      const text = typeof raw === "string" ? raw : raw.toString("utf8");
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        logger_default.warn(`WS client ${clientId}: invalid JSON, closing`);
        this.registry.sendError(ws, "PARSE_ERROR", "Invalid JSON");
        ws.close(1002, "Invalid JSON");
        return;
      }
      this.router.dispatch(client, msg);
    });
    ws.on("close", () => {
      logger_default.debug(`WS client disconnected: ${client.id}`);
      this.registry.remove(client);
    });
    ws.on("error", (err) => {
      logger_default.warn(`WS client ${clientId} error: ${err.message}`);
    });
    const authTimeout = setTimeout(() => {
      if (!client.isAuthenticated) {
        logger_default.warn(`WS client ${clientId}: auth timeout, closing`);
        ws.close(1008, "Auth timeout");
      }
    }, AUTH_TIMEOUT_MS);
    authTimeout.unref();
    client.authTimeout = authTimeout;
  }
};

// src/notification-dispatcher.ts
init_logger();
var NotificationDispatcher = class {
  constructor(sessionManager, registry, pushService) {
    this.sessionManager = sessionManager;
    this.registry = registry;
    this.pushService = pushService;
  }
  sessionManager;
  registry;
  pushService;
  /** Track sessions that already have a data listener wired to avoid duplicates. */
  wiredSessions = /* @__PURE__ */ new Set();
  /**
   * Per-session pending OUTPUT line queue. Bursts of PTY data (which can
   * arrive as 50-chunk bursts per visible block) are coalesced into a single
   * OUTPUT broadcast per turn of the event loop.
   */
  pendingOutput = /* @__PURE__ */ new Map();
  outputScheduled = /* @__PURE__ */ new Set();
  /**
   * Defense-in-depth cache of the last observed waitingForInput value per
   * session. Session._resetIdleTimer is edge-triggered at the source today,
   * but we don't want to depend on that invariant from a different module —
   * if upstream ever re-emits current state (refactor, metadata refresh,
   * resync), we still only push on the false→true edge as observed by us.
   */
  waitingState = /* @__PURE__ */ new Map();
  start() {
    this.sessionManager.on("session-added", (session) => {
      this._onSessionAdded(session);
    });
    this.sessionManager.on("session-removed", (sessionId) => {
      this._onSessionRemoved(sessionId);
    });
    this.sessionManager.on(
      "session-updated",
      (sessionId, changes) => {
        this._onSessionUpdated(sessionId, changes);
      }
    );
  }
  // ────────────────────────────────────────────
  // SessionManager event handlers
  // ────────────────────────────────────────────
  _onSessionAdded(session) {
    const msg = { type: "SESSION_ADDED", session };
    this.registry.broadcastAll(msg);
    if (!this.wiredSessions.has(session.id)) {
      const sessionObj = this.sessionManager.getSession(session.id);
      if (sessionObj) {
        this.wiredSessions.add(session.id);
        const sessionId = session.id;
        sessionObj.on("data", (lines) => {
          if (lines.length === 0) return;
          let queue = this.pendingOutput.get(sessionId);
          if (!queue) {
            queue = [];
            this.pendingOutput.set(sessionId, queue);
          }
          for (const l of lines) queue.push(l);
          if (!this.outputScheduled.has(sessionId)) {
            this.outputScheduled.add(sessionId);
            setImmediate(() => {
              this.outputScheduled.delete(sessionId);
              const batch = this.pendingOutput.get(sessionId);
              this.pendingOutput.delete(sessionId);
              if (!batch || batch.length === 0) return;
              const out = {
                type: "OUTPUT",
                sessionId,
                lines: batch
              };
              this.registry.broadcastToSession(sessionId, out);
            });
          }
        });
      }
    }
  }
  _onSessionRemoved(sessionId) {
    const msg = { type: "SESSION_REMOVED", sessionId };
    this.registry.broadcastAll(msg);
    this.wiredSessions.delete(sessionId);
    this.pendingOutput.delete(sessionId);
    this.outputScheduled.delete(sessionId);
    this.waitingState.delete(sessionId);
    this.registry.clearInputLock(sessionId);
  }
  _onSessionUpdated(sessionId, changes) {
    const msg = { type: "SESSION_UPDATED", sessionId, changes };
    this.registry.broadcastAll(msg);
    if (changes.waitingForInput !== void 0) {
      const previous = this.waitingState.get(sessionId) ?? false;
      const next = changes.waitingForInput === true;
      this.waitingState.set(sessionId, next);
      if (!previous && next && this.pushService?.isEnabled) {
        const session = this.sessionManager.getSession(sessionId);
        const name = session?.info.name ?? "Claude";
        this.pushService.sendToAll(
          `${name} needs input`,
          "Claude has finished its task and is waiting for your response.",
          { sessionId }
        ).catch((err) => {
          logger_default.warn(`FCM push error: ${String(err)}`);
        });
      }
    }
  }
};

// src/ws-server.ts
var WsServer = class {
  registry;
  transport;
  notifications;
  constructor(sessionManager, config, bindAddress, pushService) {
    this.registry = new ClientRegistry(sessionManager, pushService);
    const directoryScanner = new DirectoryScanner();
    const router = new MessageRouter({
      sessionManager,
      config,
      registry: this.registry,
      directoryScanner,
      pushService
    });
    this.transport = new WsTransport(config, bindAddress, this.registry, router);
    this.notifications = new NotificationDispatcher(
      sessionManager,
      this.registry,
      pushService
    );
  }
  async start() {
    await this.transport.start();
    this.notifications.start();
  }
  stop() {
    this.transport.stop();
  }
};

// src/daemon.ts
init_wrap_server();

// src/push.ts
var fs6 = __toESM(require("fs"));
var https = __toESM(require("https"));
var crypto3 = __toESM(require("crypto"));
init_logger();
function base64url(buf) {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function createJwt(sa) {
  const now = Math.floor(Date.now() / 1e3);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600
  };
  const segments = [
    base64url(Buffer.from(JSON.stringify(header))),
    base64url(Buffer.from(JSON.stringify(payload)))
  ];
  const sign = crypto3.createSign("RSA-SHA256");
  sign.update(segments.join("."));
  const signature = base64url(sign.sign(sa.private_key));
  return `${segments.join(".")}.${signature}`;
}
async function getAccessToken(sa) {
  const jwt = createJwt(sa);
  return new Promise((resolve3, reject) => {
    const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
    const url = new URL(sa.token_uri);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body)
        }
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => data += chunk.toString());
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.access_token) {
              resolve3(parsed.access_token);
            } else {
              reject(new Error(`OAuth token response missing access_token: ${data}`));
            }
          } catch (err) {
            reject(new Error(`Failed to parse OAuth response: ${data}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
var PushService = class {
  serviceAccount = null;
  accessToken = null;
  tokenExpiresAt = 0;
  pushTokens = /* @__PURE__ */ new Map();
  // clientId → PushToken
  constructor(serviceAccountPath) {
    const saPath = serviceAccountPath ?? process.env["WALCCY_FCM_SERVICE_ACCOUNT"] ?? `${process.env["HOME"]}/.config/walccy/fcm-service-account.json`;
    try {
      if (fs6.existsSync(saPath)) {
        const stat = fs6.statSync(saPath);
        const looseBits = stat.mode & 63;
        if (looseBits !== 0) {
          const modeStr = (stat.mode & 511).toString(8).padStart(3, "0");
          logger_default.warn(
            `fcm-service-account.json mode is 0${modeStr} \u2014 readable by group/other. FCM private key should be 0600. Run: chmod 600 ${saPath}`
          );
        }
        const raw = fs6.readFileSync(saPath, "utf-8");
        this.serviceAccount = JSON.parse(raw);
        logger_default.info(`FCM push service loaded (project: ${this.serviceAccount.project_id})`);
      } else {
        logger_default.info("FCM service account not found \u2014 push notifications disabled");
      }
    } catch (err) {
      logger_default.warn(`Failed to load FCM service account: ${String(err)}`);
    }
  }
  get isEnabled() {
    return this.serviceAccount !== null;
  }
  registerToken(clientId, token, platform) {
    this.pushTokens.set(clientId, { token, platform, clientId });
    logger_default.info(`Push token registered for client ${clientId} (${platform})`);
  }
  unregisterClient(clientId) {
    this.pushTokens.delete(clientId);
  }
  async sendToAll(title, body, data) {
    if (!this.serviceAccount || this.pushTokens.size === 0) return;
    const token = await this.getToken();
    if (!token) return;
    const promises = [];
    for (const pushToken of this.pushTokens.values()) {
      promises.push(this.sendOne(token, pushToken, title, body, data));
    }
    await Promise.allSettled(promises);
  }
  async getToken() {
    if (!this.serviceAccount) return null;
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 3e5) {
      return this.accessToken;
    }
    try {
      this.accessToken = await getAccessToken(this.serviceAccount);
      this.tokenExpiresAt = Date.now() + 36e5;
      return this.accessToken;
    } catch (err) {
      logger_default.error(`Failed to get FCM access token: ${String(err)}`);
      return null;
    }
  }
  async sendOne(accessToken, pushToken, title, body, data) {
    const projectId = this.serviceAccount.project_id;
    const message = {
      message: {
        token: pushToken.token,
        notification: { title, body },
        android: {
          priority: "high",
          notification: {
            channel_id: "walccy-sessions",
            sound: "default"
          }
        },
        ...data ? { data } : {}
      }
    };
    return new Promise((resolve3, reject) => {
      const payload = JSON.stringify(message);
      const req = https.request(
        {
          hostname: "fcm.googleapis.com",
          path: `/v1/projects/${projectId}/messages:send`,
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload)
          }
        },
        (res) => {
          let responseData = "";
          res.on("data", (chunk) => responseData += chunk.toString());
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              logger_default.debug(`FCM push sent to ${pushToken.clientId}`);
              resolve3();
            } else {
              logger_default.warn(
                `FCM push failed (${res.statusCode}): ${responseData}`
              );
              if (res.statusCode === 404 || res.statusCode === 400) {
                const parsed = JSON.parse(responseData);
                const errorCode = parsed?.error?.details?.[0]?.errorCode;
                if (errorCode === "UNREGISTERED") {
                  logger_default.info(`Removing unregistered push token for ${pushToken.clientId}`);
                  this.pushTokens.delete(pushToken.clientId);
                }
              }
              resolve3();
            }
          });
        }
      );
      req.on("error", (err) => {
        logger_default.warn(`FCM request error: ${err.message}`);
        resolve3();
      });
      req.write(payload);
      req.end();
    });
  }
};

// src/tailscale.ts
var import_child_process = require("child_process");
var import_util = require("util");
init_logger();
var execFileAsync = (0, import_util.promisify)(import_child_process.execFile);
async function getTailscaleIP() {
  if (process.env["WALCCY_DEV_MODE"] === "1") {
    return "127.0.0.1";
  }
  try {
    const { stdout } = await execFileAsync("tailscale", ["status", "--json"], {
      timeout: 5e3
    });
    const status = JSON.parse(stdout);
    const ips = status?.Self?.TailscaleIPs;
    if (Array.isArray(ips) && ips.length > 0 && ips[0]) {
      return ips[0];
    }
    logger_default.warn("tailscale status returned no IPs");
    return null;
  } catch (err) {
    if (err instanceof Error) {
      logger_default.debug(`getTailscaleIP failed: ${err.message}`);
    }
    return null;
  }
}
async function waitForTailscale(intervalMs = 1e4, maxRetries = 30) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const ip = await getTailscaleIP();
    if (ip !== null) {
      return ip;
    }
    logger_default.warn(
      `Tailscale not available yet \u2014 retrying in ${intervalMs / 1e3}s (attempt ${attempt + 1}/${maxRetries})`
    );
    await delay(intervalMs);
  }
  throw new Error(
    `Tailscale not available after ${maxRetries} attempts (${maxRetries * intervalMs / 1e3}s). Is tailscaled running?`
  );
}
function delay(ms) {
  return new Promise((resolve3) => setTimeout(resolve3, ms));
}

// src/daemon.ts
init_logger();
var Daemon = class {
  config;
  sessionManager;
  processScanner;
  wsServer;
  wrapServer;
  async start() {
    this.config = loadConfig();
    setLogLevel(this.config.logLevel);
    logger_default.info("Walccy daemon starting\u2026");
    let bindAddress;
    if (process.env["WALCCY_DEV_MODE"] === "1") {
      bindAddress = "127.0.0.1";
      logger_default.info("Dev mode: binding to 127.0.0.1");
    } else {
      logger_default.info("Waiting for Tailscale IP\u2026");
      bindAddress = await waitForTailscale();
    }
    this.sessionManager = new SessionManager(this.config.maxBufferLines);
    this.processScanner = new ProcessScanner();
    const pushService = new PushService();
    this.wsServer = new WsServer(this.sessionManager, this.config, bindAddress, pushService);
    this.wrapServer = new WrapServer(this.sessionManager);
    this.processScanner.on("process-found", async (pid, cwd) => {
      if (this.sessionManager.getSessionByPid(pid)) return;
      const session = this.sessionManager.createSession(pid, cwd);
      try {
        await session.attach();
      } catch (err) {
        logger_default.warn(`Failed to attach to pid=${pid}: ${String(err)}`);
      }
    });
    this.processScanner.on("process-lost", (pid) => {
      const session = this.sessionManager.getSessionByPid(pid);
      if (session) {
        this.sessionManager.removeSession(session.id);
      }
    });
    await this.wsServer.start();
    await this.wrapServer.start();
    if (this.config.autoDetect) {
      this.processScanner.start(this.config.autoDetectInterval);
    }
    if (this.config.attachIdlePruneMs > 0) {
      this.sessionManager.startIdlePrune(this.config.attachIdlePruneMs);
    }
    logger_default.info(
      `Walccy daemon started on ws://${bindAddress}:${this.config.port}`
    );
  }
  async stop() {
    logger_default.info("Walccy daemon stopping\u2026");
    this.processScanner?.stop();
    this.sessionManager?.stopIdlePrune();
    this.wsServer?.stop();
    await this.wrapServer?.stop();
    for (const session of this.sessionManager?.getAllSessions() ?? []) {
      this.sessionManager.removeSession(session.id);
    }
    logger_default.info("Walccy daemon stopped");
  }
};

// src/installer.ts
var fs7 = __toESM(require("fs"));
var path7 = __toESM(require("path"));
var os5 = __toESM(require("os"));
var import_child_process2 = require("child_process");
var import_util2 = require("util");
var execFileAsync2 = (0, import_util2.promisify)(import_child_process2.execFile);
function getServiceDir() {
  return path7.join(os5.homedir(), ".config", "systemd", "user");
}
function getServicePath() {
  return path7.join(getServiceDir(), "walccy.service");
}
function buildUnitFile() {
  const execPath = process.execPath;
  const scriptPath = path7.resolve(__dirname, "..", "dist", "index.js");
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
async function installSystemdService() {
  const serviceDir = getServiceDir();
  const servicePath = getServicePath();
  if (!fs7.existsSync(serviceDir)) {
    fs7.mkdirSync(serviceDir, { recursive: true });
  }
  fs7.writeFileSync(servicePath, buildUnitFile(), { encoding: "utf-8", mode: 420 });
  console.log(`Wrote systemd unit: ${servicePath}`);
  try {
    await execFileAsync2("systemctl", ["--user", "daemon-reload"]);
    await execFileAsync2("systemctl", ["--user", "enable", "walccy.service"]);
    await execFileAsync2("systemctl", ["--user", "start", "walccy.service"]);
    console.log("Walccy service enabled and started.");
  } catch (err) {
    console.warn(
      `systemctl command failed (is systemd running for your user?): ${String(err)}`
    );
    console.warn(`You can start manually: systemctl --user start walccy`);
  }
}
async function uninstallSystemdService() {
  const servicePath = getServicePath();
  try {
    await execFileAsync2("systemctl", ["--user", "stop", "walccy.service"]);
  } catch {
  }
  try {
    await execFileAsync2("systemctl", ["--user", "disable", "walccy.service"]);
  } catch {
  }
  if (fs7.existsSync(servicePath)) {
    fs7.unlinkSync(servicePath);
    console.log(`Removed systemd unit: ${servicePath}`);
  } else {
    console.log("No systemd unit file found.");
  }
  try {
    await execFileAsync2("systemctl", ["--user", "daemon-reload"]);
  } catch {
  }
  console.log("Walccy service uninstalled.");
}
async function getServiceStatus() {
  const servicePath = getServicePath();
  if (!fs7.existsSync(servicePath)) {
    return "not-installed";
  }
  try {
    const { stdout } = await execFileAsync2("systemctl", [
      "--user",
      "is-active",
      "walccy.service"
    ]);
    const status = stdout.trim();
    return status === "active" ? "running" : "stopped";
  } catch {
    return "stopped";
  }
}

// src/index.ts
var qrcode = require("qrcode-terminal");
var program = new import_commander.Command();
program.name("walccy").version(package_default.version).description("Walccy \u2014 Claude session daemon");
program.command("start").description("Start the Walccy daemon").option("-f, --foreground", "Run in the foreground (blocks)", false).action(async (opts) => {
  if (!opts.foreground) {
    console.log(
      "Use --foreground to run in the foreground, or install as a systemd service:\n  walccy install-service\n  systemctl --user start walccy"
    );
    process.exit(0);
  }
  process.env["WALCCY_FOREGROUND"] = "1";
  const daemon = new Daemon();
  const shutdown = async () => {
    console.log("\nShutting down\u2026");
    await daemon.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
  try {
    await daemon.start();
  } catch (err) {
    console.error("Failed to start daemon:", err);
    process.exit(1);
  }
});
program.command("stop").description("Stop the Walccy daemon (via systemd)").action(async () => {
  const { execFile: execFile3 } = await import("child_process");
  const { promisify: promisify3 } = await import("util");
  const execFileAsync3 = promisify3(execFile3);
  try {
    await execFileAsync3("systemctl", ["--user", "stop", "walccy.service"]);
    console.log("Walccy daemon stopped.");
  } catch {
    console.error(
      "Could not stop via systemctl. Is the service installed?\nTry: systemctl --user stop walccy"
    );
  }
});
program.command("status").description("Show daemon status").action(async () => {
  const status = await getServiceStatus();
  const config = loadConfig();
  const tailscaleIP = await getTailscaleIP();
  console.log(`Service status : ${status}`);
  console.log(`Config file    : ${getConfigPath()}`);
  console.log(`Port           : ${config.port}`);
  if (config.authSecret) {
    const fp = crypto4.createHash("sha256").update(config.authSecret).digest("hex").slice(0, 8);
    console.log(`Auth secret    : set (fp: ${fp})`);
  } else {
    console.log(`Auth secret    : unset`);
  }
  console.log(`Tailscale IP   : ${tailscaleIP ?? "(not available)"}`);
  console.log(`Dev mode       : ${process.env["WALCCY_DEV_MODE"] === "1" ? "yes" : "no"}`);
});
program.command("sessions").description("List active sessions as JSON (reads daemon state via WS)").action(async () => {
  const config = loadConfig();
  const { WebSocket: WebSocket3 } = await import("ws");
  const bindAddr = process.env["WALCCY_DEV_MODE"] === "1" ? "127.0.0.1" : await getTailscaleIP() ?? "127.0.0.1";
  const ws = new WebSocket3(`ws://${bindAddr}:${config.port}`);
  const timeout = setTimeout(() => {
    console.error("Connection timed out");
    ws.close();
    process.exit(1);
  }, 5e3);
  timeout.unref();
  ws.on("open", () => {
    ws.send(
      JSON.stringify({
        type: "AUTH",
        secret: config.authSecret,
        clientId: "walccy-cli",
        clientName: "walccy-cli"
      })
    );
  });
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === "AUTH_OK") {
      ws.send(JSON.stringify({ type: "LIST_SESSIONS" }));
    } else if (msg.type === "SESSIONS") {
      clearTimeout(timeout);
      console.log(JSON.stringify(msg.sessions, null, 2));
      ws.close();
    } else if (msg.type === "AUTH_FAIL") {
      clearTimeout(timeout);
      console.error("Auth failed");
      ws.close();
      process.exit(1);
    }
  });
  ws.on("error", (err) => {
    clearTimeout(timeout);
    console.error("WebSocket error:", err.message);
    console.error("Is the daemon running? Try: walccy start --foreground");
    process.exit(1);
  });
});
program.command("pair").description("Display QR code for mobile pairing").action(async () => {
  const config = loadConfig();
  const tailscaleIP = await getTailscaleIP();
  const hostname2 = os7.hostname();
  const pairingData = {
    v: 1,
    host: tailscaleIP ?? hostname2,
    port: config.port,
    secret: config.authSecret,
    label: hostname2
  };
  const pairingJson = JSON.stringify(pairingData);
  console.log("\nWalccy pairing QR code:");
  console.log("Scan with the Walccy mobile app\n");
  qrcode.generate(pairingJson, { small: true }, (qr) => {
    console.log(qr);
  });
  console.log("\nPairing data:");
  console.log(JSON.stringify(pairingData, null, 2));
  if (!tailscaleIP) {
    console.warn("\nWarning: Tailscale not detected. The host field may not be reachable.");
  }
});
program.command("config").description("Show current configuration").action(() => {
  const config = loadConfig();
  const configPath = getConfigPath();
  console.log(`Config file: ${configPath}
`);
  console.log(JSON.stringify(config, null, 2));
});
program.command("init").description("Initialize configuration (generates auth secret if missing)").action(() => {
  const config = loadConfig();
  const configPath = getConfigPath();
  console.log(`Config initialized at: ${configPath}`);
  console.log(`Auth secret: ${config.authSecret}`);
  console.log("\nRun `walccy pair` to get the QR code for mobile pairing.");
});
program.command("install-service").description("Install Walccy as a systemd user service").action(async () => {
  try {
    await installSystemdService();
  } catch (err) {
    console.error("Failed to install service:", err);
    process.exit(1);
  }
});
program.command("uninstall").description("Uninstall Walccy service and remove config").action(async () => {
  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  rl.question(
    "This will stop and remove the Walccy service. Continue? [y/N] ",
    async (answer) => {
      rl.close();
      if (answer.toLowerCase() !== "y") {
        console.log("Aborted.");
        return;
      }
      try {
        await uninstallSystemdService();
        const configPath = getConfigPath();
        const configDir = path10.dirname(configPath);
        const fs10 = await import("fs");
        if (fs10.existsSync(configDir)) {
          fs10.rmSync(configDir, { recursive: true, force: true });
          console.log(`Removed config directory: ${configDir}`);
        }
        const logDir2 = path10.join(os7.homedir(), ".walccy");
        if (fs10.existsSync(logDir2)) {
          fs10.rmSync(logDir2, { recursive: true, force: true });
          console.log(`Removed log directory: ${logDir2}`);
        }
        console.log("Walccy uninstalled successfully.");
      } catch (err) {
        console.error("Uninstall error:", err);
        process.exit(1);
      }
    }
  );
});
program.command("register-session").description("Register a shell session with the daemon (used by shell integration)").option("--cwd <path>", "Working directory").option("--pid <pid>", "Shell PID").action((opts) => {
  const cwd = opts.cwd ?? process.cwd();
  const pid = opts.pid ?? String(process.pid);
  process.stdout.write(`[walccy] session registered: pid=${pid} cwd=${cwd}
`);
});
program.command("unregister-session").description("Unregister a shell session (used by shell integration)").option("--pid <pid>", "Shell PID").action((opts) => {
  const pid = opts.pid ?? String(process.pid);
  process.stdout.write(`[walccy] session unregistered: pid=${pid}
`);
});
program.command("install-shell").description(
  "Install a shell function in your bashrc/zshrc so that running `claude` automatically wraps it via walccy."
).action(async () => {
  const { installShellIntegration: installShellIntegration2 } = await Promise.resolve().then(() => (init_shell_installer(), shell_installer_exports));
  const result = installShellIntegration2();
  for (const p of result.modified) {
    console.log(`  modified: ${p}`);
  }
  for (const s of result.skipped) {
    console.log(`  skipped:  ${s}`);
  }
  if (result.modified.length > 0) {
    console.log("\nOpen a new shell (or `source` the file above) to activate.");
  }
});
program.command("uninstall-shell").description("Remove the walccy shell integration from your bashrc/zshrc.").action(async () => {
  const { uninstallShellIntegration: uninstallShellIntegration2 } = await Promise.resolve().then(() => (init_shell_installer(), shell_installer_exports));
  const result = uninstallShellIntegration2();
  for (const p of result.modified) {
    console.log(`  cleaned:  ${p}`);
  }
  for (const s of result.skipped) {
    console.log(`  skipped:  ${s}`);
  }
});
program.command("wrap").description(
  "Run a command (default: claude) inside a PTY whose output is mirrored to the running daemon, so the mobile app can see it and send input back."
).argument("[args...]", 'Command and arguments (defaults to "claude")').allowUnknownOption(true).action(async (args) => {
  const { runWrapper: runWrapper2 } = await Promise.resolve().then(() => (init_wrap_cli(), wrap_cli_exports));
  await runWrapper2(args ?? []);
});
var KNOWN_SUBCOMMANDS = /* @__PURE__ */ new Set([
  ...program.commands.flatMap((c) => [c.name(), ...c.aliases()]),
  "help"
]);
var firstArg = process.argv[2];
if (firstArg && !firstArg.startsWith("-") && !KNOWN_SUBCOMMANDS.has(firstArg)) {
  process.argv.splice(2, 0, "wrap");
}
program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
