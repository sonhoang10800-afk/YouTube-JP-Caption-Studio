# TODOS

## 2026-11-09 — Language Caption rebrand (done on feature branch)

See `wiki/topics/language-caption-rebrand.md` and `plan/language-caption-rebrand-m1-2026-11-09.md`.
Owner follow-ups: rename GitHub repo → `language-caption`; set `EXTENSION_ID` after path change; archive remote branches `whisper_turbo_audio_evaluation` / `anime_auto_inject_script_panel`.

---

Durable backlog for this repo. Item format: `~/.agents/skills/gstack/review/TODOS-format.md`.
Last re-check: **2026-10-24** — Plan v3 (`plan/extension-ux-verify-bsk-2026-10-24.md`) vs
evidence after fix `b155a56` and reviews in `review/ux-verify-2026-10-24.md` /
`review/ux-verify-fix-2026-10-24.md`.
Post-fix matrix: **PASS WITH ISSUES** → F1/F2 **fixed & verified** in `d3b53f7` (2026-10-24);
xem `review/ux-verify-matrix-postfix-2026-10-24.md` + `review/ux-verify-matrix-fix-2026-10-24.md`.
C-7 UI row: **PASS WITH ISSUES** — Saved Items UI row renders `videoTitle`; real popup tab
blocked by bsk (2026-10-24, `review/ux-verify-c7-ui-2026-10-24.md`).
Star rehydration: **FIXED** in `6a70ea7` — matcher keeps ★ across cue re-keying; unit tests +
live persistence evidence (2026-10-24, `review/star-rehydration-2026-10-24.md`).
Post-fix MP4: **DONE** — 35 s H.264 clip of overlay + dict flow, criterion (e) satisfied
(2026-10-24, `review/ux-verify-mp4-2026-10-24.md`).
Reload helper: **HARDENED** in `812799f` — reload → verify popup (polling) → then refresh YouTube
tab; new page after reload gets 12 tokens (2026-10-24, `review/reload-helper-hardening-2026-10-24.md`).
Enhancement fallback: **reproduced & root-caused** — first video page after extension reload can
render plain cue (tok 0); second load restores tokens; fixed by reload helper `812799f`
(2026-10-24, `review/enhancement-fallback-repro-2026-10-24.md`).
Sidepanel: **PASS** — real Chrome side panel smoke via dev-only bridge + window-only capture
(360 px, tabs/click/close), 2026-10-24 `review/sidepanel-smoke-2026-10-24.md`.

---

## Plan re-check — Plan v3 "Verify extension UX/UI trong Chrome thật (bsk)"

**Nguồn:** plan approved `plan/extension-ux-verify-bsk-2026-10-24.md`; pre-fix review
**FAIL**; fix `b155a56`; post-fix review **PASS**; artifacts `6d25d8d`.

### Implementation tasks T1–T8

| ID | Plan task | Status | Evidence |
|----|-----------|--------|----------|
| T1 | Ghi plan + review report | **DONE** | `plan/extension-ux-verify-bsk-2026-10-24.md` tracked in `6d25d8d` |
| T2 | Preflight + session `--focus` + video + reload | **DONE** (caveat F3) | 5 reloads in-session; 4× `verify.ok:true`, 1 transient false; video `66E0wpL6O9Q` |
| T3 | Bridge pre-check 3 trạng thái | **DONE** | `.ux-audit/fix-diag-aftercap.json`: marker DIV/api7/cap36/capture7/handler, `pb:true` |
| T4 | 4 flow H/dict/star/off | **DONE** | `.ux-audit/final-flow{1..4}-*.json` + `review/ux-verify-fix-evidence-2026-10-24/` |
| T5 | Probe popup + sidepanel | **DONE** | popup render + C-7 UI row; **real sidepanel smoke PASS** (360 px, tabs/click/close; `review/sidepanel-smoke-2026-10-24.md`) |
| T6 | MP4 60 s | **DONE** | post-fix 35 s clip + frames: `review/ux-verify-mp4-2026-10-24/` (H.264 1280×690, 36 frames, 0 Unsafe) |
| T7 | UX matrix 3 viewport | **DONE** | matrix post-fix desktop/tablet/mobile + fix F1/F2 (`9c233fe`, `d3b53f7`); T7 gap đã đóng |
| T8 | Report + cleanup | **DONE** | `review/ux-verify-fix-2026-10-24.md`; session `fitc` stopped (`sessions: []`), bridge stopped, Chrome tabs verified |

### Success criteria (a)–(h)

