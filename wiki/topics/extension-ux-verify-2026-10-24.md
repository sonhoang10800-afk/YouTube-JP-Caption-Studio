# Extension UX verify + caption-pipeline fix (2026-10-24)

## Status

Plan v3 executed end-to-end in the user's real Chrome via bsk (instance `35138c57`,
Youtube-Agent, Chrome 155). Pre-fix run: **FAIL** (overlay never rendered cues despite a
healthy MAIN-world/CSP bridge). Fix commit **`b155a56`** then re-verified: **PASS** for the
overlay + dict + star + C-7 data-layer + mobile touch targets.

Post-fix **3-viewport matrix (2026-10-24): PASS WITH ISSUES** — overlay renders at
desktop/tablet/mobile (12 tokens, furigana, probe `value.ok:true`, 0 CSP errors) but F1 mobile
bar overflows below the video and F2 right-side ctrl buttons are still <44 px on touch;
mobile-UA navigation redirects to `m.youtube.com` where the extension does not inject.

**F1/F2 fixed & verified (2026-10-24, `d3b53f7`):** bar now fits inside the player
(mobile 291×149, bottom 281 vs video bottom 285; font 20.4 px; fit 0.75) and AP/move buttons are
44×44 on coarse pointers; tablet/desktop unchanged (fit 1). Desktop run showed plain cue
(`tok:0`) while mobile/tablet had 12 tokens — tracked as TODO #1 (enhancement/SW fallback).

**C-7 UI row verified (2026-10-24): PASS WITH ISSUES** — Saved Items UI ("Câu đã lưu")
renders 2 real cues; first row `00:19 – 00:22` + real `videoTitle` `【最新気象】あすは寒気流入により…`
+ source text (title 12px, 576×18, no overflow). Real extension popup tab could not be switched:
bsk refuses `chrome-extension://` DOM/input and macOS System Events has no assistive access;
documented as LIM-1. Durable review: `review/ux-verify-c7-ui-2026-10-24.md`; evidence bundle is
local (`.test-evidence/…`, not committed).

**Star rehydration fixed (2026-10-24, `6a70ea7`):** `savedCueMatches`/`findSavedCueForCue`
fallback matches videoId + start (±0.3 s) + normalized source text so a re-keyed cue keeps its
`★`; `toggleStarCue` deletes the matched saved row instead of duplicating. Unit tests cover the
matcher; live bsk run keeps a pre-existing ★ through reload (12 tokens, 0 CSP errors). Durable
review: `review/star-rehydration-2026-10-24.md`.

**Post-fix MP4 (2026-10-24): DONE** — `review/ux-verify-mp4-2026-10-24/overlay-flow-fixed.mp4`:
35 s H.264 1280×690, 36 frames, 2,345,695 bytes (SHA-256 `b4c7065b…81994a`), recorded from the
real tab (H ON → token dict → Escape → H OFF → H ON); 0 Unsafe console entries; dict frame at
3 s. Completes criterion (e). Durable review: `review/ux-verify-mp4-2026-10-24.md`.

**Enhancement fallback reproduced & root-caused (2026-10-24):** first video page loaded right
after an extension reload can render a plain cue (`tok:0`) while the bridge is healthy; reloading
the same tab restores 12 tokens. Content-side enrichment retry was ineffective and reverted; the
fix belongs to reload-helper hardening (wait for popup verify before refreshing tabs). Durable
review: `review/enhancement-fallback-repro-2026-10-24.md`; evidence bundle local (PASS, 39
artifacts).

**Reload helper hardened (2026-10-24, `812799f`):** `scripts/reload-extension.sh` now does
reload → poll popup verify → only then refresh the YouTube tab (the shared helper's early refresh
bypassed; global helper unchanged). 3/3 runs ok/verify ok, no tab litter; a new video page loaded
after reload gets 12 tokens/furigana, removing the plain-cue scenario above. Durable review:
`review/reload-helper-hardening-2026-10-24.md`.

## Raw artifacts

