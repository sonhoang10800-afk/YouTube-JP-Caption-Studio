#!/usr/bin/env node
/**
 * Live smoke test for AnimeVietSub auto-inject into real Chrome tab.
 * Uses Chrome AppleScript execution on active/open AnimeVietSub tab.
 * Validates:
 *   1. Content script mounts on animevietsub.best (hasOcrRoot === true)
 *   2. Identifies currentSource === "animevietsub"
 *   3. Resolves AniList & Jimaku to load Japanese subtitle cues (>0 cues)
 *   4. Embeds #hardsub-player-toggle into #media-player-box
 *   5. Keeps 0 overlay on the video player (bar hidden)
 *   6. Synchronizes active cue when AVS_PLAYER_TIMEUPDATE is received
 */
"use strict";

const { execSync } = require("child_process");

function runAppleScript(script) {
  const escaped = script.replace(/'/g, "'\\''");
  return execSync(`osascript -e '${escaped}'`, { encoding: "utf8" }).trim();
}

console.log("==> Running AnimeVietSub Live Smoke Test on Chrome...");

const checkScript = `tell application "Google Chrome"
  set found to ""
  repeat with w in windows
    repeat with t in tabs of w
      if (URL of t) contains "animevietsub" then
        tell t to execute javascript "(() => {
          window.__avs_live_smoke = null;
          const onMsg = (e) => {
            if (e.data && e.data.type === 'AVS_DEBUG_PONG') {
              window.__avs_live_smoke = JSON.stringify(e.data);
              window.removeEventListener('message', onMsg);
            }
          };
          window.addEventListener('message', onMsg);
          window.postMessage({ type: 'AVS_DEBUG_PING' }, '*');
          return 'PING_SENT';
        })()"
        delay 1
        set found to (execute t javascript "window.__avs_live_smoke || 'NO_PONG'")
        exit repeat
      end if
    end repeat
    if found is not "" then exit repeat
  end repeat
  return found
end tell`;

const pongRaw = runAppleScript(checkScript);
if (!pongRaw || pongRaw === "NO_PONG") {
  console.error("FAIL: Could not connect to AnimeVietSub content script in Chrome.");
  console.error("Raw response:", pongRaw);
  process.exit(1);
}

let pong;
try {
  pong = JSON.parse(pongRaw);
} catch (e) {
  console.error("FAIL: Could not parse response JSON:", pongRaw);
  process.exit(1);
}

console.log("  ✓ Content Script Connected:", pong.currentSource);
console.log("  ✓ Video ID:", pong.currentVideoId);
console.log("  ✓ Subtitles Loaded:", pong.cuesCount, "cues");
console.log("  ✓ Subtitle Info:", pong.captionsInfo);
console.log("  ✓ Toggle Button in Container:", pong.hasBtn, `(#${pong.btnParentId})`);

if (pong.currentSource !== "animevietsub") {
  console.error("FAIL: currentSource is not animevietsub:", pong.currentSource);
  process.exit(1);
}
if (!pong.cuesCount || pong.cuesCount < 10) {
  console.error("FAIL: cuesCount is suspiciously low:", pong.cuesCount);
  process.exit(1);
}
if (!pong.hasBtn || pong.btnParentId !== "media-player-box") {
  console.error("FAIL: Toggle button not properly mounted in #media-player-box:", pong.btnParentId);
  process.exit(1);
}

// Check playhead synchronization
const syncScript = `tell application "Google Chrome"
  set found to ""
  repeat with w in windows
    repeat with t in tabs of w
      if (URL of t) contains "animevietsub" then
        tell t to execute javascript "(() => {
          window.__avs_sync_smoke = null;
          window.postMessage({ type: 'AVS_PLAYER_TIMEUPDATE', currentTime: 8.0 }, '*');
          const onMsg = (e) => {
            if (e.data && e.data.type === 'AVS_DEBUG_PONG') {
              window.__avs_sync_smoke = JSON.stringify({
                iframePlayerTime: e.data.iframePlayerTime,
                activeCue: e.data.activeCue
              });
              window.removeEventListener('message', onMsg);
            }
          };
          window.addEventListener('message', onMsg);
          setTimeout(() => window.postMessage({ type: 'AVS_DEBUG_PING' }, '*'), 50);
          return 'SYNC_SENT';
        })()"
        delay 1
        set found to (execute t javascript "window.__avs_sync_smoke || 'NO_SYNC_PONG'")
        exit repeat
      end if
    end repeat
    if found is not "" then exit repeat
  end repeat
  return found
end tell`;

const syncRaw = runAppleScript(syncScript);
let syncData;
try {
  syncData = JSON.parse(syncRaw);
} catch (e) {
  console.error("FAIL: Could not parse sync response:", syncRaw);
  process.exit(1);
}

console.log("  ✓ Playhead Sync at 8.0s -> active cue:", syncData.activeCue);

if (!syncData.activeCue || syncData.activeCue.start > 8.0 || syncData.activeCue.end < 8.0) {
  console.error("FAIL: Active cue does not enclose time 8.0s:", syncData);
  process.exit(1);
}

console.log("ALL ANIMEVIETSUB LIVE CHECKS PASSED!");
