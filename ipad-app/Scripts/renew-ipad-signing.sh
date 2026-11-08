#!/usr/bin/env bash
# Renew free Apple Development signing for YouTube JP Caption Studio on a paired iPad.
# Overwrites the same Bundle ID install — never deletes the app (sandbox data stays).
# For code updates use deploy-ipad.sh instead.
#
# UDID:
#   xcrun xctrace list devices
#   (or: Xcode → Window → Devices and Simulators)
#
# Env (required for renew; skip-check works without device):
#   DEVICE_UDID=xxxxxxxx-…          # iPad UDID
#   TEAM=XXXXXXXXXX                 # Apple Development Team ID (or DEVELOPMENT_TEAM)
# Optional:
#   APP_PATH=/path/to/LanguageCaption.app
#   PROJECT / SCHEME / BUNDLE_ID
#
# LaunchAgent (copy plist → ~/Library/LaunchAgents/, then):
#   launchctl load ~/Library/LaunchAgents/com.languagecaption.renew.plist
#   launchctl start com.languagecaption.renew
#
# Paid Developer Program skips the ~7-day free cycle; this script is for free/renew flow.

set -euo pipefail

LOG="${HOME}/Library/Logs/LanguageCaption-renew.log"
BUNDLE_ID="${BUNDLE_ID:-com.example.LanguageCaption}"
SCHEME="${SCHEME:-LanguageCaption}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROJECT="${PROJECT:-${ROOT}/LanguageCaption.xcodeproj}"
TEAM="${TEAM:-${DEVELOPMENT_TEAM:-}}"
DEVICE_UDID="${DEVICE_UDID:-}"
THRESHOLD_SECS=$((48 * 3600))

mkdir -p "$(dirname "$LOG")"
ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { printf '%s %s\n' "$(ts)" "$*" | tee -a "$LOG" >&2; }

# Decode ExpirationDate (seconds since epoch) from a .mobileprovision; empty if unreadable.
prov_exp() {
  local f="$1" xml exp
  [[ -f "$f" ]] || return 0
  xml="$(security cms -D -i "$f" 2>/dev/null)" || return 0
  exp="$(printf '%s' "$xml" | plutil -extract ExpirationDate raw - 2>/dev/null)" || return 0
  # plutil: "YYYY-MM-DD HH:MM:SS +0000" or ISO8601
  date -j -f '%Y-%m-%d %H:%M:%S %z' "$exp" '+%s' 2>/dev/null \
    || date -j -f '%Y-%m-%dT%H:%M:%SZ' "$exp" '+%s' 2>/dev/null \
    || date -j -f '%Y-%m-%dT%H:%M:%S%z' "$exp" '+%s' 2>/dev/null \
    || true
}

find_app() {
  if [[ -n "${APP_PATH:-}" && -d "$APP_PATH" ]]; then
    printf '%s\n' "$APP_PATH"
    return
  fi
  local cand
  for cand in \
    "${ROOT}/build/Build/Products/Debug-iphoneos/${SCHEME}.app" \
    "${ROOT}/build/${SCHEME}.app"
  do
    [[ -d "$cand" ]] && { printf '%s\n' "$cand"; return; }
  done
  # Hottest DerivedData Debug-iphoneos build
  cand="$(find "${HOME}/Library/Developer/Xcode/DerivedData" -path "*${SCHEME}-*/Build/Products/Debug-iphoneos/${SCHEME}.app" -type d 2>/dev/null \
    | head -1 || true)"
  [[ -n "$cand" ]] && printf '%s\n' "$cand"
}

# Latest ExpirationDate among embedded + cached profiles for this bundle (0 if none).
latest_exp() {
  local best=0 e f app bundle_token
  app="$(find_app || true)"
  if [[ -n "$app" && -f "${app}/embedded.mobileprovision" ]]; then
    e="$(prov_exp "${app}/embedded.mobileprovision")"
    [[ -n "$e" && "$e" -gt "$best" ]] && best="$e"
  fi
  bundle_token="${BUNDLE_ID}"
  while IFS= read -r -d '' f; do
    if security cms -D -i "$f" 2>/dev/null | grep -q "$bundle_token"; then
      e="$(prov_exp "$f")"
      [[ -n "$e" && "$e" -gt "$best" ]] && best="$e"
    fi
  done < <(find "${HOME}/Library/Developer/Xcode/UserData/Provisioning Profiles" \
    -name '*.mobileprovision' -print0 2>/dev/null || true)
  printf '%s\n' "$best"
}

install_app() {
  local app="$1"
  if [[ -z "$DEVICE_UDID" ]]; then
    log "fail: DEVICE_UDID unset (needed to install)"
    return 1
  fi
  if xcrun devicectl device install app --device "$DEVICE_UDID" "$app" >>"$LOG" 2>&1; then
    return 0
  fi
  log "devicectl failed; trying ios-deploy fallback"
  if command -v ios-deploy >/dev/null 2>&1; then
    ios-deploy --id "$DEVICE_UDID" --bundle "$app" --no-wifi >>"$LOG" 2>&1
    return
  fi
  log "fail: install (devicectl and ios-deploy unavailable)"
  return 1
}

# --- main ---
now="$(date '+%s')"
exp="$(latest_exp)"
if [[ "$exp" -gt 0 ]]; then
  left=$((exp - now))
  if [[ "$left" -gt "$THRESHOLD_SECS" ]]; then
    hours=$((left / 3600))
    log "skip: ${hours}h left on profile (threshold 48h)"
    exit 0
  fi
  log "renew: ${left}s left (≤48h) — incremental build + install"
else
  log "renew: no usable ExpirationDate — incremental build + install"
fi

# Drop cached profiles for this bundle so Xcode fetches a fresh one.
while IFS= read -r -d '' f; do
  if security cms -D -i "$f" 2>/dev/null | grep -q "$BUNDLE_ID"; then
    rm -f "$f"
  fi
done < <(find "${HOME}/Library/Developer/Xcode/UserData/Provisioning Profiles" \
  -name '*.mobileprovision' -print0 2>/dev/null || true)

if [[ -z "$DEVICE_UDID" ]]; then
  log "fail: set DEVICE_UDID"
  exit 1
fi

dest="id=${DEVICE_UDID}"

t0="$(date '+%s')"
# No -clean / no DerivedData wipe — hot incremental (often re-sign/link only).
xb=(xcodebuild
  -project "$PROJECT"
  -scheme "$SCHEME"
  -destination "$dest"
  -allowProvisioningUpdates)
[[ -n "$TEAM" ]] && xb+=(DEVELOPMENT_TEAM="$TEAM")
"${xb[@]}" build >>"$LOG" 2>&1
t1="$(date '+%s')"

app="$(find_app)"
if [[ -z "$app" || ! -d "$app" ]]; then
  log "fail: .app not found after build (${t1}s build window)"
  exit 1
fi

install_app "$app"
t2="$(date '+%s')"
log "ok: resign-ms=$(( (t1 - t0) * 1000 )) install-ms=$(( (t2 - t1) * 1000 )) app=${app}"
