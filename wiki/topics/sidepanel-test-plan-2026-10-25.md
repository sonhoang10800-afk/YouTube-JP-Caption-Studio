# Side-panel full test plan (2026-10-25)

## Status

**Plan EXECUTED 2026-10-25 — 64 PASS / 4 FAIL / 9 NOT TESTED (77 items).** Consolidated report:
[review/sidepanel-test-run-2026-10-25.md](../../review/sidepanel-test-run-2026-10-25.md). The plan
was run by 3 teammates in parallel (`sp-ui-modes`, `sp-layout-visual`, `sp-cue-save`) plus the Lead
filling the gaps (`sp-cue-save` failed before writing its report; its raw evidence survived and was
reused, and the Lead ran groups J and the audio/diff run itself).

**Four real defects found:**

1. **`⋯` data menu overflows above the viewport top by 26 px** (P2) — first item "Nhập bản dịch
   (Import)" is clipped and unclickable (`rect.y = −26`, height 400, viewport 756×413).
2. **Escape does not close the `⋯` menu** (P2) — found independently by two teams with matching
   measurements (`details.open` stays `true`, popover still rendered, focus stays on `SUMMARY`).
   Same component as #1, and it holds two destructive actions.
3. **Saved cues are not mirrored to the local bridge when starred** (P2) — starring writes
   `chrome.storage.local.savedCues` but `GET /extension_state` still showed `savedCues: 0` with a
   4232.8 s-old timestamp; toggling an unrelated setting pushed them (13.8 s). Code:
   `service_worker.js:714-718` has no `changes.savedCues` branch. **No data loss** (extension
   storage is the source of truth and survived a reload) but the port-3000 web app sees stale data.
4. **Very long video builds the whole DOM** (P2/P3) — 2844 cues → 112,711 nodes, `scrollHeight`
   354,617 px; frame p50 8.4 ms, **p95 25.5 ms**, max 130.5 ms, one 51 ms long task.

