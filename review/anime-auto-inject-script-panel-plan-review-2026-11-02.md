<!-- date: 2026-11-02 -->
<!-- source: chat:codex · user: review plan anime auto-inject script side panel -->

# Review plan: AnimeVietSub auto-inject → Chrome Side Panel

- Plan được review: `plan/anime-auto-inject-script-panel-2026-11-02.md` (121 dòng, **untracked**)
- Code state: `anime_auto_inject_script_panel` @ `bfe1732`, worktree sạch (chỉ file plan untracked)
- Cách review: đọc code trên đĩa, đối chiếu từng giả định của plan với entry point thật. **Không chạy test/runtime nào** trong phiên này, nên không có claim PASS nào.
- Verdict: **FAIL — chưa implement được nguyên trạng**. Ý tưởng đúng, nhưng 9 blocker P0 bên dưới sẽ làm implementation fail ngay ở bước đầu (mở panel, inject script, cache key) và làm bằng chứng test không hợp lệ.

## 1. Đã đối chiếu với code (verified trên đĩa)

| # | Plan giả định | Code thật | Kết quả |
|---|---|---|---|
| 1 | Chỉ cần thêm `animevietsub` vào `platformFromUrl` | SW coi mọi `http(s)` là `"web"` (`service_worker.js:166-177`); chỉ `youtube/abema/netflix` được `isSupportedUrl` (`:180-184`) | THIẾU 5 cổng chặn, xem P1-3 |
| 2 | Side panel tự mở khi vào trang | `chrome.sidePanel.open()` chỉ chạy trong `action.onClicked` (`:133-137`) hoặc message `OPEN_SIDE_PANEL` từ content (`:449-462`); content comment ghi rõ Chrome chặn và retry theo gesture (`content.js:121-123`); `maybeAutoOpenOnNavigate` chạy khi navigate (`:4258-4270`); `autoOpen` mặc định `false` (`hardsub_defaults.js:19`) | **KHÔNG khả thi không gesture** — P0-1 |
| 3 | Content script chạy được trên AVS | Manifest chỉ match 3 site, 3 entry, không `all_frames` (`manifest.json:58-111`) | PHẢI thêm entry riêng — P0-4 |
| 4 | Cues tự nạp qua `loadPageCues` | `loadPageCues` chờ MAIN-world page bridge (`content.js:2477-2501`); `page_capture.js` chỉ match 3 site (`manifest.json:58-67`) | AVS sẽ ra `page_bridge_timeout` — P0-7 |
| 5 | `avs_<slug>_<ep>` là id | Non-YT lấy **đoạn path cuối** làm id (`content.js:1504-1537`), scrub còn `[A-Za-z0-9_-]{6,64}` | Nếu URL AVS kết thúc bằng `tap-12` → mọi phim trùng key — P0-6 |
| 6 | Gửi cues qua `/tokenize` từ code mới | Pipeline hiện có đã tự tokenize sau khi cues vào (`content.js:392+`, `enrichTokensAfterImport`; gọi `/tokenize_batch` ở `:5631`, `:6180`) | KHÔNG viết client mới — P1-1 |
| 7 | `sidepanel.js` phải "nhận diện cues" | Panel render từ `SP_STATE` + `SP_CMD get_state` (`sidepanel.js:289-295`, `:2890-2919`; content `:4093-4110`); `sp-source` là text label | Chỉ cần label/badge + whitelist URL — P1-2 |
| 8 | Seek từ panel | `SP_CMD play` → `seekToTime` đã có (`content.js:1016-1019`, `:1818`) | Reuse, không viết mới |
| 9 | API key Jimaku "quản lý trong settings" | `hardsubSettings` được đẩy nguyên blob lên bridge `/extension_state` (`service_worker.js:652-665`; bridge lưu `state.py:101-102`) | Key sẽ rò vào bridge nếu nhét vào `hardsubSettings` — P0-8 |
| 10 | API key pattern | Gemini key nằm ở storage.local riêng `geminiApiKey` (`gemini_translate.js:23`), có guard purge sync | Dùng đúng pattern này cho `jimakuApiKey` |
| 11 | bsk xác nhận Side Panel mở | AGENTS §10 + test-evidence rule 4: bsk **không** thấy/không probe được side panel | Test plan sai — P0-2 |
| 12 | Live DOM/URL của AVS | Không có bất kỳ code/fixture nào trong repo về AVS; grep `animevietsub|jimaku|anilist|subdl` chỉ ra chính file plan | Chưa có bằng chứng ngoài — P0-5 |

