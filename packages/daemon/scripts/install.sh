#!/usr/bin/env bash
# Walccy Daemon Installer
# Usage: curl -fsSL https://example.com/install.sh | bash
#        or: bash install.sh

set -euo pipefail

WALCCY_VERSION="${WALCCY_VERSION:-latest}"
REQUIRED_NODE_MAJOR=20

# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────

red()    { echo -e "\033[0;31m$*\033[0m"; }
green()  { echo -e "\033[0;32m$*\033[0m"; }
yellow() { echo -e "\033[0;33m$*\033[0m"; }
blue()   { echo -e "\033[0;34m$*\033[0m"; }

info()    { blue    "[walccy] $*"; }
success() { green   "[walccy] $*"; }
warn()    { yellow  "[walccy] WARNING: $*"; }
error()   { red     "[walccy] ERROR: $*" >&2; exit 1; }

# ──────────────────────────────────────────────
# Check prerequisites
# ──────────────────────────────────────────────

check_node() {
  if ! command -v node &>/dev/null; then
    error "Node.js is not installed. Please install Node.js ${REQUIRED_NODE_MAJOR}+ from https://nodejs.org"
  fi

  local node_major
  node_major=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
  if [[ "${node_major}" -lt "${REQUIRED_NODE_MAJOR}" ]]; then
    error "Node.js ${REQUIRED_NODE_MAJOR}+ required, found $(node --version). Please upgrade."
  fi

  success "Node.js $(node --version) detected"
}

check_npm() {
  if ! command -v npm &>/dev/null; then
    error "npm is not installed. Please install npm."
  fi
  success "npm $(npm --version) detected"
}

check_linux() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    warn "This installer is designed for Linux. Proceeding anyway…"
  fi
}

# ──────────────────────────────────────────────
# Installation
# ──────────────────────────────────────────────

install_walccy() {
  local install_dir="${HOME}/.walccy/install"
  info "Installing Walccy daemon to ${install_dir}…"

  mkdir -p "${install_dir}"

  # If running from source (dev install)
  if [[ -f "$(dirname "$0")/../package.json" ]]; then
    local pkg_dir
    pkg_dir="$(cd "$(dirname "$0")/.." && pwd)"
    info "Detected source install at ${pkg_dir}"

    cd "${pkg_dir}"
    npm install --prefer-offline 2>&1 | tail -5
    npm run build 2>&1 | tail -10

    # Symlink the binary
    local bin_path="${pkg_dir}/dist/index.js"
    chmod +x "${bin_path}"

    local walccy_bin="${HOME}/.local/bin/walccy"
    mkdir -p "$(dirname "${walccy_bin}")"

    # Write a wrapper script
    cat > "${walccy_bin}" <<EOF
#!/usr/bin/env bash
exec node "${bin_path}" "\$@"
EOF
    chmod +x "${walccy_bin}"
    success "walccy binary installed at ${walccy_bin}"
  else
    # npm install from registry
    npm install -g walccyd@"${WALCCY_VERSION}" || \
      error "Failed to install walccy from npm. Try: npm install -g walccyd"
    success "walccyd installed globally via npm"
  fi
}

init_config() {
  info "Initializing configuration…"
  walccy init
  success "Config initialized at ~/.config/walccy/config.json"
}

setup_systemd() {
  if ! command -v systemctl &>/dev/null; then
    warn "systemctl not found — skipping systemd service installation."
    warn "Run 'walccy start --foreground' to start the daemon manually."
    return
  fi

  info "Installing systemd user service…"
  walccy install-service
  success "Walccy systemd service installed and started."
}

setup_path() {
  local local_bin="${HOME}/.local/bin"
  if [[ ":${PATH}:" != *":${local_bin}:"* ]]; then
    warn "${local_bin} is not in your PATH."
    warn "Add the following to your ~/.bashrc or ~/.zshrc:"
    warn "  export PATH=\"\${HOME}/.local/bin:\${PATH}\""
  fi
}

print_next_steps() {
  echo ""
  success "Walccy installation complete!"
  echo ""
  echo "  Next steps:"
  echo "  1. Add shell integration to ~/.bashrc or ~/.zshrc:"
  echo "       source ${HOME}/.local/share/walccy/shell-integration.sh"
  echo ""
  echo "  2. Pair your mobile device:"
  echo "       walccy pair"
  echo ""
  echo "  3. Check daemon status:"
  echo "       walccy status"
  echo ""
}

# ──────────────────────────────────────────────
# Copy shell integration script
# ──────────────────────────────────────────────

install_shell_integration() {
  local share_dir="${HOME}/.local/share/walccy"
  mkdir -p "${share_dir}"

  local script_src
  script_src="$(dirname "$0")/shell-integration.sh"

  if [[ -f "${script_src}" ]]; then
    cp "${script_src}" "${share_dir}/shell-integration.sh"
    success "Shell integration script installed at ${share_dir}/shell-integration.sh"
  else
    warn "shell-integration.sh not found at ${script_src}"
  fi
}

# ──────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────

main() {
  echo ""
  blue "╔══════════════════════════════╗"
  blue "║    Walccy Daemon Installer   ║"
  blue "╚══════════════════════════════╝"
  echo ""

  check_linux
  check_node
  check_npm
  install_walccy
  install_shell_integration
  setup_path
  init_config
  setup_systemd
  print_next_steps
}

main "$@"
