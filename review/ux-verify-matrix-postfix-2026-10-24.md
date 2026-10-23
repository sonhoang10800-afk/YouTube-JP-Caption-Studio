<!-- date: 2026-10-24 -->
<!-- source: goal:execute-todos · user: "Bắt đầu thực thi TO-dos." · TODO #1 post-fix 3-viewport UX matrix -->

# UX audit — post-fix 3-viewport matrix (overlay rendered)

BACKEND: bsk | instance: 35138c57 (Youtube-Agent) | Chrome 155.0.0.0 | PLAYWRIGHT: no

- **URL:** https://www.youtube.com/watch?v=66E0wpL6O9Q
- **Date:** 2026-10-24T03:0x+09:00
- **Build:** `b155a56` (extension đang chạy từ disk; **không reload** trong session này — precheck xác nhận marker DIV/api7 + cue render)
- **Session:** `yrzh` — một bsk session, một tab `1847742549`; dùng cùng tab cho cả 3 viewport (AGENTS browser rule §8)
- **Bridge:** chạy `SKIP_SAVED_ITEMS=1 bash local-bridge/start.sh` để có furigana/token; stop sau khi đo
- **Viewports:** desktop 1440×900 dpr2 (no mobile/touch) · ipad-mini 744×1133 dpr2 touch · iphone-14 390×844 dpr3 touch
- **States:** H ON, video pause tại 22 s (câu có tiếng), bridge `Connected`
- **Mode:** Full (matrix + probe + keyboard + snapshot)
- **Fallbacks:** UA desktop được ghim cho cả 3 viewport (xem F3); full-page mobile bỏ vì page overflow

## Verdict

**PASS WITH ISSUES** — overlay render đúng và dùng được ở cả 3 viewport (12 token, furigana, bar nằm trong viewport, probe `value.ok:true`, 0 lỗi CSP), nhưng còn 2 issue responsive/accessibility: bar tràn khỏi video ở 390 px (F1) và 2 nút ctrl vẫn dưới 44 px trên touch (F2).

## Bảng số đo chính

| Viewport | Bar (x,y,w,h) | Font JA | Token | Bar trong viewport | Video (w×h, bottom) | Doc overflow | Probe `ok` | lowContrast | Tap<44 (probe) |
|---|---|---|---|---|---|---|---|---|---|
| Desktop 1440×900 | 175,364,742,176 | 38.46 px | 12 | ✅ | 996×560, bottom 628 | ❌ none | ✅ | 0 | 0 |
| Tablet 744×1133 | 119,277,555,145 | 28.78 px | 12 | ✅ | 744×419, bottom 475 | ❌ none | ✅ | 0 | 24 (page) / 0 ext |
| Mobile 390×844 (inner 424×919) | 62,182,291,236 | 27.20 px | 12 | ✅ (right 353 ≤ 424) | 390×219, **bottom 285** | ✅ **có** (YouTube masthead) | ✅ | 0 | 15 (page) / 0 ext |

Text bar ở cả 3 viewport: `時ときの総点そうてんです。大陸たいりくしっかり出でてきます。`

## Findings

| ID | Severity | Confidence | Viewport | Finding | Evidence |
|----|----------|------------|----------|---------|----------|
| F1 | Medium | High | mobile 390 | **Bar tràn khỏi video**: bar 291×236 tại y182 → bottom **418**, trong khi video 390×219 bottom **285** ⇒ bar phủ xuống page content ~133 px (che banner/title). Text wrap 3 dòng + furigana làm bar cao gấp ~1.08 lần chiều cao video. | `mobile_measure.json`; `mobile-h-on.jpg` |
| F2 | Medium | High | mobile + tablet (coarse) | **Ctrl buttons vẫn < 44 px** dù F5 đã sửa nav/toggle: `#lr-toggle-ap` = 38×40, `#lr-btn-move` = 32×32 trên cả 390 và 744. Nav 44×44 và player toggle 79×44 (mobile) / 79×56 (tablet) đã đạt. | `mobile_measure.json`, `tablet_ctrl_buttons.json`; ảnh |
| F3 | Info / Limitation | High | tablet/mobile | Emulate kèm UA iPad/iPhone làm YouTube redirect `www.youtube.com` → `m.youtube.com/watch?...&ra=m`; manifest không match `m.youtube.com` ⇒ **extension không inject** (hasRoot false, capture null). Matrix phải ghim desktop UA để đo layout hẹp; m.youtube.com là ngoài target của extension desktop. | `tablet_diag.json` (host `m.youtube.com`, hasRoot false); `tablet_host_check.json` (www, root true) |
| F4 | Low / Info | High | all | Overlay buttons **keyboard-reachable nhưng rất muộn trong tab order**: root là con #57/59 của `<body>`; 25/15/12 lần Tab không chạm overlay. Programmatic focus OK (`tabIndex 0`, `:focus-visible true`). Hotkeys H/S/A/D giảm tác động. | `keyboard_focusability.json`; `keyboard_*.jsonl` |
| F5 | Info | High | all | `ux-probe.js` **không** quét 2 nút ctrl mới (không nằm trong `tapTargets.below44`) → nếu chỉ tin probe sẽ bỏ sót F2. Cần đo trực tiếp hoặc mở rộng probe. | `probe_mobile.json` vs `mobile_measure.json` |
| F6 | Info | High | desktop | 2 warning `[jpcap] Sentence cache unavailable; Original script save continues` (bridge Connected, không phải CSP). Không chặn render. | `console_desktop.json` |
| F7 | Info | High | mobile | Page-level horizontal overflow (scrollWidth 424 > 390) do `#masthead-container`/`#masthead` của YouTube; **không phải** extension (bar right 353 < 390). Full-page mobile bị bỏ theo rule overflow. | `probe_mobile.json` (`horizontalOverflow.culprits`) |