## 2. Blocker (P0) — phải sửa plan trước khi code

### P0-1. "Tự động mở Side Panel" trái API Chrome
`chrome.sidePanel.open()` yêu cầu user gesture. Code hiện tại đã xử lý đúng bằng retry-on-gesture (`content.js:121-123`, `:4240-4255`).
Plan phải đổi mục tiêu thành: **panel mở ở gesture đầu tiên** (click icon ghim trên toolbar / click player / click nút LR), không hứa auto-open khi page load. Acceptance test cũng phải đo đúng điều này.
Nếu vẫn muốn "tự mở" tối đa: giữ `maybeAutoOpenOnNavigate` gọi 1 lần (best-effort), nhưng verdict chỉ PASS khi đường gesture hoạt động.

### P0-2. bsk không thể xác nhận Side Panel
Plan dòng 46 nói bsk "xác nhận Side Panel mở". Điều này vi phạm AGENTS §10 và test-evidence rule 4.
Phải tách bằng chứng:
- `bsk`: page/player/URL/cues load (tab surface).
- `sp_test_bridge` + `SIDEPANEL: BRIDGE PASS`: logic panel.
- Ảnh thật: `screencapture` cửa sổ Chrome (có consent), ghi `BSK PROBE: no`.
Hoặc ghi `SIDEPANEL: NOT TESTED` — không được ghi PASS.

### P0-3. Host permissions thiếu và mô tả sai
Manifest hiện chỉ có 3 site + bridge + Google (`manifest.json:8-24`). Cần thêm tối thiểu:
- `https://animevietsub.news/*` (và subdomain thực tế)
- `https://graphql.anilist.co/*`
- `https://jimaku.cc/*` (API host thực tế)
- host của SubDL / OpenSubtitles API nếu giữ
"CDN streaming" **không cần** host permission để đọc `currentTime` của `<video>` trong trang đã được match; chỉ cần nếu player nằm trong iframe khác origin — và khi đó phải match đúng origin của iframe (xem P0-5).

### P0-4. `all_frames: true` trên entry hiện tại sẽ nhân bản content script
Nếu thêm vào entry đang phục vụ YouTube/Netflix/ABEMA, script sẽ chạy trong mọi iframe quảng cáo/embed → UI trùng, `SP_STATE` trùng, ghi `transcript:*` trùng, `postMessage` race.
Phải tạo `content_scripts` entry riêng chỉ match AVS (và origin player nếu cần), có cờ "top frame owns state; subframe chỉ trả `currentTime`".

### P0-5. Chưa chứng minh được vị trí `<video>` và URL pattern của AVS
`findVideo()` là frame-local (`document.querySelector("video")`, `content.js:1779-1783`). Nếu player nằm trong iframe cross-origin, top-frame script không đọc được thời gian phát.
Plan thiếu **Spike 0** (read-only, có evidence bundle): mở 3 tập thật, ghi lại:
- URL trang phim + URL tập (pattern slug/tập, có query không)
- origin + selector của iframe player, độ sâu iframe
- selector `<video>`, track/subtitle có sẵn hay không
- DOM metadata thật cho resolver (h1, breadcrumb, title, episode)
Không có spike này thì test DOM/resolver chỉ là đoán.

### P0-6. Cache key sẽ đụng nhau
`videoIdFromUrl()` lấy path segment cuối (`content.js:1532-1536`). Với URL kiểu `/phim/<slug>/tap-12/`, id thành `web__tap-12` → mọi anime dùng chung key, ghi đè cue của nhau (và Drive folder trùng).
Plan phải chỉ định hàm id mới, ví dụ `animevietsub__<slug>__ep<NN>`:
- lấy slug + số tập từ canonical URL (bỏ query/`?t=`)
- scrub đúng regex bridge `[A-Za-z0-9_-]{6,64}` (`content.js:1501-1503`)
- ổn định khi URL đổi query, và có unit test 2 phim cùng `tap-12` ra 2 key khác nhau.

### P0-7. AVS không có page bridge → phải thêm nhánh nạp mới
`loadPageCues()` chỉ dùng cho ABEMA/Netflix (page_capture). AVS cần nhánh riêng trong `navigate()`:
`loadCachedCues(videoId)` → rỗng thì gửi SW `FETCH_ANIME_SCRIPT` → `applyLoadedCues()` → `saveTranscriptToDisk()`.
Không được để rơi vào `page_bridge_timeout` rồi kết luận "không có phụ đề".

