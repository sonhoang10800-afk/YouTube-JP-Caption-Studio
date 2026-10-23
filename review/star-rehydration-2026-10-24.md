<!-- date: 2026-10-24 -->
<!-- source: goal:execute-todos · user: "Bắt đầu thực thi TO-dos." · TODO #4 star rehydration -->

# Review — star rehydration across cue re-keying

BACKEND: bsk | instance: 35138c57 (Youtube-Agent) | Chrome 155.0.0.0 | PLAYWRIGHT: no

- **Problem:** `isCueStarred()` only checked `savedCues[cue.savedCueId || cue.id]`. When the
  same sentence is projected from a different load path (intercept vs ANDROID), cue ids/group
  ids change and the bar showed `☆` although the saved cue still existed.
- **Code:** commit **`6a70ea7`** — `extension/content/content.js`,
  `extension/content/content_test.js`.
- **Evidence bundle (local, not committed):**
  `/Users/hoangson/Projects/YouTube JP Caption Studio/.test-evidence/20261024-052233-star-rehydrate`
  — `PASS`, 39 artifacts.

## Change

- `savedCueMatches(cue, saved, videoId)` — same video (when both known), start within ±0.3 s,
  normalized `source` text equal.
- `findSavedCueForCue(cue)` — scans `savedCues` for a match.
- `isCueStarred()` — direct saved id still wins; otherwise fall back to the matcher.
- `toggleStarCue()` — if the current cue has no saved row under its id but matches one under
  another id, delete that matched row instead of creating a duplicate.
- Test seam exports the three helpers plus a `setSavedCuesForTest` hook (test-only).

## Verification

- `node extension/content/content_test.js` → `content_test: all assertions passed`
  (new asserts: same video/start/source matches; wrong video, start, source do not; whitespace
  normalization; direct-id precedence; `findSavedCueForCue` returns `old-id`).
- `node scripts/verify_no_fake_tests.js` → `Anti-Fake-Test Gate: PASSED`.
- Live Chrome (real bsk, Chrome 155): video `66E0wpL6O9Q`, pause 22 s, H ON; the cue was
  already starred (`★`, title "Bỏ lưu câu này") with 12 tokens/furigana; page reloaded; H ON
  again; `★` still active with the same source `時ときの総点そうてんです。大陸しっかり出でてきます。`.
  0 `Unsafe attempt to load URL` in 79 console entries.
- Extension reloaded once with `./scripts/reload-extension.sh` (`reload_page.verdict:
  closed_after_reload`; first run `verify_failed` popup transient — F3 TODO).

## Findings

| ID | Severity | Finding | Evidence (bundle) |
| --- | --- | --- | --- |
| STAR-1 | Info (PASS) | Star persists `★` through reload with the matcher build; source and 12 tokens unchanged. | `screenshots/star-after-reload.png`, `star_after_reload.json` |
| STAR-2 | Info (unit) | Matcher proves re-keyed cues inherit the saved star; wrong video, start, source do not; direct id wins. | `commands/star-unit-tests.stdout` |
| LIM-1 | Low (limitation) | The live page kept its cue id, so the fallback branch is proven by unit tests only, not forced live. | `screenshots/star-after-reload.png` |
| LIM-2 | Low (limitation) | Non-destructive run: the pre-existing star was not toggled off/on to avoid touching the user's saved cue. | `screenshots/star-initial.png` |
| LIM-3 | Low (limitation) | `reload-extension.sh` first reported `verify_failed` while the reload page closed after reload; a later run returned `ok:true` (F3). | `commands/reload-extension.stdout` |

## Not tested

- Forced live segmentation switch.
- Star save/un-save toggling in this run.
- Mobile/coarse-pointer star tap target (desktop star 19×19; separate touch-target task).
- Dark mode, keyboard-only star toggle, screen reader.

## Attestation

- bsk `35138c57` (Youtube-Agent), Chrome `155.0.0.0`; no separate Chromium/Playwright.
- One session per live attempt; session `ppox` died after the extension reload, replacement
  `dfjc` bound to the bundle; no tab churn inside a live session.
- Evidence bundle validated with `evidence.py check --finish --verdict PASS`.
- Cleanup: session list empty, bridge stopped, static/dev servers closed; a leftover Agent
  Window with only the language-learning forum tab (opened by a stray popup keyboard action)
  was closed so only the user's window remains.
