# Walccy

Beautiful mobile dashboard for Claude Code sessions, accessible over Tailscale.

## What it does

- **Daemon (`walccyd`)** — runs on your laptop/EC2, detects Claude Code sessions, streams output over WebSocket
- **Mobile app** — Expo/React Native app showing all sessions as tabs, with terminal output, prompt input, and clipboard tools

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

### 3. Optional: shell integration (instant session detection)

Add to `~/.bashrc` or `~/.zshrc`:
```bash
source ~/.config/walccy/shell-integration.sh
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

The repo is a small monorepo with three workspaces:

- `packages/protocol/` — types-only package, single source of truth for the wire protocol. Both daemon and app import from `@walccy/protocol`.
- `packages/daemon/` — Node + TypeScript, ships the `walccy` CLI (daemon + the `walccy claude` wrapper).
- `packages/app/` — Expo / React Native client.

### Session modes

A session in walccy can be in one of three modes:

- **spawn** — daemon owns a `node-pty` directly. Created from the app via `SPAWN_SESSION` (or future CLI flow). Fully bidirectional: input from mobile, output mirrored to all subscribers.
- **wrap** — a sibling `walccy claude` (or `walccy <cmd>`) process owns the PTY in your existing terminal (Konsole, iTerm, etc.) and streams I/O to the daemon over a Unix socket at `~/.walccy/wrap.sock`. Recommended mode: you keep your normal terminal window working *and* get the mobile mirror.
- **attach** — the daemon detects an existing `claude` process via `/proc` scanning. Since the TTY-skip fix this is detection-only — the session shows up in the tab bar so you know it exists, but it is read-only (no PTY hijacking).

### Daemon module layout

```
index (CLI)
  └─ daemon.ts (orchestrator)
       ├─ sessionManager      — session lifecycle, mode tagging
       ├─ ws-server           — WS orchestrator (see below)
       ├─ wrap-server         — Unix-socket IPC for `walccy claude`
       ├─ processScanner      — /proc detection of claude processes
       └─ pushService         — FCM token registry + send

ws-server.ts (orchestrator)
  ├─ ws-transport            — WS lifecycle, framing, ping/pong
  ├─ message-router          — auth gate + message dispatch
  ├─ client-registry         — clients, subscriptions, locks, push tokens
  └─ notification-dispatcher — broadcast fan-out + FCM
```

Per-module responsibilities:

- `daemon.ts` — wires everything, owns startup/shutdown.
- `session-manager.ts` — create/list/destroy sessions, route I/O.
- `session.ts` — tagged-union `spawn | attach | wrap` session implementations.
- `wrap-server.ts` — accepts `walccy claude` connections on `~/.walccy/wrap.sock`.
- `wrap-cli.ts` — the `walccy claude` / `walccy <cmd>` wrapper command.
- `ws-transport.ts` — raw WS connection handling.
- `message-router.ts` — AUTH-then-anything gate, dispatch by message type.
- `client-registry.ts` — per-client state: subs, input lock, push token.
- `notification-dispatcher.ts` — broadcast to subscribers, fan to FCM.
- `process-scanner.ts` — periodic `/proc` walk for attach-mode detection.
- `push.ts` — FCM service-account auth and send.

### Wire protocol

- Defined in `@walccy/protocol`, imported by both daemon and app — no drift.
- Line-delimited JSON over a single WebSocket per client.
- **AUTH gate**: the first message must be `AUTH` with the shared secret; any other message before auth disconnects the client.
- `HISTORY` messages carry `firstAvailableLine` so a reconnecting client can detect ring-buffer truncation (10k lines/session) and reconcile.

## Quick start

```bash
# 1. run the daemon (foreground for dev)
walccy start --foreground

# 2. wrap a terminal session so it mirrors to mobile
walccy claude            # or: walccy <any-command>

# 3. on the phone: scan QR (`walccy pair`) or enter host/port/secret manually
```

## Security posture

- Daemon binds the WebSocket **only** to the Tailscale interface (`100.x.x.x`) by default — no public exposure.
- Auth via a 32-byte shared secret stored in `~/.config/walccy/config.json` (mode `0600`).
- WS traffic is cleartext within the tailnet — no TLS. Accepted trade-off: Tailscale already provides transport encryption end-to-end, and adding TLS on top would mean managing certs for ephemeral 100.x addresses.
- In-memory ring buffer only; no on-disk session logs. No tmux, no screen — pure PTY wrapping.

## Tech stack

| | Technology |
|---|---|
| Daemon | Node.js 20+, TypeScript, node-pty, ws |
| App | Expo SDK 52, React Native, Zustand, FlashList |
| Network | Tailscale (encrypted, no open ports) |
