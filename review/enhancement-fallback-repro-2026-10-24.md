<!-- date: 2026-10-24 -->
<!-- source: goal:execute-todos · user: "Bắt đầu thực thi TO-dos." · TODO #1 desktop plain-cue fallback -->

# Review — desktop plain cue after extension reload (repro + root cause)

BACKEND: bsk | instance: 35138c57 (Youtube-Agent) | Chrome 155.0.0.0 | PLAYWRIGHT: no

- **Symptom:** the F1/F2 fix run rendered a desktop cue with no tokens/furigana (`tok:0`,
  `ruby:0`) although the bridge was healthy; mobile/tablet in the same run had 12 tokens.
- **Reproduced:** yes, deterministically for the first video page loaded right after
  `./scripts/reload-extension.sh`; the same tab reloaded a second time gets 12 tokens.
- **Evidence bundle (local, not committed):**
  `/Users/hoangson/Projects/YouTube JP Caption Studio/.test-evidence/20261024-061405-enhancement-repro`
  — `PASS`, 39 artifacts.
- **No product code shipped:** a content-side enrichment retry was implemented and tested, did
  **not** recover the first page, and was reverted (working tree clean for `content.js`; tests
  re-run pass).

## Repro

1. Baseline: video `66E0wpL6O9Q`, 22 s, H ON → `tok:12`, furigana present
   (`screenshots/h-on-12s.png`).
2. `./scripts/reload-extension.sh` (reload page `closed_after_reload`; popup verify transient
   `ok:false` — F3). Start a fresh session and open the video.
3. H ON → overlay shows `時の総点です。大陸しっかり出てきます。` with `tok:0`, `ruby:0`
   (`screenshots/h-on-after-reload.png`), still plain at 15 s.
4. `bsk reload` the same tab → H ON → `tok:12` again (`logs/measure-reload2.json`).
5. Content retry experiment (3 × 1.5 s on enrichment failure) + extension reload → first page
   still `tok:0` (`screenshots/postfix-first-page.png`); reverted.

## Root cause (inferred, not instrument-proven)

The first page after an extension reload is loaded/refreshed while the reloaded extension is
still starting, so its content-script world is a half-initialized/stale context: the caption
cues render (content script ran) but token enrichment silently fails, and the page never
re-enriches because the bridge is already flagged ready. A second page load gets a clean
injection and works. bsk cannot read extension-internal/service-worker logs, so the exact race is
not instrumented — but the page-level behavior and the “second load fixes it” pattern are
reproduced.

## Recommendation (tracked in TODO #3, reload helper)

- The reload helper must **not refresh/load video tabs until the extension is ready**: wait for
  the reload page to close **and** the popup verify to succeed, then refresh the YouTube tab(s).
- A content-script retry cannot fix an invalidated/half-initialized extension context; a page
  reload after the extension is ready is the reliable recovery.
- If helper hardening is not done, document “reload extension → refresh the YouTube tab once”
  as the user workaround.

## Not tested

- Extension service-worker console and content-script injection ordering (bsk limitation).
- Same scenario on mobile/tablet viewports.
- A shipped fix: deferred to the reload-helper task; no product diff was kept.

## Attestation

- bsk `35138c57` (Youtube-Agent), Chrome `155.0.0.0`; no separate Chromium/Playwright.
- Sessions `btda`/`gfjy`/`jncf` used (session died after each extension reload); bundle bound to
  `jncf`; sessions stopped; bridge stopped after the run.
- Evidence bundle validated with `evidence.py check --finish --verdict PASS`.
