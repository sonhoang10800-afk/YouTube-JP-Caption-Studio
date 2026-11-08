# Topic: AnimeVietSub auto-inject script → Side Panel

## Status

**SHIPPED & FULLY VERIFIED (2026-11-04).**
Raw plans:
- [plan/anime-auto-inject-script-panel-2026-11-02.md](../../plan/anime-auto-inject-script-panel-2026-11-02.md)
- [review/anime-auto-inject-script-panel-plan-review-2026-11-02.md](../../review/anime-auto-inject-script-panel-plan-review-2026-11-02.md)
- [plan/anime-auto-inject-avs-test-plan-2026-11-04.md](../../plan/anime-auto-inject-avs-test-plan-2026-11-04.md)
Evidence bundle: `.test-evidence/20261104-222326-avs-live-verification/` (VERDICT: PASS, 10/10 automated tests pass).

### Đã hoàn thành (Shipped):
1. **ASS / SRT Subtitle Parser**: `extension/shared/ass_parser.js` parse .ass & .srt, bóc tách override tags `{\k...}`, chuẩn hóa thời gian và cue text. Verified by `extension/shared/ass_parser_test.js`.
2. **Metadata & Contract Resolver**: `extension/shared/anime_resolver.js` trích xuất slug/tập từ URL/DOM, tra cứu AniList GraphQL (có English title fallback cho trường hợp Romaji không match), tìm kiếm và tải kịch bản tiếng Nhật từ Jimaku.cc. Verified by `extension/shared/anime_resolver_test.js --live`.
3. **Cross-Origin Player Bridge**: `extension/content/animevietsub_player_bridge.js` được inject vào iframe `stream.googleapiscdn.com`, lắng nghe `timeupdate` để postMessage `AVS_PLAYER_TIMEUPDATE` lên top frame và nhận `AVS_PLAYER_SEEK` khi click cue trong panel.
4. **Content Script & Zero Overlay**: `extension/content/content.js` hỗ trợ nguồn `animevietsub`, tự động fetch script tiếng Nhật, triệt tiêu 100% overlay trên video để không che hardsub tiếng Việt sẵn có của phim.
5. **Nút Mở Nhanh Side Panel**: Nút `LR PANEL` gắn vào `#media-player-box`, gọi `chrome.sidePanel.open()` qua user gesture an toàn.
6. **Bảo mật Jimaku Key**: Lưu trữ độc lập trong `chrome.storage.local.jimakuApiKey`, không bị đẩy lên local bridge `/extension_state` hay Drive.
7. **Live Browser Verification**: Verified trên Chrome tab thật `https://animevietsub.best/phim/mezametara-saikyou-soubi-.../xem-phim.html`, tải thành công 379 cues, đồng bộ playhead tại 8.0s và 55.0s (`scripts/animevietsub_live_smoke.js`).

## Verdict review

**FAIL** — 9 blocker P0. Ý tưởng đúng nhưng plan đánh giá thấp 3 ràng buộc thật của code hiện tại:

1. `chrome.sidePanel.open()` cần user gesture; code đã có retry-on-gesture
   (`extension/content/content.js:121-123`, `:4258-4270`) → không hứa auto-open on load.
2. bsk không thấy side panel (AGENTS §10) → test plan dòng 46 không hợp lệ; phải dùng
   `sp_test_bridge` + `screencapture`, ghi `BSK PROBE: no`.
3. Cache key non-YouTube lấy segment cuối URL (`content.js:1504-1537`) → `/tap-12/` sẽ trùng
   giữa mọi anime; cần `animevietsub__<slug>__ep<NN>` ≤64 ký tự.

Thêm: `all_frames: true` trên entry hiện tại sẽ nhân bản content script trên YouTube/Netflix/ABEMA;
`loadPageCues()` phụ thuộc page bridge không tồn tại trên AVS; host permissions thiếu AniList/Jimaku/
SubDL; `jimakuApiKey` nếu nằm trong `hardsubSettings` sẽ bị đẩy lên bridge `/extension_state`
(`service_worker.js:652-665`, `local-bridge/app/api/state.py:101-102`).

## Việc phải làm trước khi code

- **Spike 0** (read-only, evidence bundle): URL pattern tập, iframe origin, selector `<video>`,
  track có sẵn, DOM metadata thật của AVS.
- Sửa plan theo P0-1…P0-9 trong review; thêm ma trận 6 cổng nền tảng
  (`service_worker.js:166/180/190`, `hardsub_defaults.js:39`, `settings_modal.js:145-153`,
  `sidepanel.js:2740`) + manifest.
- Reuse pipeline có sẵn: `applyLoadedCues` tự tokenize; panel render từ `SP_STATE`;
  `SP_CMD play` đã seek. Không viết client tokenize/panel mới.

## Chưa kiểm chứng

DOM/URL/player thật của AVS; contract AniList/Jimaku/SubDL; hành vi side panel trên build đã cài;
timing sub so với video. Không chạy test runtime nào trong phiên review.

## Sửa plan sau review (2026-11-02)

- Panel: bỏ hứa "auto-open khi tải trang" → mở bằng gesture (icon/player/LR); bsk chỉ test tab.
- Manifest: host permissions cụ thể (AniList/Jimaku/SubDL) + entry AVS riêng, không `all_frames`
  trên entry cũ; `sp_test_bridge` match AVS là dev-only.
- Cache id: `animevietsub__<slug>__ep<NN>` thay cho `web__<last-path>`.
- Nạp cues: nhánh `loadCachedCues → FETCH_ANIME_SCRIPT → applyLoadedCues`, không dùng page bridge.
- Tokenize/panel/seek: reuse pipeline hiện có, không viết client mới.
- `jimakuApiKey` local-only, không vào `hardsubSettings`/bridge.
- Test: thêm live contract check + collision test; thiếu key → `NOT TESTED`.
- Thêm Spike 0 (URL/DOM/iframe), docs `walkthrough.md`/`README.md`, ghi `errors.log`.

## Liên quan

- [sidepanel-test-plan-2026-10-25](sidepanel-test-plan-2026-10-25.md) — giới hạn bsk với panel.
- `extension/shared/gemini_translate.js:23` — pattern lưu API key local-only.
