#!/usr/bin/env bash
set -euo pipefail

# 編譯並執行 Safari 原生備份 handler 的測試（需要 Xcode Command Line Tools）。
OUT_DIR=$(mktemp -d)
trap 'rm -rf "$OUT_DIR"' EXIT

xcrun --sdk macosx swiftc \
  src/safari-native/SafariWebExtensionHandler.swift \
  tests/safari-native/main.swift \
  -o "$OUT_DIR/safari-native-tests"
"$OUT_DIR/safari-native-tests"