## Coverage

- **Surfaces:** overlay in-page (3 viewport) — PASS với F1/F2; popup/sidepanel **không** nằm trong matrix này (TODO #2 riêng).
- **Viewports:** 3/3, emulation desktop UA; mỗi viewport navigate lại cùng tab, H ON, seek 22 s.
- **Checks đã chạy:** bridge precheck, bar/video rect + font + token count, overflow doc, `ux-probe.js` (`value.ok`), console, keyboard walk (25/15/12 Tab), `bsk snapshot` (a11y tree), full-page desktop/tablet (raw), mobile full-page skipped.
- **Console:** desktop 22 entries / tablet 10 / mobile 8; **0** `Unsafe attempt to load URL`.
- **Probe:** `value.ok:true` cả 3; `lowContrast:0`; extension-related `tapTargets.below44:0` (probe blind spot F5).

## Not tested

- `m.youtube.com` (extension không match host) — xem F3; không phải target desktop.
- Dark mode cưỡng bức, reduced motion, 200% zoom, offline/throttling, real touch device, screen reader, cross-browser.
- Popup/sidepanel UI (TODO #2); C-7 UI row.
- Full-page mobile (bỏ do page horizontal overflow); full-page desktop/tablet chỉ lưu raw trong `.ux-audit/`, không copy vào evidence durable.
- Keyboard walk dừng ở 25/15/12 Tab (overlay không tới); chưa test full traversal tới overlay.

## Limitations

- Emulated viewport không phải thiết bị thật; UA desktop được ghim để tránh redirect m.youtube.com (F3).
- Mobile innerWidth 424 > device 390 do YouTube layout; screenshot vẫn 390 CSS pixel width.
- `ux-probe.js` là page-level, có blind spot với control overlay (F5).
- Bridge chạy trong lúc đo; nếu bridge offline, bar render plain text (không token/furigana) — chưa đo lại trạng thái đó trong matrix này.

## Suggested fixes (chưa áp dụng)

1. **F1:** clamp chiều cao bar theo video rect ở viewport hẹp (`max-height: min(video.height, …)`, giảm scale/font khi `max-width: 500px`) và verify lại 390/744/1440.
2. **F2:** mở rộng `@media (pointer: coarse)` cho `.lr-ap-toggle`, `#lr-btn-move` (min 44×44) — cùng chỗ với nav/toggle đã sửa.
3. **F4 (optional):** đưa overlay root lên sớm hơn trong DOM hoặc quản lý tabindex/focus ring; hotkeys hiện có thể đủ.
4. **F5:** thêm check tap-target cho control overlay vào probe/checklist để lần sau không bỏ sót.

## Attestation

- Browser: bsk → instance `35138c57` (Youtube-Agent), Chrome `155.0.0.0`
- Separate Chromium/Playwright: **no**
- Session lifecycle: 1 session `yrzh`, 1 tab, không tạo/đóng tab giữa các check; extension **không reload** trong session (build đã là `b155a56`); session stop 1 lần sau khi đo; bridge stop sau khi đo.
- Extension reload: không dùng — precheck `marker DIV/api7/cap36/capture 7/handler` xác nhận build fix đang chạy.

## Evidence files

`review/ux-verify-matrix-postfix-evidence-2026-10-24/`:
- `desktop-h-on.jpg`, `tablet-h-on.jpg`, `mobile-h-on.jpg`
- `probe_desktop.json`, `probe_tablet.json`, `probe_mobile.json`
- `desktop_measure.json`, `tablet_measure2.json`, `mobile_measure.json`, `tablet_ctrl_buttons.json`
- `console_desktop.json`, `console_tablet.json`, `console_mobile.json`
- `keyboard_desktop.jsonl`, `keyboard_tablet.jsonl`, `keyboard_mobile.jsonl`, `keyboard_focusability.json`
- `tablet_host_check.json`, `mobile_host_check.json`, `precheck.json`, `session_start.json`

Raw (không commit): `.ux-audit/20261024-ux-matrix-postfix/` (gồm full-page desktop/tablet, snapshot, `tablet_diag.json` của m.youtube.com).