- Plan: [plan/extension-ux-verify-bsk-2026-10-24.md](../../plan/extension-ux-verify-bsk-2026-10-24.md)
- Pre-fix review (FAIL): [review/ux-verify-2026-10-24.md](../../review/ux-verify-2026-10-24.md)
- Evidence pre-fix: [review/ux-verify-evidence-2026-10-24/](../../review/ux-verify-evidence-2026-10-24/)
- Post-fix review (PASS): [review/ux-verify-fix-2026-10-24.md](../../review/ux-verify-fix-2026-10-24.md)
- Evidence post-fix: [review/ux-verify-fix-evidence-2026-10-24/](../../review/ux-verify-fix-evidence-2026-10-24/)
- Matrix post-fix: [review/ux-verify-matrix-postfix-2026-10-24.md](../../review/ux-verify-matrix-postfix-2026-10-24.md)
- Evidence matrix: [review/ux-verify-matrix-postfix-evidence-2026-10-24/](../../review/ux-verify-matrix-postfix-evidence-2026-10-24/)
- Fix review F1/F2: [review/ux-verify-matrix-fix-2026-10-24.md](../../review/ux-verify-matrix-fix-2026-10-24.md)
- Evidence fix: [review/ux-verify-matrix-fix-evidence-2026-10-24/](../../review/ux-verify-matrix-fix-evidence-2026-10-24/)
- C-7 UI review: [review/ux-verify-c7-ui-2026-10-24.md](../../review/ux-verify-c7-ui-2026-10-24.md)
- Star rehydration review: [review/star-rehydration-2026-10-24.md](../../review/star-rehydration-2026-10-24.md)
- MP4 review: [review/ux-verify-mp4-2026-10-24.md](../../review/ux-verify-mp4-2026-10-24.md)
- Enhancement repro review: [review/enhancement-fallback-repro-2026-10-24.md](../../review/enhancement-fallback-repro-2026-10-24.md)
- Reload hardening review: [review/reload-helper-hardening-2026-10-24.md](../../review/reload-helper-hardening-2026-10-24.md)
- Code: commit `b155a56` — `extension/content/content.js`, `extension/injected/page_capture.js`, `extension/styles/panel.css`

## What shipped

- **Bridge cap race (root cause A):** `page_capture.js` cached the capability token once at
  startup; a reinject race left it empty, so the content script rejected every page-world
  reply (`replyCapLen:0` vs `markerCapLen:36`, `PING:timeout`, `pageBridgeReady:false`).
  Send sites now resolve `currentCap()` from the live marker at send time.
- **Slow ANDROID fallback discarded (root cause B):** WEB timedtext URLs return HTTP 200 with
  an empty body; the page-world ANDROID Innertube fallback returns cues in 2.7–10 s, but
  `content.js` allowed 750 ms and awaited the SW cascade without a timeout. Multi-lang now
  has a 15 s budget, late results are awaited, and SW awaits are capped at 12 s.
- **Touch targets:** nav buttons 38×38 → 44×44 and player toggle 79×32 → 79×44 on coarse
  pointers.

## Verified evidence

- Caption state: `cues=50`, `enhancedCues=38`, `status=ok`, `pageBridgeReady=true`,
  `applyLoadedCues` ran 4×.
- Overlay H-on: 12 tokens with furigana, bridge pill `Connected`; dict popup shows
  `時 [とき] Thời N5` + VI/EN senses; star toggles `☆→★`; H-off hides bar.
- C-7: saved cue in `data/config/extension_state.json` carries
  `videoId=66E0wpL6O9Q` and the real `videoTitle`.
- Mobile: nav 44×44, toggle 79×44; probe `tapTargets.below44` extension-related = 0.
- Matrix (one session `yrzh`, one tab): desktop 1440×900 bar 742×176 font 38.46; tablet 744×1133
  bar 555×145 font 28.78; mobile 390×844 bar 291×236 font 27.20; all inside viewport, 12 tokens,
  0 `Unsafe attempt to load URL`. F1: mobile bar bottom 418 vs video bottom 285. F2: `#lr-toggle-ap`
  38×40, `#lr-btn-move` 32×32 on coarse pointers (probe blind spot).
- Console: 0 `Unsafe attempt to load URL`; tests 15/15 extension suites + anti-fake + popup
  asset gate pass.

## Open gaps

- **F3 reload helper:** one transient `verify.ok:false` + stray popup tab early in the session;
  four later reloads verified `ok:true` with no litter. Helper is a global user tool; not changed.
- **Star rehydration vs segmentation:** one reload where the load path changed
  (`ja intercept · 55 cues` → `page_multi_android · 50 cues`) showed `☆` although the saved
  cue remained in storage. Match by `sourceKey` + start/source in a follow-up.
- **No CI browser+extension regression** for the MAIN-world bridge; branded Chrome cannot
  load unpacked from CLI. Live bsk verification is the acceptance proof.
- **Popup/sidepanel DOM** remains unreachable through bsk (`restricted_tab_url`); C-7 is proven
  at the data layer + popup render, not by clicking the "Câu đã lưu" tab.

## Anchors

- `extension/content/content.js`: multi-lang path + timeouts near `loadAllCaptions`
  (FETCH_MULTI_LANG_CAPTIONS call, late-await block, `swTimed`).
- `extension/injected/page_capture.js`: `currentCap()` + reply/message send sites.
- `extension/styles/panel.css`: `@media (pointer: coarse)` touch-target block.
