<!-- date: 2026-11-02 -->
<!-- source: user request (/plan Bỏ cái bù lệch và cả overlay luôn) -->
<!-- revised: 2026-11-02 · sửa theo review/anime-auto-inject-script-panel-plan-review-2026-11-02.md -->

# Kế hoạch triển khai: Tự động tải Script Anime trên AnimeVietSub & hiển thị trên Side Panel (Đã bỏ Overlay & Bù lệch)

## 1. Mục tiêu (Goal)
Tự động tìm, tải và nạp script phụ đề vào **Chrome Side Panel** khi người dùng mở bất kỳ bộ anime nào trên `https://animevietsub.news/`, mang lại trải nghiệm xem phim sạch sẽ và học tiếng Nhật trực tiếp qua Side Panel giống YouTube:
1. **Tự động nhận diện phim & tập**: Bóc tách tên đa ngữ (VN, EN, JP, Romaji) và số tập từ DOM và URL.
2. **Khớp đa ngữ qua AniList**: Chuẩn hóa tên sang AniList ID và tên tiếng Nhật chuẩn.
3. **Tự động tải Script tiếng Nhật từ Jimaku.cc API**: Tải file phụ đề gốc (`.ass` / `.srt`) theo AniList ID và số tập bằng Jimaku API Key.
4. **Tìm phụ đề VI / EN trên mạng**: Quét Subdl / OpenSubtitles để lấy sub dịch; ưu tiên dịch từ cue JA bằng Gemini vì sub mạng thường khác release/timing, chỉ dùng sub mạng khi khớp thời gian.
5. **Phân tích từ vựng & Furigana**: Đưa cues vào pipeline sẵn có (`applyLoadedCues` → `enrichTokensAfterImport` → `/tokenize_batch`) để gắn Furigana, cấp độ JLPT và tra từ điển Mazii. Không viết client tokenize mới.
6. **Mở Side Panel & Đồng bộ 2 chiều (Zero Overlay)**:
   - **Không chèn overlay lên video**: Giữ nguyên màn hình video sạch sẽ trên AnimeVietSub.
   - **Mở Chrome Side Panel bằng gesture** (`sidepanel.html`): click icon extension đã ghim hoặc click player/nút LR. Chrome chỉ cho `sidePanel.open()` trong user gesture, nên "tự mở khi tải trang" chỉ là best-effort và không được dùng làm tiêu chí PASS. Hiển thị timeline lời thoại, tab Words và Saved.
   - **Đồng bộ thời gian 2 chiều**: Video phát đến đâu Side Panel tự động cuộn sáng câu đó; người dùng click vào bất kỳ câu nào trong Side Panel thì video tự động tua đến đúng giây đó.
   - **Không bù lệch** (theo yêu cầu): nếu sub Jimaku khác release với video AVS thì cue có thể lệch; plan chấp nhận rủi ro này và không tự thêm offset.
7. **Bộ test suite chắc cú & Multi-Agent phản biện chéo**: Đảm bảo 100% test thật, không test chuỗi tĩnh giả mạo, có các reviewer subagents kiểm định độc lập.

### Ràng buộc đã xác minh (review 2026-11-02)
- **Spike 0 bắt buộc trước khi code**: mở 3 tập thật trên `animevietsub.news`, ghi lại URL trang/tập, origin + selector iframe player, selector `<video>`, track có sẵn, DOM metadata cho resolver. Không có spike này thì selector/resolver chỉ là đoán.
- **bsk chỉ quản lý tab**: không screenshot/click/probe được Chrome side panel. Panel phải test qua `sp_test_bridge` (logic) + `screencapture` cửa sổ Chrome (visual), ghi `BSK PROBE: no`.
- **Không bật `all_frames` cho entry hiện tại**: entry YouTube/Netflix/ABEMA sẽ nhân bản content script trong iframe quảng cáo. AVS phải có `content_scripts` entry riêng, và chỉ thêm origin player nếu Spike 0 chứng minh video nằm trong iframe cross-origin.

---

## 2. Chi tiết Bộ Test Suite Chắc Cú (6 tầng)

