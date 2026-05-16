#!/bin/bash
# macOS dev runner: sign binary with entitlements before executing
# This script is used as the Cargo runner for macOS development on macOS 26+
# to work around a compatibility issue where WebView apps crash without
# proper entitlements.

ENTITLEMENTS="/Users/cococzl/Documents/github/VaporLensDB/src-tauri/gen/apple/Entitlements.plist"
BINARY="$1"
shift

if [ -f "$BINARY" ] && [ -f "$ENTITLEMENTS" ]; then
    codesign --force --deep --sign - --entitlements "$ENTITLEMENTS" "$BINARY" 2>/dev/null
fi

exec "$BINARY" "$@"