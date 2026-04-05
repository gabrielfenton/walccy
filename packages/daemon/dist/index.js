#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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

// src/index.ts
var import_commander = require("commander");
var os4 = __toESM(require("os"));
var path6 = __toESM(require("path"));

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
  sessionNameStrategy: "cwd-basename"
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
  if (!merged.authSecret) {
    merged.authSecret = crypto.randomBytes(32).toString("hex");
  }
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  saveConfig(merged);
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
  lines = [];
  maxLines;
  totalReceived = 0;
  // Global monotonically increasing line index (never resets)
  nextIndex = 0;
  constructor(maxLines = 1e4) {
    this.maxLines = maxLines;
  }
  /**
   * Append a new line to the buffer. Returns the stored BufferedLine.
   */
  push(line) {
    const stored = {
      ...line,
      index: this.nextIndex++,
      content: stripAnsi(line.rawContent)
    };
    this.lines.push(stored);
    this.totalReceived++;
    if (this.lines.length > this.maxLines) {
      this.lines.shift();
    }
    return stored;
  }
  /**
   * Return lines starting from `fromIndex` (global index), up to `count` lines.
   * If `fromIndex` is undefined, returns from the start of the current buffer.
   * If `count` is undefined, returns all available lines from `fromIndex`.
   */
  getLines(fromIndex, count) {
    let result = this.lines;
    if (fromIndex !== void 0) {
      result = result.filter((l) => l.index >= fromIndex);
    }
    if (count !== void 0) {
      result = result.slice(0, count);
    }
    return result;
  }
  /**
   * Return the most recent `count` lines.
   */
  getRecent(count) {
    if (count >= this.lines.length) {
      return [...this.lines];
    }
    return this.lines.slice(this.lines.length - count);
  }
  get totalLinesReceived() {
    return this.totalReceived;
  }
  get size() {
    return this.lines.length;
  }
  clear() {
    this.lines = [];
  }
};

// src/logger.ts
var winston = __toESM(require("winston"));
var path2 = __toESM(require("path"));
var os2 = __toESM(require("os"));
var fs2 = __toESM(require("fs"));
var logDir = path2.join(os2.homedir(), ".walccy", "logs");
if (!fs2.existsSync(logDir)) {
  fs2.mkdirSync(logDir, { recursive: true });
}
var logFile = path2.join(logDir, "daemon.log");
var isForeground = process.env["WALCCY_FOREGROUND"] === "1";
var transports2 = [
  new winston.transports.File({
    filename: logFile,
    maxsize: 10 * 1024 * 1024,
    // 10 MB
    maxFiles: 3,
    tailable: true,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    )
  })
];
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
var logger = winston.createLogger({
  level: process.env["WALCCY_LOG_LEVEL"] ?? "info",
  transports: transports2
});
function setLogLevel(level) {
  logger.level = level;
}
var logger_default = logger;

