<!-- date: 2026-10-24 -->
<!-- source: goal:execute-todos · user: "Bắt đầu thực thi TO-dos." · TODO #1 fix F1/F2 from review/ux-verify-matrix-postfix-2026-10-24.md -->

# UX fix review — overlay inside video + coarse-pointer ctrl targets

BACKEND: bsk | instance: 35138c57 (Youtube-Agent) | Chrome 155.0.0.0 | PLAYWRIGHT: no

- **Scope:** fix 2 findings từ matrix post-fix: **F1** bar tràn khỏi video ở viewport hẹp (Medium), **F2** `#lr-toggle-ap` / `#lr-btn-move` <44 px trên coarse pointer (Medium).
- **Build:** working tree trên `b155a56` + thay đổi fix (commit sau review này); extension reload **một lần** trong lúc verify.
- **URL:** https://www.youtube.com/watch?v=66E0wpL6O9Q
- **Session:** bsk `35138c57`; xem mục "Session churn" bên dưới — session bị stop giữa chừng 3 lần, phải restart; trong mỗi session chỉ dùng 1 tab, không tạo/đóng tab giữa các check.
- **Bridge:** `SKIP_SAVED_ITEMS=1 bash local-bridge/start.sh` (để có furigana/token); stop sau đo.
- **Viewports:** mobile 390×844 dpr3 + desktop UA; tablet 744×1133 dpr2 + desktop UA; desktop 1440×900 dpr2 (no mobile/touch).
- **States:** H ON, video pause 22 s, bridge Connected.

## Thay đổi

| File | Thay đổi |
|---|---|
| `extension/styles/panel.css` | `.lr-text-ja` nhân thêm `var(--bar-fit-scale, 1)`; `@media (pointer: coarse)` thêm `.lr-ap-toggle, .lr-move-btn { min-width:44px; min-height:44px; }` |
| `extension/content/content.js` | `--bar-fit-scale` = clamp(0.55…1, `rect.width / 520`) trong `applyBarPosition`; hàm `clampBarIntoVideo()` co text nếu bar vẫn > 92% chiều cao video và nudge `top` để `bar.bottom ≤ video.bottom - 4` |

## Kết quả đo (pre → post)

| Viewport | Bar trước | Bar sau | Trong video | Fit | Font JA | Ctrl buttons |
|---|---|---|---|---|---|---|
| mobile 390 (cue dài) | 291×**236** @y182, bottom **418**; video bottom 285 ⇒ tràn **133 px** | 291×**149** @y132, bottom **281** | ✅ | 0.75 | 27.2 → **20.4 px** | 38×40 / 32×32 → **44×44 / 44×44** |
| mobile 390 (cue ngắn, clean) | — | 291×111, bottom 281 | ✅ | 0.75 | — | — |
| tablet 744 | 555×145, bottom 422 (video 475) | 555×145, bottom 422 | ✅ | 1 | 28.78 px | **44×44 / 44×44** |
| desktop 1440 | 742×176, bottom 540 (video 628) | 738×170, bottom 531 (video 624) | ✅ | 1 | 38.18 px | 38×40 / 32×32 (mouse — không đổi, đúng thiết kế) |

- Mobile nav 44×44, player toggle 79×44; tablet toggle 79×56 — giữ nguyên.
- Text trong card mobile: block 116 px, `bottom 265 < bar.bottom 281` → không clipping; `bar.scrollHeight 155` vs `clientHeight 149` (6 px là handles/shadow, text không bị cắt — ảnh xác nhận).
- Mobile/tablet: 12 token + furigana (`時ときの総点そうてんです。大陸たいりくしっかり出でてきます。`).
- Console: mobile 39 entries / desktop 75 — **0** `Unsafe attempt to load URL`; còn `ERR_BLOCKED_BY_CLIENT` (adblock/YouTube, page-level) và 2 warning `[jpcap] Sentence cache unavailable`.
- Probe: mobile `value.ok:true`, `horizontalOverflow.ok:false`→ lần này `false` (page-level YouTube); desktop `ok:true` nhưng overflow `true` với `scrollWidth 1425 == viewport 1425`, `culprits:[]` — probe quirk, không phải extension.

## Tests

- `node --check extension/content/content.js` → OK
- `node extension/content/content_test.js` → `content_test: all assertions passed`
- `node scripts/verify_no_fake_tests.js` → `Anti-Fake-Test Gate: PASSED`
- `git diff --check` → clean

## Findings / limitations

- **Session churn (môi trường):** 4 session bsk (`uzto`, `lfbg`, `rswp`, `ptzg`) bị stop giữa chừng (daemon/Agent Window) — phải restart; mỗi session vẫn chỉ 1 tab, không churn tab; extension reload 1 lần. Không phải lỗi của fix.
- **Reload tooling:** `reload_chrome_extension` (native) trả `extension_not_loaded` dù extension đang chạy trong Agent Window; helper AppleScript có thể mở reload page ở cửa sổ/profile khác. Cách dùng được: navigate chính tab bsk tới `chrome-extension://…/reload.html` (chrome.runtime.reload) — cùng profile, không click. Đây là bằng chứng bổ sung cho TODO #3 (harden reload).
- **Desktop run này hiện plain cue (`tok:0`)** dù bridge Connected; mobile/tablet cùng lúc có 12 token; matrix run trước desktop cũng 12 token. Nghi enhancement request fail sau khi SW sleep/reload — **không** do thay đổi CSS/JS này (không chạm token pipeline); cần TODO riêng để tái hiện.
- `scrollH 155 > clientH 149` trên cue dài: 6 px overflow của container (handles/shadow), text trong card không bị cắt.

## Not tested

- Dark mode cưỡng bức, reduced motion, 200% zoom, real touch device, screen reader, cross-browser.
- Keyboard traversal tới overlay (chỉ kiểm tra H toggle + focusability trước đó); popup/sidepanel; C-7 UI row.
- Desktop enhancement/token fallback (xem finding trên) — chưa kết luận.
- Long cue khác (chỉ cue 22 s + cue ngắn); cue cực dài hơn có thể cần fit sâu hơn.

## Attestation

- Browser: bsk → `35138c57` (Youtube-Agent), Chrome `155.0.0.0`; **no** separate Chromium/Playwright.
- Extension reload: đúng 1 lần cho 1 lần đổi code; test trong cùng session/profile.
- Tabs: mỗi session 1 tab; không tạo/đóng tab giữa các check trong cùng session.
- Cleanup: session dừng (list rỗng), bridge stop sau đo.

## Evidence

`review/ux-verify-matrix-fix-evidence-2026-10-24/`:
- `mobile-pre-computed.json`, `mobile-postfix-measure.json`, `mobile-clean-measure.json`, `tablet-postfix-measure.json`, `desktop-postfix-measure4.json`
- `mobile-postfix.jpg` (cue dài), `mobile-postfix-clean.jpg` (cue ngắn), `tablet-postfix.jpg`, `desktop-postfix.jpg`
- `probe-mobile-postfix.json`, `probe-desktop-postfix3.json`, `console-mobile-postfix.json`, `console-desktop-postfix3.json`
- `postfix-mobile-probe1.json` (fit=0.75, bar 149, bottom 281)

Raw (không commit): `.ux-audit/20261024-ux-matrix-fix/`.