1. **`extension/shared/ass_parser_test.js` (Unit Test Parser)**:
   - Test timestamp conversion (`0:01:23.45` -> `83.45s`).
   - Test lọc sạch các tag override ASS `{\k50}`, `{\pos...}`, `{\fad...}`, ngắt dòng `\N`.
   - Test chỉ lấy dòng `Dialogue:`, bỏ `Comment:`, sắp xếp tăng dần theo `start`.
   - Test chống crash khi file rỗng hoặc hỏng định dạng.

2. **`extension/shared/anime_resolver_test.js` (Resolver & API Integration)**:
   - Unit test (fixture thật từ Spike 0, không mock hình dạng tự bịa): DOM metadata (h1, breadcrumb, title, episode), AniList matching, parse response Jimaku, fallback Gemini.
   - Live contract check (bắt buộc, không mock): POST thật tới AniList GraphQL, Jimaku (Authorization header + tập), SubDL/OpenSubtitles; assert HTTP status + parse field thật. Thiếu key/không gọi được → ghi `NOT TESTED`, không được PASS.
   - Test collision: 2 phim khác nhau cùng số tập phải ra 2 `videoId` khác nhau.

3. **`extension/background/service_worker_test.js` (Service Worker Contract)**:
   - Test `platformFromUrl` nhận diện `"animevietsub"`.
   - Test `isSupportedUrl` + `isPlatformEnabledForUrl` + `enabledPlatforms` fallback kích hoạt Side Panel cho AnimeVietSub.
   - Test handler `FETCH_ANIME_SCRIPT` lưu trữ cues an toàn.
   - Test `jimakuApiKey` chỉ nằm ở `chrome.storage.local` và không xuất hiện trong payload `/extension_state`.

4. **`extension/content/content_test.js` (Content Script & 2-Way Player Sync)**:
   - Test `sourceFromHost()` nhận `"animevietsub"` và `videoIdFromUrl()` tạo `animevietsub__<slug>__ep<NN>` (≤64 ký tự, không đụng `web__<last-path>`).
   - Test nhánh nạp AVS: `loadCachedCues` → rỗng thì `FETCH_ANIME_SCRIPT` → `applyLoadedCues`; không rơi vào `page_bridge_timeout`.
   - Test lắng nghe `timeupdate` và seek khi nhận `SP_CMD play { mediaTime }` từ Side Panel.

5. **`scripts/animevietsub_live_smoke.js` (Real Browser E2E — tách 3 surface)**:
   - **bsk (tab)**: điều hướng tập thật, xác nhận cues nạp, `<video>` seek đúng khi content nhận lệnh.
   - **bridge (logic panel)**: dùng `sp_test_bridge` (dev-only, thêm match AVS và gỡ trước release) để đọc/click panel thật; ghi `SIDEPANEL: BRIDGE PASS`.
   - **visual**: `screencapture` cửa sổ Chrome có consent; ghi `BSK PROBE: no`. Không dùng ảnh tab thay cho panel.
   - Chạy trong evidence bundle (`evidence.py start --profile browser --profile sidepanel`), kết thúc bằng `check --finish`.

6. **Anti-Fake Gate**:
   - Chạy `node scripts/verify_no_fake_tests.js` đảm bảo 100% test kiểm tra kết quả hàm, không test chuỗi tĩnh.
   - Chạy `git diff --check`; mọi test UI/layout phải đo DOM/thời gian thật, không đọc source.

---

## 3. Quy trình Giám sát Multi-Agent & Phản biện Độc lập

1. **Implementer**: TDD (Red -> Green -> Verify), chạy test thật bằng chứng thật (`evidence.py`).
2. **`frontend-reviewer`**: Phản biện độc lập về giao tiếp 2 chiều iframe streaming <-> Side Panel, tracking `timeupdate` mượt mà không rò rỉ bộ nhớ.
3. **`security-reviewer`**: Phản biện độc lập về bảo mật Jimaku API Key (local-only, không log/export/bridge) và chống XSS khi render phụ đề ngoài.
4. **`browser-qa`**: `bsk` kiểm tra page/player và seek thật; panel kiểm tra qua `sp_test_bridge`, visual qua `screencapture` cửa sổ — không claim bsk thấy panel.
5. **`release-gate`**: Audit toàn diện diff, đối chiếu báo cáo các reviewer và ra phán quyết `PASS` / `FAIL`.

---

## 4. Danh sách các file triển khai

### [NEW] `extension/shared/ass_parser.js`
Parser chuyển đổi ASS/SRT sang danh sách cues `{ start, end, text }`.

