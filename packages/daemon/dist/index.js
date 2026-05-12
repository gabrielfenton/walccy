#!/usr/bin/env node

// src/index.ts
import { Command } from "commander";
import * as crypto4 from "crypto";
import * as os6 from "os";
import * as path7 from "path";

// package.json
var package_default = {
  name: "walccyd",
  version: "2.0.0-alpha.1",
  private: true,
  type: "module",
  bin: {
    walccy: "./dist/index.js"
  },
  main: "./dist/index.js",
  scripts: {
    dev: "tsx watch src/index.ts",
    build: "tsup src/index.ts --format esm --dts",
    start: "node dist/index.js",
    test: "vitest run",
    typecheck: "tsc --noEmit"
  },
  dependencies: {
    "@anthropic-ai/claude-agent-sdk": "^0.2.138",
    "@walccy/protocol": "*",
    commander: "^12.1.0",
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
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
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
import { EventEmitter as EventEmitter4 } from "events";
import * as path4 from "path";

// src/session.ts
import { EventEmitter as EventEmitter2 } from "events";
import { v4 as uuidv4 } from "uuid";

// src/claude-driver.ts
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { execFileSync } from "child_process";
import * as fs3 from "fs";
import {
  query
} from "@anthropic-ai/claude-agent-sdk";

// src/stream-translator.ts
function translate(msg, _ctx) {
  switch (msg.type) {
    case "system":
      return translateSystem(msg);
    case "assistant":
      return translateAssistant(msg);
    case "user":
      return translateUser(msg);
    case "stream_event":
      return translateStreamEvent(msg);
    case "result":
      return [translateResult(msg)];
    case "rate_limit_event":
      return [translateRateLimit(msg)];
    case "tool_progress":
      return [translateToolProgress(msg)];
    default:
      return translateFallback(msg);
  }
}
function translateSystem(msg) {
  const sub = msg.subtype;
  switch (sub) {
    case "init":
      return [translateInit(msg)];
    case "status":
      return [translateStatus(msg)];
    case "compact_boundary":
      return [translateCompactBoundary(msg)];
    case "task_started":
      return [translateTaskStarted(msg)];
    case "task_progress":
      return [translateTaskProgress(msg)];
    case "task_updated":
      return [translateTaskUpdated(msg)];
    case "task_notification":
      return [translateTaskNotification(msg)];
    case "plugin_install":
      return [translatePluginInstall(msg)];
    case "memory_recall":
      return translateMemoryRecall(msg);
    case "permission_denied":
      return [translatePermissionDenied(msg)];
    case "elicitation_complete":
      return [translateElicitationComplete(msg)];
    case "hook_started":
      return [translateHookStarted(msg)];
    case "hook_progress":
      return [translateHookProgress(msg)];
    case "hook_response":
      return [translateHookResponse(msg)];
    case "mirror_error":
      return [translateMirrorError(msg)];
    default:
      return [];
  }
}
function translateInit(msg) {
  const agents = (msg.agents ?? []).map((name) => ({
    name
  }));
  const mcpServers = (msg.mcp_servers ?? []).map(
    (s) => ({
      name: s.name,
      status: s.status
    })
  );
  return {
    kind: "init",
    sessionId: msg.session_id,
    model: msg.model,
    cwd: msg.cwd,
    tools: msg.tools,
    agents,
    skills: msg.skills,
    slashCommands: msg.slash_commands,
    mcpServers,
    plugins: msg.plugins.map((p) => ({ name: p.name, path: p.path })),
    permissionMode: msg.permissionMode,
    memoryPaths: {},
    outputStyle: msg.output_style,
    claudeCodeVersion: msg.claude_code_version
  };
}
function translateStatus(msg) {
  const status = msg.status === null ? "idle" : msg.status === "requesting" || msg.status === "compacting" ? msg.status : "idle";
  return {
    kind: "status",
    status,
    permissionMode: msg.permissionMode
  };
}
function translateCompactBoundary(msg) {
  return {
    kind: "compact_boundary",
    trigger: msg.compact_metadata.trigger,
    preTokens: msg.compact_metadata.pre_tokens,
    postTokens: msg.compact_metadata.post_tokens,
    durationMs: msg.compact_metadata.duration_ms
  };
}
function translateTaskStarted(msg) {
  return {
    kind: "task_started",
    taskId: msg.task_id,
    parentToolUseId: msg.tool_use_id,
    description: msg.description
  };
}
function translateTaskProgress(msg) {
  return {
    kind: "task_progress",
    taskId: msg.task_id,
    message: msg.description
  };
}
function translateTaskUpdated(msg) {
  return {
    kind: "task_updated",
    taskId: msg.task_id,
    status: msg.patch.status ?? "running",
    description: msg.patch.description,
    error: msg.patch.error,
    isBackgrounded: msg.patch.is_backgrounded
  };
}
function translateTaskNotification(msg) {
  return {
    kind: "task_updated",
    taskId: msg.task_id,
    status: msg.status,
    description: msg.summary
  };
}
function translatePluginInstall(msg) {
  const m = msg;
  return {
    kind: "plugin_install",
    pluginId: m.plugin_id ?? m.pluginId ?? "unknown",
    status: m.status ?? "installing",
    message: m.message
  };
}
function translateMemoryRecall(msg) {
  const m = msg;
  const out = [];
  for (const mem of m.memories ?? []) {
    out.push({ kind: "memory_recall", path: mem.path, summary: mem.summary });
  }
  return out;
}
function translatePermissionDenied(msg) {
  const m = msg;
  const reason = m.reason === "auto_deny" || m.reason === "user_reject" || m.reason === "hook_deny" || m.reason === "rule_deny" ? m.reason : "other";
  return {
    kind: "permission_denied",
    toolUseId: m.tool_use_id ?? "",
    toolName: m.tool_name ?? "",
    reason,
    detail: m.detail
  };
}
function translateElicitationComplete(msg) {
  const m = msg;
  return {
    kind: "elicitation_complete",
    toolUseId: m.tool_use_id ?? "",
    result: m.result
  };
}
function translateHookStarted(msg) {
  const m = msg;
  return {
    kind: "hook_started",
    hookId: m.hook_id ?? m.hookId ?? "",
    event: m.event,
    toolUseId: m.tool_use_id,
    matcher: m.matcher
  };
}
function translateHookProgress(msg) {
  const m = msg;
  return {
    kind: "hook_progress",
    hookId: m.hook_id ?? m.hookId ?? "",
    message: m.message ?? "",
    data: m.data
  };
}
function translateHookResponse(msg) {
  const m = msg;
  return {
    kind: "hook_response",
    hookId: m.hook_id ?? m.hookId ?? "",
    decision: m.decision,
    reason: m.reason
  };
}
function translateMirrorError(msg) {
  const m = msg;
  return {
    kind: "error",
    code: m.code ?? "mirror_error",
    message: m.message ?? "mirror error",
    fatal: m.fatal ?? false
  };
}
function translateAssistant(msg) {
  const out = [];
  const messageId = typeof msg.message?.id === "string" ? msg.message.id : "unknown";
  const content = Array.isArray(msg.message?.content) ? msg.message.content : [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const type = block.type;
    if (type === "text") {
      const text = block.text ?? "";
      out.push({ kind: "assistant_text_done", messageId, fullText: text });
    } else if (type === "thinking") {
      const text = block.thinking ?? "";
      out.push({ kind: "thinking_done", messageId, fullText: text });
    } else if (type === "tool_use") {
      const tu = block;
      out.push({
        kind: "tool_use",
        messageId,
        toolUseId: tu.id ?? "",
        name: tu.name ?? "",
        input: tu.input ?? {},
        parentToolUseId: msg.parent_tool_use_id ?? null
      });
    }
  }
  return out;
}
function translateUser(msg) {
  const content = Array.isArray(msg.message?.content) ? msg.message.content : [];
  const out = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (block.type !== "tool_result") continue;
    const tr = block;
    out.push({
      kind: "tool_result",
      toolUseId: tr.tool_use_id ?? "",
      content: tr.content,
      isError: tr.is_error ?? false,
      structured: extractStructured(msg.tool_use_result)
    });
  }
  return out;
}
function extractStructured(raw) {
  if (!raw || typeof raw !== "object") return void 0;
  const r = raw;
  const out = {};
  if (typeof r.stdout === "string") out.stdout = r.stdout;
  if (typeof r.stderr === "string") out.stderr = r.stderr;
  if (typeof r.exitCode === "number") out.exitCode = r.exitCode;
  if (typeof r.isImage === "boolean") out.isImage = r.isImage;
  if (typeof r.interrupted === "boolean") out.interrupted = r.interrupted;
  if (typeof r.noOutputExpected === "boolean") {
    out.noOutputExpected = r.noOutputExpected;
  }
  return Object.keys(out).length === 0 ? void 0 : out;
}
function translateStreamEvent(msg) {
  const inner = msg.event;
  const parent = msg;
  const messageId = parent?.uuid ?? "";
  if (!inner || typeof inner !== "object") return [];
  if (inner.type === "content_block_delta" && "delta" in inner) {
    const delta = inner.delta;
    if (delta.type === "text_delta" && "text" in delta) {
      return [
        {
          kind: "assistant_text_delta",
          messageId,
          text: delta.text
        }
      ];
    }
    if (delta.type === "thinking_delta" && "thinking" in delta) {
      return [
        {
          kind: "thinking_delta",
          messageId,
          text: delta.thinking
        }
      ];
    }
  }
  return [];
}
function translateResult(msg) {
  const isSuccess = msg.subtype === "success";
  const successUsage = isSuccess ? msg.usage : null;
  return {
    kind: "turn_complete",
    stopReason: msg.stop_reason,
    durationMs: msg.duration_ms,
    cost: {
      total: msg.total_cost_usd ?? 0,
      inputTokens: successUsage?.input_tokens ?? 0,
      outputTokens: successUsage?.output_tokens ?? 0,
      cacheReadTokens: successUsage?.cache_read_input_tokens,
      cacheCreateTokens: successUsage?.cache_creation_input_tokens
    },
    modelUsage: msg.modelUsage,
    permissionDenials: isSuccess ? msg.permission_denials : void 0,
    isError: msg.is_error,
    result: isSuccess ? msg.result : void 0
  };
}
function translateRateLimit(msg) {
  return {
    kind: "rate_limit",
    info: {
      status: msg.rate_limit_info.status,
      resetsAt: msg.rate_limit_info.resetsAt,
      rateLimitType: msg.rate_limit_info.rateLimitType,
      utilization: msg.rate_limit_info.utilization,
      overageStatus: msg.rate_limit_info.overageStatus,
      overageResetsAt: msg.rate_limit_info.overageResetsAt,
      isUsingOverage: msg.rate_limit_info.isUsingOverage,
      surpassedThreshold: msg.rate_limit_info.surpassedThreshold
    }
  };
}
function translateToolProgress(msg) {
  const m = msg;
  return {
    kind: "tool_progress",
    toolUseId: m.tool_use_id ?? "",
    progress: m.progress ?? 0,
    message: m.message
  };
}
function translateFallback(_msg) {
  return [];
}
function buildPermissionRequest(args) {
  return {
    kind: "permission_request",
    requestId: args.requestId,
    toolUseId: args.toolUseId,
    toolName: args.toolName,
    input: args.input,
    title: args.title,
    description: args.description,
    suggestions: args.suggestions,
    agentId: args.agentId
  };
}

// src/logger.ts
import * as winston from "winston";
import * as path2 from "path";
import * as os2 from "os";
import * as fs2 from "fs";
var logDir = path2.join(os2.homedir(), ".walccy", "logs");
if (!fs2.existsSync(logDir)) {
  fs2.mkdirSync(logDir, { recursive: true, mode: 448 });
}
try {
  fs2.chmodSync(logDir, 448);
} catch {
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
var logger = winston.createLogger({
  level: process.env["WALCCY_LOG_LEVEL"] ?? "info",
  transports: transports2
});
function setLogLevel(level) {
  logger.level = level;
}
var logger_default = logger;

// src/claude-driver.ts
var cachedClaudePath;
function resolveClaudePath() {
  if (cachedClaudePath !== void 0) return cachedClaudePath || void 0;
  const override = process.env["WALCCY_CLAUDE_PATH"];
  if (override && fs3.existsSync(override)) {
    cachedClaudePath = override;
    return cachedClaudePath;
  }
  try {
    const out = execFileSync("which", ["claude"], { encoding: "utf8" }).trim();
    if (out && fs3.existsSync(out)) {
      cachedClaudePath = out;
      logger_default.info(`ClaudeDriver: resolved claude binary \u2192 ${out}`);
      return cachedClaudePath;
    }
  } catch {
  }
  cachedClaudePath = "";
  return void 0;
}
var UserMessageQueue = class {
  buffer = [];
  waiter = null;
  closed = false;
  push(msg) {
    if (this.closed) {
      logger_default.warn("UserMessageQueue: push after close \u2014 dropping message");
      return;
    }
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(msg);
    } else {
      this.buffer.push(msg);
    }
  }
  close() {
    this.closed = true;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(null);
    }
  }
  async *iter(sessionId) {
    while (true) {
      let next;
      if (this.buffer.length > 0) {
        next = this.buffer.shift();
      } else if (this.closed) {
        return;
      } else {
        next = await new Promise((resolve3) => {
          this.waiter = resolve3;
        });
      }
      if (next === null) return;
      const userMsg = {
        type: "user",
        message: {
          role: "user",
          // The block shapes carried by walccy match Anthropic's MessageParam
          // content types at runtime; the cast is necessary because their
          // public TS shape uses branded discriminants from a different
          // import path.
          content: next.content
        },
        parent_tool_use_id: next.parent_tool_use_id ?? null,
        session_id: sessionId()
      };
      yield userMsg;
    }
  }
};
var ClaudeDriver = class extends EventEmitter {
  constructor(opts) {
    super();
    this.opts = opts;
  }
  opts;
  inputQueue = new UserMessageQueue();
  q = null;
  pending = /* @__PURE__ */ new Map();
  currentSessionId = "";
  started = false;
  stopped = false;
  /** Begin pumping. Resolves when the first SDK message arrives. */
  async start() {
    if (this.started) throw new Error("ClaudeDriver: already started");
    this.started = true;
    const canUseTool = (toolName, input, callbackOptions) => this.handlePermissionRequest(toolName, input, callbackOptions);
    const options = {
      cwd: this.opts.cwd,
      permissionMode: this.opts.permissionMode,
      model: this.opts.model,
      agents: this.opts.agents,
      agent: this.opts.agent,
      tools: this.opts.tools,
      allowedTools: this.opts.allowedTools,
      disallowedTools: this.opts.disallowedTools,
      additionalDirectories: this.opts.additionalDirectories,
      resume: this.opts.resume,
      forkSession: this.opts.forkSession,
      env: this.opts.env ?? process.env,
      extraArgs: this.opts.extraArgs,
      pathToClaudeCodeExecutable: resolveClaudePath(),
      canUseTool,
      includePartialMessages: true
    };
    const promptIter = this.inputQueue.iter(() => this.currentSessionId);
    this.q = query({ prompt: promptIter, options });
    this.pump().catch((err) => {
      logger_default.error(`ClaudeDriver pump error: ${err}`);
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    });
  }
  async pump() {
    if (!this.q) return;
    try {
      for await (const msg of this.q) {
        this.captureSessionId(msg);
        const events = translate(msg);
        for (const ev of events) this.emit("event", ev);
      }
    } catch (err) {
      logger_default.error(`ClaudeDriver pump caught: ${err}`);
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.emit("end");
    }
  }
  captureSessionId(msg) {
    const sid = msg.session_id;
    if (typeof sid === "string" && sid.length > 0) {
      this.currentSessionId = sid;
    }
  }
  /** SDK session id (assigned after init). Empty string before. */
  get sdkSessionId() {
    return this.currentSessionId;
  }
  // ── Control plane ──
  sendUserMessage(content) {
    if (this.stopped) {
      logger_default.warn("ClaudeDriver.sendUserMessage after stop \u2014 dropped");
      return;
    }
    this.inputQueue.push({ content });
  }
  async interrupt() {
    if (!this.q) return;
    await this.q.interrupt();
  }
  async setPermissionMode(mode) {
    if (!this.q) return;
    await this.q.setPermissionMode(mode);
  }
  async setModel(model) {
    if (!this.q) return;
    await this.q.setModel(model);
  }
  /** Stop the driver. Idempotent. Closes input; SDK pump drains. */
  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.inputQueue.close();
    if (this.q) {
      try {
        await this.q.interrupt();
      } catch (err) {
        logger_default.warn(`ClaudeDriver.stop interrupt failed: ${err}`);
      }
    }
  }
  // ── Permission plane ──
  handlePermissionRequest(toolName, input, cb) {
    return new Promise((resolve3) => {
      const requestId = randomUUID();
      const pending = {
        requestId,
        toolUseId: cb.toolUseID,
        toolName,
        input,
        resolve: resolve3
      };
      this.pending.set(requestId, pending);
      this.emit(
        "event",
        buildPermissionRequest({
          requestId,
          toolUseId: cb.toolUseID,
          toolName,
          input,
          title: cb.title,
          description: cb.description,
          suggestions: cb.suggestions,
          agentId: cb.agentID
        })
      );
      cb.signal.addEventListener("abort", () => {
        if (this.pending.delete(requestId)) {
          resolve3({ behavior: "deny", message: "aborted" });
        }
      });
    });
  }
  /**
   * App-side decision arrived. `decision` becomes `behavior`. `updatedInput`
   * lets the app rewrite the tool call (used by AskUserQuestion to pass the
   * user's answer back as the tool input).
   */
  resolvePermission(args) {
    const pending = this.pending.get(args.requestId);
    if (!pending) return false;
    this.pending.delete(args.requestId);
    if (args.decision === "allow") {
      pending.resolve({
        behavior: "allow",
        updatedInput: args.updatedInput ?? pending.input
      });
    } else {
      pending.resolve({
        behavior: "deny",
        message: args.message ?? "user rejected",
        interrupt: false
      });
    }
    return true;
  }
  /** Helper for plan/answer paths — same as resolvePermission with allow. */
  resolveByToolUseId(args) {
    for (const [requestId, pending] of this.pending.entries()) {
      if (pending.toolUseId === args.toolUseId) {
        return this.resolvePermission({
          requestId,
          decision: args.decision,
          updatedInput: args.updatedInput,
          message: args.message
        });
      }
    }
    return false;
  }
};

