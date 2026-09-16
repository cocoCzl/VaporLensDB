#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF' >&2
Usage: ./scripts/qa-dev-profile.sh <create|run|run-keychain|run-release-keychain|cleanup> [profile-directory]

create                 Print a new disposable QA HOME directory.
run <profile-directory> Launch pnpm tauri dev with that temporary HOME.
run-keychain <profile-directory> Launch with an isolated config directory but
                           the logged-in macOS Keychain, for credential QA.
run-release-keychain <profile-directory>
                         Launch the unsigned release-like macOS app with an
                         isolated config directory and logged-in Keychain.
cleanup <profile-dir>  Remove only a QA profile directory created under TMPDIR.
EOF
}

qa_tmp_root="${TMPDIR:-/tmp}"
qa_tmp_root="${qa_tmp_root%/}"

case "${1:-}" in
  create)
    mktemp -d "$qa_tmp_root/vaporlensdb-qa-profile.XXXXXX"
    ;;
  run)
    profile_dir="${2:-}"
    [[ -d "$profile_dir" ]] || { printf 'QA profile directory does not exist: %s\n' "$profile_dir" >&2; exit 1; }
    host_home="$HOME"
    HOME="$profile_dir" \
      COREPACK_HOME="${COREPACK_HOME:-$host_home/.cache/node/corepack}" \
      RUSTUP_HOME="${RUSTUP_HOME:-$host_home/.rustup}" \
      CARGO_HOME="${CARGO_HOME:-$host_home/.cargo}" \
      VAPORLENSDB_USE_DEV_KEY=1 \
      pnpm tauri dev
    ;;
  run-keychain)
    profile_dir="${2:-}"
    [[ -d "$profile_dir" ]] || { printf 'QA profile directory does not exist: %s\n' "$profile_dir" >&2; exit 1; }
    host_home="$HOME"
    VAPORLENSDB_CONFIG_DIR="$profile_dir/.vaporlensdb" \
      COREPACK_HOME="${COREPACK_HOME:-$host_home/.cache/node/corepack}" \
      RUSTUP_HOME="${RUSTUP_HOME:-$host_home/.rustup}" \
      CARGO_HOME="${CARGO_HOME:-$host_home/.cargo}" \
      pnpm tauri dev
    ;;
  run-release-keychain)
    profile_dir="${2:-}"
    [[ -d "$profile_dir" ]] || { printf 'QA profile directory does not exist: %s\n' "$profile_dir" >&2; exit 1; }
    [[ "$(uname -s)" = "Darwin" ]] || { printf 'Release-like Keychain QA is only available on macOS.\n' >&2; exit 1; }
    release_app="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/target/release/bundle/macos/VaporLensDB.app"
    [[ -d "$release_app" ]] || { printf 'Release-like app does not exist: %s\n' "$release_app" >&2; exit 1; }

    previous_config_dir="$(launchctl getenv VAPORLENSDB_CONFIG_DIR 2>/dev/null || true)"
    launchctl setenv VAPORLENSDB_CONFIG_DIR "$profile_dir/.vaporlensdb"
    /usr/bin/open -n "$release_app"

    # LaunchServices passes this environment to the spawned app. Restore the
    # session setting immediately after the process appears so this temporary
    # QA configuration cannot leak to unrelated future application launches.
    app_pid=""
    for _ in {1..50}; do
      app_pid="$(pgrep -n -f "$release_app/Contents/MacOS/vapor-lens-db" 2>/dev/null || true)"
      [[ -n "$app_pid" ]] && break
      sleep 0.1
    done
    if [[ -n "$previous_config_dir" ]]; then
      launchctl setenv VAPORLENSDB_CONFIG_DIR "$previous_config_dir"
    else
      launchctl unsetenv VAPORLENSDB_CONFIG_DIR
    fi
    [[ -n "$app_pid" ]] || { printf 'Release-like app did not start.\n' >&2; exit 1; }
    printf 'Release-like QA app started with PID %s\n' "$app_pid"
    ;;
  cleanup)
    profile_dir="${2:-}"
    case "$profile_dir" in
      "$qa_tmp_root"/vaporlensdb-qa-profile.*|/private/tmp/vaporlensdb-qa-profile.*|/tmp/vaporlensdb-qa-profile.*)
        [[ -d "$profile_dir" ]] || { printf 'QA profile directory does not exist: %s\n' "$profile_dir" >&2; exit 1; }
        rm -rf "$profile_dir"
        [[ ! -e "$profile_dir" ]] || { printf 'Failed to remove QA profile directory: %s\n' "$profile_dir" >&2; exit 1; }
        ;;
      *)
        printf 'Refusing to remove a non-QA profile directory: %s\n' "$profile_dir" >&2
        exit 2
        ;;
    esac
    ;;
  *)
    usage
    exit 2
    ;;
esac
