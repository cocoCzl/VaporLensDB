#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-mac}"

usage() {
  cat <<'EOF'
Usage:
  ./build.sh [mac|current|check|jdbc-bridge]

Targets:
  mac      Build a macOS app bundle and DMG on macOS.
  current  Build a Tauri bundle for the current platform.
  check    Run validation only: frontend lint/build and Rust tests.
  jdbc-bridge Build the lightweight Java JDBC bridge jar.

Outputs:
  macOS app: src-tauri/target/release/bundle/macos/VaporLensDB.app
  macOS dmg: src-tauri/target/release/bundle/dmg/*.dmg
EOF
}

log() {
  printf '\n==> %s\n' "$1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

ensure_dependencies() {
  require_command pnpm
  require_command cargo

  if [ ! -d "$ROOT_DIR/node_modules" ]; then
    log "Installing frontend dependencies"
    pnpm install --frozen-lockfile
  fi
}

build_jdbc_bridge() {
  log "Building JDBC bridge"
  "$ROOT_DIR/tools/jdbc-bridge/build.sh"
}

run_checks() {
  log "Running frontend lint"
  pnpm lint

  log "Building frontend"
  pnpm build

  log "Running Rust clippy"
  (cd "$ROOT_DIR/src-tauri" && cargo clippy --all-targets -- -D warnings)

  log "Running Rust tests"
  (cd "$ROOT_DIR/src-tauri" && cargo test)
}

build_current() {
  log "Building Tauri bundle for current platform"
  pnpm tauri build
}

build_mac() {
  if [ "$(uname -s)" != "Darwin" ]; then
    printf 'The mac target must be run on macOS. Use ./build.sh current for this machine.\n' >&2
    exit 1
  fi

  log "Building macOS Tauri app and DMG"
  pnpm tauri build --bundles app,dmg

  log "Build artifacts"
  find "$ROOT_DIR/src-tauri/target/release/bundle" \
    \( -name 'VaporLensDB.app' -o -name '*.dmg' \) \
    -maxdepth 3 \
    -print
}

cd "$ROOT_DIR"

case "$TARGET" in
  -h|--help|help)
    usage
    ;;
  check)
    ensure_dependencies
    build_jdbc_bridge
    run_checks
    ;;
  current)
    ensure_dependencies
    build_jdbc_bridge
    run_checks
    build_current
    ;;
  mac)
    ensure_dependencies
    build_jdbc_bridge
    run_checks
    build_mac
    ;;
  jdbc-bridge)
    build_jdbc_bridge
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