Minor: toggle buttons only 18–21 px tall (below WCAG 2.5.8's 24 px); "Mở trang web" opens the
extension popup rather than the port-3000 web app; `TEST_PLAN_MATRIX.md` Flow 4 documents a
`POST /saved/sync` path the extension never calls (real path is `POST /extension_state`).

**Notable closures of older gaps:** the popup "Câu đã lưu" tab **was** measured this time (2 cues with
the real `videoTitle`) — `review/ux-verify-c7-ui-2026-10-24.md` had recorded it as blocked; and the
**audio/ASR diff run was measured for the first time** (candidates 19→29→43→52, green `ins` / red
strikethrough `del`, accept applies the heard text, revert keeps the original, undo restores it
exactly) after the headless teammates were refused `tabCapture`.

**Still unverified (9):** real Chrome side-panel surface and its true minimum width; overlay-on-video
and PiP; 30 real Tab presses (361 focusable elements were walked instead); `jlpt-unknown` colour (no
such element in the data); browser restart; two-way `/saved/sync` (no such call exists); Gemini
429/quota and silent-slice; Drive + account switch; port-3000 web app; and ASR **content** accuracy
(needs a human listener).

The plan itself (`plan/sidepanel-test-plan-2026-10-25.md`) was written from the user's own answers to
8 scoping questions; the user chose **"test everything; split across runs if time is short"**, staged
as **4 runs**. It superseded the coverage limits of the earlier smoke
(`review/sidepanel-smoke-2026-10-24.md`: panel open 360 px, tab clicks, close only).

## Scope locked by the user

| Axis | Chosen |
|------|--------|
| Panels | All six: 3 tabs; caption-mode row (Original/Enhanced/Audio); JA/VI/EN/Furi toggles; per-cue actions (replay, listen, star, edit, add); footer (reload, overlay, PiP, follow, more-menu); import/export/backup/restore/clear data |
| Videos | Short <100 cues; long >500 cues fast speech; audio-only (no captions); audio ≠ captions + noisy multi-speaker overlap |
| Usage | Drag panel very narrow; largest and smallest font; fast tab switching + fast scroll + continuous seeking |
| Failures | New video still showing old captions or reload not recovering; ASR candidate totally different vs identical to source |
| Evidence | Screenshots per key step, screen recording, hand-check **plus** automated real on-screen measurement |
| Save/restore | Star toggle + persistence across restart; offline save then re-sync (no loss/no dupes); import/export/backup/restore/clear-translations/wipe; Drive mirror + account switch + token revoke |
| Colours/popover | JLPT level colour correctness + dict on click; long-sentence popover scroll + mouse-bridge retention |
| Priority | Everything; split into multiple runs if needed |

## Staging

- **Run 1 — panel & cue rows:** groups A (3 tabs), B (caption mode), C (ja/vi/en/furi toggles),
  D (per-cue actions + diff accept/revert), G (state memory + video switch). Video: 55-cue
  `66E0wpL6O9Q`, panel 360 px.
- **Run 2 — save, import/export, network:** groups F, J, G, K; offline, video switch, restart.
- **Run 3 — visual/UX:** groups H (280/360/520 px, overflow measured, keyboard walk), I (level
  colours, long-sentence popover, 180 ms hover bridge), E (footer buttons incl. follow-scroll).
- **Run 4 — audio & diff:** groups B, D, K on noisy multi-speaker video; ASR candidate different
  from / identical to source; accept then revert.

## Constraints and risks carried in the plan

- **bsk cannot probe the side panel** (`chrome-extension://` is `restricted_tab_url`); panel
  interactions must go through the dev-only bridge (`extension/content/sp_test_bridge.js` +
  `extension/sidepanel/sp_test_bridge.js`), and visuals are external `screencapture` only — never
  claim a bsk panel screenshot. Bridge removal remains a pre-release cleanup item.
- No second browser, no Chrome for Testing, no Playwright: measurement happens in the user's
  already-signed-in Chrome profile.
- Anti-fake rule applies: results must come from runtime measurement/screenshots, never from
  reading source strings.
- Long (>500 cue) and noisy video IDs are **not yet chosen**; run 1 must fix them and publish the
  IDs in its report so later runs reuse the same videos.
- Drive mirror and offline tests need one user-approved consent click; the agent will not click an
  account consent on the user's behalf.
- Working tree is dirty (`extension/sidepanel/sidepanel.html` modified; both dev bridges and the
  smoke script untracked), so run reports must record the exact on-disk state to avoid mixing
  results with an older build.

## Raw artifacts

- Plan: [plan/sidepanel-test-plan-2026-10-25.md](../../plan/sidepanel-test-plan-2026-10-25.md)
- **Consolidated run report:** [review/sidepanel-test-run-2026-10-25.md](../../review/sidepanel-test-run-2026-10-25.md)
- Per-run reports: [A/B/C/E](../../review/sidepanel-runs-2026-10-25/run-a-b-c-e.md) ·
  [H/I](../../review/sidepanel-runs-2026-10-25/run-h-i.md) ·
  [D/F/J](../../review/sidepanel-runs-2026-10-25/run-d-f-j.md) ·
  [G/K](../../review/sidepanel-runs-2026-10-25/run-g-k.md)
- Raw measurements, screenshots, real backup/export files:
  [review/sidepanel-runs-2026-10-25/evidence/](../../review/sidepanel-runs-2026-10-25/evidence/)
- Shared measurement harness (surface, tool quirks, report template): `.tmp-sp/HARNESS.md`
- Prior plan (methodology, env traps): [plan/extension-ux-verify-bsk-2026-10-24.md](../../plan/extension-ux-verify-bsk-2026-10-24.md)
- Prior smoke (limits this plan closes): [review/sidepanel-smoke-2026-10-24.md](../../review/sidepanel-smoke-2026-10-24.md)
- Manual TC baseline to fold in: [docs/test-cases/TC_EXTENSION_SIDEPANEL_UI.md](../../docs/test-cases/TC_EXTENSION_SIDEPANEL_UI.md) (TC-UI-001…011)
- Module map: [TEST_PLAN_MATRIX.md](../../TEST_PLAN_MATRIX.md) (MOD-07, MOD-11, MOD-12)
- Smoke script: [scripts/bsk_sidepanel_bridge_smoke.js](../../scripts/bsk_sidepanel_bridge_smoke.js)

## Open gaps

**Resolved by this run:**

- ~~No runs executed yet~~ → executed; 64 PASS / 4 FAIL / 9 NOT TESTED, see Status above.
- ~~Mode-colour claims are file-level only~~ → **measured**: Enhanced `rgb(16,185,129)`, Original
  `rgb(30,30,45)`, audio `rgb(2,132,199)`, toggles purple `rgb(123,92,255)`. All match the contract.
- ~~Toggle colour differs from mode colour~~ → confirmed by measurement; the two are distinct and the
  run did not confuse them.
- ~~`TC_UI-010` click-to-dict popover inside the panel~~ → **confirmed stale**: `#sp-dict` is hidden
  0×0 in the panel; clicking a token paints the dict on the **video page** instead
  (`#hardsub-ocr-dict` 380×322, showing `明日 [あした] Minh Nhật N5`). The behaviour is fine; the TC
  describes the wrong surface.
- ~~`TC_UI-009` narrow-panel objective~~ → layout does hold at 280 px (0 overflow, 0 overlapping, 0
  clipped buttons), but on a **tab** surface.

**Still open:**

- **True Chrome side-panel minimum width remains unmeasured.** Three documents still disagree
  (`TEST_PLAN_MATRIX.md:116` <320 px; `TC-UI-009` 280 px; real 2026-10-24 smoke 360 px). This run
  proved the layout survives 280 px **when forced**, which is not the same as Chrome allowing it.
  Needs the real side panel, not a tab.
- **Real side-panel surface generally**: everything here was measured on `sidepanel.html` opened as a
  tab, because the DSH browser's subagent gate spawns headless Chrome without `--load-extension`.
- **Four defects are unfixed** (menu overflow, Escape, saved-cue bridge mirror, long-video DOM) — the
  run was read-only; no product code was changed. Suggested fixes are listed in §7 of the report.
- **`TEST_PLAN_MATRIX.md` Flow 4 is wrong** about `POST /saved/sync`; either the doc or the missing
  sync path must change.
- **`F-3` unresolved**: VI/EN toggle state appeared to drift mid-session once; not reproduced.
- **ASR content accuracy** needs a human listener; only the UI lifecycle was verified.
