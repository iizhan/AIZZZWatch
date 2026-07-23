#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
ICONSET="$TMP_DIR/AIZZZWatch.iconset"
BASE_PNG="$TMP_DIR/icon-1024.png"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$ICONSET"
if ! sips -s format png "$ROOT_DIR/assets/icon.svg" --out "$BASE_PNG" >/dev/null; then
  if [[ -f "$ROOT_DIR/assets/icon.icns" ]]; then
    echo "[build-icon] SVG conversion failed; keeping existing icon.icns"
    exit 0
  fi
  echo "[build-icon] SVG conversion failed and no fallback icon.icns exists" >&2
  exit 1
fi

sips -z 16 16 "$BASE_PNG" --out "$ICONSET/icon_16x16.png" >/dev/null
sips -z 32 32 "$BASE_PNG" --out "$ICONSET/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$BASE_PNG" --out "$ICONSET/icon_32x32.png" >/dev/null
sips -z 64 64 "$BASE_PNG" --out "$ICONSET/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$BASE_PNG" --out "$ICONSET/icon_128x128.png" >/dev/null
sips -z 256 256 "$BASE_PNG" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$BASE_PNG" --out "$ICONSET/icon_256x256.png" >/dev/null
sips -z 512 512 "$BASE_PNG" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$BASE_PNG" --out "$ICONSET/icon_512x512.png" >/dev/null
cp "$BASE_PNG" "$ICONSET/icon_512x512@2x.png"

iconutil -c icns "$ICONSET" -o "$ROOT_DIR/assets/icon.icns"
