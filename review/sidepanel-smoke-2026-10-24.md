<!-- date: 2026-10-24 -->
<!-- source: goal:execute-todos · user: "Bắt đầu thực thi TO-dos." · TODO #2 sidepanel real-surface smoke -->

# Review — real Chrome side panel smoke (dev-only bridge + window capture)

BACKEND: bsk | instance: 35138c57 (Youtube-Agent) | Chrome 155.0.0.0 | PLAYWRIGHT: no

SURFACE: real Chrome side panel (external window capture)
SIDEPANEL: PASS
SIDEPANEL SOURCE: macos-screencapture
BSK PROBE: no

- **Evidence bundle (local, not committed):**
  `/Users/hoangson/Projects/YouTube JP Caption Studio/.test-evidence/20261024-073911-sidepanel-smoke`
  — `PASS`, 18 artifacts.
- **Script:** `scripts/bsk_sidepanel_bridge_smoke.js` (dev-only bridge; still untracked — see
  TODO #10).
- **Session:** script-owned bsk session `vxvw`, started/stopped by the script; no manual panel
  open needed (the injected test button's trusted click opened the real panel).

## What was verified

1. Real Chrome side panel opened on the YouTube watch page (`?sp_test=1`): title `YT Caption`,
   URL `chrome-extension://…/sidepanel/sidepanel.html`, visible, **width 360 px**, tabs
   `subtitles` (active), `words`, `saved`.
2. Whitelisted clicks through the dev bridge: `words` → `sp-view-words`, `saved` →
   `sp-view-saved`; `settings`/`follow` kept `sp-view-saved` as the script expects.
3. `close` → `{ok:true, closing:true}`; post-close ping → `{ok:false, error:"no_response"}`.
4. Visual: window-only `screencapture` of Chrome while the panel was open shows the panel with
   the Subtitles/Words/Saved tabs and JA/VI cue rows. A `screencapture` PATH shim replaced the
   smoke script's full-screen call so **the whole screen was never captured**.

## Findings

| ID | Severity | Finding | Evidence (bundle) |
| --- | --- | --- | --- |
| SIDEPANEL-1 | Info (PASS) | Real side panel opens and responds: 360 px wide, correct URL/title, expected tabs. | `sidepanel/screenshot-20261024-074532.png`, `sidepanel/bridge-20261024-074532.json` |
| SIDEPANEL-2 | Info (PASS) | Words/Saved tab clicks switch views; close works and post-close ping fails. | `commands/sidepanel-smoke.stdout` |
| SIDEPANEL-3 | Info | Window capture shows JA/VI cue rows, not just bridge JSON. | `sidepanel/screenshot-20261024-074532.png` |
| LIM-1 | Medium | Panel logic was driven through the **dev-only bridge**; bsk cannot probe the panel (no DOM measurements; visual estimate only). | `sidepanel/capture.json` |
| LIM-2 | Low | Dev build shows the injected `SP TEST OPEN` button and the browser info bar; not production UX. | `sidepanel/screenshot-20261024-074532.png` |

## Not tested

- Panel interactions beyond tab clicks (typing, cue seek, delete, settings).
- Contrast/tap-target measurements inside the panel; width matrix (320/380/520); production build.
- Sidepanel after removing the dev bridge.

## Notes

- This completes the side-panel evidence gap in T5/(f); the dev bridge remains a **release
  cleanup item** (TODO #10) and the smoke script stays local-only.
- No bsk screenshot/probe of the panel was claimed; the visual is external window capture.

## Attestation

- bsk `35138c57` (Youtube-Agent), Chrome `155.0.0.0`; no separate Chromium/Playwright.
- One script-owned bsk session (`vxvw`), stopped; no manual panel open required.
- Evidence bundle validated with `evidence.py check --finish --verdict PASS`.
- Chrome returned to a single user window after the smoke (no side-panel/test-tab litter left).
