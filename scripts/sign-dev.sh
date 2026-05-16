#!/bin/bash
# Sign the binary with entitlements for macOS development
BINARY_PATH="$1"
ENTITLEMENTS="$2"

if [ -f "$BINARY_PATH" ]; then
  codesign --force --deep --sign - --entitlements "$ENTITLEMENTS" "$BINARY_PATH" 2>/dev/null
  if [ $? -eq 0 ]; then
    echo "Successfully signed $BINARY_PATH with entitlements"
  else
    echo "Warning: Failed to sign $BINARY_PATH"
  fi
fi