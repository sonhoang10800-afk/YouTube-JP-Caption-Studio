# Plan v3: Verify extension UX/UI trong Chrome thật của bạn (bsk) — viết lại sau review

<!-- date: 2026-10-24 -->
<!-- source: chat · user: "Viết lại plan 'Plan v2: Verify extension UX/UI trong Chrome thật của bạn (bsk) — đã qua eng review', sau đó dùng skill để review lại cho chính xác." -->

Bản này thay **Plan v2** (v2 chỉ nằm trong chat, chưa từng ghi vào `plan/`). Viết lại vì 7 giả định của v2 đã sai hoặc lỗi thời. Mỗi điểm sửa có bằng chứng đo được trên disk hoặc CLI live — không phải ý kiến.

**Phạm vi lượt duyệt này:** chốt bản plan và ghi vào `plan/extension-ux-verify-bsk-2026-10-24.md`. Các phase browser bên dưới là nội dung để **thực thi ở lượt riêng** khi bạn nói "chạy plan"; lượt ghi file không mở Chrome và không sửa code sản phẩm.

## 1. V2 sai ở đâu — bằng chứng

| # | V2 nói | Thực tế đo được | V3 sửa |
|---|---|---|---|
| 1 | "Bạn phải Reload ở `chrome://extensions`; bsk chặn `chrome://` nên tôi không làm hộ được" | Native tool `reload_chrome_extension` có trong session này (dry-run trả `ok:true`, đúng reload URL + verify popup URL); `scripts/reload-extension.sh` và `~/.local/bin/reload-chrome-extension` tồn tại; AGENTS.md §9 bắt buộc automate, cấm đòi user click | Reload tự động. Chỉ khi helper trả `extension_not_loaded` (exit 3) mới cần **một** HUMAN STEP Load unpacked, rồi dừng |
| 2 | "Session mặc định là đủ để đo" | `bsk session start` mặc định `--no-focus` (Agent Window ra sau); `content.js:4935` bỏ update bar khi `document.hidden` → BRIDGE_OK nhưng bar trống, dễ báo sai | Bắt buộc `--focus` + assert `document.hidden === false` trước mọi flow |
| 3 | "`chrome-extension://` bị chặn cứng, không test được 2 bề mặt" | Chỉ `bsk navigate` bị Chrome từ chối qua CDP: `{"code":-32000,"message":"Not allowed"}`. Chưa ai thử `bsk tab create --url` hay AppleScript-open rồi `tab borrow`; helper reload đã mở được popup page và đọc title | Thêm probe 5 phút (thử `tab create` trước), fallback borrow rồi mới "not tested"; không tuyên bố bất khả thi |
| 4 | "Bump 0.11.4 + đọc `data-v` để biết build mới" | Version 0.11.3 nằm ở **3 chỗ**: `extension/manifest.json:4`, `TEST_PLAN_MATRIX.md:3`, `docs/test-cases/TC_EXTENSION_CORE_CAPTIONS.md:18`. Marker `data-v` được tạo **trước** `executeScript` (`content.js:196-235`), nên có marker không chứng minh inject chạy. Boot line đi bridge `/log` (`content.js:6131`), không ra console. Bằng chứng build đúng: marker đổi từ `<script>` sang `<div>` trong `e465a2d` | Bỏ bump (0 file sản phẩm bị sửa). Build proof = `marker.tagName === "DIV"` + bridge sống |
| 5 | "`scripts/extension_ux_probe.js` dùng lại được" | Header script ghi rõ stock Chrome bỏ qua `--load-extension`; script tự spawn Chrome riêng. `scripts/browser_probe.js` dùng Chrome for Testing qua `--remote-debugging-pipe` | Không dùng (vi phạm "không mở browser thứ hai"). Probe = `~/.agents/skills/ux-verify/scripts/ux-probe.js` chạy qua `bsk evaluate` |
| 6 | "Đang có tab WeatherNews để đo" | Live tab list (osascript, read-only): chỉ có `https://www.youtube.com/` (home) và `chrome://extensions/`; **không có watch tab** | Navigate Agent Window tới `watch?v=66E0wpL6O9Q` (55 cue; fallback `FfUjmyCeK7s`, 152 cue — đã verify trong `review/ux-test-2026-10-23.md` §4) |
| 7 | "File báo cáo `review/ux-verify-2026-10-23.md`" | Đã qua nửa đêm JST (2026-10-24 00:0x); AGENTS §1: sang ngày mới → file mới | Dùng `run-date` tại lúc chạy, không hardcode 2026-10-23 |