| # | Criterion | Status | Ghi chú |
|---|-----------|--------|---------|
| a | reload ok + refreshed đúng video | **PASS** (caveat) | 1 lần `verify.ok:false` rồi 4 lần OK — theo dõi ở F3 |
| b | pre-check `BRIDGE_OK` đủ trường | **PASS** | `n:50, s:ok, pb:true, ap:4` sau fix |
| c | 4 flow + screenshot/số đo | **PASS** | H-on 12 token, dict 453×569, star `☆→★`, H-off hidden |
| d | 0 lỗi mới `Unsafe attempt to load URL` | **PASS** | 0; 2 `Extension context invalidated` là stale pre-reload |
| e | 1 MP4 quay đúng tab | **PASS** | 35 s H.264 1280×690 post-fix clip (dict + H on/off), `review/ux-verify-mp4-2026-10-24/` |
| f | popup + sidepanel có bằng chứng, không claim | **PASS** (caveat dev build) | popup render + C-7 UI; real sidepanel smoke 360 px/tabs/click/close via dev bridge + window capture |
| g | report header + "Not tested" | **PASS** (format note) | nội dung đủ; cả 2 review dùng `**Backend:**` thay vì đúng dòng uppercase `BACKEND:` — TODO P4 |
| h | cleanup | **PASS** | emulate off, không borrow, session stop, `session list` sạch |

### Giả định §0 của plan sau khi chạy

| # | Giả định | Kết quả thực tế |
|---|----------|-----------------|
| 1 | Reload tự động thay click | Đúng — tool + helper dùng được; 4/5 lần verify OK, 1 transient (F3) |
| 2 | Cần `--focus` + check `document.hidden` | Đúng — `hidden:false` suốt các flow |
| 3 | `chrome-extension://`: `tab create`/borrow đáng thử | Đúng một nửa — `tab create` mở được popup; mọi DOM tool vẫn bị bsk chặn (`restricted_tab_url`) |
| 4 | Bỏ bump version, dùng marker `SCRIPT→DIV` | Đúng — marker DIV/api7 xác nhận build mới |
| 5 | `extension_ux_probe.js`/`browser_probe.js` không dùng | Đúng — chỉ dùng `ux-probe.js` qua bsk |
| 6 | Phải navigate tới video cụ thể | Đúng — dùng `66E0wpL6O9Q` |
| 7 | Tên file theo run-date | Đúng — toàn bộ 2026-10-24 |

### Ghi chú re-check

- Plan §8 ghi fix sản phẩm **ngoài scope**; việc fix `b155a56` được thực hiện ở lượt sau
  theo yêu cầu "Tiếp tục phần còn lại", không phải plan tự mở scope.
- GSTACK report trong plan (CLEAR, 7 corrections) vẫn đúng tại thời điểm file; các gap dưới
  đây là finding **sau** execution, không phải review sai.
- Hai review dùng nhãn `**Backend:**` thay vì dòng chuẩn `BACKEND:` (AGENTS browser rule §7);
  nội dung đúng, lệch format — TODO P4 bên dưới, không sửa raw review đã filed.

---

## Extension UX verify (2026-10-24) — remaining work

### 6. CI browser+extension regression for the MAIN-world bridge

**What:** Thêm gate CI chạy extension trong Chrome for Testing/Chromium với profile tạm,
mở fixture page, assert (1) `__HARDSubOCRCapture.apiVer`, (2) reply PING có `cap` bằng
marker `data-cap`, (3) cue load dùng được fallback ANDROID (mock không được).
**Why:** Cap-race + timeout-750ms đều lọt qua unit tests và CI hiện tại; chỉ browser thật
mới bắt được. Đây là gap đã ghi trong cả 2 review, không được giả vờ cover.
**Context:** AGENTS cho phép Playwright/Chrome for Testing cho **isolated CI checks** (không
dùng cho UX verdict). Cần fixture timedtext hoặc video/URL ổn định; branded Chrome không
load unpacked qua CLI nên phải dùng Chrome for Testing/Chromium + `--load-extension`.
**Effort:** L
**Priority:** P3
**Depends on:** Fixture/timedtext testdata ổn định

---

## Housekeeping

### 8. Review + commit docs reload automation (wrapper đã commit)

**What:** `AGENTS.md` §9, `README.md`, `extension/Scripts/reload-extension.md` (modified) là thay
đổi có sẵn từ trước phiên audit; cần review rồi commit thành một thay đổi riêng.
**Why:** Docs mô tả reload automation; wrapper đã được track nhưng docs sửa đổi vẫn untracked,
clone khác đọc docs sẽ thấy mô tả lệch.
**Context:** Wrapper `scripts/reload-extension.sh` đã commit trong `812799f` (hardened order).
`git status` còn `M AGENTS.md`, `M README.md`, `M extension/Scripts/reload-extension.md` — nội
dung có sẵn trước phiên audit, cần chủ repo review trước khi commit. Lưu ý: AGENTS §10 mô tả
dev-only sidepanel bridge trong khi `sp_test_bridge.js`/smoke script vẫn **untracked**; nên commit
docs cùng bridge (dev-only) hoặc gỡ bridge trước rồi commit docs — quyết định của chủ repo.
**Effort:** S
**Priority:** P3
**Depends on:** Review nội dung docs (không phải của lượt fix)

