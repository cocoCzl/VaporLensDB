#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: ./scripts/qa-sqlite-dir.sh <create|cleanup> [directory]\n' >&2
}

qa_tmp_root="${TMPDIR:-/tmp}"
qa_tmp_root="${qa_tmp_root%/}"

case "${1:-}" in
  create)
    qa_dir="$(mktemp -d "$qa_tmp_root/vaporlensdb-qa.XXXXXX")"
    mkdir -p "$qa_dir/space path" "$qa_dir/测试路径"
    printf '%s\n' "$qa_dir"
    ;;
  cleanup)
    qa_dir="${2:-}"
    case "$qa_dir" in
      "$qa_tmp_root"/vaporlensdb-qa.*|/private/tmp/vaporlensdb-qa.*|/tmp/vaporlensdb-qa.*)
        [[ -d "$qa_dir" ]] || { printf 'QA SQLite directory does not exist: %s\n' "$qa_dir" >&2; exit 1; }
        rm -rf "$qa_dir"
        [[ ! -e "$qa_dir" ]] || { printf 'Failed to remove QA SQLite directory: %s\n' "$qa_dir" >&2; exit 1; }
        ;;
      *)
        printf 'Refusing to remove a non-QA SQLite directory: %s\n' "$qa_dir" >&2
        exit 2
        ;;
    esac
    ;;
  *)
    usage
    exit 2
    ;;
esac