Ba điều v2 đúng, giữ nguyên: `bsk video` chạy được (đã thử 5s → `complete`); `bsk emulate` có `iphone-14`/`ipad-mini`; fix CSP `e465a2d` + `d91b50a` đã nằm trong HEAD.

## 2. Mục tiêu và tiêu chí xong

Chứng minh bằng số đo rằng bản fix MAIN-world/CSP chạy trong Chrome đã đăng nhập của bạn, rồi đo UX overlay + 2 bề mặt extension. Không Playwright, không browser thứ hai, không Chrome for Testing.

Xong khi:
- (a) reload JSON `ok:true`, `reload_page.verdict` ∈ {`loaded`, `closed_after_reload`}, `refreshed` trỏ đúng tab video; nếu `extension_not_loaded` → dừng, đúng 1 HUMAN STEP, không đo gì thêm.
- (b) pre-check trả đúng 1 trong 3 trạng thái `EXT_NOT_LOADED` / `INJECT_BROKEN` / `BRIDGE_OK`. `BRIDGE_OK` phải có đủ: `marker.tagName === "DIV"`, `marker.dataset.api === "7"`, `window.__HARDSubOCRCapture.apiVer === 7`, `typeof window.__hardsubPageMsgHandler === "function"`, `data-cap` dài 32–36 (UUID 36 trên Chrome 155, fallback hex 32).
- (c) 4 flow trong trang có screenshot + số đo thật: H bật (bar visible, ≥1 token JP), click token → dict visible + text, star → `★` + class `active`, H tắt (bar hidden).
- (d) 0 lỗi **mới** `Unsafe attempt to load URL` sau mốc console baseline.
- (e) 1 MP4 quay đúng tab, mở/kiểm size > 0.
- (f) popup + sidepanel: có screenshot + console qua probe; nếu probe fail → ghi `not tested via bsk` + verbatim error + đúng 1 HUMAN STEP gộp để bạn chụp, **không claim**.
- (g) report `review/ux-verify-<run-date>.md` mở đầu đúng dòng `BACKEND: bsk | instance: 35138c57 (Youtube-Agent) | Chrome 155.0.0.0 | PLAYWRIGHT: no`, có mục "Not tested".
- (h) cleanup: `bsk emulate --off`, trả tab borrow, đóng tab tự tạo, `bsk session stop`, `bsk session list` không còn session của mình.

## 3. Môi trường đo được (preflight facts)

- `bsk status --json`: daemon `0.3.3`, protocol `1.3`, pid `71867`, **0 session**, `unresponsive:false`.
- `bsk browsers --json`: instance `35138c57`, label `Youtube-Agent`, Chrome `155.0.0.0`, bsk extension `0.3.3`, `version_skew:false`.
- Chrome đang mở: `chrome://extensions/`, `https://www.youtube.com/` (home); không có watch tab, không có tab `chrome-extension://`.
- Extension id `oiocgalcdfmkbcikemohekbjjmlbpoll`; popup `popup/index.html`; sidepanel `sidepanel/sidepanel.html` (`side_panel.default_path` trong manifest).
- `reload_chrome_extension` dry-run: `ok:true`, reload URL + verify popup URL đúng.
- macOS TCC chặn đọc `~/Library/Application Support/Google/Chrome/**` (`Operation not permitted`) → không đọc được Preferences để biết extension enabled; chỉ tin verdict của helper.
- gstack `1.80.0` → `1.91.182.0` có bản mới; **không nâng** trong plan này.

## 4. State machine pre-check

