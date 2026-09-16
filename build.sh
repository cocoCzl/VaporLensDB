#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-current}"
if [ "$#" -gt 0 ]; then
  shift
fi

usage() {
  cat <<'EOF'
Usage:
  ./build.sh [mac|windows|linux|current|check|live-tests|destructive-live-tests|jdbc-bridge] [selectors]

Targets:
  mac      Build a macOS app bundle and DMG on macOS.
  windows  Build Windows MSI and NSIS installers on Windows.
  linux    Build Linux AppImage, DEB, and RPM packages on Linux.
  current  Build the supported installer format for the current platform.
  check    Run all local validation without creating an installer.
  live-tests Run explicitly selected non-destructive RC JDBC integration tests.
  destructive-live-tests Run explicitly selected CREATE/DROP DATABASE integration tests.
  jdbc-bridge Build the lightweight Java JDBC bridge jar.

Outputs:
  macOS app: src-tauri/target/release/bundle/macos/VaporLensDB.app
  macOS dmg: src-tauri/target/release/bundle/dmg/VaporLensDB.dmg
  macOS local staging: artifacts/macos/<architecture>/
  Windows msi: src-tauri/target/release/bundle/msi/*.msi
  Windows nsis: src-tauri/target/release/bundle/nsis/*.exe
  Windows local staging: artifacts/windows/<architecture>/
  Linux appimage: src-tauri/target/release/bundle/appimage/*.AppImage
  Linux deb: src-tauri/target/release/bundle/deb/*.deb
  Linux rpm: src-tauri/target/release/bundle/rpm/*.rpm
  Linux local staging: artifacts/linux/<architecture>/
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

load_live_test_env() {
  local env_file="${VAPORLENSDB_LIVE_TEST_ENV_FILE:-$ROOT_DIR/.env}"
  if [ -n "${VAPORLENSDB_LIVE_TEST_ENV_FILE:-}" ] && [ ! -f "$env_file" ]; then
    printf 'Explicit live-test environment file is missing: %s\n' "$env_file" >&2
    return 1
  fi
  if [ -f "$env_file" ]; then
    log "Loading explicit local live-test configuration"
    set -a
    # shellcheck disable=SC1091
    source "$env_file"
    set +a
  fi
}

require_live_env() {
  local label="$1"
  shift
  local missing=""
  local name
  for name in "$@"; do
    if [ -z "${!name:-}" ]; then
      missing="${missing}${missing:+, }${name}"
    fi
  done
  if [ -n "$missing" ]; then
    printf 'Incomplete %s integration configuration; missing: %s\n' "$label" "$missing" >&2
    return 1
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

host_architecture() {
  local rustc_details
  rustc_details="$(rustc -vV)"

  case "$rustc_details" in
    *"host: x86_64-"*)
      printf 'x86_64\n'
      ;;
    *"host: aarch64-"*)
      printf 'aarch64\n'
      ;;
    *)
      printf 'Unsupported build architecture reported by rustc:\n%s\n' "$rustc_details" >&2
      exit 1
      ;;
  esac
}

stage_installer_artifacts() {
  local platform="$1"
  local architecture="$2"
  node "$ROOT_DIR/scripts/stage-build-artifacts.mjs" \
    "$platform" \
    "$ROOT_DIR/src-tauri/target/release/bundle" \
    "$ROOT_DIR/artifacts/$platform/$architecture"
}

tauri_bundle_build() {
  if [ "$(uname -s)" = "Darwin" ]; then
    bash "$ROOT_DIR/scripts/tauri-release-build.sh" "$@"
    return
  fi

  pnpm tauri build --config src-tauri/tauri.bundle.conf.json "$@"
}

build_jdbc_bridge() {
  log "Building JDBC bridge"
  "$ROOT_DIR/tools/jdbc-bridge/build.sh"
}

run_checks() {
  log "Scanning repository files for sensitive information"
  pnpm test:sensitive-info

  log "Running frontend lint"
  pnpm lint

  log "Testing cross-platform artifact staging"
  pnpm test:packaging

  log "Running frontend behavior tests"
  pnpm test

  log "Running complete workflow smoke suite"
  pnpm test:smoke

  log "Building frontend"
  pnpm build

  log "Checking performance and bundle budgets"
  pnpm test:performance-guardrails
  pnpm test:bundle-budget

  log "Checking Rust formatting"
  (cd "$ROOT_DIR/src-tauri" && cargo fmt -- --check)

  log "Running Rust clippy"
  (cd "$ROOT_DIR/src-tauri" && cargo clippy --all-targets -- -D warnings)

  log "Running deterministic Rust tests"
  (cd "$ROOT_DIR/src-tauri" && cargo test)
}

run_selected_live_tests() {
  load_live_test_env
  if [ "$#" -eq 0 ]; then
    printf 'Select at least one RC live integration target: --mysql, --oracle, or --postgresql.\n' >&2
    return 1
  fi

  local target
  for target in "$@"; do
    case "$target" in
      --mysql)
        require_live_env "MySQL JDBC" \
          TEST_MYSQL_JDBC_URL TEST_MYSQL_USER TEST_MYSQL_PASSWORD TEST_MYSQL_JDBC_DRIVER_PATH
        log "Running MySQL JDBC metadata integration (isolated fixture schema)"
        (cd "$ROOT_DIR/src-tauri" && cargo test --test jdbc_template_driver \
          mysql_jdbc_template_queries_and_reads_metadata -- --ignored)
        ;;
      --oracle)
        require_live_env "Oracle JDBC" \
          TEST_ORACLE_JDBC_URL TEST_ORACLE_USER TEST_ORACLE_PASSWORD TEST_ORACLE_JDBC_DRIVER_PATH
        log "Running Oracle JDBC query and metadata integrations"
        (cd "$ROOT_DIR/src-tauri" && cargo test --test oracle_jdbc_driver \
          connects_and_queries_oracle_with_jdbc_bridge -- --ignored)
        (cd "$ROOT_DIR/src-tauri" && cargo test --test oracle_jdbc_driver \
          reads_oracle_metadata_with_jdbc_bridge -- --ignored)
        ;;
      --postgresql)
        require_live_env "PostgreSQL JDBC" \
          TEST_PG_JDBC_URL TEST_PG_USER TEST_PG_PASSWORD TEST_PG_JDBC_DRIVER_PATH
        log "Running PostgreSQL JDBC metadata integration (isolated fixture schema)"
        (cd "$ROOT_DIR/src-tauri" && cargo test --test jdbc_template_driver \
          postgres_jdbc_template_queries_and_reads_metadata -- --ignored)
        ;;
      *)
        printf 'Unknown RC live integration target: %s\n' "$target" >&2
        return 1
        ;;
    esac
  done
}

run_selected_destructive_live_tests() {
  load_live_test_env
  if [ "${VAPORLENSDB_ALLOW_DESTRUCTIVE_INTEGRATION:-}" != "1" ]; then
    printf 'Refusing destructive integration tests. Set VAPORLENSDB_ALLOW_DESTRUCTIVE_INTEGRATION=1 explicitly.\n' >&2
    return 1
  fi
  if [ "$#" -eq 0 ]; then
    printf 'Select at least one destructive target: --mysql or --postgresql.\n' >&2
    return 1
  fi

  local target
  for target in "$@"; do
    case "$target" in
      --mysql)
        require_live_env "MySQL CREATE/DROP DATABASE" VAPORLENSDB_TEST_MYSQL_URL
        log "Running MySQL CREATE/DROP DATABASE integration"
        (cd "$ROOT_DIR/src-tauri" && cargo test --test live_database_create \
          mysql_create_database_is_visible_and_duplicate_is_rejected -- --ignored)
        ;;
      --postgresql)
        require_live_env "PostgreSQL CREATE/DROP DATABASE" VAPORLENSDB_TEST_POSTGRES_URL
        log "Running PostgreSQL CREATE/DROP DATABASE integration"
        (cd "$ROOT_DIR/src-tauri" && cargo test --test live_database_create \
          postgres_create_database_is_visible_and_duplicate_is_rejected -- --ignored)
        ;;
      *)
        printf 'Unknown destructive integration target: %s\n' "$target" >&2
        return 1
        ;;
    esac
  done
}

build_current() {
  case "$(uname -s)" in
    Darwin)
      build_mac
      ;;
    MINGW*|MSYS*|CYGWIN*)
      build_windows
      ;;
    Linux)
      build_linux
      ;;
    *)
      printf 'Unsupported packaging platform: %s\n' "$(uname -s)" >&2
      exit 1
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

  local architecture
  project_version >/dev/null
  architecture="$(mac_architecture)"
  local bundle_dir="$ROOT_DIR/src-tauri/target/release/bundle"
  local app_path="$bundle_dir/macos/VaporLensDB.app"
  local dmg_dir="$bundle_dir/dmg"
  local dmg_path="$dmg_dir/VaporLensDB.dmg"
  local artifact_dir="$ROOT_DIR/artifacts/macos/$architecture"

  log "Building macOS Tauri app"
  tauri_bundle_build --bundles app

  if [ ! -d "$app_path" ]; then
    printf 'Expected macOS app bundle was not created: %s\n' "$app_path" >&2
    exit 1
  fi

  log "Creating macOS DMG"
  rm -rf "$dmg_dir"
  bash "$ROOT_DIR/scripts/create-macos-dmg.sh" "$app_path" "$dmg_path"

  log "Staging local macOS artifacts"
  rm -rf "$artifact_dir"
  mkdir -p "$artifact_dir"
  ditto "$app_path" "$artifact_dir/VaporLensDB.app"
  cp "$dmg_path" "$artifact_dir/VaporLensDB.dmg"
  (
    cd "$artifact_dir"
    shasum -a 256 "VaporLensDB.dmg" > SHA256SUMS.txt
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

  local architecture
  project_version >/dev/null
  architecture="$(host_architecture)"

  log "Building Windows MSI and NSIS installers"
  rm -rf \
    "$ROOT_DIR/src-tauri/target/release/bundle/msi" \
    "$ROOT_DIR/src-tauri/target/release/bundle/nsis"
  tauri_bundle_build --bundles msi,nsis

  log "Staging local Windows artifacts"
  stage_installer_artifacts windows "$architecture"
}

build_linux() {
  if [ "$(uname -s)" != "Linux" ]; then
    printf 'The linux target must be run on Linux. Use ./build.sh current for this machine.\n' >&2
    exit 1
  fi

  local architecture
  project_version >/dev/null
  architecture="$(host_architecture)"

  log "Building Linux AppImage, DEB, and RPM packages"
  rm -rf \
    "$ROOT_DIR/src-tauri/target/release/bundle/appimage" \
    "$ROOT_DIR/src-tauri/target/release/bundle/deb" \
    "$ROOT_DIR/src-tauri/target/release/bundle/rpm"
  tauri_bundle_build --bundles appimage,deb,rpm

  log "Staging local Linux artifacts"
  stage_installer_artifacts linux "$architecture"
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
  live-tests)
    ensure_dependencies
    build_jdbc_bridge
    run_selected_live_tests "$@"
    ;;
  destructive-live-tests)
    ensure_dependencies
    run_selected_destructive_live_tests "$@"
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
  linux)
    if [ "$(uname -s)" != "Linux" ]; then
      printf 'The linux target must be run on Linux. Use ./build.sh current for this machine.\n' >&2
      exit 1
    fi
    ensure_dependencies
    project_version >/dev/null
    build_jdbc_bridge
    run_checks
    build_linux
    ;;
  jdbc-bridge)
    build_jdbc_bridge
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
