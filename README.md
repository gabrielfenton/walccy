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

- Daemon binds WebSocket server **only** to the Tailscale interface (100.x.x.x)
- Auth via shared 32-byte secret (auto-generated, stored in `~/.config/walccy/config.json`)
- In-memory circular buffer: 10,000 lines per session
- No tmux, no screen — pure PTY wrapping

## Tech stack

| | Technology |
|---|---|
| Daemon | Node.js 20+, TypeScript, node-pty, ws |
| App | Expo SDK 52, React Native, Zustand, FlashList |
| Network | Tailscale (encrypted, no open ports) |
