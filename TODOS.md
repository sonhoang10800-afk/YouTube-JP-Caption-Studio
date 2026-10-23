# TODOS

Durable backlog for this repo. Item format: `~/.agents/skills/gstack/review/TODOS-format.md`.
Last re-check: **2026-10-24** — Plan v3 (`plan/extension-ux-verify-bsk-2026-10-24.md`) vs
evidence after fix `b155a56` and reviews in `review/ux-verify-2026-10-24.md` /
`review/ux-verify-fix-2026-10-24.md`.

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
| T5 | Probe popup + sidepanel | **PARTIAL** | popup post-fix có `popup-500px.jpg`; **sidepanel post-fix chưa chụp lại**; bsk chặn DOM trên `chrome-extension://` (F4) |
| T6 | MP4 60 s | **PARTIAL** | chỉ có clip repro **20 s** pre-fix `.ux-audit/20261024-ux-verify-ext/overlay-flow-repro.mp4`; chưa quay post-fix |
| T7 | UX matrix 3 viewport | **PARTIAL** | matrix 3 viewport pre-fix trên overlay hỏng (`matrix_*.json`); post-fix chỉ mobile F5 + desktop flow shots; **chưa matrix post-fix 3 viewport** |
| T8 | Report + cleanup | **DONE** | `review/ux-verify-fix-2026-10-24.md`; session `fitc` stopped (`sessions: []`), bridge stopped, Chrome tabs verified |

### Success criteria (a)–(h)

| # | Criterion | Status | Ghi chú |
|---|-----------|--------|---------|
| a | reload ok + refreshed đúng video | **PASS** (caveat) | 1 lần `verify.ok:false` rồi 4 lần OK — theo dõi ở F3 |
| b | pre-check `BRIDGE_OK` đủ trường | **PASS** | `n:50, s:ok, pb:true, ap:4` sau fix |
| c | 4 flow + screenshot/số đo | **PASS** | H-on 12 token, dict 453×569, star `☆→★`, H-off hidden |
| d | 0 lỗi mới `Unsafe attempt to load URL` | **PASS** | 0; 2 `Extension context invalidated` là stale pre-reload |
| e | 1 MP4 quay đúng tab | **PARTIAL** | chỉ clip repro 20 s pre-fix; không quay post-fix |
| f | popup + sidepanel có bằng chứng, không claim | **PARTIAL** | popup render OK; sidepanel post-fix chưa chụp; C-7 chứng minh ở data layer, chưa UI row |
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

### 1. Post-fix 3-viewport UX matrix with the overlay rendered

**What:** Chạy lại matrix desktop/tablet/mobile trên bản `b155a56` (bar đã render), kèm
`ux-probe.js`, console/network, keyboard walk, screenshot từng viewport.
**Why:** T7 hiện chỉ có matrix pre-fix trên overlay hỏng; chưa có bằng chứng post-fix cho
desktop/tablet, nên chưa thể kết luận UX responsive của overlay sau fix.
**Context:** Dùng `~/.agents/skills/ux-verify/SKILL.md`; **một bsk session duy nhất** (lead
owns, theo AGENTS browser rule §8 mới), `bsk emulate --device iphone-14` / `ipad-mini` /
desktop `1440x900 dpr2`; lưu vào `review/ux-verify-matrix-postfix-2026-10-24/`. Trước khi
đo: H on, seek tới cue có tiếng (22 s), bridge chạy nếu muốn furigana/token. Ghi rõ
`value.ok` của probe và Not tested.
**Effort:** M
**Priority:** P1
**Depends on:** None (bridge optional; nếu bridge off, ghi "plain-text fallback")

### 2. C-7 UI row in Saved Items (popup "Câu đã lưu" hoặc web app localhost)

**What:** Chụp/verify row đã lưu có `videoTitle` trong UI thật, không chỉ data layer.
**Why:** criterion (f) và C-7 hiện chỉ được chứng minh bằng `extension_state.json`; chưa có
bằng chứng UI hiển thị đúng cột Video/tiêu đề.
**Context:** bsk chặn DOM trên tab `chrome-extension://`, nên không click được tab
"Câu đã lưu" trong popup. Hai đường hợp lệ: (a) chạy `local-bridge/start.sh` (kèm Saved
Items tại `http://127.0.0.1:3000`) rồi mở web app bằng bsk — đây là UI đầy đủ, không phải
extension page bị chặn; (b) chụp cửa sổ Chrome thật bằng `screencapture` sau khi user mở
popup và tab Saved. Ghi rõ cách nào đã dùng.
**Effort:** M
**Priority:** P2
**Depends on:** Local bridge + Saved Items (npm) hoặc human screenshot

### 3. Harden reload-extension verify (F3: transient false + stray tab)

**What:** Làm helper `reload-chrome-extension`/`scripts/reload-extension.sh` ổn định: chờ
popup title bằng polling thay vì `delay 1.0`, luôn đóng tab verify bằng URL, và trả
`verify.ok:false` không để lại tab rác.
**Why:** Lần reload đầu trong session trả `verify.ok:false` (title/url rỗng) và để lại 1 tab
popup trong cửa sổ user (đã đóng tay); 4 lần sau OK nên đây là race timing, không phải
extension hỏng.
**Context:** Helper thật ở `~/.local/bin/reload-chrome-extension` (tool dùng chung, ngoài
repo); repo wrapper `scripts/reload-extension.sh` hiện **untracked** (xem Housekeeping).
Verify bằng 5 reload liên tiếp: `verify.ok:true` cả 5, tab count trước/sau bằng nhau, không
tab `chrome-extension://` còn sót trong cửa sổ user.
**Effort:** S
**Priority:** P2
**Depends on:** Housekeeping (commit wrapper) + quyết định có sửa global helper hay không