### [NEW] `extension/shared/ass_parser_test.js`
Bộ unit test kiểm tra parser với các fixture thực tế.

### [NEW] `extension/shared/anime_resolver.js`
Module trích xuất metadata, gọi AniList, Jimaku.cc và Subdl API.

### [NEW] `extension/shared/anime_resolver_test.js`
Bộ test kiểm tra resolver: fixture thật từ Spike 0 + live contract check (AniList/Jimaku/SubDL).

### [NEW] `scripts/animevietsub_live_smoke.js`
Script E2E: `bsk` cho tab/player, `sp_test_bridge` cho panel, `screencapture` cho visual.

### [MODIFY] `extension/manifest.json`
Thêm host permissions: `animevietsub.news` (+ subdomain thực tế từ Spike 0), `https://graphql.anilist.co/*`, `https://jimaku.cc/*`, host SubDL/OpenSubtitles (nếu giữ). Chỉ thêm origin player nếu Spike 0 chứng minh `<video>` nằm trong iframe cross-origin. Tạo `content_scripts` entry **riêng** cho AVS; **không** thêm `all_frames` vào entry YouTube/Netflix/ABEMA hiện có. Thêm match AVS cho `content/sp_test_bridge.js` (dev-only, gỡ trước release).

### [MODIFY] `extension/background/service_worker.js`
Cập nhật đủ 6 cổng: `platformFromUrl` → `"animevietsub"`; `isSupportedUrl`; fallback `enabledPlatforms`; `FETCH_ANIME_SCRIPT`; cache theo `anilistId + episode`; backoff 429/401/timeout (mỗi lỗi ghi `local-bridge/errors.log`). `jimakuApiKey` lưu `chrome.storage.local` riêng (không nằm trong `hardsubSettings` vì blob này bị đẩy lên bridge `/extension_state`).

### [MODIFY] `extension/background/service_worker_test.js`
Thêm test case cho nền tảng `animevietsub`.

### [MODIFY] `extension/content/content.js`
Nhận diện `animevietsub`; `videoIdFromUrl()` tạo `animevietsub__<slug>__ep<NN>`; thêm nhánh nạp `loadCachedCues` → `FETCH_ANIME_SCRIPT` → `applyLoadedCues` (không dùng page bridge trên AVS); giữ nút LR làm gesture mở panel, ẩn `#hardsub-ocr-bar`; đồng bộ `timeupdate` và xử lý `SP_CMD play`.

### [MODIFY] `extension/content/content_test.js`
Thêm test case nhận diện `animevietsub` và đồng bộ player.

### [MODIFY] `extension/content/settings_modal.js`
Thêm trường nhập `Jimaku.cc API Key`.

### [MODIFY] `extension/sidepanel/sidepanel.js`
Mở whitelist `isSupportedVideoUrl` cho AVS; hiển thị label `AVS · <tên> · tập N` qua `sp-source`. Không viết lại renderer: panel đã render cues từ `SP_STATE` và seek qua `SP_CMD play`.

### [MODIFY] `extension/shared/hardsub_defaults.js`
Thêm `animevietsub` vào `enabledPlatforms` (cùng `settings_modal.js` toggle nền tảng).

### [MODIFY] `walkthrough.md` + `README.md`
Cập nhật theo AGENTS §7: cách bật, nguồn sub, giới hạn (không overlay, không bù lệch, cần Jimaku key).

---

## 5. Verification Commands

```bash
# 1. Anti-Fake-Test Gate
node scripts/verify_no_fake_tests.js

# 2. Bộ Unit Test Mới (Parser & Resolver)
node extension/shared/ass_parser_test.js
node extension/shared/anime_resolver_test.js

# 3. Extension Core Tests
node extension/background/service_worker_test.js
node extension/content/content_test.js
node extension/sidepanel/sidepanel_pure_test.js

# 4. Local Bridge Suite
cd local-bridge && python3 -m pytest -q tests/

# 5. Live contract (không mock) — thiếu key thì ghi NOT TESTED
node extension/shared/anime_resolver_test.js --live
node scripts/animevietsub_live_smoke.js

# 6. Diff + evidence
git diff --check
python3 ~/.agents/skills/test-evidence/scripts/evidence.py check --dir <bundle> --finish --verdict PASS
```
