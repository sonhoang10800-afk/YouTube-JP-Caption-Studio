#!/usr/bin/env node
"use strict";

const { execSync } = require("child_process");

function runAppleScript(script) {
  const escaped = script.replace(/'/g, "'\\''");
  return execSync(`osascript -e '${escaped}'`, { encoding: "utf8" }).trim();
}

console.log("==> Testing Gemini Translation on AnimeVietSub tab...");

const script = `tell application "Google Chrome"
  set found to ""
  repeat with w in windows
    repeat with t in tabs of w
      if (URL of t) contains "animevietsub" then
        tell t to execute javascript "(() => {
          window.__avs_trans_smoke = null;
          const onMsg = (e) => {
            if (e.data && e.data.type === 'AVS_TRANSLATE_PONG') {
              window.__avs_trans_smoke = JSON.stringify(e.data);
              window.removeEventListener('message', onMsg);
            }
          };
          window.addEventListener('message', onMsg);
          window.postMessage({ type: 'AVS_TEST_TRANSLATE' }, '*');
          return 'TRANSLATE_SENT';
        })()"
        repeat 20 times
          delay 1
          set found to (execute t javascript "window.__avs_trans_smoke || ''")
          if found is not "" then exit repeat
        end repeat
        exit repeat
      end if
    end repeat
    if found is not "" then exit repeat
  end repeat
  return found
end tell`;

const result = runAppleScript(script);
console.log("Result:", result);
