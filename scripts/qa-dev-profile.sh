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

case "${1:-}" in
  create)
    mktemp -d "${TMPDIR:-/tmp}/vaporlensdb-qa-profile.XXXXXX"
    ;;
  run)
    profile_dir="${2:-}"
    [[ -d "$profile_dir" ]] || { printf 'QA profile directory does not exist: %s\n' "$profile_dir" >&2; exit 1; }
    HOME="$profile_dir" VAPORLENSDB_USE_DEV_KEY=1 pnpm tauri dev
    ;;
  cleanup)
    profile_dir="${2:-}"
    case "$profile_dir" in
      "${TMPDIR:-/tmp}"/vaporlensdb-qa-profile.*|/private/tmp/vaporlensdb-qa-profile.*|/tmp/vaporlensdb-qa-profile.*)
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
