#!/usr/bin/env bash
# Build menu-bar app that runs local-bridge without Terminal.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
BRIDGE="$REPO/local-bridge"
SRC_ICON="${SRC_ICON:-$REPO/ipad-app/Assets.xcassets/AppIcon.appiconset/AppIcon.png}"
OUT_DIR="${OUT_DIR:-$ROOT/dist}"
APP_NAME="Language Caption Bridge"
APP="$OUT_DIR/$APP_NAME.app"
BIN="$APP/Contents/MacOS/CaptionStudioBridge"
RES="$APP/Contents/Resources"

# Prefer Xcode SDK (CLT-only often mismatches Swift version on macOS 27 betas).
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
if [[ ! -d "$DEVELOPER_DIR" ]]; then
  unset DEVELOPER_DIR
fi
SWIFTC="$(xcrun --find swiftc)"
SDK="$(xcrun --sdk macosx --show-sdk-path)"

if [[ ! -f "$BRIDGE/start.sh" ]]; then
  echo "Missing $BRIDGE/start.sh" >&2
  exit 1
fi
if [[ ! -f "$SRC_ICON" ]]; then
  echo "Missing app icon: $SRC_ICON" >&2
  exit 1
fi

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$RES"

cp "$ROOT/Info.plist" "$APP/Contents/Info.plist"
printf '%s\n' "$BRIDGE" >"$RES/bridge_root.txt"

# Same AppIcon as iPad → .icns (Finder / Applications) + MenuIcon.png (menu bar).
ICONSET="$ROOT/.build-icon.iconset"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"
for spec in \
  "16 icon_16x16.png" \
  "32 icon_16x16@2x.png" \
  "32 icon_32x32.png" \
  "64 icon_32x32@2x.png" \
  "128 icon_128x128.png" \
  "256 icon_128x128@2x.png" \
  "256 icon_256x256.png" \
  "512 icon_256x256@2x.png" \
  "512 icon_512x512.png" \
  "1024 icon_512x512@2x.png"
do
  set -- $spec
  sips -z "$1" "$1" "$SRC_ICON" --out "$ICONSET/$2" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$RES/AppIcon.icns"
sips -z 64 64 "$SRC_ICON" --out "$RES/MenuIcon.png" >/dev/null
rm -rf "$ICONSET"
echo "Icon from: $SRC_ICON"

echo "Compiling Swift → $BIN"
echo "  swiftc: $SWIFTC"
echo "  sdk:    $SDK"
"$SWIFTC" -O -parse-as-library \
  -target arm64-apple-macos13.0 \
  -sdk "$SDK" \
  -framework SwiftUI -framework AppKit \
  "$ROOT/Sources/main.swift" \
  -o "$BIN"

chmod +x "$BIN"
codesign --force --deep --sign - --identifier com.example.LanguageCaption.Bridge "$APP" 2>/dev/null \
  || codesign --force --sign - "$BIN" 2>/dev/null \
  || true

echo "Built: $APP"
echo "  Bridge root: $BRIDGE"
echo ""
echo "Run:      open \"$APP\""
echo "Install:  INSTALL=1 ./build.sh"
echo "  → icon あ như iPad (Finder + menu bar). Thoát từ menu app."

if [[ "${INSTALL:-}" == "1" ]]; then
  # Quit running instance so Resources/icon refresh.
  pkill -x CaptionStudioBridge 2>/dev/null || true
  sleep 0.5
  rm -rf "/Applications/$APP_NAME.app"
  cp -R "$APP" "/Applications/$APP_NAME.app"
  echo "Installed → /Applications/$APP_NAME.app"
  echo "Open:     open \"/Applications/$APP_NAME.app\""
fi