### P0-8. Jimaku API key sẽ rò nếu để trong `hardsubSettings`
`hardsubSettings` được POST nguyên blob lên bridge (`service_worker.js:652-665`), bridge lưu vào `extension_state` (`local-bridge/app/api/state.py:101-102`). Drive settings là whitelist nên không leak lên Drive, nhưng bridge + web app cổng 3000 vẫn thấy.
Bắt buộc: key riêng `jimakuApiKey` trong `chrome.storage.local`, masked input, không log, không export, không đưa vào `hardsubSettings`; thêm test khẳng định `/extension_state` payload không chứa key.

### P0-9. Test "mock API" không đủ làm bằng chứng
AGENTS cấm test giả/mock-only để kết luận PASS. Unit test với fixture là hợp lệ, nhưng phải có **live contract check** thật:
- AniList GraphQL: POST thật, HTTP status + parse `data.Page.media[0].id`
- Jimaku: request thật với key, status + tên file/tập
- SubDL/OpenSubtitles: status + parse
Nếu không có key/không gọi được: ghi `NOT TESTED`, không được PASS.

## 3. Vấn đề P1 — plan phải bổ sung

1. **Đừng viết client tokenize mới.** Cues vào `applyLoadedCues` là đã có enrich (`content.js:392-440`, `/tokenize_batch` `:5631`). Plan step 5 chỉ nên nói "đảm bảo cues vào đúng pipeline hiện có".
2. **Side panel không cần logic nhận diện cues mới.** Chỉ cần: `sourceLabel()` trả `AVS` (`content.js:1563-1568`), `sp-source` hiển thị label (`sidepanel.js:289-295`), và mở whitelist `isSupportedVideoUrl` (`sidepanel.js:2740-2763`).
3. **Ma trận 6 cổng nền tảng** (plan chỉ nhắc 2):
   - `service_worker.js:166` `platformFromUrl`
   - `service_worker.js:180` `isSupportedUrl`
   - `service_worker.js:190` fallback `enabledPlatforms`
   - `hardsub_defaults.js:39` `enabledPlatforms`
   - `settings_modal.js:145-153` toggle nền tảng
   - `sidepanel.js:2740` `isSupportedVideoUrl`
   - manifest `matches` + `host_permissions`
   Thiếu cổng nào thì panel/tab resolution im lặng fail.
4. **Overlay/UI trên AVS**: `init()` ép `showOnVideo=false` (`content.js:6447-6450`) nhưng `ensurePlayerToggle()` vẫn chèn nút LR nổi cho mọi non-YouTube (`:4318-4360`). Plan phải nói rõ: giữ nút LR (đây là gesture để mở panel), ẩn `#hardsub-ocr-bar`, bỏ qua `injectPageScript`/page bridge trên AVS.
5. **Mapping tập → Jimaku** chưa có quy tắc: split-cour, absolute numbering, movie/OVA, special. Cần rule + fallback chọn tay (search AniList/Jimaku) khi confidence thấp; nếu không, tập 13 của mùa 2 sẽ lấy sai file.
6. **Bỏ bù lệch = rủi ro desync** (ý người dùng đã chốt): phải ghi rõ trong plan là chấp nhận rủi ro, và với VI/EN nên **dịch từ cue JA bằng Gemini** thay vì SubDL/OpenSubtitles (sub mạng gần như chắc chắn khác release/timing). Nếu vẫn lấy sub mạng, phải có cảnh báo "có thể lệch".
7. **Cache/Drive**: cues AVS sẽ đi vào `transcript:*`, `/scripts/save`, Drive mirror. Cần định nghĩa `title`, `source`, `video_id` để không lẫn với YouTube và không vượt giới hạn 64 ký tự.
8. **Lỗi mạng/quota chưa có**: 401/403 (key sai), 429 (rate limit), timeout, offline. Cần backoff + thông báo + dùng cache; mỗi lỗi ghi `local-bridge/errors.log` theo §6.
9. **Tài liệu & wiki**: plan chưa có bước cập nhật `walkthrough.md` + `README.md` (§7) và ingest `wiki/` (§4). File plan đang untracked — phải commit trước khi implement.

## 4. P2 — chi tiết nên chốt trong plan