### 10. Remove dev sidepanel test bridge before release

**What:** Remove or extract `extension/content/sp_test_bridge.js`,
`extension/sidepanel/sp_test_bridge.js`, the manifest content-script entry, the
`sidepanel.html` script tag, and the `#sp-test-open` injection before packaging a release.
**Why:** It is a dev-only test hook. It is gated by an unpacked build, `?sp_test=1`, and a token,
but it must not ship in the extension.
**Context:** Smoke evidence: `scripts/bsk_sidepanel_bridge_smoke.js` (one bsk session, real
sidepanel snapshot/click/close). Keep the smoke script for local verification only.
**Status:** Sidepanel bridge smoke **PASS** 2026-10-24 (`review/sidepanel-smoke-2026-10-24.md`);
removal is now only a release-packaging task.
**Effort:** S
**Priority:** P1
**Depends on:** Sidepanel bridge tests complete (done 2026-10-24); release packaging checklist.

---

## Completed

### Raw `.ux-audit` excluded locally

**Completed:** 2026-10-24 (local only, not committed)

Added `/.ux-audit/` to `.git/info/exclude` so raw UX artifacts stop appearing as untracked noise;
`git status` is clean of them. A tracked `.gitignore` entry is left to the repo owner (ux-verify
rule: ask before editing `.gitignore`), but the local exclude solves the commit-risk now.

### Real Chrome side panel smoke (dev bridge + window capture)

**Completed:** 2026-10-24 (`review/sidepanel-smoke-2026-10-24.md`)

Script-owned bsk session `vxvw`: real side panel opened (360 px, URL/title correct; tabs
subtitles/words/saved), Words→Saved clicks switched views, close worked and post-close ping
failed (`no_response`); window-only `screencapture` shim captured the Chrome window (whole screen
never recorded) showing the panel with JA/VI cue rows. Evidence bundle local
`.test-evidence/20261024-073911-sidepanel-smoke` (PASS, 18 artifacts). Dev bridge removal stays
TODO #10.

### Reload helper — verify before refreshing tabs

**Completed:** 812799f (2026-10-24; `review/reload-helper-hardening-2026-10-24.md`)