// src/event-buffer.ts
var COALESCE_KINDS = /* @__PURE__ */ new Set([
  "assistant_text_delta",
  "thinking_delta"
]);
var RingEventBuffer = class {
  ring;
  maxEvents;
  /** Write position (next slot). */
  head = 0;
  /** Number of items currently stored. */
  count = 0;
  /** Monotonic index of the next event to be assigned. */
  nextIndex = 0;
  constructor(opts = {}) {
    this.maxEvents = opts.maxEvents ?? 1e4;
    this.ring = new Array(this.maxEvents);
  }
  /**
   * Append an event. Returns the stored event plus its assigned index.
   * For coalescable kinds, attempts to merge into the most recent entry
   * sharing the same `messageId`; on a successful merge no new index is
   * minted and the returned `index` is the existing one.
   */
  push(event) {
    if (COALESCE_KINDS.has(event.kind)) {
      const merged = this.tryMerge(event);
      if (merged !== null) return merged;
    }
    const index = this.nextIndex++;
    const entry = { index, event };
    this.ring[this.head] = entry;
    this.head = (this.head + 1) % this.maxEvents;
    if (this.count < this.maxEvents) this.count++;
    return { event, index };
  }
  /**
   * Return the most recent entry's event in-place if it can absorb the new
   * delta. Otherwise null (caller should append a fresh entry).
   */
  tryMerge(next) {
    if (this.count === 0) return null;
    const lastSlot = (this.head - 1 + this.maxEvents) % this.maxEvents;
    const last = this.ring[lastSlot];
    if (!last) return null;
    if (last.event.kind !== next.kind) return null;
    if (next.kind === "assistant_text_delta" && last.event.kind === "assistant_text_delta" && last.event.messageId === next.messageId) {
      last.event = {
        ...last.event,
        text: last.event.text + next.text
      };
      return { event: last.event, index: last.index };
    }
    if (next.kind === "thinking_delta" && last.event.kind === "thinking_delta" && last.event.messageId === next.messageId) {
      last.event = {
        ...last.event,
        text: last.event.text + next.text
      };
      return { event: last.event, index: last.index };
    }
    return null;
  }
  /**
   * Return events with index ≥ `startIndex` in chronological order, plus
   * the oldest index still resident (for scrollback-gap detection).
   */
  getFrom(startIndex) {
    const ordered = this.materialize();
    const firstAvailableIndex = ordered.length === 0 ? 0 : ordered[0].index;
    let lo = 0;
    let hi = ordered.length;
    while (lo < hi) {
      const mid = lo + hi >>> 1;
      if (ordered[mid].index < startIndex) lo = mid + 1;
      else hi = mid;
    }
    return {
      events: ordered.slice(lo).map((e) => e.event),
      firstAvailableIndex
    };
  }
  getTail(count) {
    const ordered = this.materialize();
    if (count >= ordered.length) return ordered.map((e) => e.event);
    return ordered.slice(ordered.length - count).map((e) => e.event);
  }
  clear() {
    this.ring = new Array(this.maxEvents);
    this.head = 0;
    this.count = 0;
  }
  get size() {
    return this.count;
  }
  get totalCount() {
    return this.nextIndex;
  }
  get firstAvailableIndex() {
    if (this.count === 0) return 0;
    const start = (this.head - this.count + this.maxEvents) % this.maxEvents;
    return this.ring[start].index;
  }
  materialize() {
    if (this.count === 0) return [];
    const out = new Array(this.count);
    const start = (this.head - this.count + this.maxEvents) % this.maxEvents;
    for (let i = 0; i < this.count; i++) {
      out[i] = this.ring[(start + i) % this.maxEvents];
    }
    return out;
  }
};

