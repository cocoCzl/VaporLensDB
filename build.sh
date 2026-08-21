#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-current}"

usage() {
  cat <<'EOF'
Usage:
  ./build.sh [mac|windows|current|check|jdbc-bridge]

Targets:
  mac      Build a macOS app bundle and DMG on macOS.
  windows  Build Windows MSI and NSIS installers on Windows.
  current  Build the supported installer format for the current platform.
  check    Run validation only: frontend lint/build and Rust tests.
  jdbc-bridge Build the lightweight Java JDBC bridge jar.

Outputs:
  macOS app: src-tauri/target/release/bundle/macos/VaporLensDB.app
  macOS dmg: src-tauri/target/release/bundle/dmg/VaporLensDB_<version>_<architecture>.dmg
  macOS local staging: artifacts/macos/<architecture>/<version>/
  Windows msi: src-tauri/target/release/bundle/msi/*.msi
  Windows nsis: src-tauri/target/release/bundle/nsis/*.exe
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
  require_command node
  require_command cargo

  if [ ! -d "$ROOT_DIR/node_modules" ]; then
    log "Installing frontend dependencies"
    pnpm install --frozen-lockfile
  fi
}

project_version() {
  local package_version
  local tauri_version
  local cargo_version

  package_version="$(node -p "JSON.parse(require('node:fs').readFileSync('package.json', 'utf8')).version")"
  tauri_version="$(node -p "JSON.parse(require('node:fs').readFileSync('src-tauri/tauri.conf.json', 'utf8')).version")"
  cargo_version="$(node -e "const text=require('node:fs').readFileSync('src-tauri/Cargo.toml','utf8'); const match=text.match(/^\\[package\\][\\s\\S]*?^version\\s*=\\s*\\\"([^\\\"]+)\\\"/m); if(!match) process.exit(1); process.stdout.write(match[1])")"

  if [ "$package_version" != "$tauri_version" ] || [ "$package_version" != "$cargo_version" ]; then
    printf 'Version mismatch: package.json=%s, tauri.conf.json=%s, Cargo.toml=%s\n' \
      "$package_version" "$tauri_version" "$cargo_version" >&2
    exit 1
  fi

  printf '%s\n' "$package_version"
}

mac_architecture() {
  case "$(uname -m)" in
    arm64)
      printf 'aarch64\n'
      ;;
    x86_64)
      printf 'x86_64\n'
      ;;
    *)
      printf 'Unsupported macOS architecture: %s\n' "$(uname -m)" >&2
      exit 1
      ;;
  esac
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
  case "$(uname -s)" in
    Darwin)
      build_mac
      ;;
    MINGW*|MSYS*|CYGWIN*)
      build_windows
      ;;
    *)
      log "Building Tauri bundle for current platform"
      pnpm tauri build
      ;;
  esac
}

build_mac() {
  if [ "$(uname -s)" != "Darwin" ]; then
    printf 'The mac target must be run on macOS. Use ./build.sh current for this machine.\n' >&2
    exit 1
  fi

  require_command ditto
  require_command hdiutil
  require_command shasum

  local version
  local architecture
  version="$(project_version)"
  architecture="$(mac_architecture)"
  local bundle_dir="$ROOT_DIR/src-tauri/target/release/bundle"
  local app_path="$bundle_dir/macos/VaporLensDB.app"
  local dmg_path="$bundle_dir/dmg/VaporLensDB_${version}_${architecture}.dmg"
  local artifact_dir="$ROOT_DIR/artifacts/macos/$architecture/$version"

  log "Building macOS Tauri app"
  pnpm tauri build --bundles app

  if [ ! -d "$app_path" ]; then
    printf 'Expected macOS app bundle was not created: %s\n' "$app_path" >&2
    exit 1
  fi

  log "Creating macOS DMG"
  bash "$ROOT_DIR/scripts/create-macos-dmg.sh" "$app_path" "$dmg_path"

  log "Staging local macOS artifacts"
  mkdir -p "$artifact_dir"
  rm -rf "$artifact_dir/VaporLensDB.app"
  rm -f "$artifact_dir/VaporLensDB_${version}_${architecture}.dmg" "$artifact_dir/SHA256SUMS.txt"
  ditto "$app_path" "$artifact_dir/VaporLensDB.app"
  cp "$dmg_path" "$artifact_dir/VaporLensDB_${version}_${architecture}.dmg"
  (
    cd "$artifact_dir"
    shasum -a 256 "VaporLensDB_${version}_${architecture}.dmg" > SHA256SUMS.txt
  )

  log "Build artifacts"
  printf '%s\n%s\n%s\n' \
    "$app_path" \
    "$dmg_path" \
    "$artifact_dir"
}

build_windows() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      ;;
    *)
      printf 'The windows target must be run on Windows. Use ./build.sh current for this machine.\n' >&2
      exit 1
      ;;
  esac

  project_version >/dev/null

  log "Building Windows MSI and NSIS installers"
  pnpm tauri build --bundles msi,nsis

  log "Build artifacts"
  find "$ROOT_DIR/src-tauri/target/release/bundle" \
    \( -name '*.msi' -o -name '*.exe' \) \
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
    project_version >/dev/null
    build_jdbc_bridge
    run_checks
    build_current
    ;;
  mac)
    if [ "$(uname -s)" != "Darwin" ]; then
      printf 'The mac target must be run on macOS. Use ./build.sh current for this machine.\n' >&2
      exit 1
    fi
    ensure_dependencies
    project_version >/dev/null
    build_jdbc_bridge
    run_checks
    build_mac
    ;;
  windows)
    case "$(uname -s)" in
      MINGW*|MSYS*|CYGWIN*)
        ;;
      *)
        printf 'The windows target must be run on Windows. Use ./build.sh current for this machine.\n' >&2
        exit 1
        ;;
    esac
    ensure_dependencies
    project_version >/dev/null
    build_jdbc_bridge
    run_checks
    build_windows
    ;;
  jdbc-bridge)
    build_jdbc_bridge
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
