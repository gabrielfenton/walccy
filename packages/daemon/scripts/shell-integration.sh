#!/usr/bin/env bash
# Walccy shell integration
# Source this file from your ~/.bashrc or ~/.zshrc:
#   source ~/.local/share/walccy/shell-integration.sh

# Guard against double-sourcing
if [[ -n "${_WALCCY_SHELL_INTEGRATION_LOADED:-}" ]]; then
  return 0
fi
_WALCCY_SHELL_INTEGRATION_LOADED=1

# ──────────────────────────────────────────────
# Wrapper function for the `claude` command
# ──────────────────────────────────────────────

_walccy_claude() {
  # Register this shell session with the daemon (best-effort, background)
  walccy register-session --cwd "$PWD" --pid $$ &>/dev/null &

  # Run the real claude binary
  command claude "$@"
  local exit_code=$?

  # Unregister when done (best-effort, background)
  walccy unregister-session --pid $$ &>/dev/null &

  return ${exit_code}
}

# Override the `claude` command with our wrapper
alias claude='_walccy_claude'

# ──────────────────────────────────────────────
# Optional: auto-start daemon if not running
# ──────────────────────────────────────────────

_walccy_ensure_daemon() {
  # Only attempt if walccy is on PATH
  if ! command -v walccy &>/dev/null; then
    return 0
  fi

  # Check if systemd service is active
  if command -v systemctl &>/dev/null; then
    if systemctl --user is-active --quiet walccy.service 2>/dev/null; then
      return 0  # already running
    fi
    # Try to start it quietly
    systemctl --user start walccy.service &>/dev/null || true
  fi
}

# Run daemon check in background on shell start (non-blocking)
_walccy_ensure_daemon &
