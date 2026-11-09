#!/usr/bin/env bash
# deploy-iphone.sh — PC/Mac code change → fresh binary on real iPhone ASAP.
# Incremental build + install overwrite (same Bundle ID). Never cleans DerivedData.
# Never deletes the app on device (preserves SwiftData sandbox).
#
# Signing-only refresh: renew-iphone-signing.sh. For code updates use this script.
#
# Wireless: pair once (USB or Xcode → Devices), then same Wi‑Fi + unlocked iPhone;
# destination id=$DEVICE_UDID still works over wireless debugging.
#
# UDID:
#   xcrun xctrace list devices
#   (or: Xcode → Window → Devices and Simulators → Identifier)
#   (or: xcrun devicectl list devices)
#
# Example alias:
#   alias iphone-deploy='DEVICE_UDID=YOUR-UDID-HERE ~/…/iphone-app/Scripts/deploy-iphone.sh'
#
# Env:
#   DEVICE_UDID     (required)
#   INSTALL_ONLY=1  skip xcodebuild; install last .app only
#   APP_PATH / PROJECT / SCHEME / BUNDLE_ID / CONFIGURATION / LOG
#   TEAM / DEVELOPMENT_TEAM unused here (signing via -allowProvisioningUpdates)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROJECT="${PROJECT:-${ROOT}/LanguageCaptioniPhone.xcodeproj}"
SCHEME="${SCHEME:-LanguageCaptioniPhone}"
BUNDLE_ID="${BUNDLE_ID:-com.example.LanguageCaption.iPhone}"
CONFIGURATION="${CONFIGURATION:-Debug}"
LOG="${LOG:-${HOME}/Library/Logs/LanguageCaption-iPhone-deploy.log}"
DEVICE_UDID="${DEVICE_UDID:-}"

mkdir -p "$(dirname "$LOG")"
ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { printf '%s %s\n' "$(ts)" "$*" | tee -a "$LOG"; }
die() { log "fail: $*"; exit 1; }

[[ -n "$DEVICE_UDID" ]] || die "set DEVICE_UDID (see script header)"

ms_now() { python3 -c 'import time; print(int(time.time()*1000))'; }

# Skip adhoc leftovers (e.g. ROOT/build/*.app) — device install needs Apple Development signature.
_app_device_signed() {
  local out
  out="$(codesign -dv "$1" 2>&1)" || return 1
  [[ "$out" != *"Signature=adhoc"* ]] || return 1
  [[ "$out" == *"TeamIdentifier="* && "$out" != *"TeamIdentifier=not set"* ]]
}

find_app() {
  if [[ -n "${APP_PATH:-}" && -d "$APP_PATH" ]]; then
    printf '%s\n' "$APP_PATH"
    return 0
  fi
  local cand
  for cand in \
    "${ROOT}/build/Build/Products/${CONFIGURATION}-iphoneos/${SCHEME}.app" \
    "${ROOT}/build/${SCHEME}.app"
  do
    [[ -d "$cand" ]] || continue
    _app_device_signed "$cand" || continue
    printf '%s\n' "$cand"
    return 0
  done
  cand="$(
    find "${HOME}/Library/Developer/Xcode/DerivedData" \
      -path "*${SCHEME}-*/Build/Products/${CONFIGURATION}-iphoneos/${SCHEME}.app" \
      -type d 2>/dev/null \
      | while IFS= read -r p; do
          printf '%s\t%s\n' "$(stat -f '%m' "$p" 2>/dev/null || echo 0)" "$p"
        done | sort -nr | head -1 | cut -f2-
  )"
  [[ -n "$cand" && -d "$cand" ]] || return 1
  _app_device_signed "$cand" || return 1
  printf '%s\n' "$cand"
}

BUILD_MS=0

if [[ "${INSTALL_ONLY:-0}" != "1" ]]; then
  log "build start scheme=${SCHEME} destination=id=${DEVICE_UDID} configuration=${CONFIGURATION}"
  t0="$(ms_now)"
  # No clean. No DerivedData wipe. Incremental only.
  xcodebuild \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -configuration "$CONFIGURATION" \
    -destination "id=${DEVICE_UDID}" \
    -allowProvisioningUpdates \
    build
  t1="$(ms_now)"
  BUILD_MS=$((t1 - t0))
  log "build done ${BUILD_MS}ms"
else
  log "INSTALL_ONLY=1 — skipping build"
fi

APP="$(find_app)" || die "could not find ${SCHEME}.app (build first, or set APP_PATH)"
case "$APP" in *iphonesimulator*) die "refusing simulator .app: $APP" ;; esac
log "app=${APP}"

t0="$(ms_now)"
xcrun devicectl device install app --device "$DEVICE_UDID" "$APP"
t1="$(ms_now)"
INSTALL_MS=$((t1 - t0))
log "install done ${INSTALL_MS}ms bundle=${BUNDLE_ID} (overwrite; app not deleted)"
log "timing build_ms=${BUILD_MS} install_ms=${INSTALL_MS}"
