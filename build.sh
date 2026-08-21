#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-current}"
LIVE_TEST_ENV_LOADED=0

usage() {
  cat <<'EOF'
Usage:
  ./build.sh [mac|windows|linux|current|check|live-tests|jdbc-bridge]

Targets:
  mac      Build a macOS app bundle and DMG on macOS.
  windows  Build Windows MSI and NSIS installers on Windows.
  linux    Build Linux AppImage, DEB, and RPM packages on Linux.
  current  Build the supported installer format for the current platform.
  check    Run validation only: frontend lint/build and Rust tests.
  live-tests Run configured PostgreSQL, MySQL, Oracle, and JDBC integration tests.
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
  if [ "$LIVE_TEST_ENV_LOADED" -eq 1 ]; then
    return
  fi

  if [ -f "$ROOT_DIR/.env" ]; then
    log "Loading local live-test configuration from .env"
    set -a
    # shellcheck disable=SC1091
    source "$ROOT_DIR/.env"
    set +a
  fi

  LIVE_TEST_ENV_LOADED=1
}

env_has_any() {
  local name
  for name in "$@"; do
    if [ -n "${!name:-}" ]; then
      return 0
    fi
  done
  return 1
}

require_complete_env_group() {
  local label="$1"
  shift

  if ! env_has_any "$@"; then
    return 1
  fi

  local missing=""
  local name
  for name in "$@"; do
    if [ -z "${!name:-}" ]; then
      missing="${missing}${missing:+, }${name}"
    fi
  done

  if [ -n "$missing" ]; then
    printf 'Incomplete %s live-test configuration; missing: %s\n' "$label" "$missing" >&2
    return 2
  fi

  return 0
}

validate_live_test_configuration() {
  local status

  require_complete_env_group "PostgreSQL" \
    TEST_PG_JDBC_URL TEST_PG_USER TEST_PG_PASSWORD TEST_PG_DATABASE || status=$?
  if [ "${status:-0}" -eq 2 ]; then
    return 1
  fi
  status=0

  require_complete_env_group "MySQL" \
    TEST_MYSQL_JDBC_URL TEST_MYSQL_USER TEST_MYSQL_PASSWORD TEST_MYSQL_DATABASE || status=$?
  if [ "$status" -eq 2 ]; then
    return 1
  fi
  status=0

  require_complete_env_group "Oracle" \
    TEST_ORACLE_JDBC_URL TEST_ORACLE_USER TEST_ORACLE_PASSWORD TEST_ORACLE_JDBC_DRIVER_PATH || status=$?
  if [ "$status" -eq 2 ]; then
    return 1
  fi

  local path_name
  for path_name in \
    TEST_PG_JDBC_DRIVER_PATH \
    TEST_MYSQL_JDBC_DRIVER_PATH \
    TEST_ORACLE_JDBC_DRIVER_PATH; do
    if [ -n "${!path_name:-}" ] && [ ! -f "${!path_name}" ]; then
      printf '%s does not point to a readable JDBC JAR: %s\n' "$path_name" "${!path_name}" >&2
      return 1
    fi
  done
}

has_live_test_configuration() {
  env_has_any \
    TEST_PG_JDBC_URL TEST_PG_USER TEST_PG_PASSWORD TEST_PG_DATABASE TEST_PG_JDBC_DRIVER_PATH \
    TEST_MYSQL_JDBC_URL TEST_MYSQL_USER TEST_MYSQL_PASSWORD TEST_MYSQL_DATABASE TEST_MYSQL_JDBC_DRIVER_PATH \
    TEST_ORACLE_JDBC_URL TEST_ORACLE_USER TEST_ORACLE_PASSWORD TEST_ORACLE_JDBC_DRIVER_PATH \
    VAPORLENSDB_TEST_POSTGRES_URL VAPORLENSDB_TEST_MYSQL_URL
}

has_complete_live_test_configuration() {
  [ -n "${TEST_PG_JDBC_URL:-}" ] &&
    [ -n "${TEST_PG_USER:-}" ] &&
    [ -n "${TEST_PG_PASSWORD:-}" ] &&
    [ -n "${TEST_PG_DATABASE:-}" ] &&
    [ -n "${TEST_PG_JDBC_DRIVER_PATH:-}" ] &&
    [ -n "${TEST_MYSQL_JDBC_URL:-}" ] &&
    [ -n "${TEST_MYSQL_USER:-}" ] &&
    [ -n "${TEST_MYSQL_PASSWORD:-}" ] &&
    [ -n "${TEST_MYSQL_DATABASE:-}" ] &&
    [ -n "${TEST_MYSQL_JDBC_DRIVER_PATH:-}" ] &&
    [ -n "${TEST_ORACLE_JDBC_URL:-}" ] &&
    [ -n "${TEST_ORACLE_USER:-}" ] &&
    [ -n "${TEST_ORACLE_PASSWORD:-}" ] &&
    [ -n "${TEST_ORACLE_JDBC_DRIVER_PATH:-}" ] &&
    [ -n "${VAPORLENSDB_TEST_POSTGRES_URL:-}" ] &&
    [ -n "${VAPORLENSDB_TEST_MYSQL_URL:-}" ]
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
  pnpm tauri build --config src-tauri/tauri.bundle.conf.json "$@"
}