Wrapper `scripts/reload-extension.sh` v2: reload → poll popup verify → then refresh the YouTube
tab (helper's early refresh bypassed). Verified 3 runs `ok:true`/verify ok, no tab litter; new
video page after reload gets 12 tokens/furigana (fixes the enhancement plain-cue scenario).
Evidence bundle local `.test-evidence/20261024-063617-reload-helper-hardening` (PASS, 36
artifacts).

### Desktop plain cue after extension reload — reproduced & root-caused

**Completed:** 2026-10-24 (`review/enhancement-fallback-repro-2026-10-24.md`)

Reproduced: first video page loaded right after `reload-extension.sh` renders the overlay without
tokens (`tok:0`) while the bridge is healthy; reloading the same tab restores 12 tokens. A
content-side enrichment retry (3×1.5 s) did not recover the page and was reverted (clean diff,
tests pass). Root cause inferred: helper refreshes/loads tabs while the reloaded extension is
still starting; fix moved into TODO #3 (helper must wait for popup verify, then refresh tabs).
Evidence bundle local `.test-evidence/20261024-061405-enhancement-repro` (PASS, 39 artifacts).

### Post-fix overlay flow MP4 (criterion e)

**Completed:** 2026-10-24 (`review/ux-verify-mp4-2026-10-24.md`)

35 s H.264 1280×690 MP4 (36 frames, `duration_limit`, 2,345,695 bytes, SHA-256
`b4c7065b…81994a`) recorded from the real video tab: H ON → token dict popup → Escape → H OFF
→ H ON; 0 Unsafe console entries; frame at 3 s shows the dict over the rendered overlay.
Committed clip: `review/ux-verify-mp4-2026-10-24/overlay-flow-fixed.mp4`; evidence bundle local
(`.test-evidence/20261024-054743-overlay-mp4-fixed`, PASS, 36 artifacts).

### C-7 saved-cue UI row (videoTitle)

**Completed:** 2026-10-24 (`review/ux-verify-c7-ui-2026-10-24.md`)

Saved Items UI ("Câu đã lưu") renders 2 real cues; first row `00:19 – 00:22` + real
`videoTitle` `【最新気象】あすは寒気流入により…` + source text; title 12px/576×18, no overflow.
Evidence bundle (local, not committed) `PASS WITH ISSUES`, 45 artifacts. Real extension popup
tab could not be switched (bsk blocks `chrome-extension://` DOM/input; System Events no
assistive access) — documented as LIM-1; popup render screenshot kept.

### Star rehydration across cue re-keying

**Completed:** 6a70ea7 (2026-10-24; `review/star-rehydration-2026-10-24.md`)

`savedCueMatches`/`findSavedCueForCue` fallback (videoId + start ±0.3 s + normalized source)
keeps `★` when segmentation re-keys a cue; `toggleStarCue` deletes the matched row instead of
duplicating. Unit tests pass; live bsk check: pre-existing ★ persists through reload with
12 tokens, 0 CSP errors. Evidence bundle `.test-evidence/20261024-052233-star-rehydrate`
(PASS, local).

### Responsive overlay + coarse ctrl targets (matrix F1/F2)

**Completed:** d3b53f7 (2026-10-24)

`--bar-fit-scale` (rect.width/520) + `clampBarIntoVideo()` keeps the bar ≤92% video height and
inside the player; `@media (pointer: coarse)` grows `.lr-ap-toggle`/`.lr-move-btn` to 44×44.
Live post-fix: mobile bar bottom 418→281 (video 285), font 27.2→20.4 px, ctrl 44×44; tablet
unchanged (fit 1); desktop unchanged; 0 CSP. Tests: content_test + anti-fake + syntax + diff
check pass. Report: `review/ux-verify-matrix-fix-2026-10-24.md`.

### Post-fix 3-viewport UX matrix

**Completed:** 2026-10-24 (matrix + evidence; `review/ux-verify-matrix-postfix-2026-10-24.md`)

Matrix desktop/tablet/mobile trên `b155a56` trong một bsk session (`yrzh`, một tab `1847742549`),
bridge chạy; overlay render 12 token/furigana ở cả 3 viewport, probe `value.ok:true`, 0 lỗi CSP.
Verdict **PASS WITH ISSUES**; F1/F2 đã fix ở `d3b53f7` (review fix riêng); F3 m.youtube.com là
limitation; F4/F5/F6/F7 là info.

### bsk one-session protocol applied

**Completed:** 2026-10-24

Matrix chạy đúng AGENTS browser rule §8: 1 session `yrzh`, 1 tab `1847742549`, không tạo/đóng
tab giữa 3 viewport, không reload extension (build đã `b155a56`), stop 1 lần sau khi đo.

### Chuẩn hoá nhãn `BACKEND:` trong report UX

**Completed:** 2026-10-24 (matrix report dùng đúng dòng uppercase)

`review/ux-verify-matrix-postfix-2026-10-24.md` mở đầu bằng
`BACKEND: bsk | instance: 35138c57 (Youtube-Agent) | Chrome 155.0.0.0 | PLAYWRIGHT: no`.

### Plan v3 filed + eng review CLEAR

**Completed:** 6d25d8d (2026-10-24)

Plan viết lại (7 corrections), review `plan-eng-review` CLEAR (0 unresolved, 0 critical gap),
filed + committed; wiki chưa ingest ở bước này.

### Pre-fix execution + FAIL review + evidence

**Completed:** 6d25d8d (2026-10-24)

Thực thi P0–P9 trong Chrome thật: bridge OK, reload OK, nhưng overlay không render cue
(`n:0`, `PING:timeout`, `replyCapLen:0`); 3-viewport matrix pre-fix, popup/sidepanel render,
MP4 repro 20 s, cleanup. Report: `review/ux-verify-2026-10-24.md`.

### Caption-pipeline + touch-target fix

**Completed:** b155a56 (2026-10-24)

`currentCap()` tại thời điểm gửi (page_capture), multi-lang 15 s + late await + SW cap 12 s
(content), 44 px coarse-pointer targets (panel.css); 15/15 extension suites + anti-fake +
popup asset gate pass.
**Follow-up:** F5 hoàn tất ở `d3b53f7` — AP toggle/move button 44×44 trên coarse pointer.

### Post-fix PASS verify + evidence

**Completed:** 6d25d8d (2026-10-24)

4/4 flow (H-on 12 token/furigana, dict `時 [とき] Thời N5`, star `☆→★`, H-off), C-7 saved cue
có `videoTitle` (data layer), mobile 44×44, 0 CSP errors. Report:
`review/ux-verify-fix-2026-10-24.md` + evidence dir.

### Wiki ingest of plan/reviews

**Completed:** 6d25d8d (2026-10-24)

Topic `wiki/topics/extension-ux-verify-2026-10-24.md`, index catalogs, log entries; wiki lint
0 broken links.

### bsk/bridge cleanup

**Completed:** 2026-10-24

Session `fitc` stopped (`sessions: []`), bridge started for token/dict verification then
stopped, Chrome user windows/tabs verified unchanged (2 windows).
