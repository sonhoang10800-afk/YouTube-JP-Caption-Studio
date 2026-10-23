<!-- date: 2026-10-24 -->
<!-- source: goal:continue · user: "Tiếp tục phần còn lại." (tiếp nối review/ux-verify-2026-10-24.md — verdict FAIL) -->

# UX verify post-fix — overlay caption pipeline + touch targets

- **Tiếp nối:** `review/ux-verify-2026-10-24.md` (FAIL F1/F2/F5) + plan `plan/extension-ux-verify-bsk-2026-10-24.md`.
- **Fix commit:** `b155a56` (3 file, +68/−10).
- **Backend:** bsk | instance: 35138c57 (Youtube-Agent) | Chrome 155.0.0.0 | PLAYWRIGHT: no
- **Build:** working tree tại `b155a56`, extension reload từ thư mục `extension/`.
- **Bridge:** chạy `SKIP_SAVED_ITEMS=1 bash local-bridge/start.sh` cho token/dict; đã stop sau verify (trước đó bridge không chạy).
- **Ngày:** 2026-10-24 02:0x JST

## Kết quả

**PASS** — overlay render cue trong Chrome thật; 4/4 flow đạt; C-7 verify được ở data layer; F5 (touch target) đã sửa. Không còn FAIL nào của review trước, trừ các limitation ghi dưới.

## Root cause (2 defect + 1 a11y)

### A. Bridge sống nhưng mọi reply bị content script từ chối (cap rỗng)

Trước fix, content script không nhận được reply nào của page world:

```json
{"n":0,"m":"enhanced","e":0,"s":"none","i":"timedtext_empty","b":false,"k":"asr","t":31}
```

Phép đo trực tiếp: marker có `capLen 36`, nhưng reply PING mang **cap rỗng** → `capAcceptsReply(pageCapToken, "")` trả false → `PING:timeout` → `pageBridgeReady=false` → mọi path caption đều fail.

```json
{"equal":false,"markerCapLen":36,"replyCapLen":0,"result":{"apiVer":7,"ok":true,"ready":true}}
```

Nguyên nhân: `page_capture.js` cache `CAP_TOKEN` **một lần lúc script khởi động**. Reinject (content script mint token mới + thay marker) có thể race với startup này, để lại token rỗng vĩnh viễn trong MAIN world.

**Sửa (`extension/injected/page_capture.js`):** thêm `currentCap()` đọc `data-cap` từ marker **tại thời điểm gửi**; cache chỉ là fallback. Áp dụng cho reply của handler + 2 message `__HARDSUB_TIMEDTEXT_CAPTURED__`.

### B. Path chậm (ANDROID Innertube) bị bỏ vì timeout 750 ms

- WEB timedtext URL trả `HTTP 200`, body `0 bytes` (`hasPot:false`, baseLen 340).
- Path duy nhất còn cue: page world `FETCH_MULTI_LANG_CAPTIONS` → `page_multi_android`, **55 cue**, mất **9.961 ms / 2.699 ms** (2 lần đo; lần khác 4.902 ms).
- `content.js` chỉ cho path này **750 ms** và race `sleep(800)`; kết quả về muộn bị bỏ. SW cascade có thể treo → `await swPromise` không có timeout.

**Sửa (`extension/content/content.js`):**
- `MULTI_TIMEOUT_MS = 15000` cho `FETCH_MULTI_LANG_CAPTIONS` và cho fallback `FETCH_MULTI_LANG`.
- Nếu fast path (800 ms) không có gì: await `multiPromise` thêm 15 s trước khi rơi vào các path WEB-only đã biết là rỗng.
- `SW_TIMEOUT_MS = 12000`; mọi `await swPromise` đổi sang `swTimed()` để SW chết không treo pipeline.

### C. Touch target mobile < 44 px

Đo trước fix trên `iphone-14`: nav `‹ ↻ ›` = **38×38**, player toggle = **79×32**; probe tự bắt `#hardsub-ocr-player-toggle` trong `tapTargets.below44`.

**Sửa (`extension/styles/panel.css`):** `@media (pointer: coarse)` → nav 44×44, toggle `min-height:44px` (giữ pill 26 px, hit area 44).

## Bằng chứng sau fix

