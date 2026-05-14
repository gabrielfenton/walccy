# Walccy

Mobile chat UI for Claude Code, accessible over Tailscale.

## What it does

- **Daemon (`walccyd`)** — runs on your laptop. Spawns `claude` in stream-json mode and broadcasts structured `SessionEvent`s over WebSocket.
- **Mobile app** — Expo / React Native chat-style UI. Renders assistant streaming, thinking, tool calls (Bash, Edit, Read, Grep, etc.) and lets you drive sessions from your phone.

## Setup

### 1. Install the daemon

```bash
# Install globally
npm install -g walccyd

# Initialize (generates auth secret)
walccy init

# Install as a system service (Linux)
walccy install-service

# Or run manually (dev mode — binds to 127.0.0.1)
WALCCY_DEV_MODE=1 walccy start --foreground
```

### 2. Pair your phone

```bash
walccy pair
# Scan the QR code with the Walccy mobile app
```

## Development

```bash
# Root
npm install

# Daemon (dev mode)
cd packages/daemon
WALCCY_DEV_MODE=1 npm run dev

# App
cd packages/app
npx expo start
```

## Architecture

Small monorepo, three workspaces:

- `packages/protocol/` — types-only package, single source of truth for the wire protocol. Both daemon and app import from `@walccy/protocol`.
- `packages/daemon/` — Node + TypeScript daemon. Spawns `claude` per session, translates raw stream-json events into `SessionEvent`s, broadcasts over WS.
- `packages/app/` — Expo / React Native chat client.

### Session lifecycle

The daemon spawns Claude Code in stream-json mode:

```
claude --input-format stream-json --output-format stream-json \
       --include-partial-messages --verbose
```

The app sends `ControlMessage`s (`send_user_message`, `interrupt`, `plan_accept`, `answer_question`, `kill_session`, etc.) and receives `SessionEvent`s (`init`, `status`, `assistant_text_delta`, `thinking_delta`, `tool_use`, `tool_result`, `turn_complete`, `rate_limit`, `error`).

### Daemon module layout

```
index (CLI)
  └─ daemon.ts (orchestrator)
       ├─ sessionManager      — session lifecycle
       ├─ ws-server           — WS orchestrator (see below)
       └─ pushService         — FCM token registry + send

session.ts
  ├─ claude-spawner          — spawns `claude`, line-delimited JSON reader
  ├─ stream-translator       — raw Claude event → SessionEvent
  └─ event-buffer            — ring of SessionEvent per session

ws-server.ts (orchestrator)
  ├─ ws-transport            — WS lifecycle, framing, ping/pong
  ├─ message-router          — auth gate + message dispatch
  ├─ client-registry         — clients, subscriptions, push tokens
  └─ notification-dispatcher — broadcast fan-out + FCM (push on AskUserQuestion / idle)
```

### Wire protocol

- Defined in `@walccy/protocol`, imported by both daemon and app — no drift.
- Line-delimited JSON over a single WebSocket per client.
- **AUTH gate**: the first message must be `AUTH` with the shared secret; any other message before auth disconnects the client.
- `SessionEventMessage` carries `eventIndex` so a reconnecting client can detect ring-buffer truncation and reconcile.

## Security posture

- Daemon binds the WebSocket **only** to the Tailscale interface (`100.x.x.x`) by default — no public exposure.
- Auth via a 32-byte shared secret stored in `~/.config/walccy/config.json` (mode `0600`).
- WS traffic is cleartext within the tailnet — no TLS. Tailscale provides transport encryption end-to-end.
- In-memory event ring buffer only; no on-disk session logs.

## Tech stack

| | Technology |
|---|---|
| Daemon | Node.js 20+, TypeScript, `@anthropic-ai/claude-agent-sdk`, ws |
| App | Expo SDK 54, React Native, Zustand, FlashList, react-native-markdown-display |
| Network | Tailscale (encrypted, no open ports) |
