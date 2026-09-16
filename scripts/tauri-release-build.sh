#!/usr/bin/env bash
# Build a macOS release-like Tauri artifact without embedding local source
# roots in Rust source-location strings. The resulting mapping is deliberately
# derived at build time so no developer-specific path is committed.
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  printf 'tauri-release-build.sh is only for macOS release-like builds.\n' >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CARGO_ROOT="${CARGO_HOME:-$HOME/.cargo}"
RUSTUP_ROOT="${RUSTUP_HOME:-$HOME/.rustup}"
SEPARATOR=$'\x1f'

if [ -n "${RUSTFLAGS:-}" ]; then
  printf 'Refusing to replace RUSTFLAGS during a release build. Set CARGO_ENCODED_RUSTFLAGS instead.\n' >&2
  exit 1
fi

append_rustflag() {
  if [ -n "${CARGO_ENCODED_RUSTFLAGS:-}" ]; then
    CARGO_ENCODED_RUSTFLAGS+="$SEPARATOR"
  fi
  CARGO_ENCODED_RUSTFLAGS+="$1"
}

# Keep Rust's panic/source-location data useful without retaining a local home
# directory or workspace path in a distributable executable.
append_rustflag "--remap-path-prefix=$ROOT_DIR=/vaporlensdb"
append_rustflag "--remap-path-prefix=$CARGO_ROOT=/cargo"
append_rustflag "--remap-path-prefix=$RUSTUP_ROOT=/rustup"
export CARGO_ENCODED_RUSTFLAGS

cd "$ROOT_DIR"
pnpm tauri build --config src-tauri/tauri.bundle.conf.json "$@"