| Kiểm tra | Kết quả đo | Artifact |
|---|---|---|
| Caption state sau reload | `n:50, e:38, s:"ok", i:"page_multi_android · en:37 vi:46", pb:true, ap:4` | `fix-evidence/root-cause-before-after.json` |
| H bật | bar `hidden:false`, text `時ときの総点そうてんです。大陸たいりくしっかり出でてきます。`, **12 token**, bridge pill `Connected` | `overlay-h-on-tokens.jpg` |
| Click token → dict | `#hardsub-ocr-dict` visible, 453×569, `時 [とき] Thời N5`, senses VI/EN, ví dụ | `dict-popup.jpg` |
| Star | `☆` → `★`, class `active`, title "Bỏ lưu câu này (phím S)" | `star-active.jpg` |
| H tắt | bar hidden, nav hidden | `overlay-h-off.jpg` |
| C-7 `videoTitle` (data layer) | saved cue `videoId=66E0wpL6O9Q`, `videoTitle=【最新気象】あすは寒気流入により…`, `source=時の総点です。大陸しっかり出てきます。`, `19.4–22.359s` | `c7-saved-cue.json` |
| Mobile touch targets | nav **44×44**, toggle **79×44**; probe `tapTargets.below44` extension-related = **0** | `mobile-44px-targets.jpg` |
| Console | `Unsafe attempt to load URL`: **0**; 2 `Extension context invalidated` (seq 523/524) là artifact của lần reload extension trước khi reload tab, không phải runtime sau fix | — |
| Tests | 15/15 extension suites pass; anti-fake gate PASSED; popup assets OK (19 assets) | `tests.txt` |
| Popup render | `YT Caption — Từ đã lưu`, 500 px window capture | `popup-500px.jpg` |

**Danh sách file thay đổi (commit `b155a56`):**

```
extension/content/content.js       | 43 +++++++++++++++++++++-------
extension/injected/page_capture.js | 21 +++++++++++---
extension/styles/panel.css         | 14 +++++++++
```

## Known limitations / follow-ups

- **F3 (reload verify)**: lần reload đầu trong session trả `verify.ok:false` (title/url rỗng) và để lại 1 tab popup trong cửa sổ user (đã đóng); **4 lần reload sau đó đều `verify.ok:true`, không litter**. Chưa sửa helper `~/.local/bin/reload-chrome-extension` vì là tool dùng chung ngoài repo; nên làm task riêng nếu muốn.
- **Star rehydrate phụ thuộc segmentation**: một lần reload, path đổi từ `ja intercept · 55 cues` sang `page_multi_android · 50 cues` → cue id/group id khác → star hiện `☆` dù saved cue vẫn còn trong storage. Đề xuất match thêm theo `sourceKey` + start time/source text.
- **Popup/sidepanel DOM** vẫn bị bsk chặn (`restricted_tab_url`); C-7 chứng minh ở data layer (`chrome.storage.local` → bridge `extension_state.json`) + popup render, chưa click được tab "Câu đã lưu".
- **Bridge**: khi bridge offline, overlay vẫn render plain text (Intl.Segmenter fallback) nhưng không có furigana/token/dict; muốn full UX phải chạy bridge.
- **MP4**: không quay lại clip post-fix (screenshots + DOM measurements đủ cho 4 flow); clip repro 20 s của lần FAIL vẫn ở `.ux-audit/20261024-ux-verify-ext/overlay-flow-repro.mp4`.
- **Không thêm unit test mới**: lỗi nằm ở race giữa hai world + timing mạng, cần browser thật; CI branded Chrome không load unpacked. Ghi nhận là gap, không tạo test giả.

## Attestation

- Browser: bsk → `35138c57` (Youtube-Agent), Chrome `155.0.0.0`
- Separate Chromium/Playwright: **no**
- Extension reload: `reload_chrome_extension` (verdict `closed_after_reload`, verify popup OK ở các lần sau)
- Session stopped: `fitc` → `sessions: []`; user's Chrome windows/tabs verified (2 windows, không tab rác của Agent Window)
- Bridge started for token/dict verification and stopped afterwards

## Evidence files

`review/ux-verify-fix-evidence-2026-10-24/`:
- `overlay-h-on-tokens.jpg`, `dict-popup.jpg`, `star-active.jpg`, `overlay-h-off.jpg`, `mobile-44px-targets.jpg`, `popup-500px.jpg`
- `root-cause-before-after.json`, `c7-saved-cue.json`, `tests.txt`