- `sp_test_bridge` hiện chỉ match 3 site (`manifest.json:104-111`); muốn test panel trên AVS phải thêm match dev-only và nhớ gỡ trước release.
- `.ass` parser: ngoài `{\k}`, `\N`, `Comment:`, cần BOM/CRLF/UTF-8 (và Shift-JIS nếu gặp), dòng `Dialogue:` không có text, timestamp âm/lớn hơn duration.
- XSS: `sidepanel.js` đã escape (`escapeHtml:472`, render `:1461-1485`) — giữ nguyên, thêm test với cue chứa `<script>`.
- Giới hạn hiển thị: `maxSentences` 2000 đã có; với tập dài vẫn nên đo p95 render như lần sidepanel test 2026-10-25.
- Pháp lý/ToS: AVS là site stream; SubDL/OpenSubtitles/Jimaku có điều khoản + quota. Ghi 1 dòng rủi ro, không chặn kỹ thuật.

## 5. Thứ tự triển khai đề nghị (behavior-preserving slices)

0. **Spike 0** (read-only + evidence bundle `anime-site-recon`): URL/DOM/iframe/video/track thật. Dừng nếu player không truy cập được từ content script.
1. **Platform plumbing**: thêm `animevietsub` vào 6 cổng + manifest entry riêng (chưa all_frames) + unit tests. Check: mở tab AVS, icon mở panel, panel rỗng nhưng không lỗi.
2. **Pure modules**: `ass_parser.js` + `anime_resolver.js` + tests (fixture thật từ Spike 0).
3. **SW fetch**: host permissions, cache theo `anilistId+ep`, key local-only, backoff. Live contract check.
4. **Content integration**: id mới, nhánh load mới, chặn overlay, seek 2 chiều. Test runtime thật.
5. **Side panel**: label AVS, trạng thái lỗi/retry, không đổi renderer.
6. **E2E + evidence**: bsk cho page/player; bridge cho panel; screencapture cửa sổ; `evidence.py check --finish`.
7. **Docs/wiki + commit**.

## 6. Acceptance criteria viết lại (đo được)

1. Mở tab AVS tập N, click icon extension (hoặc gesture đầu tiên trên player) → panel mở; header hiện `AVS · <tên anime> · tập N`.
2. Không có overlay phụ đề nào trên video; không có DOM `.hardsub-ocr-bar`; chỉ còn nút LR (nếu giữ).
3. Cues JA nạp đúng thứ tự; sau ≤ 2s có furigana/JLPT (hoặc trạng thái "bridge offline" rõ ràng).
4. Click câu trong panel → `video.currentTime` lệch < 0.5s so với `start_media_time`.
5. Video phát → panel highlight đúng câu đang phát (đo bằng `currentTime` thật).
6. Không tìm được sub → panel báo lỗi cụ thể + nút thử lại; không ghi đè cache cũ.
7. `jimakuApiKey` không xuất hiện trong `/extension_state`, settings snapshot, export JSON, log.
8. HTTP 429/401 → có thông báo + backoff; cues cache vẫn dùng offline.
9. `node scripts/verify_no_fake_tests.js` exit 0; `git diff --check` exit 0; evidence bundle có `EVIDENCE`, `VERDICT`, `## Not tested`.

## 7. Chưa kiểm chứng (not tested)

- DOM/URL/iframe player thật của `animevietsub.news` (không có trong repo; chưa probe).
- Contract thật của AniList / Jimaku / SubDL / OpenSubtitles (chưa gọi API).
- Hành vi `chrome.sidePanel.open()` trên bản extension đã cài (chỉ đọc code + docs).
- Visual side panel thật (bsk không thấy; cần screencapture có consent).
- Timing thật của sub Jimaku so với video AVS (chưa tải file nào).
- Không chạy test suite nào trong phiên review này.

## 8. Lệnh đã chạy (static inspection)

```text
rg / sed trên extension/, local-bridge/, scripts/   exit 0
git status --short                                  exit 0  → chỉ plan untracked
git diff --check                                    exit 0
```

## 9. Kết luận

Kế hoạch đúng hướng nhưng đang đánh giá thấp 3 ràng buộc thật: **gesture của Chrome**, **kiến trúc tab/page-bridge hiện có**, và **tính duy nhất của cache key**. Nếu implement nguyên trạng, kết quả gần như chắc chắn là: panel không mở, content script không chạy, hoặc cues của các anime ghi đè nhau — và test "bsk thấy panel" sẽ là bằng chứng giả.

Sửa P0-1 → P0-9 + thêm Spike 0 rồi mới code. Điểm hiện tại: **5/10** (ý tưởng 8, feasibility 3, test integrity 4).
