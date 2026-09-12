#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF' >&2
Usage: ./scripts/qa-dev-profile.sh <create|run|cleanup> [profile-directory]

create                 Print a new disposable QA HOME directory.
run <profile-directory> Launch pnpm tauri dev with that temporary HOME.
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