// src/session.ts
var Session = class extends EventEmitter2 {
  id;
  /** Daemon doesn't own a child PID directly — the SDK manages that. */
  pid = 0;
  driver = null;
  buffer;
  _info;
  constructor(name, cwd, maxBufferEvents = 1e4) {
    super();
    this.id = uuidv4();
    this.buffer = new RingEventBuffer({ maxEvents: maxBufferEvents });
    this._info = {
      id: this.id,
      pid: 0,
      name,
      cwd,
      status: "idle",
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      waitingForInput: false,
      connectedClients: [],
      owned: true,
      costSoFar: 0,
      lastEventIndex: -1
    };
  }
  // ────────────────────────────────────────────
  // Lifecycle
  // ────────────────────────────────────────────
  async spawn(opts) {
    if (this.driver) {
      logger_default.warn(`Session ${this.id}: spawn called twice \u2014 ignoring`);
      return;
    }
    const extraArgs = {};
    if (opts.worktree !== void 0 && opts.worktree !== false) {
      extraArgs["worktree"] = typeof opts.worktree === "string" ? opts.worktree : null;
    }
    if (opts.outputStyle) extraArgs["output-style"] = opts.outputStyle;
    if (opts.effortLevel) extraArgs["effort"] = opts.effortLevel;
    const driverOpts = {
      cwd: opts.cwd,
      permissionMode: opts.permissionMode,
      model: opts.model,
      agent: opts.agent,
      agents: opts.agents,
      resume: opts.resumeSessionId,
      env: this._sanitizedEnv(),
      extraArgs: Object.keys(extraArgs).length > 0 ? extraArgs : void 0
    };
    if (opts.permissionMode) this._info.permissionMode = opts.permissionMode;
    if (opts.model) this._info.model = opts.model;
    if (opts.effortLevel) this._info.effortLevel = opts.effortLevel;
    this.driver = new ClaudeDriver(driverOpts);
    this.driver.on("event", (ev) => this._onEvent(ev));
    this.driver.on("end", () => {
      logger_default.info(`Session ${this.id}: driver stream ended`);
      this._info.status = "ended";
      this.emit("exit");
    });
    this.driver.on("error", (err) => {
      logger_default.error(`Session ${this.id}: driver error: ${err.message}`);
      const errorEvent = {
        kind: "error",
        code: "driver_error",
        message: err.message,
        fatal: false
      };
      this._onEvent(errorEvent);
    });
    await this.driver.start();
    this._info.status = "active";
  }
  /**
   * Send the user's next turn. `content` is multipart text+image content
   * matching MessageParam shape.
   */
  sendUserMessage(content) {
    if (!this.driver) {
      logger_default.warn(`Session ${this.id}: sendUserMessage with no driver`);
      return;
    }
    this._info.lastActivityAt = Date.now();
    this._info.waitingForInput = false;
    this.driver.sendUserMessage(content);
  }
  async interrupt() {
    if (!this.driver) return;
    await this.driver.interrupt();
  }
  async setPermissionMode(mode) {
    if (!this.driver) return;
    await this.driver.setPermissionMode(mode);
    this._info.permissionMode = mode;
  }
  async setModel(model) {
    if (!this.driver) return;
    await this.driver.setModel(model);
    this._info.model = model;
  }
  resolvePermission(args) {
    if (!this.driver) return false;
    return this.driver.resolvePermission(args);
  }
  resolveByToolUseId(args) {
    if (!this.driver) return false;
    return this.driver.resolveByToolUseId(args);
  }
  async kill() {
    if (!this.driver) return;
    await this.driver.stop();
    this._info.status = "ended";
  }
  // ────────────────────────────────────────────
  // Metadata
  // ────────────────────────────────────────────
  get info() {
    return { ...this._info, lastEventIndex: this.buffer.totalCount - 1 };
  }
  updateStatus(status) {
    this._info.status = status;
  }
  setConnectedClients(clients) {
    this._info.connectedClients = clients;
  }
  setName(name) {
    this._info.name = name;
  }
  get owned() {
    return true;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event, listener) {
    return super.on(event, listener);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emit(event, ...args) {
    return super.emit(event, ...args);
  }
  // ────────────────────────────────────────────
  // Internal
  // ────────────────────────────────────────────
  _onEvent(ev) {
    const { event, index } = this.buffer.push(ev);
    this._info.lastActivityAt = Date.now();
    switch (event.kind) {
      case "init":
        if (event.model) this._info.model = event.model;
        if (event.permissionMode) this._info.permissionMode = event.permissionMode;
        break;
      case "status":
        this._info.status = event.status === "requesting" || event.status === "compacting" ? "active" : "idle";
        if (event.permissionMode) this._info.permissionMode = event.permissionMode;
        break;
      case "permission_request":
        this._info.waitingForInput = true;
        break;
      case "turn_complete":
        this._info.status = "idle";
        this._info.costSoFar = (this._info.costSoFar ?? 0) + event.cost.total;
        break;
      default:
        break;
    }
    this._info.lastEventIndex = index;
    this.emit("session-event", event, index);
  }
  /** Allowlisted env passthrough for the SDK child process. */
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
      const v = process.env[key];
      if (v !== void 0) env[key] = v;
    }
    return env;
  }
};

