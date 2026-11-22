<!-- date: 2026-10-22 -->

# Topic: Codebase Audit 2026-10-22

## Status

**Đang remediate.** Audit read-only; từ 2026-10-22 đã sửa một phần (xem bảng dưới).
Raw review đã file và **không sửa** (§4).

Quét 2026-11-22 đọc lại A-4: thiếu `cap` vẫn bị từ chối, nhưng `pageCapToken == ""` vẫn nhận mọi reply có token. Chi tiết: [codebase-unreasonable-points-2026-11-22.md](codebase-unreasonable-points-2026-11-22.md).

| Finding | Trạng thái | Commit |
|---|---|---|
| A-1 vocab `meaning`/`status` + merge khi upload Drive | **đã sửa** | `f669bcd9c` |
| A-2 đọc `caption-studio-vocab.json` (iPad → extension) | **đã sửa** | `cc01eb0ad` |
| A-4 capability gate nhận message thiếu token | **đã sửa** | `775d275ae` |
| A-6 test giả `test_bugfixes_qa.js` | **đã sửa** (giữ phần live-Chrome thật) | `561472851` |
| A-7 anti-fake gate false negative | **đã sửa** (bắt thêm 1 test giả nữa) | `561472851` |
| A-8 tài liệu overlay/pill | **đã sửa**, hạ P0 → P2 | `28b59d1e4` |
| B-21 `write_files` không validate `cues.json` | **đã sửa** | `7788db731` |
| B-4 `BackupService.apply()` xoá sạch library khi pull Drive | **đã sửa** (merge theo videoId/cue id) | `c6f6097da` |
| B-6 iPad `clearTranslations()` không filter tombstone | **đã sửa** | `c6f6097da` |
| B-5 `wipeAll()` hard-delete → Drive hồi sinh script | **đã sửa** (tombstone + dirty) | `9248d8388` |
| B-2 self-check chết (3 file test không được pytest collect) | **đã sửa** | `cf58aaefa` |
| A-3 iPhone không bundle `user_script.js` | **hạ P0 → P2: là thiết kế, không phải bug** | — |
| B-15, B-16 sanity scripts không chạy trong CI | **đã sửa** (job `sanity-scripts`, skip ≠ pass) | `c90f3a082` |
| B-22 `/asr/transcribe` buffer cả body trước khi check 50 MB | **đã sửa** (đọc theo chunk, cap tại chỗ) | `ad20ed44e` |
| B-23 `_get_mazii_details()` 1 SQL mỗi kanji | **đã sửa** (1 query `IN (...)`) | `a8b0f7c31` |
| B-24 `/saved/sync` tới 5000 transaction | **đã sửa** (1 `executemany`) | `a8b0f7c31` |
| C-28 `tokenize()` 2 nhánh if/else giống hệt | **đã sửa** (xoá nhánh chết) | `11f1df9b8` |
| C-31 `/log` chèn newline → log forging | **đã sửa** (sanitize trong helper chung) | `11f1df9b8` |
| C-32 `build_dict_sqlite` luôn log 0 expression | **đã sửa** | `11f1df9b8` |
| C-11 comment trỏ `extension/popup/popup.js` đã xoá | **đã sửa** | `e739d4a5f` |
| C-18 `ttMiss:<videoId>` key tích tụ trong session storage | **đã sửa** (prune key hết hạn) | `47d10eef4` |
| C-19 Drive mirror lỗi chỉ `console.warn` | **đã sửa** (`logDriveFailure` → `POST /log`) | `47d10eef4` |
| C-20 ASR dispatch không timeout, backstop timer không clear | **đã sửa** (60s + clear) | `47d10eef4` |
| C-27 4 hàm bridge không ai gọi (+ 1 hằng chỉ phục vụ chúng) | **đã sửa** (xoá) | `2415162e4` |
| C-33 6 import bridge không dùng | **đã sửa** (xoá) | `2415162e4` |
| C-21 test suite ghi bẩn `local-bridge/errors.log` | **đã sửa** (fixture autouse → tmp) | `5e185d16f` |
| C-26 bootstrap build `en_vi.json` không ai đọc + `_en_vi_cache` thừa | **đã sửa** (xoá) | `7b77ee337` |
| C-24 Gemini cost table thiếu giá model fallback | **để mở có chủ ý** — không có giá thật thì trả `null` + `PARTIAL ESTIMATE`, không bịa số | `21577b8a7` (chỉ ghi chú) |
| C-29 lỗi ASR/saved-items/bootstrap không vào `errors.log` | **đã sửa 3/3, có test cả 3** (bootstrap test sandbox `DICT`→tmp) | `d43d41820`, `9b3580a09`, `7a3eafc26`, `9aa8fbac0` |
| C-30 nhánh `watch_html` chết khi Android trả non-JSON | **đã sửa** (fall through + `_parse_srv_xml` chịu json3) | `497c04c74` |
| C-10 `freq_ja.json` 3 bản độc lập | **đã sửa** (parity check + CI; chưa gộp file) | `373cb38f6` |
| C-9 env var `BRIDGE_URL` vs `CAPTION_BRIDGE_URL` | **đã sửa** (đọc cả hai tên, default giữ nguyên) | `e75ec298e` |
| C-12 `mock-data.ts` vào bundle production (72 KB demo) | **đã sửa** (`NODE_ENV` conditional → build xoá literal) | `b1a2a3f74` |
| C-14 search/colour input thiếu accessible name, SVG thiếu `aria-hidden` | **đã sửa code** (chưa có screen reader/AT tree để đo) | `b0153ddeb` |
| C-17 `onUpdated` đọc storage + `setOptions` mỗi event | **đã sửa một phần** (memo bỏ IPC; vẫn đọc storage) | `a23252017` |
| C-15 build stale (`out/`, `extension/popup/`) | **đã đóng**: `out/` không track; popup rebuild `2026-10-23T00:15Z` + CI job `extension-popup` verify | `b1a2a3f74` |
| C-16 `sentence_benchmark.js` quét O(cues) mỗi frame kể cả khi pause | **đã sửa** (chỉ rescan khi list instance đổi; **không có red proof**, chưa đo frame time) | `b3b412b87` |
| C-13 web list không virtualize | **đã sửa** cửa sổ 100 row + đo Chrome thật: 5000 → 100 row, 622 918 → 12 941 px | `97a5c85df` |
| C-2 level-colour/JLPT table lệch giữa extension và web | **đã sửa** (contract test; `unknown` #c5c5d0 → #94a3b8) | `37a64a20a` |
| C-2 map curated JLPT (bridge 60 keys ↔ extension 403 keys) | **đã gộp**: bridge giữ nguyên 60 key, thêm 350 key từ extension; đồng ý 254/410 → 407/410 (3 còn lại là gap extension để trống, bridge điền đúng) + test 2 chiều | `55837faf6`, `f2fe701` |
| C-7 saved-cue wire (`start_media_time` giây) | **guard** cross-layer test extension ↔ web + bridge route | `37a64a20a` |
| C-8 `meta.rev` trên wire Drive | **guard** bridge route test | `37a64a20a` |
| C-5 settings defaults lệch (barShowVi, roi.height, maxSentences, barBgOpacity) | **đã sửa** (1 bảng chung `extension/shared/hardsub_defaults.js` + contract test) | `b2f38cf6c` |
| C-7 Saved cue thiếu `videoTitle` → cột Video Anki trống | **đã sửa** (snapshot ghi title, worker lưu nguyên object) | `d20193830` |
| C-8 Bridge thay cả `meta.json` bằng template riêng, key lạ mất | **đã sửa** (`setdefault` merge key ngoại) | `803e10385` |
| C-3 TXT parse: extension JS + bridge port | **đã sửa**: parity test tìm ra bug thật — bridge hiểu `1:02:03` thành **62 s** thay vì 3723 s | `d5873bd80` |
| C-1 gộp 20 file Swift trùng (4 141 LOC) thành package `CaptionShared` 19 file | **HOÀN TẤT A–E**: mỗi app còn `App.swift` + 5 file riêng + `DriveScriptsService`; migration module-move chứng minh headless (`MIGRATION_OK`); Swift 6 mode bắt thêm race cache + `Sendable` | `939637b04`, `6a1762ec1`, `e80278883`, `a76c7ae94`, `4286cec10` |
| C-22 `.git` 1.6 GB (heap snapshot + object mồ côi) | **đã sửa, không rewrite history**: `git gc --prune=now` → pack 1.14 GiB còn 155 MiB; còn lại là `.git/cursor` IDE (388M, không đụng) + submodule (50M) | — (local-only, không commit) |
| P0 `ScriptCue.isDeleted` đụng `NSManagedObject.isDeleted`, mất tombstone trên macOS 26 | **đã sửa**: stored property thành `tombstoned` + `@Attribute(originalName:)`, wire giữ nguyên; migration chứng minh bằng 2 binary chung 1 store | `3e7a9dbc9` |
| B-3/C-6 `jlptLevel` Int (iOS) vs string (web) vs null (bridge) | **không đổi wire** (YAGNI, đã kiểm chứng trên disk): không consumer nào vỡ — extension merge passthrough opaque (test sẵn case Int), web không đọc file vocab, iOS đọc đúng kiểu mình ghi | — (ghi nhận, không commit) |

## Raw

- [review/codebase-audit-2026-10-22.md](../../review/codebase-audit-2026-10-22.md) — báo cáo đầy đủ,
  kèm lệnh kiểm chứng và exit code thật.

## Ngữ cảnh

Audit 2026-10-18 (`review/full-codebase-improvement-audit-2026-10-18.md`) đã được remediate và merge
(`2fff75c48`). Audit này **không lặp lại** phần đó — mọi P0 của audit cũ đã verify là đã đóng
(CI giờ chạy extension tests + root tests, `test_tokenize_import_enrich.py` đã đọc `BRIDGE_URL`,
`verify_no_fake_tests.js` đã quét `local-bridge/tests` + `tests/`). Đây là phần **còn lại**.

## Nguyên nhân gốc (không phải triệu chứng)

Schema của "bản ghi vocab" và "tên file backup" được định nghĩa ở **4 nơi với 4 nghĩa khác nhau**,
không có nguồn sự thật duy nhất. Sửa từng lỗi riêng lẻ sẽ tạo lỗi mới. Cần 1 contract file +
1 script validate.

## P0 (8)

| ID | Vấn đề | File:line |
|---|---|---|
| A-1 | `vocab[].meaning` mang **2 nghĩa** (status vs gloss) trong cùng file → mất gloss/JLPT/tần suất 2 chiều | `local-bridge/app/services/snapshot.py:34,53` ↔ `ipad-app/Services/BackupService.swift:265` |
| A-2 | iOS ghi `caption-studio-vocab.json`, **không ai đọc** file đó → kênh sync iOS↔extension chết | `iphone-app/Services/VocabSync.swift:10` ↔ `extension/background/service_worker.js:1343` |
| A-3 | iPhone **không bundle** `user_script.js` → toàn bộ bridge WKWebView của iPhone chết | `iphone-app/project.yml:10-22` ↔ `iphone-app/Views/YouTubePlayerView.swift:49` |
| A-4 | Capability-token gate **không chặn** message thiếu token; token còn nằm trong URL của DOM | `extension/content/content.js:671,6130,216-222` |
| A-5 | `extension/popup/` được track nhưng `_next/` bị gitignore → **popup trắng sau fresh clone** | `.gitignore:89` ↔ `extension/popup/index.html` |
| A-6 | `scripts/test_bugfixes_qa.js` là test giả (đọc source + assert chuỗi) — vi phạm AGENTS.md | `scripts/test_bugfixes_qa.js:66-78,99-108` |
| A-7 | Anti-fake gate có **false negative** → đã PASS trong khi A-6 tồn tại | `scripts/verify_no_fake_tests.js:45-48` |
| A-8 | README/walkthrough mô tả UI **không tồn tại** (`(LR) ON ⚙` pill, `.lr-card-vi`) | `README.md:39`, `walkthrough.md:205,214,221` |

## P1 (24) — tiêu đề

segfault test suite (B-1) · `write_files` không validate `cues.json` (B-21, **đã repro runtime**) ·
ASR buffer toàn bộ body trước khi check 50 MB (B-22) · 3 self-check bridge không ai chạy (B-2) ·
`jlptLevel` Int/string/null drift (B-3) · `BackupService` wipe-all (B-4) · `wipeAll` không tombstone (B-5) ·
iPad `clearTranslations` thiếu filter tombstone (B-6) · `url_hash.js` + `dfxp_parser.js` code chết (B-7) ·
`/tokenize_batch` unbounded → N request tuần tự (B-8) · `chrome.storage.local` quota mất script (B-9) ·
2 bộ rule `LayoutSmoke` khác nhau (B-10) · `CueEditorRow` iPhone mất 210 LOC (B-11) ·
dict lookup ~480 round-trip SQLite trên main thread (B-12) · `NLPTagger` cache thrash (B-13) ·
ATS drift trong `project.yml` (B-14) · 25 sanity script không vào CI (B-15) ·
sanity script exit 0 khi SKIP (B-16) · `macos-bridge-app` không được compile (B-17) ·
web `pendingDeletes` không retire (B-18) · web nuốt lỗi `persistSettingsAsync` (B-19) ·
web apply snapshot cũ (B-20) · `_get_mazii_details` N+1 SQL (B-23) · `/saved/sync` 5000 transaction (B-24)

## P2 trùng lặp (rủi ro drift thật, không phải "style")

- **C-1**: 20/26 file Swift giữa iPad và iPhone **giống hệt** (4 028 LOC = 59% app iPad);
  6 file đã lệch → **nguyên nhân trực tiếp** của B-6, B-10, B-11.
- **C-2**: level-colour map ×6 · **C-3**: TXT import parse ×4 · **C-4**: tokenize JP ×4
  (cùng 1 câu, bridge sống/chết cho 2 furigana khác nhau) · **C-5**: settings default lệch 4 key.
- B-3: JLPT band resolution ×4 với dataset khác nhau (JS 403 mục vs PY 60 mục; iOS thiếu 14k).

## Đính chính chính báo cáo (2026-10-22, trong lúc sửa A-8)

`review/` là immutable (§4), nên đính chính nằm ở đây thay vì sửa file đã file.

**A-8 được hạ mức P0 → P2 và mô tả lại.** Khi viết báo cáo tôi kết luận "player pill
`[ (LR) ON ⚙ ]` không tồn tại, 0 hit trong `extension/`" và "pill thật là
`.hardsub-bridge-pill`". Cả hai đều **SAI**:

- Pill **có thật**: `extension/content/content.js:4000-4013` `createPlayerToggleButton()`
  dựng `.hardsub-ytp-toggle` gồm badge `LR` + nhãn `playerToggleLabel()` trả `"ON"`/`"OFF"`
  (`:3891-3893`) + bánh răng `⚙` gọi `openSettingsModal()`. Nó chèn vào
  `.ytp-left-controls` sau `.ytp-time-display` (`:4040`) hoặc nổi trên video.
- `.hardsub-bridge-pill` (`content.js:4991`) là **thứ khác**: chấm trạng thái bridge
  nằm trong overlay, không phải nút ON/OFF.

Lỗi thật của tài liệu chỉ là **cách viết**: `[ (LR) ON ⚙ ]` với ngoặc vuông không có
trong DOM, và "dual-card layout"/"lower card" sai vì chỉ có **một** thẻ `.lr-card-ja`
chứa các dòng `.bar-vi` / `.bar-en` bên trong. Đã sửa `README.md:36,39` và
`walkthrough.md:204,205,214,221`.

Bài học phương pháp: kết luận "không tồn tại" từ grep chuỗi literal là **suy luận từ
string matching**, đúng loại lỗi mà chính báo cáo này (A-6/A-7) lên án. Muốn nói một
control không tồn tại thì phải tìm theo hành vi (class/handler), không phải theo chuỗi
người viết tài liệu tự đặt.

## Đính chính A-3: iPhone **cố ý** không có page bridge (P0 → P2)

Audit ghi "iPhone không bundle `user_script.js` → toàn bộ bridge WKWebView chết". Đọc lại
thì đó là **thiết kế**, không phải bug — iPhone có đường fallback native cho cả ba thứ mà
script lẽ ra cung cấp:

| Việc | Fallback native trên iPhone |
|---|---|
| Phụ đề | `CaptionService.fetchCues(videoId:)` — `iphone-app/Views/ContentView.swift:783` |
| Playhead | `Timer` 0.125 s + nội suy `playheadSync.timeMs + elapsed` — `:92-93, :135` |
| Khung overlay | `HardsubOverlayView.resolvedVideo` trả cả pane khi `videoFrame == nil` — `HardsubOverlayView.swift:73-75` |

Hai comment trong code nói rõ ý định: `iphone-app/Services/LayoutSmoke.swift:4` ("the iPhone
app bundles no `user_script.js` … so the check is skipped there") và `iphone-app/project.yml:16`
("Scripts/ is dev tooling only … nothing ships in the app").

Cái **thật sự** sai chỉ là `iphone-app/Views/YouTubePlayerView.swift:49-59`: một `if let`
im lặng không tìm thấy file, và 6 message handler (`captionHandler`, `timeHandler`,
`rectHandler`, `layoutHandler`, `navHandler`, `fullscreenHandler`) được đăng ký nhưng
không bao giờ chạy. Đó là dead wiring gây hiểu nhầm, không phải hỏng chức năng.

Hệ quả cho B-10: hai `LayoutSmoke.swift` **không được gọi ở đâu cả** (`run()` không có
call site trong cả 2 app) — chúng là dead code mâu thuẫn nhau. Hướng xử lý đúng là xoá
cả hai, không phải "gộp rule" rồi giữ tiếp.

## Đã kiểm tra và KHÔNG có phát hiện

XSS/DOM injection trong extension (33 hit `innerHTML`, tất cả đã escape, không `eval`) ·
secret thật trong git (4 hit, tất cả false positive) · egress chỉ 2 đích (Google Gemini + Drive) ·
bridge path traversal / command injection / SQL injection / SSRF / cache leak / deadlock ·
iOS Keychain + ATS trong binary ship + force-unwrap + retain cycle · web type safety (0 `any`,
`tsc --noEmit` exit 0, ESLint exit 0) · extension 15/15 test exit 0 · iOS 2 app `BUILD SUCCEEDED`.

## Chưa verify (nói thẳng)

segfault trên Linux/ubuntu (**không có Docker**) · `npm run build` của web (ghi `out/`, vi phạm
read-only) · sanity suite chạy trong CI (21 passed / 6 skipped, skip ≠ pass) · browser thật đã
chạy (`scripts/browser_probe.js`: Chrome 151 qua CDP pipe — popup hydrate, đếm row, đo scroll;
**chưa** đo fps/paint timing chi tiết, **chưa** screen reader) · Drive round-trip thật ·
Gemini API thật.

## Trạng thái 2026-10-23

Đã đóng **50 dòng trạng thái** (bảng có 51 dòng, trừ C-24 mở có chủ ý; mỗi fix có commit + proof red→green,
ngoại lệ ghi rõ):

- **P0/P1 chính**: A-1, A-2, A-4, A-5, A-6, A-7, A-8 (hạ P2), B-1, B-2, B-4, B-5, B-6, B-14,
  B-15, B-16, B-21, B-22, B-23, B-24, **P0 `isDeleted`/NSManagedObject** (rename `tombstoned`).
- **Hygiene/security**: C-11, C-18, C-19, C-20, C-21, C-26, C-27, C-28, C-29 (đủ 3/3 test),
  C-30 (+ bug phụ `_parse_srv_xml`), C-31, C-32, C-33.
- **Cross-layer guards**: C-2 (level-colour + curated JLPT map parity), C-3 (TXT-parse parity,
  tìm ra bug giờ `1:02:03`→62s), C-5 (1 bảng settings defaults), C-7 (snapshot ghi `videoTitle`),
  C-8 (`setdefault` merge key ngoại trong `meta.json`),
  C-9 (một env var), C-10 (`freq_ja` parity), C-12 (bỏ demo khỏi bundle), C-13 (window list,
  đo Chrome thật), C-14 (a11y names, chưa đo screen reader), C-15 (build stale),
  C-16 (skip rescan khi pause; **không red proof được**), C-17 (memo panel, **một phần**).
- **Hai finding do tự verify mà hạ cấp**: A-3 (thiết kế, P0 → P2), A-8 (audit sai, P0 → P2).
- **Một finding đóng bằng kiểm chứng không đổi code**: B-3/C-6 (YAGNI — không consumer nào vỡ).
- **Mở có chủ ý, không phải quên**: C-24 (không bịa giá), C-25 (giữ theo quyết định user).
- **Meta-item process**: C-23 (commit tồn đọng) — đã push hết từ trước, có log; không phải finding code.

## Còn mở

| Nhóm | Việc | Vì sao chưa làm |
|---|---|---|
| C-4 | Tokenize: bridge Sudachi vs extension `Intl.Segmenter` fallback vs Swift (ngoài phạm vi) | hai engine khác nhau **có chủ ý** (fallback), không phải port; bản Swift bỏ khỏi phạm vi phiên này |
| C-25 | `saved_items` SQLite stack (547 dòng) không client nào dùng | **giữ nguyên** (user quyết 2026-10-23) — ghi chú thay vì xoá | — |

## Chưa verify (nói thẳng)

segfault trên Linux/ubuntu (**không có Docker**) · `npm run build` của web (ghi `out/`, vi phạm
read-only) · browser thật đã chạy (`scripts/browser_probe.js`: Chrome 151 qua CDP pipe — popup
hydrate, đếm row, đo scroll; **chưa** đo fps/paint timing chi tiết, **chưa** screen reader) ·
Drive round-trip thật · Gemini API thật · Swift self-test chạy bằng harness macOS, **1 block bị
skip** vì SwiftData in-memory không enforce unique constraint trên macOS (assert đó vẫn chạy
trên iOS).

Ponytail: sửa 1 nguồn sự thật, xoá phần còn lại — không thêm framework, không thêm abstraction.
