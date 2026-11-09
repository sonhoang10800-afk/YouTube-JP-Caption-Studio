#!/usr/bin/env bash
# Reload the unpacked YouTube JP Caption Studio extension without clicking
# chrome://extensions.
#
# Uses the shared helper (~/.local/bin/reload-chrome-extension) for the actual
# chrome.runtime.reload(), but changes the ORDER: the helper used to refresh the
# YouTube tab *before* verifying the reloaded extension. Refreshing/opening a
# video tab while the extension is still starting leaves that first page without
# token enrichment (plain cue) until the tab is reloaded again; see
# review/enhancement-fallback-repro-2026-10-24.md.
#
# Flow: reload -> wait for the reload page to close -> verify the popup page
# (poll the title; the helper's 1s verify can race) -> only then refresh the
# first YouTube tab.
set -euo pipefail

# Unpacked ID is a path-hash of the Load unpacked folder. After a repo/folder
# rename, measure the new ID in chrome://extensions and export EXTENSION_ID.
# Default kept for the historical youtube-jp-caption-studio load path.
EXTENSION_ID="${EXTENSION_ID:-oiocgalcdfmkbcikemohekbjjmlbpoll}"
HELPER="${RELOAD_HELPER:-$HOME/.local/bin/reload-chrome-extension}"
REFRESH_PREFIX="${RELOAD_REFRESH_PREFIX:-https://www.youtube.com/}"
VERIFY_URL="chrome-extension://${EXTENSION_ID}/popup/index.html"
JSON=0
DRY_RUN=0
HELPER_ARGS=()

usage() {
  cat <<EOF
Usage: $0 [--json] [--dry-run] [--wait <seconds>] [--refresh-url-prefix <prefix>]

Reloads the unpacked extension via its own reload page, verifies the popup page,
then refreshes the first tab whose URL starts with <prefix>.

  --json                       Print machine-readable JSON
  --dry-run                    Print the plan; do not touch Chrome
  --wait <seconds>             Max wait for the reload page (helper default 2)
  --refresh-url-prefix <p>     Tab prefix to refresh after verification
                               (default: https://www.youtube.com/)

Environment: EXTENSION_ID, RELOAD_HELPER, RELOAD_REFRESH_PREFIX
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) JSON=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --wait) HELPER_ARGS+=(--wait "${2:-}"); shift 2 ;;
    --refresh-url-prefix) REFRESH_PREFIX="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ ! -x "$HELPER" ]]; then
  echo "reload helper not found: $HELPER" >&2
  echo "Install ~/.local/bin/reload-chrome-extension first (see ~/.agents/skills/automate-first/SKILL.md)." >&2
  exit 2
fi

if (( DRY_RUN )); then
  if (( JSON )); then
    printf '{"ok":true,"dry_run":true,"extension_id":"%s","verify_url":"%s","refresh_prefix":"%s","helper":"%s","order":"reload->verify->refresh"}\n' \
      "$EXTENSION_ID" "$VERIFY_URL" "$REFRESH_PREFIX" "$HELPER"
  else
    echo "dry-run: $HELPER $EXTENSION_ID --verify-url $VERIFY_URL"
    echo "dry-run: then verify $VERIFY_URL, then refresh first tab starting with $REFRESH_PREFIX"
  fi
  exit 0
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
HELPER_JSON="$TMP_DIR/helper.json"
HELPER_ERR="$TMP_DIR/helper.err"

set +e
"$HELPER" "$EXTENSION_ID" --verify-url "$VERIFY_URL" --json ${HELPER_ARGS[@]+"${HELPER_ARGS[@]}"} \
  >"$HELPER_JSON" 2>"$HELPER_ERR"
HELPER_EXIT=$?
set -e

RELOAD_VERDICT=""
HELPER_VERIFY_OK=0
if [[ -s "$HELPER_JSON" ]]; then
  read -r RELOAD_VERDICT HELPER_VERIFY_OK < <(
    python3 - "$HELPER_JSON" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    print("error 0")
    raise SystemExit(0)
reload = data.get("reload_page") or {}
verify = data.get("verify") or {}
print(str(reload.get("verdict") or ""), 1 if verify.get("ok") else 0)
PY
  )