```
reload helper
  exit 0, verdict loaded / closed_after_reload ──► tab video ──► pre-check
  exit 3, extension_not_loaded ──► HUMAN STEP: Load unpacked 1 lần ──► STOP
  exit 4, chrome_not_running ──► không tự mở profile khác ──► STOP + ask
  exit 5, applescript/automation ──► STOP + hướng dẫn Automation permission

pre-check (1 evaluate, MAIN world + DOM)
  hasRoot=false                               ──► EXT_NOT_LOADED ──► reload lại 1 lần, vẫn vậy thì STOP
  hasRoot=true, marker≠DIV | captureApiVer≠7 | hasHandler=false ──► INJECT_BROKEN ──► P8 (≤2 vòng)
  hasRoot=true, marker DIV, api=7, capture=7, handler=function  ──► BRIDGE_OK ──► P4
```

## 5. Phase thực thi

**P0 — Preflight (read-only).**
```sh
bsk status --json
bsk browsers --json        # phải thấy 35138c57 / Youtube-Agent / 155.0.0.0
git rev-parse --short HEAD # ce301df
```
Daemon lỗi → `bsk doctor`, `bsk update -y` một lần; vẫn không có browser → dừng, hỏi. Không fallback browser khác.

**P1 — Session + video (chỉ đụng Agent Window).**
```sh
bsk session start --json --browser 35138c57 --name ux-verify-ext --focus
bsk tab create --url "https://www.youtube.com/watch?v=66E0wpL6O9Q" --session <id> --json
bsk wait-for-navigation --wait-until load --timeout 30s --session <id>   # networkidle timeout -> load + wait-ms 500 (ghi fallback)
```
Giữ `session_id`, `tab_id`. Assert `document.hidden === false`; nếu true → `bsk tab select`/`bsk window` đưa lên trước, hoặc xin user giữ cửa sổ hiển thị (`page_hidden` là môi trường, không phải finding). Lấy baseline console: `bsk console --json --limit 1 --session <id>` → giữ `sequence`.

**P2 — Reload tự động.**
Gọi native tool `reload_chrome_extension(extension_id="oiocgalcdfmkbcikemohekbjjmlbpoll", refresh_url_prefix="https://www.youtube.com/", verify_url="chrome-extension://oiocgalcdfmkbcikemohekbjjmlbpoll/popup/index.html")`. Không có tool thì `./scripts/reload-extension.sh`.
Đọc JSON: `ok`, `reload_page.verdict`, `refreshed`, `verify.ok/title`, `previous_tab`, tab counts.
- `ok:true` + `refreshed` chứa `watch?v=66E0…` → P3.
- `extension_not_loaded` → HUMAN STEP một dòng (Load unpacked đúng thư mục `extension/`), STOP.
- `refreshed` rỗng (helper refresh nhầm cửa sổ) → `bsk reload --session <id>` tab video, ghi fallback.
- `verify.ok:false` → popup không load; ghi lại, vẫn đo overlay, đánh dấu popup not tested.
Chờ tối đa 8s (`waitForPageBridge(8000)` trong `content.js:246`) rồi P3.

**P3 — Bridge pre-check (1 evaluate).**
```js
(() => {
  const m = document.getElementById('hardsub-ocr-page-script');
  const c = window.__HARDSubOCRCapture;
  return { href: location.href, hidden: document.hidden,
    hasRoot: !!document.getElementById('hardsub-ocr-root'),
    marker: m ? { tag: m.tagName, api: m.dataset.api || null, v: m.dataset.v || null, capLen: (m.dataset.cap || '').length } : null,
    captureApiVer: c?.apiVer ?? null,
    hasHandler: typeof window.__hardsubPageMsgHandler === 'function' };
})()
```
Đọc `value` (object) từ `bsk evaluate --json`; phân loại theo §4. Marker có `tag:"SCRIPT"` = build cũ; `DIV` + không bridge = inject hỏng.

**P4 — 4 flow trong trang.**
- Focus body (`bsk focus --selector "body"`) rồi `bsk press h` → `applyBarVisibility`; chờ 300ms; evaluate bar `{hidden, rect:{w,h}, innerText.slice(0,200), tokCount}`; screenshot `shots/01-h-on.png`.
- Click token đầu tiên (`bsk click --selector "#hardsub-ocr-bar .tok"`); evaluate `#hardsub-ocr-dict` `{hidden, rect, text}`; screenshot.
- Click `.lr-star-btn`; evaluate class `active`, text `★`/`☆`, title; screenshot. (Chỉ claim persistence nếu popup probe thấy row.)
- `bsk press h` lần nữa; evaluate bar hidden; screenshot.
Mỗi bước: `bsk console --json --since <baseline>`; dedupe `(kind,text,url)`; lỗi mới ghi vào report.

