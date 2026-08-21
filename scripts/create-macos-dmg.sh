#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  printf 'Usage: %s <VaporLensDB.app> <output.dmg>\n' "$0" >&2
  exit 1
fi

APP_PATH="$1"
OUTPUT_PATH="$2"

if [ "$(uname -s)" != "Darwin" ]; then
  printf 'macOS DMG creation must run on macOS.\n' >&2
  exit 1
fi

if [ ! -d "$APP_PATH" ]; then
  printf 'App bundle not found: %s\n' "$APP_PATH" >&2
  exit 1
fi

case "$OUTPUT_PATH" in
  *.dmg)
    ;;
  *)
    printf 'Output path must end in .dmg: %s\n' "$OUTPUT_PATH" >&2
    exit 1
    ;;
esac

for command in ditto hdiutil mktemp; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$command" >&2
    exit 1
  fi
done

mkdir -p "$(dirname "$OUTPUT_PATH")"
OUTPUT_DIR="$(cd "$(dirname "$OUTPUT_PATH")" && pwd)"
OUTPUT_PATH="$OUTPUT_DIR/$(basename "$OUTPUT_PATH")"
STAGING_DIR="$(mktemp -d -t vaporlensdb-dmg)"

cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

ditto "$APP_PATH" "$STAGING_DIR/VaporLensDB.app"
ln -s /Applications "$STAGING_DIR/Applications"
hdiutil create -volname VaporLensDB -srcfolder "$STAGING_DIR" -ov -format UDZO "$OUTPUT_PATH"