// src/session.ts
var Session = class extends import_events.EventEmitter {
  id;
  /** The original detected PID (or 0 for daemon-spawned sessions). */
  pid;
  /** node-pty instance — only set for sessions we own. */
  pty = null;
  /** Read-stream used to monitor external processes. */
  monitorStream = null;
  /** Whether we own the PTY (can accept writes). */
  owned = false;
  buffer;
  _info;
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
      connectedClients: []
    };
  }
  // ────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────
  get info() {
    return { ...this._info, lineCount: this.buffer.size };
  }
  updateStatus(status) {
    this._info.status = status;
  }
  /**
   * Spawn a new `claude` process in `cwd` via node-pty.
   * The daemon owns this PTY and can send input.
   */
  async spawn(cols = 220, rows = 50) {
    if (this.pty) return;
    const pty = require("node-pty");
    this.pty = pty.spawn("claude", [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: this._info.cwd,
      env: process.env
    });
    this.owned = true;
    this._info.status = "active";
    this.pty.onData((data) => {
      this._handleRawData(data, "stdout");
    });
    this.pty.onExit(() => {
      this._info.status = "ended";
      this.pty = null;
      this.owned = false;
      this.emit("exit");
    });
  }
  /**
   * Attach to an external process by reading its stdout fd via /proc.
   * Creates a read-only (no-write) session.
   */
  async attach() {
    if (this.pty || this.monitorStream) return;
    const fdPath = `/proc/${this.pid}/fd/1`;
    try {
      fs3.accessSync(fdPath, fs3.constants.R_OK);
    } catch {
      logger_default.warn(
        `Session ${this.id}: cannot read ${fdPath} \u2014 monitoring as external-only`
      );
      this._info.status = "active";
      this._startExitWatcher();
      return;
    }
    try {
      this.monitorStream = fs3.createReadStream(fdPath, {
        encoding: "utf8",
        autoClose: true
      });
      this._info.status = "active";
      this.monitorStream.on("data", (chunk) => {
        const data = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        this._handleRawData(data, "stdout");
      });
      this.monitorStream.on("error", (err) => {
        logger_default.debug(`Session ${this.id} monitor stream error: ${err.message}`);
        this.monitorStream = null;
      });
      this.monitorStream.on("close", () => {
        logger_default.debug(`Session ${this.id} monitor stream closed`);
        this.monitorStream = null;
      });
    } catch (err) {
      logger_default.debug(`Session ${this.id}: failed to open ${fdPath}: ${String(err)}`);
      this._info.status = "active";
    }
    this._startExitWatcher();
  }
  /**
   * Send input to the owned PTY.
   * No-ops for external sessions (read-only).
   */
  write(data, clientId) {
    if (!this.owned || !this.pty) {
      logger_default.warn(
        `Session ${this.id}: write attempted on non-owned session (clientId=${clientId ?? "unknown"})`
      );
      return;
    }
    const line = this.buffer.push({
      rawContent: data,
      content: data,
      timestamp: Date.now(),
      source: "input",
      inputClientId: clientId
    });
    this._info.lastActivityAt = Date.now();
    this.emit("data", [line]);
    this.pty.write(data);
  }
  resize(cols, rows) {
    if (!this.owned || !this.pty) return;
    this.pty.resize(cols, rows);
  }
  kill() {
    if (this.pty) {
      try {
        this.pty.kill();
      } catch {
      }
      this.pty = null;
    }
    if (this.monitorStream) {
      this.monitorStream.destroy();
      this.monitorStream = null;
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
    const segments = data.split(/\r?\n/);
    const bufferedLines = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (i === segments.length - 1 && seg === "") continue;
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
      this.emit("data", bufferedLines);
    }
  }
  /**
   * Poll /proc/{pid} to detect when the external process exits.
   */
  _startExitWatcher() {
    const procDir = `/proc/${this.pid}`;
    const timer = setInterval(() => {
      if (!fs3.existsSync(procDir)) {
        clearInterval(timer);
        this._info.status = "ended";
        this.emit("exit");
      }
    }, 2e3);
    timer.unref();
  }
};

// src/session-manager.ts
var SessionManager = class extends import_events2.EventEmitter {
  sessions = /* @__PURE__ */ new Map();
  /** Maps detected PID → session ID to avoid duplicate sessions. */
  pidToSessionId = /* @__PURE__ */ new Map();
  maxBufferLines;
  constructor(maxBufferLines = 1e4) {
    super();
    this.maxBufferLines = maxBufferLines;
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
    session.on("data", () => {
      this.emit("session-updated", session.id, {
        lastActivityAt: session.info.lastActivityAt,
        lineCount: session.info.lineCount,
        status: session.info.status
      });
    });
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
    session.on("data", () => {
      this.emit("session-updated", session.id, {
        lastActivityAt: session.info.lastActivityAt,
        lineCount: session.info.lineCount,
        status: session.info.status
      });
    });
    session.on("exit", () => {
      logger_default.info(`Spawned session ${session.id} exited`);
      this.removeSession(session.id);
    });
    await session.spawn();
    logger_default.info(`Spawned session: id=${session.id} cwd=${cwd} name=${name}`);
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
      this.emit("session-updated", sessionId, {
        connectedClients: [...info.connectedClients, clientId]
      });
    }
  }
  removeClientFromSession(sessionId, clientId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const info = session.info;
    const updated = info.connectedClients.filter((c) => c !== clientId);
    this.emit("session-updated", sessionId, { connectedClients: updated });
  }
  // ────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────
  deriveName(cwd) {
    return path3.basename(cwd) || cwd;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event, listener) {
    return super.on(event, listener);
  }
};