### 4. Star rehydration across cue segmentation / load-path changes

**What:** Khi load path đổi (`ja intercept · 55 cues` ↔ `page_multi_android · 50 cues`), cue
id/group id đổi làm star hiện `☆` dù saved cue vẫn còn trong storage; match thêm theo
`sourceKey` + start time + source text.
**Why:** Người dùng thấy mất dấu ★ sau reload dù câu đã lưu; Saved Items vẫn có câu nhưng
bar không phản ánh.
**Context:** `isCueStarred()` dùng `cue.savedCueId` (`ss:` + groupIds) hoặc `cue.id`; cue id
sinh từ `c-<start>-<source>`. Khi nguồn cue khác (intercept vs ANDROID) thì id/group khác.
Đề xuất matcher thuần (sourceKey + round(start,3) + source text) để có unit test trong
`extension/content/content_test.js`; không hạ thấp assert hiện có.
**Effort:** M
**Priority:** P2
**Depends on:** None

### 5. Post-fix MP4 (criterion e)

**What:** Quay 15–20 s clip post-fix (H on → dict → star → H off) bằng `bsk video`, export
MP4, lưu vào evidence.
**Why:** criterion (e) hiện chỉ có clip repro lỗi; thiếu bằng chứng video cho trạng thái đã
fix (screenshot đã cover nhưng plan yêu cầu video).
**Context:** `bsk video start --session <id> --duration 40s`, replay flow, `video stop/save
--out review/ux-verify-fix-evidence-2026-10-24/overlay-flow-fixed.mp4`. Video capability
từng fail trên session cũ ("Video task session is no longer active") — dùng session mới.
**Effort:** S
**Priority:** P3
**Depends on:** None (session mới, cùng browser instance)

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

### 7. Run protocol cho các lần verify tiếp theo (bsk one-session rule)

**What:** Tuân thủ AGENTS browser rule §8 mới: một bsk session/task, Lead sở hữu, dùng cùng
`session_id` cho mọi viewport/check, không tạo/đóng tab giữa các check, stop đúng một lần.
**Why:** Các lượt trước dùng nhiều session/tab (session bị purge sau reload, tab popup/sidepanel
tạo thêm) — đúng cho điều tra nhưng không phải cách test UX chuẩn; rule mới yêu cầu tránh.
**Context:** Áp dụng cho TODO #1 và #2; extension reload chỉ một lần mỗi lần đổi code, rồi
test trong cùng session. Ghi rõ session id + một lần stop trong report.
**Effort:** S
**Priority:** P2
**Depends on:** None

---

## Housekeeping

### 8. Review + commit reload automation đang untracked

**What:** `AGENTS.md` §9, `README.md`, `extension/Scripts/reload-extension.md` (modified) và
`scripts/reload-extension.sh` (untracked) là thay đổi có sẵn từ trước phiên audit; cần review
rồi commit thành một thay đổi riêng (kèm test/lint).
**Why:** AGENTS §9 đã tham chiếu `./scripts/reload-extension.sh` nhưng file chưa được track;
clone khác sẽ thiếu script trong khi docs nói có.
**Context:** `git status` hiện: `M AGENTS.md`, `M README.md`, `M extension/Scripts/reload-extension.md`,
`?? scripts/reload-extension.sh`. Không thuộc commit `b155a56`/`6d25d8d`; cần chủ repo quyết
định nội dung trước khi commit.
**Effort:** S
**Priority:** P2
**Depends on:** Review nội dung docs (không phải của lượt fix)

### 9. `.ux-audit/` raw artifacts chưa được ignore

**What:** Thêm `.ux-audit/` vào `.gitignore` hoặc xoá raw artifacts sau khi đã chép bằng chứng
chốt sang `review/`.
**Why:** Hiện `.ux-audit/` là untracked noise (JSON/PNG/MP4), dễ bị commit nhầm.
**Context:** `.gitignore` đã có `.tmp-*/` nhưng không có `.ux-audit/`; ưu tiên ignore để giữ
raw cho debug. Hỏi user trước khi thêm (ux-verify skill rule).
**Effort:** S
**Priority:** P3
**Depends on:** None

### 10. Chuẩn hoá nhãn `BACKEND:` trong report UX

**What:** Các report UX sau dùng đúng dòng `BACKEND: bsk | instance: ... | PLAYWRIGHT: no`
(uppercase, không bold) thay vì `**Backend:**`.
**Why:** AGENTS browser rule §7 yêu cầu đúng nhãn; hiện 2 review đã file dùng `**Backend:**`
nội dung đúng nhưng format lệch.
**Context:** Không sửa raw review đã filed (immutable); chỉ áp dụng cho report mới (TODO #1/#2).
**Effort:** S
**Priority:** P4
**Depends on:** None

---

## Completed

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