build_jdbc_bridge() {
  log "Building JDBC bridge"
  "$ROOT_DIR/tools/jdbc-bridge/build.sh"
}

run_checks() {
  log "Running frontend lint"
  pnpm lint

  log "Testing cross-platform artifact staging"
  pnpm test:packaging

  log "Building frontend"
  pnpm build

  log "Running Rust clippy"
  (cd "$ROOT_DIR/src-tauri" && cargo clippy --all-targets -- -D warnings)

  run_rust_tests
}

run_rust_tests() {
  load_live_test_env
  validate_live_test_configuration

  if has_complete_live_test_configuration; then
    log "Running Rust tests including all configured live database tests"
    (cd "$ROOT_DIR/src-tauri" && cargo test -- --include-ignored)
    return
  fi

  log "Running Rust tests"
  (cd "$ROOT_DIR/src-tauri" && cargo test)

  if has_live_test_configuration; then
    run_configured_live_tests
  else
    log "Live database tests skipped (no local configuration)"
  fi
}

run_configured_live_tests() {
  load_live_test_env
  validate_live_test_configuration

  local ran_any=0

  if [ -n "${TEST_PG_JDBC_URL:-}" ]; then
    log "Running PostgreSQL live integration tests"
    (cd "$ROOT_DIR/src-tauri" && cargo test --test postgres_driver -- --ignored)
    ran_any=1

    if [ -n "${TEST_PG_JDBC_DRIVER_PATH:-}" ]; then
      log "Running PostgreSQL JDBC template integration test"
      (cd "$ROOT_DIR/src-tauri" && cargo test --test jdbc_template_driver \
        postgres_jdbc_template_queries_and_reads_metadata -- --ignored)
    else
      log "PostgreSQL JDBC template test skipped (TEST_PG_JDBC_DRIVER_PATH is not set)"
    fi
  else
    log "PostgreSQL live tests skipped (configuration is not set)"
  fi

  if [ -n "${TEST_MYSQL_JDBC_URL:-}" ]; then
    log "Running MySQL live integration tests"
    (cd "$ROOT_DIR/src-tauri" && cargo test --test mysql_driver -- --ignored)
    ran_any=1

    if [ -n "${TEST_MYSQL_JDBC_DRIVER_PATH:-}" ]; then
      log "Running MySQL JDBC template integration test"
      (cd "$ROOT_DIR/src-tauri" && cargo test --test jdbc_template_driver \
        mysql_jdbc_template_queries_and_reads_metadata -- --ignored)
    else
      log "MySQL JDBC template test skipped (TEST_MYSQL_JDBC_DRIVER_PATH is not set)"
    fi
  else
    log "MySQL live tests skipped (configuration is not set)"
  fi

  if [ -n "${TEST_ORACLE_JDBC_URL:-}" ]; then
    log "Running Oracle JDBC live integration tests"
    (cd "$ROOT_DIR/src-tauri" && cargo test --test oracle_jdbc_driver -- --ignored)
    ran_any=1
  else
    log "Oracle live tests skipped (configuration is not set)"
  fi

  if [ -n "${VAPORLENSDB_TEST_POSTGRES_URL:-}" ]; then
    log "Running PostgreSQL CREATE/DROP DATABASE integration test"
    (cd "$ROOT_DIR/src-tauri" && cargo test --test live_database_create \
      postgres_create_database_is_visible_and_duplicate_is_rejected -- --ignored)
    ran_any=1
  else
    log "PostgreSQL CREATE/DROP DATABASE test skipped (VAPORLENSDB_TEST_POSTGRES_URL is not set)"
  fi

  if [ -n "${VAPORLENSDB_TEST_MYSQL_URL:-}" ]; then
    log "Running MySQL CREATE/DROP DATABASE integration test"
    (cd "$ROOT_DIR/src-tauri" && cargo test --test live_database_create \
      mysql_create_database_is_visible_and_duplicate_is_rejected -- --ignored)
    ran_any=1
  else
    log "MySQL CREATE/DROP DATABASE test skipped (VAPORLENSDB_TEST_MYSQL_URL is not set)"
  fi

  if [ "$ran_any" -eq 0 ]; then
    printf 'No complete live database configuration was found in .env or the shell.\n' >&2
    return 1
  fi
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
    run_configured_live_tests
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