// src/transcript-watcher.ts
import { EventEmitter as EventEmitter3 } from "events";
import * as fs4 from "fs";
import * as os3 from "os";
import * as path3 from "path";
var TranscriptWatcher = class extends EventEmitter3 {
  states = /* @__PURE__ */ new Map();
  filesInUse = /* @__PURE__ */ new Set();
  timer = null;
  baseDir;
  pollIntervalMs;
  mtimeSlackMs;
  constructor(opts = {}) {
    super();
    this.baseDir = opts.baseDir ?? path3.join(os3.homedir(), ".claude", "projects");
    this.pollIntervalMs = opts.pollIntervalMs ?? 2e3;
    this.mtimeSlackMs = opts.mtimeSlackMs ?? 5e3;
  }
  watch(sessionId, cwd, startedAt) {
    if (this.states.has(sessionId)) return;
    this.states.set(sessionId, {
      cwd,
      startedAt,
      file: null,
      offset: 0,
      carry: ""
    });
    if (!this.timer) {
      this.timer = setInterval(() => {
        void this.pollAll();
      }, this.pollIntervalMs);
      this.timer.unref();
    }
    void this.pollOne(sessionId);
  }
  unwatch(sessionId) {
    const s = this.states.get(sessionId);
    if (!s) return;
    if (s.file) this.filesInUse.delete(s.file);
    this.states.delete(sessionId);
    if (this.states.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  stopAll() {
    for (const id of Array.from(this.states.keys())) this.unwatch(id);
  }
  // ────────────────────────────────────────────
  async pollAll() {
    for (const id of Array.from(this.states.keys())) {
      await this.pollOne(id);
    }
  }
  async pollOne(sessionId) {
    const state = this.states.get(sessionId);
    if (!state) return;
    try {
      if (!state.file) {
        const file = await this.findCandidateFile(state.cwd, state.startedAt);
        if (!file) return;
        state.file = file;
        this.filesInUse.add(file);
      }
      const stat = await fs4.promises.stat(state.file).catch(() => null);
      if (!stat || stat.size <= state.offset) return;
      const length = stat.size - state.offset;
      const buf = Buffer.alloc(length);
      const fh = await fs4.promises.open(state.file, "r");
      try {
        await fh.read(buf, 0, length, state.offset);
      } finally {
        await fh.close();
      }
      state.offset = stat.size;
      const combined = state.carry + buf.toString("utf8");
      const nlIdx = combined.lastIndexOf("\n");
      const consumed = nlIdx >= 0 ? combined.slice(0, nlIdx) : "";
      state.carry = nlIdx >= 0 ? combined.slice(nlIdx + 1) : combined;
      if (!consumed) return;
      let latest = null;
      for (const line of consumed.split("\n")) {
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type === "summary" && typeof obj.summary === "string") {
            latest = obj.summary;
          }
        } catch {
        }
      }
      if (latest) this.emit("summary", sessionId, latest);
    } catch (err) {
      logger_default.debug(`TranscriptWatcher pollOne(${sessionId}) failed: ${String(err)}`);
    }
  }
  async findCandidateFile(cwd, startedAt) {
    const dir = path3.join(this.baseDir, encodeCwd(cwd));
    let entries;
    try {
      entries = await fs4.promises.readdir(dir);
    } catch {
      return void 0;
    }
    let best;
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      const full = path3.join(dir, entry);
      if (this.filesInUse.has(full)) continue;
      const stat = await fs4.promises.stat(full).catch(() => null);
      if (!stat) continue;
      if (stat.mtimeMs < startedAt - this.mtimeSlackMs) continue;
      const distance = Math.abs(stat.mtimeMs - startedAt);
      if (!best || distance < best.distance) {
        best = { file: full, distance };
      }
    }
    return best?.file;
  }
};
function encodeCwd(cwd) {
  return cwd.replace(/[/.]/g, "-");
}

