# Extension UX verify + caption-pipeline fix (2026-10-24)

## Status

Plan v3 executed end-to-end in the user's real Chrome via bsk (instance `35138c57`,
Youtube-Agent, Chrome 155). Pre-fix run: **FAIL** (overlay never rendered cues despite a
healthy MAIN-world/CSP bridge). Fix commit **`b155a56`** then re-verified: **PASS** for the
overlay + dict + star + C-7 data-layer + mobile touch targets.

## Raw artifacts

- Plan: [plan/extension-ux-verify-bsk-2026-10-24.md](../../plan/extension-ux-verify-bsk-2026-10-24.md)
- Pre-fix review (FAIL): [review/ux-verify-2026-10-24.md](../../review/ux-verify-2026-10-24.md)
- Evidence pre-fix: [review/ux-verify-evidence-2026-10-24/](../../review/ux-verify-evidence-2026-10-24/)
- Post-fix review (PASS): [review/ux-verify-fix-2026-10-24.md](../../review/ux-verify-fix-2026-10-24.md)
- Evidence post-fix: [review/ux-verify-fix-evidence-2026-10-24/](../../review/ux-verify-fix-evidence-2026-10-24/)
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