// src/process-scanner.ts
var import_events3 = require("events");
var fs4 = __toESM(require("fs"));
var path4 = __toESM(require("path"));
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
      entries = fs4.readdirSync("/proc");
    } catch (err) {
      logger_default.error(`Cannot read /proc: ${String(err)}`);
      return;
    }
    for (const entry of entries) {
      const pid = parseInt(entry, 10);
      if (isNaN(pid) || pid <= 0) continue;
      const isClaudeProcess = this.isClaude(pid);
      if (!isClaudeProcess) continue;
      currentPids.add(pid);
      if (!this.knownPids.has(pid)) {
        const cwd = this.readCwd(pid);
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
  isClaude(pid) {
    const cmdlinePath = path4.join("/proc", String(pid), "cmdline");
    try {
      const raw = fs4.readFileSync(cmdlinePath, "utf8");
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
  readCwd(pid) {
    const cwdLink = path4.join("/proc", String(pid), "cwd");
    try {
      return fs4.readlinkSync(cwdLink);
    } catch {
      return null;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event, listener) {
    return super.on(event, listener);
  }
};

// src/ws-server.ts
var http = __toESM(require("http"));
var import_ws = require("ws");
var import_uuid2 = require("uuid");
var INPUT_LOCK_TTL_MS = 2e3;
var WsServer = class {
  constructor(sessionManager, config, bindAddress) {
    this.sessionManager = sessionManager;
    this.config = config;
    this.bindAddress = bindAddress;
  }
  httpServer = null;
  wss = null;
  clients = /* @__PURE__ */ new Map();
  inputLocks = /* @__PURE__ */ new Map();
  // ────────────────────────────────────────────
  // Lifecycle
  // ────────────────────────────────────────────
  async start() {
    this.httpServer = http.createServer();
    this.wss = new import_ws.WebSocketServer({ server: this.httpServer });
    this.wss.on("connection", (ws) => {
      this._handleConnection(ws);
    });
    await new Promise((resolve2, reject) => {
      this.httpServer.listen(this.config.port, this.bindAddress, () => {
        logger_default.info(
          `WebSocket server listening on ws://${this.bindAddress}:${this.config.port}`
        );
        resolve2();
      });
      this.httpServer.once("error", reject);
    });
    this.sessionManager.on("session-added", (session) => {
      this.broadcastSessionAdded(session);
    });
    this.sessionManager.on("session-removed", (sessionId) => {
      this.broadcastSessionRemoved(sessionId);
    });
    this.sessionManager.on(
      "session-updated",
      (sessionId, changes) => {
        this.broadcastSessionUpdated(sessionId, changes);
      }
    );
    this.sessionManager.getAllSessions().forEach((session) => {
      session.on("data", (lines) => {
        this.broadcastOutput(session.id, lines);
      });
    });
  }
  stop() {
    this.wss?.close();
    this.httpServer?.close();
    logger_default.info("WebSocket server stopped");
  }
  // ────────────────────────────────────────────
  // Broadcast helpers
  // ────────────────────────────────────────────
  broadcastSessionAdded(session) {
    const msg = { type: "SESSION_ADDED", session };
    this._broadcastAll(msg);
    const sessionObj = this.sessionManager.getSession(session.id);
    if (sessionObj) {
      sessionObj.on("data", (lines) => {
        this.broadcastOutput(session.id, lines);
      });
    }
  }
  broadcastSessionRemoved(sessionId) {
    const msg = { type: "SESSION_REMOVED", sessionId };
    this._broadcastAll(msg);
  }
  broadcastSessionUpdated(sessionId, changes) {
    const msg = { type: "SESSION_UPDATED", sessionId, changes };
    this._broadcastAll(msg);
  }
  broadcastOutput(sessionId, lines) {
    const msg = { type: "OUTPUT", sessionId, lines };
    this._broadcastToSession(sessionId, msg);
  }
  // ────────────────────────────────────────────
  // Connection handling
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
    this.clients.set(clientId, client);
    logger_default.debug(`WS client connected: ${clientId}`);
    ws.on("message", (raw) => {
      const text = typeof raw === "string" ? raw : raw.toString("utf8");
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        logger_default.warn(`WS client ${clientId}: invalid JSON, closing`);
        this._sendError(ws, "PARSE_ERROR", "Invalid JSON");
        ws.close(1002, "Invalid JSON");
        return;
      }
      this._handleMessage(client, msg);
    });
    ws.on("close", () => {
      logger_default.debug(`WS client disconnected: ${clientId}`);
      for (const sessionId of client.subscribedSessions) {
        this.sessionManager.removeClientFromSession(sessionId, clientId);
      }
      this.clients.delete(clientId);
    });
    ws.on("error", (err) => {
      logger_default.warn(`WS client ${clientId} error: ${err.message}`);
    });
    const authTimeout = setTimeout(() => {
      if (!client.isAuthenticated) {
        logger_default.warn(`WS client ${clientId}: auth timeout, closing`);
        ws.close(1008, "Auth timeout");
      }
    }, 1e4);
    authTimeout.unref();
  }
  _handleMessage(client, msg) {
    if (typeof msg !== "object" || msg === null || !("type" in msg)) {
      this._sendError(client.ws, "INVALID_MESSAGE", "Missing type field");
      return;
    }
    const typed = msg;
    if (!client.isAuthenticated) {
      if (typed.type !== "AUTH") {
        this._sendError(client.ws, "NOT_AUTHENTICATED", "Send AUTH first");
        client.ws.close(1008, "Not authenticated");
        return;
      }
      this._handleAuth(client, typed);
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
      default:
        this._sendError(client.ws, "UNKNOWN_TYPE", "Unknown message type");
    }
  }
  // ────────────────────────────────────────────
  // Message handlers
  // ────────────────────────────────────────────
  _handleAuth(client, msg) {
    if (msg.secret !== this.config.authSecret) {
      logger_default.warn(`WS client ${client.id}: auth failed`);
      const fail = {
        type: "AUTH_FAIL",
        reason: "Invalid secret"
      };
      this._send(client.ws, fail);
      client.ws.close(1008, "Auth failed");
      return;
    }
    client.isAuthenticated = true;
    client.name = msg.clientName || "unknown";
    const ok = { type: "AUTH_OK", clientId: client.id };
    this._send(client.ws, ok);
    logger_default.info(`WS client authenticated: ${client.id} (${client.name})`);
  }
  _handleListSessions(client) {
    const sessions = this.sessionManager.getAllSessions().map((s) => s.info);
    const msg = { type: "SESSIONS", sessions };
    this._send(client.ws, msg);
  }
  _handleSubscribe(client, msg) {
    const session = this.sessionManager.getSession(msg.sessionId);
    if (!session) {
      this._sendError(client.ws, "SESSION_NOT_FOUND", `Session ${msg.sessionId} not found`);
      return;
    }
    client.subscribedSessions.add(msg.sessionId);
    this.sessionManager.addClientToSession(msg.sessionId, client.id);
    const historyCount = this.config.historyOnConnect;
    const lines = msg.fromLine !== void 0 ? session.buffer.getLines(msg.fromLine) : session.buffer.getRecent(historyCount);
    const history = {
      type: "HISTORY",
      sessionId: msg.sessionId,
      lines,
      totalLines: session.buffer.totalLinesReceived
    };
    this._send(client.ws, history);
    logger_default.debug(
      `Client ${client.id} subscribed to session ${msg.sessionId}, sent ${lines.length} history lines`
    );
  }
  _handleUnsubscribe(client, msg) {
    client.subscribedSessions.delete(msg.sessionId);
    this.sessionManager.removeClientFromSession(msg.sessionId, client.id);
    logger_default.debug(`Client ${client.id} unsubscribed from session ${msg.sessionId}`);
  }
  _handleInput(client, msg) {
    const session = this.sessionManager.getSession(msg.sessionId);
    if (!session) {
      this._sendError(client.ws, "SESSION_NOT_FOUND", `Session ${msg.sessionId} not found`);
      return;
    }
    const lock = this.inputLocks.get(msg.sessionId);
    if (lock && lock.expiresAt > Date.now() && lock.clientId !== client.id) {
      const lockMsg = {
        type: "INPUT_LOCK",
        sessionId: msg.sessionId,
        lockedByClientId: lock.clientId,
        lockedByClientName: lock.clientName,
        expiresAt: lock.expiresAt
      };
      this._send(client.ws, lockMsg);
      return;
    }
    this.inputLocks.set(msg.sessionId, {
      clientId: client.id,
      clientName: client.name,
      expiresAt: Date.now() + INPUT_LOCK_TTL_MS
    });
    session.write(msg.data, client.id);
  }
  _handleResize(client, msg) {
    const session = this.sessionManager.getSession(msg.sessionId);
    if (!session) {
      this._sendError(client.ws, "SESSION_NOT_FOUND", `Session ${msg.sessionId} not found`);
      return;
    }
    session.resize(msg.cols, msg.rows);
  }
  _handlePing(client) {
    const pong = { type: "PONG", timestamp: Date.now() };
    this._send(client.ws, pong);
  }
  // ────────────────────────────────────────────
  // Sending helpers
  // ────────────────────────────────────────────
  _send(ws, msg) {
    if (ws.readyState !== import_ws.WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      logger_default.debug(`WS send error: ${String(err)}`);
    }
  }
  _sendError(ws, code, message) {
    const msg = { type: "ERROR", code, message };
    this._send(ws, msg);
  }
  _broadcastAll(msg) {
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
  _broadcastToSession(sessionId, msg) {
    const payload = JSON.stringify(msg);
    for (const client of this.clients.values()) {
      if (client.isAuthenticated && client.subscribedSessions.has(sessionId) && client.ws.readyState === import_ws.WebSocket.OPEN) {
        try {
          client.ws.send(payload);
        } catch (err) {
          logger_default.debug(`Session broadcast error to ${client.id}: ${String(err)}`);
        }
      }
    }
  }
};

// src/tailscale.ts
var import_child_process = require("child_process");
var import_util = require("util");
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
async function waitForTailscale(intervalMs = 1e4) {
  while (true) {
    const ip = await getTailscaleIP();
    if (ip !== null) {
      return ip;
    }
    logger_default.warn(
      `Tailscale not available yet \u2014 retrying in ${intervalMs / 1e3}s`
    );
    await delay(intervalMs);
  }
}
function delay(ms) {
  return new Promise((resolve2) => setTimeout(resolve2, ms));
}

// src/daemon.ts
var Daemon = class {
  config;
  sessionManager;
  processScanner;
  wsServer;
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
    this.wsServer = new WsServer(this.sessionManager, this.config, bindAddress);
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
    if (this.config.autoDetect) {
      this.processScanner.start(this.config.autoDetectInterval);
    }
    logger_default.info(
      `Walccy daemon started on ws://${bindAddress}:${this.config.port}`
    );
  }
  async stop() {
    logger_default.info("Walccy daemon stopping\u2026");
    this.processScanner?.stop();
    this.wsServer?.stop();
    for (const session of this.sessionManager?.getAllSessions() ?? []) {
      this.sessionManager.removeSession(session.id);
    }
    logger_default.info("Walccy daemon stopped");
  }
};

// src/installer.ts
var fs5 = __toESM(require("fs"));
var path5 = __toESM(require("path"));
var os3 = __toESM(require("os"));
var import_child_process2 = require("child_process");
var import_util2 = require("util");
var execFileAsync2 = (0, import_util2.promisify)(import_child_process2.execFile);
function getServiceDir() {
  return path5.join(os3.homedir(), ".config", "systemd", "user");
}
function getServicePath() {
  return path5.join(getServiceDir(), "walccy.service");
}
function buildUnitFile() {
  const execPath = process.execPath;
  const scriptPath = path5.resolve(__dirname, "..", "dist", "index.js");
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
  if (!fs5.existsSync(serviceDir)) {
    fs5.mkdirSync(serviceDir, { recursive: true });
  }
  fs5.writeFileSync(servicePath, buildUnitFile(), { encoding: "utf-8", mode: 420 });
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
  if (fs5.existsSync(servicePath)) {
    fs5.unlinkSync(servicePath);
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
  if (!fs5.existsSync(servicePath)) {
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
program.name("walccy").version("1.0.0").description("Walccy \u2014 Claude session daemon");
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
  console.log(`Auth secret    : ${config.authSecret.slice(0, 8)}\u2026 (truncated)`);
  console.log(`Tailscale IP   : ${tailscaleIP ?? "(not available)"}`);
  console.log(`Dev mode       : ${process.env["WALCCY_DEV_MODE"] === "1" ? "yes" : "no"}`);
});
program.command("sessions").description("List active sessions as JSON (reads daemon state via WS)").action(async () => {
  const config = loadConfig();
  const { WebSocket: WebSocket2 } = await import("ws");
  const bindAddr = process.env["WALCCY_DEV_MODE"] === "1" ? "127.0.0.1" : await getTailscaleIP() ?? "127.0.0.1";
  const ws = new WebSocket2(`ws://${bindAddr}:${config.port}`);
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
  let authed = false;
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === "AUTH_OK") {
      authed = true;
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
    void authed;
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
  const hostname2 = os4.hostname();
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
        const configDir = path6.dirname(configPath);
        const fs6 = await import("fs");
        if (fs6.existsSync(configDir)) {
          fs6.rmSync(configDir, { recursive: true, force: true });
          console.log(`Removed config directory: ${configDir}`);
        }
        const logDir2 = path6.join(os4.homedir(), ".walccy");
        if (fs6.existsSync(logDir2)) {
          fs6.rmSync(logDir2, { recursive: true, force: true });
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
program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