// src/session-manager.ts
var SessionManager = class extends EventEmitter4 {
  sessions = /* @__PURE__ */ new Map();
  maxBufferEvents;
  pruneTimer = null;
  transcripts;
  constructor(maxBufferEvents = 1e4, transcripts) {
    super();
    this.maxBufferEvents = maxBufferEvents;
    this.transcripts = transcripts ?? new TranscriptWatcher();
    this.transcripts.on("summary", (sessionId, summary) => {
      const session = this.sessions.get(sessionId);
      if (!session) return;
      const trimmed = summary.trim();
      if (!trimmed || session.info.name === trimmed) return;
      session.setName(trimmed);
      this.emit("session-updated", sessionId, { name: trimmed });
    });
  }
  // ────────────────────────────────────────────
  // Explicit kill (client-initiated)
  // ────────────────────────────────────────────
  /**
   * Terminate a session by id. Stops the SDK driver via Query.interrupt()
   * and removes the session. Returns true if a session existed, false
   * otherwise.
   */
  async killSession(id) {
    const session = this.sessions.get(id);
    if (!session) return false;
    try {
      await session.kill();
    } catch (err) {
      logger_default.warn(`killSession(${id}): kill failed: ${String(err)}`);
    }
    this.removeSession(id);
    return true;
  }
  // ────────────────────────────────────────────
  // Idle prune
  // ────────────────────────────────────────────
  /**
   * Periodically drop sessions that have had no activity for `idleMs` AND
   * have no subscribed clients. Idle prune is now opt-in legacy plumbing —
   * with no attach mode and explicit kill via the UI, most sessions go
   * away cleanly. Retained for safety against runaway forgotten tabs.
   */
  startIdlePrune(idleMs, checkIntervalMs = 15 * 60 * 1e3) {
    if (this.pruneTimer || idleMs <= 0) return;
    this.pruneTimer = setInterval(() => {
      void this._pruneOnce(idleMs);
    }, checkIntervalMs);
    this.pruneTimer.unref();
    logger_default.info(
      `SessionManager: idle prune enabled (idleMs=${idleMs}, checkMs=${checkIntervalMs})`
    );
  }
  stopIdlePrune() {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }
  stopTranscriptWatcher() {
    this.transcripts.stopAll();
  }
  /** Exposed for tests — runs one prune pass without scheduling. */
  async _pruneOnce(idleMs) {
    const cutoff = Date.now() - idleMs;
    let removed = 0;
    for (const session of Array.from(this.sessions.values())) {
      const info = session.info;
      if (info.connectedClients.length > 0) continue;
      if (info.lastActivityAt > cutoff) continue;
      logger_default.info(
        `Pruning idle session ${session.id} (idle for ${Date.now() - info.lastActivityAt}ms)`
      );
      await this.killSession(session.id);
      removed++;
    }
    return removed;
  }
  // ────────────────────────────────────────────
  // Session lifecycle
  // ────────────────────────────────────────────
  /**
   * Spawn a new Claude session via the Agent SDK in `cwd`.
   */
  async spawnSession(opts) {
    const name = opts.name ?? this.deriveName(opts.cwd);
    const session = new Session(name, opts.cwd, this.maxBufferEvents);
    this.sessions.set(session.id, session);
    this.wireSessionEvents(session);
    session.on("exit", () => {
      logger_default.info(`Session ${session.id} exited`);
      this.removeSession(session.id);
    });
    try {
      await session.spawn(opts);
    } catch (err) {
      this.sessions.delete(session.id);
      this.transcripts.unwatch(session.id);
      throw err;
    }
    logger_default.info(`Spawned session: id=${session.id} cwd=${opts.cwd} name=${name}`);
    this.transcripts.watch(session.id, opts.cwd, session.info.startedAt);
    this.emit("session-added", session.info);
    return session;
  }
  getSession(id) {
    return this.sessions.get(id);
  }
  getAllSessions() {
    return Array.from(this.sessions.values());
  }
  removeSession(id) {
    const session = this.sessions.get(id);
    if (!session) return;
    this.transcripts.unwatch(id);
    void session.kill();
    this.sessions.delete(id);
    logger_default.info(`Session removed: id=${id}`);
    this.emit("session-removed", id);
  }
  /** Add / remove a client ID from a session's connectedClients list. */
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
    const base = path4.basename(cwd) || cwd;
    const used = /* @__PURE__ */ new Set();
    for (const s of this.sessions.values()) used.add(s.info.name);
    if (!used.has(base)) return base;
    for (let i = 2; ; i++) {
      const candidate = `${base} ${i}`;
      if (!used.has(candidate)) return candidate;
    }
  }
  /** Forward typed SessionEvents up as a manager-level event for fan-out. */
  wireSessionEvents(session) {
    session.on("session-event", (event, index) => {
      this.emit("session-event", session.id, event, index);
      const info = session.info;
      const changes = {
        lastActivityAt: info.lastActivityAt,
        status: info.status,
        waitingForInput: info.waitingForInput,
        costSoFar: info.costSoFar,
        lastEventIndex: info.lastEventIndex
      };
      if (event.kind === "init") {
        changes.model = info.model;
        changes.permissionMode = info.permissionMode;
      }
      this.emit("session-updated", session.id, changes);
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event, listener) {
    return super.on(event, listener);
  }
};

// src/directory-scanner.ts
import * as fs5 from "fs";
import * as path5 from "path";
import * as os4 from "os";
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
    this.homeDir = os4.homedir();
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
      real = fs5.realpathSync.native(resolved);
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
      entries = fs5.readdirSync(root, { withFileTypes: true });
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
        st = fs5.lstatSync(full);
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
        if (fs5.existsSync(gitDir)) isRepo = true;
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
      const stat = fs5.statSync(p);
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
import { WebSocket } from "ws";
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
    if (ws.readyState !== WebSocket.OPEN) return;
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
      if (client.isAuthenticated && client.ws.readyState === WebSocket.OPEN) {
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
      if (!client || !client.isAuthenticated || client.ws.readyState !== WebSocket.OPEN) {
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
import * as crypto2 from "crypto";
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
    const session = await sessionManager.spawnSession({
      cwd,
      name: msg.name,
      permissionMode: msg.permissionMode,
      model: msg.model,
      effortLevel: msg.effortLevel,
      outputStyle: msg.outputStyle,
      worktree: msg.worktree,
      resumeSessionId: msg.resumeSessionId,
      agent: msg.agent
    });
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
var MessageRouter = class _MessageRouter {
  constructor(deps) {
    this.deps = deps;
  }
  deps;
  listDirsCache = null;
  clientListDirsAt = /* @__PURE__ */ new Map();
  static LIST_DIRS_MIN_INTERVAL_MS = 1e3;
  static LIST_DIRS_CACHE_TTL_MS = 2e3;
  dispatch(client, msg) {
    if (typeof msg !== "object" || msg === null || !("type" in msg)) {
      this.deps.registry.sendError(
        client.ws,
        "INVALID_MESSAGE",
        "Missing type field"
      );
      return;
    }
    const typed = msg;
    if (!this._validateMessage(typed)) {
      this.deps.registry.sendError(
        client.ws,
        "INVALID_MESSAGE",
        "Invalid message fields"
      );
      return;
    }
    if (!client.isAuthenticated) {
      if (typed.type !== "AUTH") {
        this.deps.registry.sendError(
          client.ws,
          "NOT_AUTHENTICATED",
          "Send AUTH first"
        );
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
      case "CONTROL_MESSAGE":
        void this._handleControlMessage(client, typed);
        break;
      default: {
        const _exhaustive = typed;
        void _exhaustive;
        this.deps.registry.sendError(
          client.ws,
          "UNKNOWN_TYPE",
          "Unknown message type"
        );
      }
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
        return typeof msg.sessionId === "string" && (msg.fromEventIndex === void 0 || typeof msg.fromEventIndex === "number" && Number.isInteger(msg.fromEventIndex) && msg.fromEventIndex >= 0);
      case "UNSUBSCRIBE":
        return typeof msg.sessionId === "string";
      case "REGISTER_PUSH_TOKEN":
        return typeof msg.token === "string" && msg.token.length > 0 && (msg.platform === "android" || msg.platform === "ios");
      case "LIST_DIRECTORIES":
        return msg.query === void 0 || typeof msg.query === "string" && msg.query.length <= 256;
      case "SPAWN_SESSION":
        return typeof msg.cwd === "string" && msg.cwd.length > 0 && msg.cwd.length <= 4096 && typeof msg.requestId === "string" && msg.requestId.length > 0;
      case "CONTROL_MESSAGE":
        return typeof msg.sessionId === "string" && msg.sessionId.length > 0 && typeof msg.message === "object" && msg.message !== null;
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
    const { sessionManager, registry } = this.deps;
    const session = sessionManager.getSession(msg.sessionId);
    if (!session) {
      registry.sendError(
        client.ws,
        "SESSION_NOT_FOUND",
        `Session ${msg.sessionId} not found`
      );
      return;
    }
    registry.addSubscription(client.id, msg.sessionId);
    sessionManager.addClientToSession(msg.sessionId, client.id);
    const fromIndex = msg.fromEventIndex ?? 0;
    const { events, firstAvailableIndex } = session.buffer.getFrom(fromIndex);
    const history = {
      type: "HISTORY",
      sessionId: msg.sessionId,
      events,
      totalEvents: session.buffer.totalCount,
      firstAvailableEventIndex: firstAvailableIndex
    };
    registry.send(client.ws, history);
    logger_default.debug(
      `Client ${client.id} subscribed to session ${msg.sessionId} (from ${fromIndex}, sent ${events.length} events)`
    );
  }
  _handleUnsubscribe(client, msg) {
    this.deps.registry.removeSubscription(client.id, msg.sessionId);
    this.deps.sessionManager.removeClientFromSession(
      msg.sessionId,
      client.id
    );
  }
  async _handleControlMessage(client, env) {
    const { sessionManager, registry } = this.deps;
    const session = sessionManager.getSession(env.sessionId);
    if (!session) {
      registry.sendError(
        client.ws,
        "SESSION_NOT_FOUND",
        `Session ${env.sessionId} not found`
      );
      return;
    }
    const m = env.message;
    try {
      switch (m.type) {
        case "send_user_message":
          session.sendUserMessage(m.content);
          return;
        case "interrupt":
          await session.interrupt();
          return;
        case "kill_session":
          await sessionManager.killSession(m.sessionId);
          return;
        case "plan_accept":
          session.resolveByToolUseId({
            toolUseId: m.toolUseId,
            decision: "allow"
          });
          return;
        case "plan_reject":
          session.resolveByToolUseId({
            toolUseId: m.toolUseId,
            decision: "deny",
            message: m.reason
          });
          return;
        case "answer_question":
          session.resolveByToolUseId({
            toolUseId: m.toolUseId,
            decision: "allow",
            updatedInput: { answers: m.answers }
          });
          return;
        case "resolve_permission":
          session.resolvePermission({
            requestId: m.requestId,
            decision: m.decision,
            updatedInput: m.updatedInput
          });
          return;
        case "change_permission_mode":
          await session.setPermissionMode(m.mode);
          return;
        case "set_model":
          await session.setModel(m.model);
          return;
        case "set_effort_level":
          logger_default.info(
            `set_effort_level (${m.level}) ignored mid-session \u2014 apply at next spawn`
          );
          return;
        default: {
          const _exhaustive = m;
          void _exhaustive;
          registry.sendError(
            client.ws,
            "UNKNOWN_CONTROL",
            `Unknown control message type`
          );
        }
      }
    } catch (err) {
      logger_default.warn(
        `Control message error (session=${env.sessionId}, type=${m.type}): ${String(err)}`
      );
      registry.sendError(
        client.ws,
        "CONTROL_ERROR",
        err instanceof Error ? err.message : String(err)
      );
    }
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
import * as http from "http";
import { WebSocketServer } from "ws";
import { v4 as uuidv42 } from "uuid";
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
    this.wss = new WebSocketServer({
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
    const clientId = uuidv42();
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
var NotificationDispatcher = class {
  constructor(sessionManager, registry, pushService) {
    this.sessionManager = sessionManager;
    this.registry = registry;
    this.pushService = pushService;
  }
  sessionManager;
  registry;
  pushService;
  wiredSessions = /* @__PURE__ */ new Set();
  /** Pending event batches per session (flushed via setImmediate). */
  pendingEvents = /* @__PURE__ */ new Map();
  eventScheduled = /* @__PURE__ */ new Set();
  /** Edge-detection cache for waitingForInput → push trigger. */
  waitingState = /* @__PURE__ */ new Map();
  start() {
    this.sessionManager.on(
      "session-added",
      (session) => this._onSessionAdded(session)
    );
    this.sessionManager.on(
      "session-removed",
      (sessionId) => this._onSessionRemoved(sessionId)
    );
    this.sessionManager.on(
      "session-updated",
      (sessionId, changes) => this._onSessionUpdated(sessionId, changes)
    );
    this.sessionManager.on(
      "session-event",
      (sessionId, event, index) => this._enqueueSessionEvent(sessionId, event, index)
    );
  }
  // ────────────────────────────────────────────
  // Handlers
  // ────────────────────────────────────────────
  _onSessionAdded(session) {
    const msg = { type: "SESSION_ADDED", session };
    this.registry.broadcastAll(msg);
    this.wiredSessions.add(session.id);
  }
  _onSessionRemoved(sessionId) {
    const msg = { type: "SESSION_REMOVED", sessionId };
    this.registry.broadcastAll(msg);
    this.wiredSessions.delete(sessionId);
    this.pendingEvents.delete(sessionId);
    this.eventScheduled.delete(sessionId);
    this.waitingState.delete(sessionId);
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
          "Claude is waiting for your response.",
          { sessionId }
        ).catch((err) => {
          logger_default.warn(`FCM push error: ${String(err)}`);
        });
      }
    }
  }
  _enqueueSessionEvent(sessionId, event, eventIndex) {
    let queue = this.pendingEvents.get(sessionId);
    if (!queue) {
      queue = [];
      this.pendingEvents.set(sessionId, queue);
    }
    queue.push({ event, eventIndex });
    if (this.eventScheduled.has(sessionId)) return;
    this.eventScheduled.add(sessionId);
    setImmediate(() => {
      this.eventScheduled.delete(sessionId);
      const batch = this.pendingEvents.get(sessionId);
      this.pendingEvents.delete(sessionId);
      if (!batch || batch.length === 0) return;
      for (const { event: ev, eventIndex: idx } of batch) {
        const out = {
          type: "SESSION_EVENT",
          sessionId,
          eventIndex: idx,
          event: ev
        };
        this.registry.broadcastToSession(sessionId, out);
      }
    });
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

// src/push.ts
import * as fs6 from "fs";
import * as https from "https";
import * as crypto3 from "crypto";
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
    const promises2 = [];
    for (const pushToken of this.pushTokens.values()) {
      promises2.push(this.sendOne(token, pushToken, title, body, data));
    }
    await Promise.allSettled(promises2);
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
import { execFile } from "child_process";
import { promisify } from "util";
var execFileAsync = promisify(execFile);
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
var Daemon = class {
  config;
  sessionManager;
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
    const pushService = new PushService();
    this.wsServer = new WsServer(
      this.sessionManager,
      this.config,
      bindAddress,
      pushService
    );
    await this.wsServer.start();
    if (this.config.attachIdlePruneMs > 0) {
      this.sessionManager.startIdlePrune(this.config.attachIdlePruneMs);
    }
    logger_default.info(
      `Walccy daemon started on ws://${bindAddress}:${this.config.port}`
    );
  }
  async stop() {
    logger_default.info("Walccy daemon stopping\u2026");
    this.sessionManager?.stopIdlePrune();
    this.sessionManager?.stopTranscriptWatcher();
    this.wsServer?.stop();
    for (const session of this.sessionManager?.getAllSessions() ?? []) {
      this.sessionManager.removeSession(session.id);
    }
    logger_default.info("Walccy daemon stopped");
  }
};

// src/installer.ts
import * as fs7 from "fs";
import * as path6 from "path";
import * as os5 from "os";
import { execFile as execFile2 } from "child_process";
import { promisify as promisify2 } from "util";
var execFileAsync2 = promisify2(execFile2);
function getServiceDir() {
  return path6.join(os5.homedir(), ".config", "systemd", "user");
}
function getServicePath() {
  return path6.join(getServiceDir(), "walccy.service");
}
function buildUnitFile() {
  const execPath = process.execPath;
  const scriptPath = path6.resolve(__dirname, "..", "dist", "index.js");
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
var program = new Command();
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
  const hostname2 = os6.hostname();
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
  const qrcode = (await import("qrcode-terminal")).default;
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
        const configDir = path7.dirname(configPath);
        const fs8 = await import("fs");
        if (fs8.existsSync(configDir)) {
          fs8.rmSync(configDir, { recursive: true, force: true });
          console.log(`Removed config directory: ${configDir}`);
        }
        const logDir2 = path7.join(os6.homedir(), ".walccy");
        if (fs8.existsSync(logDir2)) {
          fs8.rmSync(logDir2, { recursive: true, force: true });
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
