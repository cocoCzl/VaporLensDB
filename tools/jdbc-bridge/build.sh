#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$ROOT_DIR/build"
TARGET_DIR="$ROOT_DIR/target"
JAR_PATH="$TARGET_DIR/jdbc-bridge.jar"

command -v javac >/dev/null 2>&1 || {
  echo "Missing javac. Install a JDK to build the JDBC bridge." >&2
  exit 1
}

command -v jar >/dev/null 2>&1 || {
  echo "Missing jar. Install a JDK to build the JDBC bridge." >&2
  exit 1
}

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR" "$TARGET_DIR"

javac -encoding UTF-8 -d "$BUILD_DIR" \
  "$ROOT_DIR/src/com/vaporlensdb/jdbcbridge/JdbcBridge.java"

jar --create --file "$JAR_PATH" --main-class com.vaporlensdb.jdbcbridge.JdbcBridge -C "$BUILD_DIR" .

echo "$JAR_PATH"