**P5 — Probe 2 bề mặt (mới).** Thử theo thứ tự, từng bề mặt:
1. `bsk tab create --url "chrome-extension://<id>/popup/index.html" --session <id> --json` → nếu ok: `bsk emulate --width 400 --height 800 --session <id> --tab-id <new>`, chờ 1s, screenshot + evaluate `document.title` + body text + console. Đây là **render trong tab**, không phải popup chrome thật → ghi rõ.
2. Nếu `tab create` fail (ghi verbatim): mở bằng AppleScript trong cửa sổ user, `bsk tab list --scope user`, `bsk tab borrow <tab-id> --timeout 120s` (có thể cần 1 lần xác nhận borrow). Borrow xong screenshot/evaluate.
3. Cả hai fail/deny → `not tested via bsk` + **một** HUMAN STEP gộp (mở popup + sidepanel, chụp 2 ảnh). Không claim verdict.
Sidepanel: cùng quy trình với `sidepanel/sidepanel.html`. Popup check C-7: sau khi star ở P4, nếu popup render, assert có row chứa video title; nếu không thấy → not tested. Dọn tab đã tạo/borrow (`bsk tab return` rồi đóng).

**P6 — Video 60s.**
```sh
bsk video start --session <id> --tab-id <tab> --duration 90s --quality clear
# replay: H on -> click token -> star -> H off
bsk video stop --out .ux-audit/<ts>/overlay-flow.mp4 --overwrite
```
Budget 90s, stop ngay sau replay; kiểm file tồn tại + size > 0.

**P7 — UX matrix 3 viewport.** Mỗi viewport (`iphone-14`, `ipad-mini`, desktop 1440x900 dpr2 no-mobile no-touch): set emulate trước, chờ 500ms, **re-check bridge** (emulation có thể reload), screenshot viewport, check overflow `scrollWidth > clientWidth + 1` (overflow → bỏ full-page, ghi lý do), chạy `ux-probe.js` qua `bsk evaluate --json` (đọc `value.ok`, dùng `value.data`; `value.ok=false` → sửa state, chạy lại, không báo partial), `bsk console`/`bsk network --since`, keyboard walk ≤30 Tab (ghi `document.activeElement` + selector + focus visible), `bsk snapshot --json`. Không bịa loading/empty/error state.

**P8 — Nếu `INJECT_BROKEN` (tối đa 2 vòng).** Kiểm theo thứ tự: marker `SCRIPT` (build cũ) → reload lại; marker `DIV` nhưng thiếu capture/handler → đọc console/network lỗi `chrome-extension://` bị chặn, kiểm `document.hidden`, tab id; PING thủ công theo shape trong `page_capture.js`. Quá 2 vòng → dừng, báo hiện trạng + giả thuyết, **không sửa mù**.

**P9 — Report + cleanup.** Viết `review/ux-verify-<run-date>.md` theo template `ux-verify` (verdict, findings severity/confidence/probe key+value/screenshot, coverage, Not tested, limitations, attestation). Ảnh chốt ≤8 tấm copy sang `review/ux-verify-evidence-<run-date>/`; ảnh thô + MP4 ở `.ux-audit/<ts>/` (không commit; `.ux-audit/` chưa có trong .gitignore — nếu muốn ignore thì thêm 1 dòng sau khi hỏi). Cleanup: `bsk emulate --off`, trả tab borrow, đóng tab tạo, `bsk session stop <id>`, `bsk session list --json` sạch; không stop daemon/session khác.

## 6. Failure modes