fi

# The helper's popup verify waits only 1.0s; poll for the title ourselves so a
# transient empty title does not abort a reload that actually happened.
VERIFY_TITLE=""
if [[ "$HELPER_VERIFY_OK" != "1" ]]; then
  VERIFY_TITLE="$(osascript - "$VERIFY_URL" <<'APPLESCRIPT' 2>/dev/null || true
on run argv
  set verifyURL to item 1 of argv
  tell application "Google Chrome"
    if (count of windows) is 0 then return ""
    set win to front window
    set prevIndex to active tab index of win
    make new tab at end of tabs of win with properties {URL:verifyURL}
    set verifyIndex to (count of tabs of win)
    try
      set active tab index of win to verifyIndex
    end try
    set titleSeen to ""
    set elapsed to 0
    repeat while elapsed < 60
      try
        set t to title of tab verifyIndex of win
        if t is not "" then set titleSeen to t
      end try
      if titleSeen is not "" then exit repeat
      delay 0.1
      set elapsed to elapsed + 1
    end repeat
    try
      close tab verifyIndex of win
    end try
    set c to count of tabs of win
    if prevIndex > c then set prevIndex to c
    if prevIndex > 0 then
      try
        set active tab index of win to prevIndex
      end try
    end if
    return titleSeen
  end tell
end run
APPLESCRIPT
)"
  [[ -n "$VERIFY_TITLE" ]] && HELPER_VERIFY_OK=1
fi

if [[ "$HELPER_VERIFY_OK" != "1" ]]; then
  if (( JSON )); then
    if [[ -s "$HELPER_JSON" ]]; then
      python3 - "$HELPER_JSON" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
data["ok"] = False
data["error"] = data.get("error") or "verify_failed"
data["wrapper"] = {"order": "reload->verify->refresh"}
print(json.dumps(data, ensure_ascii=False))
PY
    else
      printf '{"ok":false,"error":"verify_failed","extension_id":"%s","reload_page":{"verdict":"%s"},"wrapper":{"order":"reload->verify->refresh"}}\n' \
        "$EXTENSION_ID" "$RELOAD_VERDICT"
    fi
  else
    echo "reload-extension: reload page verdict=${RELOAD_VERDICT:-unknown}; popup verify failed." >&2
    [[ -s "$HELPER_ERR" ]] && cat "$HELPER_ERR" >&2
    echo "The extension may still be loaded; check chrome-extension://${EXTENSION_ID}/popup/index.html once." >&2
  fi
  exit 3
fi

# Extension is ready: now (and only now) refresh the first matching tab.
REFRESHED_URL="$(osascript - "$REFRESH_PREFIX" <<'APPLESCRIPT' 2>/dev/null || true
on run argv
  set prefix to item 1 of argv
  tell application "Google Chrome"
    if (count of windows) is 0 then return ""
    set win to front window
    repeat with t in tabs of win
      set u to ""
      try
        set u to URL of t
      end try
      if u starts with prefix then
        reload t
        return u
      end if
    end repeat
    return ""
  end tell
end run
APPLESCRIPT
)"

if (( JSON )); then
  python3 - "$HELPER_JSON" "$REFRESHED_URL" "$VERIFY_TITLE" <<'PY'
import json, sys
data = {}
if sys.argv[1]:
    try:
        data = json.load(open(sys.argv[1], encoding="utf-8"))
    except Exception:
        data = {}
verify = data.get("verify") or {}
data["ok"] = True
data["error"] = None
data["refreshed"] = sys.argv[2] or ""
data["verify"] = {
    "ok": True,
    "url": verify.get("url") or "",
    "title": verify.get("title") or sys.argv[3] or "",
}
data["wrapper"] = {"order": "reload->verify->refresh"}
print(json.dumps(data, ensure_ascii=False))
PY
else
  echo "RELOADED $EXTENSION_ID"
  echo "  reload page: ${RELOAD_VERDICT:-closed_after_reload}"
  echo "  verify: ${VERIFY_TITLE:-ok} ($VERIFY_URL)"
  echo "  refreshed: ${REFRESHED_URL:-<no matching tab>}"
fi
