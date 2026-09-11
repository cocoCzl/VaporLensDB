#!/bin/bash
# macOS dev runner: launch the debug executable as a real application bundle.
# macOS 26 evaluates local-network privacy at the bundle level; launching the
# bare Cargo executable can fail with "No route to host (os error 65)".

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TAURI_DIR="$PROJECT_DIR/src-tauri"
ENTITLEMENTS="$TAURI_DIR/gen/apple/Entitlements.plist"
DEV_INFO_PLIST="$TAURI_DIR/Info.dev.plist"
APP_ICON="$TAURI_DIR/icons/icon.icns"
JDBC_BRIDGE_SOURCE="$PROJECT_DIR/tools/jdbc-bridge/target/jdbc-bridge.jar"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
BINARY="${1:?missing Cargo binary path}"
shift

if [ ! -f "$BINARY" ] || [ ! -f "$ENTITLEMENTS" ] || [ ! -f "$DEV_INFO_PLIST" ]; then
    exec "$BINARY" "$@"
fi

# Cargo invokes this runner for both `cargo run` and `cargo test`. The latter
# supplies a test harness from target/**/deps. A test harness must be executed
# by Cargo's process tree so its output and exit status remain authoritative;
# LaunchServices' `open` only reports whether it launched an application, not
# whether that harness passed. Signing the Mach-O directly preserves the same
# development entitlements without introducing an app-bundle/LaunchServices
# boundary for tests.
case "$BINARY" in
    "$TAURI_DIR"/target/*/deps/*)
        if [ ! -x "$BINARY" ]; then
            echo "Cargo test harness is not executable: $BINARY" >&2
            exit 126
        fi

        if ! codesign --force --sign - --entitlements "$ENTITLEMENTS" "$BINARY" >/dev/null 2>&1; then
            echo "Failed to sign Cargo test harness with macOS entitlements: $BINARY" >&2
            exit 1
        fi

        if ! codesign --verify --strict "$BINARY" >/dev/null 2>&1; then
            echo "Cargo test harness signature verification failed: $BINARY" >&2
            exit 1
        fi

        exec "$BINARY" "$@"
        ;;
esac

BINARY_DIR="$(cd "$(dirname "$BINARY")" && pwd)"
DEV_APP="$BINARY_DIR/VaporLensDB-dev.app"
DEV_CONTENTS="$DEV_APP/Contents"
DEV_EXECUTABLE="$DEV_CONTENTS/MacOS/vapor-lens-db-dev"

mkdir -p "$DEV_CONTENTS/MacOS" "$DEV_CONTENTS/Resources"
rm -f "$DEV_CONTENTS/MacOS/vapor-lens-db"
cp "$BINARY" "$DEV_EXECUTABLE"
cp "$DEV_INFO_PLIST" "$DEV_CONTENTS/Info.plist"
if [ -f "$APP_ICON" ]; then
    cp "$APP_ICON" "$DEV_CONTENTS/Resources/icon.icns"
fi
if [ -f "$JDBC_BRIDGE_SOURCE" ]; then
    mkdir -p "$DEV_CONTENTS/Resources/jdbc"
    cp "$JDBC_BRIDGE_SOURCE" "$DEV_CONTENTS/Resources/jdbc/jdbc-bridge.jar"
else
    rm -f "$DEV_CONTENTS/Resources/jdbc/jdbc-bridge.jar"
fi

codesign --force --sign - --entitlements "$ENTITLEMENTS" "$DEV_EXECUTABLE" >/dev/null 2>&1
codesign --force --deep --sign - --entitlements "$ENTITLEMENTS" "$DEV_APP" >/dev/null 2>&1

# Build and staging bundles share the same bundle identifier. If they were
# opened during development, LaunchServices keeps every path and Launchpad
# shows several identical VaporLensDB icons. Keep only this active dev bundle
# registered; no build artifact is deleted.
if [ -x "$LSREGISTER" ]; then
    while IFS= read -r stale_app; do
        [ "$stale_app" = "$DEV_APP" ] || "$LSREGISTER" -u "$stale_app" >/dev/null 2>&1 || true
    done < <(
        find "$TAURI_DIR/target" "$PROJECT_DIR/artifacts" "${TMPDIR:-/tmp}" \
            -type d \( -name 'VaporLensDB.app' -o -name 'VaporLensDB-dev.app' \) \
            -prune 2>/dev/null
    )
    "$LSREGISTER" -gc >/dev/null 2>&1 || true
fi

APP_PID=""

cleanup() {
    if [ -n "$APP_PID" ] && kill -0 "$APP_PID" >/dev/null 2>&1; then
        kill "$APP_PID" >/dev/null 2>&1 || true
    fi
    if [ -x "$LSREGISTER" ]; then
        "$LSREGISTER" -u "$DEV_APP" >/dev/null 2>&1 || true
        "$LSREGISTER" -gc >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM

# LaunchServices registers the bundle identity and triggers the macOS local-
# network consent prompt. Track the process LaunchServices creates so Cargo
# still owns its lifecycle and Ctrl+C only closes this runner's app instance.
/usr/bin/open -n "$DEV_APP" --args "$@"

for _ in {1..50}; do
    APP_PID="$(pgrep -n -f "$DEV_EXECUTABLE" 2>/dev/null || true)"
    [ -n "$APP_PID" ] && break
    sleep 0.1
done

if [ -z "$APP_PID" ]; then
    echo "VaporLensDB Dev was registered but its process did not start" >&2
    exit 1
fi

while kill -0 "$APP_PID" >/dev/null 2>&1; do
    sleep 1
done