| Mode | Signal | Xử lý | User thấy |
|---|---|---|---|
| Extension chưa load/disabled | reload exit 3 | 1 HUMAN STEP Load unpacked, stop | Chưa có overlay |
| Agent Window ra sau | `document.hidden:true`, bar trống | `--focus`, `tab select`; xin user giữ cửa sổ hiển thị | Không có overlay (môi trường) |
| YouTube không có JP caption / timedtext 401 | network fail, cues 0 | đổi video fallback; login wall → `bsk request-help` | Không có cue |
| Borrow bị deny/timeout | lỗi borrow | fallback human screenshot, mark not tested | Không |
| Full-page treo | timeout | viewport + `scroll-to` shots, ghi fallback | Không |
| Console baseline cũ | lỗi `Unsafe` cũ | `--since <baseline>`, re-baseline sau reload | Tránh false positive |
| Phím H bị nuốt | `activeElement` là input/button, bar không đổi | focus body, bấm lại 1 lần, ghi nhận | Không toggle |
| `value.ok=false` | probe không hợp lệ | sửa state, chạy lại; không báo partial | Tránh số liệu sai |
| Session mất giữa chừng | lỗi bsk | session mới của mình, resume viewport, giữ artifacts | Không |

Critical gaps: **0** — mỗi mode có đường xử lý hoặc dừng an toàn.

## 7. What already exists (reuse, không rebuild)

- Reload: native `reload_chrome_extension` + `scripts/reload-extension.sh` + `~/.local/bin/reload-chrome-extension` (script repo đang untracked, helper đã executable).
- Probe: `ux-verify/scripts/ux-probe.js`, `bsk` commands (`evaluate`, `screenshot`, `console`, `network`, `snapshot`, `video`, `emulate`).
- Evidence nền: `review/ux-test-2026-10-23.md` (root cause CSP + proof trên Chromium); link, không lặp.
- Fix đã có: `e465a2d`, `d91b50a`.
- Gates: `scripts/verify_all.sh` (extension suites, anti-fake, popup assets, sanity, wiki lint, browser self-test, bridge, swift, web).
- **Không dùng lại:** `scripts/extension_ux_probe.js`, `scripts/browser_probe.js` — cả hai tự spawn browser khác.

## 8. NOT in scope

- Bump version 0.11.4 (3 file, không thêm giá trị verify).
- Sửa code sản phẩm / thêm error UI khi inject fail (plan riêng).
- CI browser+extension harness (stock Chrome không load unpacked qua CLI; plan riêng).
- UX verdict đầy đủ cho popup/sidepanel nếu probe fail (fallback human screenshot).
- iOS/Android, bridge, `web/saved-items`.
- Nâng gstack 1.80 → 1.91.182.
- Wiki ingest (làm sau khi plan được file).
- Gọi model ngoài (codex/claude CLI) cho "outside voice".

## 9. Tests & gates

Không sửa code sản phẩm → không viết test mới. Chạy regression gates hiện có:
```sh
node extension/content/content_test.js
node extension/shared/timedtext_parse_test.js
node scripts/verify_no_fake_tests.js
node scripts/verify_extension_popup.js
bash scripts/run_sanity_suite.sh
# hoặc full: bash scripts/verify_all.sh (có browser self-test trên Chrome for Testing — isolated, không phải UX verdict)
```
Known test gap: **không có** automated browser+extension regression cho MAIN-world inject; CI không load được unpacked trong branded Chrome. Ghi nhận trung thực, không giả vờ cover. Anti-fake: mọi claim phải từ runtime measurement/screenshot, không dùng string-matching source.

## 10. Rollback / cleanup

- Không có thay đổi sản phẩm để revert.
- Reload reversible; artifacts xoá được; tab borrow trả lại; tab tạo đóng; session stop.
- Nếu reload làm extension trong Chrome user hỏng: reload lại từ đúng thư mục; helper fail thì ghi lỗi và dừng.

## 11. Implementation Tasks (cho lượt thực thi browser — không chạy trong lượt ghi plan)

