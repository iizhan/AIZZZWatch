#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
ICONSET="$TMP_DIR/AIZZZWatch.iconset"
BASE_PNG="$TMP_DIR/icon-1024.png"
WINDOWS_ICON_PNG="$TMP_DIR/icon-256.png"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$ICONSET"
if ! sips -s format png "$ROOT_DIR/assets/icon.svg" --out "$BASE_PNG" >/dev/null 2>&1; then
  if ! qlmanage -t -s 1024 -o "$TMP_DIR" "$ROOT_DIR/assets/icon.svg" >/dev/null 2>&1; then
    echo "[build-icon] cannot render assets/icon.svg with sips or qlmanage" >&2
    exit 1
  fi
  if [[ ! -f "$TMP_DIR/icon.svg.png" ]]; then
    echo "[build-icon] qlmanage did not create the SVG thumbnail" >&2
    exit 1
  fi
  mv "$TMP_DIR/icon.svg.png" "$BASE_PNG"
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
sips -z 256 256 "$BASE_PNG" --out "$WINDOWS_ICON_PNG" >/dev/null
sips -s format ico "$WINDOWS_ICON_PNG" --out "$ROOT_DIR/assets/icon.ico" >/dev/null
