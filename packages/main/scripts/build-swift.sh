#!/usr/bin/env bash
# Build the macOS Swift audio helper as a universal binary.
# Run this on a Mac before packaging: npm run build-swift
set -e

SWIFT_SRC="packages/main/swift/AudioHelper.swift"
OUT_DIR="packages/main/resources"
OUT="$OUT_DIR/turingram-audio-helper"

mkdir -p "$OUT_DIR"

echo "Compiling arm64..."
swiftc "$SWIFT_SRC" \
  -O -target arm64-apple-macos13.0 \
  -framework ScreenCaptureKit -framework CoreAudio \
  -o "${OUT}-arm64"

echo "Compiling x86_64..."
swiftc "$SWIFT_SRC" \
  -O -target x86_64-apple-macos13.0 \
  -framework ScreenCaptureKit -framework CoreAudio \
  -o "${OUT}-x86_64"

echo "Creating universal binary..."
lipo -create "${OUT}-arm64" "${OUT}-x86_64" -output "$OUT"
rm "${OUT}-arm64" "${OUT}-x86_64"
chmod +x "$OUT"

echo "Done: $OUT"