| ID | P | Task | Files | Verify |
|---|---|---|---|---|
| T1 | P1 | Ghi bản plan này vào `plan/`, giữ nguyên review report | `plan/extension-ux-verify-bsk-2026-10-24.md` | file tồn tại, heading cuối là report |
| T2 | P1 | Preflight + session `--focus` + video + reload | — | reload JSON ok, refreshed đúng URL |
| T3 | P1 | Bridge pre-check 3 trạng thái | — | evaluate trả state + values |
| T4 | P1 | 4 flow H/dict/star/off | — | 4 screenshot + measurements, console sạch |
| T5 | P2 | Probe popup + sidepanel | — | screenshot hoặc not-tested + verbatim |
| T6 | P2 | MP4 60s | `.ux-audit/<ts>/overlay-flow.mp4` | file size > 0 |
| T7 | P2 | UX matrix 3 viewport | `review/ux-verify-evidence-*` | 3 viewport + probe `value.ok` |
| T8 | P2 | Report + cleanup | `review/ux-verify-<date>.md` | session list sạch, emulate off |

Effort: T2-T4 ~20 phút người / ~5 phút CC; T5-T8 ~30 phút / ~10 phút CC.

## GSTACK REVIEW REPORT

**Scope gate:** plan mode → auto-select **B** (review đúng bản Plan v2 viết lại). Design doc: không có → bỏ qua `/office-hours` (đây là plan verification, không phải feature design).

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | skipped (external model CLI bị cấm) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 2 | CLEAR | 7 corrections, 0 unresolved, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | not needed (không sửa UI; plan verify UI) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**Findings (severity, confidence, bằng chứng):**
1. [P1] (10/10) Reload thủ công đã lỗi thời — native tool dry-run `ok:true`; helper + script + AGENTS §9 tồn tại.
2. [P1] (9/10) Mặc định `--no-focus` + `document.hidden` (`content.js:4935`) làm bar không update → pre-check phải `--focus` và assert hidden=false.
3. [P2] (9/10) "Chặn cứng `chrome-extension://`" chỉ đúng cho `bsk navigate` (CDP `-32000 Not allowed`); `tab create`/borrow chưa thử → thêm probe + fallback.
4. [P2] (9/10) Bump version không phải 1 chỗ (manifest + `TEST_PLAN_MATRIX.md:3` + `docs/test-cases/TC_EXTENSION_CORE_CAPTIONS.md:18`); `data-v` set trước `executeScript`; boot line đi bridge (`content.js:6131`); marker `SCRIPT`→`DIV` là build proof.
5. [P2] (9/10) `extension_ux_probe.js` / `browser_probe.js` tự mở browser riêng (header nói rõ) → không dùng.
6. [P2] (9/10) Không có watch tab đang mở (live tab list) → phải navigate tới video cụ thể.
7. [P3] (8/10) Đã sang ngày mới JST → tên file/report dùng `run-date`, không hardcode 2026-10-23.

**Completion summary:**
- Step 0: scope accepted; cắt bump version (không có giá trị verify, 3 file doc phải sửa).
- Architecture: 2 issues (reload state, hidden tab) — đã fold.
- Code quality: 1 issue (không thêm script/không lặp docs) — đã fold.
- Tests: diagram + 1 known gap (không có CI browser+extension regression) — ghi nhận.
- Performance: 0 issue (executeScript thêm vài ms).
- NOT in scope: đã viết.
- What already exists: đã viết.
- TODOS.md: repo không có file; gap CI harness ghi trong §9, không tạo file mới.
- Failure modes: 0 critical gap (9 mode đều có xử lý/dừng an toàn).
- Outside voice: skipped (external model CLI bị cấm; không chạy subagent).
- Parallelization: 0 lane (một browser, một session, tuần tự).
- Lake Score: 3/3 (reload tự động; probe+fallback; không bỏ im lặng bề mặt nào).

**VERDICT:** ENG CLEARED — 7 corrections đã fold; 0 unresolved; 0 critical gap. Sẵn sàng ghi file plan; chạy browser verification là lượt riêng sau khi bạn đồng ý.
**Prior v2 review:** 9 findings / 2 critical gaps / 1 unresolved (D1 popup/sidepanel). D1 giờ được giải quyết bằng probe-first + fallback human screenshot, không bỏ im lặng.
**gstack:** 1.80.0 → 1.91.182.0 có bản mới; hoãn nâng (ngoài scope).
**Known gap:** không có automated browser+extension regression cho MAIN-world inject; CI không load unpacked trong branded Chrome. Manual verification là bằng chứng của lượt này.

NO UNRESOLVED DECISIONS
