<!-- date: 2026-10-25 -->
<!-- source: goal:execute plan/sidepanel-test-plan-2026-10-25.md · user: "Thực hiện plan... spawn subagents để test càng nhanh càng tốt." -->

# Báo cáo tổng hợp — kiểm thử khung bên phải (side-panel) 2026-10-25

Kế hoạch: [plan/sidepanel-test-plan-2026-10-25.md](../plan/sidepanel-test-plan-2026-10-25.md).
Bề mặt đo: **DSH Browser** (Chrome for Testing), extension id thật của repo
`oiocgalcdfmkbcikemohekbjjmlbpoll` v0.11.3 bản chưa đóng gói, khung mở bằng
`chrome-extension://<id>/sidepanel/sidepanel.html`. **Không** dùng bsk, **không** đụng Chrome cá
nhân của người dùng. `HEAD` = `43399f3`, cây làm việc bẩn (bản đo là bản chép từ cây đang bẩn).

## 1. Cách chia việc (3 tổ chạy song song)

| Tổ | Nhóm | Kết quả | Báo cáo |
|----|------|---------|---------|
| `sp-ui-modes` | A, B, C, E | 16 PASS · 2 FAIL · 3 NOT TESTED | [run-a-b-c-e.md](sidepanel-runs-2026-10-25/run-a-b-c-e.md) |
| `sp-layout-visual` | H, I | 18 PASS · 1 FAIL · 1 NOT TESTED | [run-h-i.md](sidepanel-runs-2026-10-25/run-h-i.md) |
| `sp-cue-save` | D, F, J | dừng giữa chừng (D, F xong; J chưa) | [run-d-f-j.md](sidepanel-runs-2026-10-25/run-d-f-j.md) |
| Lead (bù) | G, K, J, lượt 4 | 9 PASS · 0 FAIL · 4 NOT TESTED (G/K) + 21 PASS · 1 FAIL · 1 NOT TESTED (D/F/J) | [run-g-k.md](sidepanel-runs-2026-10-25/run-g-k.md) |

Tổ `sp-cue-save` **thất bại trước khi ghi báo cáo**; bằng chứng thô của nó còn nguyên và đã được
dùng lại. Lead chạy bù nhóm J và lượt 4 (nghe audio).

## 2. Tổng kết số lượng

| Kết quả | Số mục |
|---------|--------|
| **PASS** | **64** |
| **FAIL** | **4** |
| **NOT TESTED** | **9** |
| Tổng | 77 |

Phạm vi đã phủ: ba thẻ, nút chọn kiểu hiện (gốc/nâng cao/nghe audio), bốn nút bật tắt JA/VI/EN/Furi,
từng dòng câu (phát, lưu sao, sửa câu, thêm câu, xóa câu), chân khung và menu dữ liệu, nhập bản dịch,
xuất TXT, sao lưu và khôi phục, xóa bản dịch, xóa toàn bộ, nhớ trạng thái, đổi phim, mất mạng,
khung 280/360/520px, bàn phím, màu trình độ, furigana, bảng nhỏ câu dài, lưu và đồng bộ, và lượt 4
(nghe audio + so khác nhau).

## 3. Bốn lỗi phát hiện

| Mã | Mức | Lỗi | Số đo / bằng chứng |
|----|-----|-----|--------------------|
| **SPABCE-1** | P2 | Menu dữ liệu `⋯` mở **tràn mép trên 26px**, mục "Nhập bản dịch (Import)" bị cắt, không bấm được | `rect.y = −26`, cao 400px, viewport 756×413; ảnh `evidence/abce/05-menu-more-open-clipped-top.jpg` |
| **SPABCE-2 / H-11** | P2 | **Escape không đóng** menu `⋯` — hai tổ độc lập cùng gặp, cùng số đo | Sau Escape: `details.open` vẫn `true`, popover vẫn render, focus vẫn ở `SUMMARY`; ảnh `evidence/hi/shot-menu-after-escape.jpg` |
| **F-J1** | P2 | **Câu vừa lưu không được đẩy lên máy chủ cục bộ**; chỉ lên kèm khi có thay đổi từ vựng/cài đặt | Bấm sao 2 câu → `chrome.storage.local.savedCues` = 2, nhưng `GET /extension_state` vẫn `savedCues: 0`, `updatedAt` cũ **4232,8 giây**; bật/tắt nút JA → máy chủ nhận `savedCues: 2`, `updatedAt` mới (13,8 giây). Mã: `service_worker.js:714-718` thiếu nhánh `changes.savedCues` |
| **F-P1** | P2/P3 | Phim rất dài: khung dựng **toàn bộ DOM**, cuộn bị tụt khung | 2844 dòng → **112.711 phần tử**, `scrollHeight` 354.617px; khung hình p50 8,4ms, **p95 25,5ms**, max **130,5ms**, 1 long task **51ms** |

Hai lỗi đầu là **cùng một khu vực** (menu dữ liệu `⋯` chứa 2 hành động phá dữ liệu) và đều do hai tổ
độc lập tìm ra — đáng ưu tiên sửa cùng lúc. Lỗi F-J1 đụng đúng thứ người dùng dặn quan trọng nhất
("không mất món đã lưu"): dữ liệu **không mất** (kho của extension là nguồn thật, còn nguyên sau khi
tải lại) nhưng **trang web đọc máy chủ cục bộ sẽ không thấy món vừa lưu**.

### Lỗi nhẹ và ghi nhận thêm

| Mã | Mức | Nội dung |
|----|-----|----------|
| F-2 | Nhẹ (a11y) | Nút bật tắt JA/VI/EN/Furi chỉ cao **18px** (280px) và **19–21px** (360/520), dưới ngưỡng 24×24 của WCAG 2.5.8. Đề nghị `min-height: 24px` |
| F-J2 | P3 | Nút "↗ Mở trang web" (tooltip "Mở trang web Saved Items đầy đủ") thực tế mở `popup/index.html` của extension, không phải ứng dụng web ở cổng 3000. Hành vi khớp mã `sidepanel.js:2790-2795`, chỉ lệch nhãn |
| F-J4 | P2 (tài liệu) | `TEST_PLAN_MATRIX.md` Flow 4 mô tả extension "định kỳ gửi tới local-bridge qua `POST /saved/sync`" — mã **không** gọi endpoint này; đường thật là `POST /extension_state`, còn `/saved/items` (SQLite) trống |
| F-3 | Chưa rõ | Trạng thái VI/EN tự lệch giữa phiên khi tổ H/I đang thao tác; đọc dao động rồi ổn định. **Chưa tái hiện được** — không kết luận |
| F-4 | Ghi nhận | 38 câu sinh **361 điểm dừng Tab** (mỗi dòng ~9 điểm); mọi điểm đều có dấu hiệu focus, nhưng rất dài cho người dùng bàn phím |

## 4. Điểm mạnh đã kiểm chứng (không phải suy đoán)

- **Ba thẻ**: chuyển bằng chuột thật (`isTrusted=true`), **3,7–10,9ms** (mốc 50ms), thẻ đang chọn đúng
  một cái, và **giữ nguyên vị trí cuộn** khi quay lại thẻ câu (`scrollTop` 1500 → 1500).
- **Màu nút đúng hợp đồng**: Enhanced `rgb(16,185,129)` = `#10b981`; Original `rgb(30,30,45)` =
  `#1e1e2d`; nghe audio `rgb(2,132,199)` = `#0284c7`; bốn nút bật tắt khi bật là **tím**
  `rgb(123,92,255)` = `#7b5cff` (khác hẳn màu xanh của nút chế độ — dễ báo nhầm).
- **Màu trình độ khớp tuyệt đối**: n5 166/166, n4 30/30, n3 54/54, n2 11/11, n1 23/23 — không lệch
  phần tử nào; **333 token không rõ cấp không bị tô màu bừa** (đều về màu chữ mặc định).
- **Furigana hiện thật**: 145 `<ruby>` / 145 `<rt>`, **145/145 cao 12px > 0**, không cái nào bị cắt.
- **Bảng nhỏ câu dài**: `max-height: 280px` + `overflow-y: auto`, ép nội dung dài thì cuộn được
  (976 > 278); **ẩn sau 194ms** khi rời nút, **giữ > 300ms** khi đưa chuột vào bảng, ẩn 210ms khi rời
  bảng; dòng sát đáy thì **lật lên trên** và vẫn trong vùng nhìn.
- **Khung hẹp không vỡ**: tràn ngang **0** ở 280/360/520px, **0 cặp nút chồng**, **0 nút bị cắt mép**;
  nhãn tự rút gọn đúng thiết kế (`Enh`/`🎧` ở 280, `Enh`/`Audio` ở 360, đầy đủ + badge ở 520).
- **Không mất dữ liệu khi thao tác dữ liệu**: sao lưu JSON 1.521.209 byte / 150 cue đủ VI+EN+mốc giờ;
  nhập gộp không mất câu (150 → 150); khôi phục rồi quay lại trả đúng trạng thái trước; xóa bản dịch
  giữ nguyên JA và `Reload` dựng lại đủ; xóa toàn bộ rồi tải lại ra đúng 150 cue cũ.
- **Lưu câu bền**: bấm sao → kho có 2 mục → **tải lại khung vẫn còn đúng 2 sao**; thẻ Saved hiện đủ;
  và **trang popup "Câu đã lưu" hiện đúng 2 câu kèm tiêu đề phim thật** — đây là chỗ mà review
  `2026-10-24` ghi là *không bấm được* (bsk chặn), nay đã đo được thật.
- **Nhóm nghe audio (lượt 4) lần đầu kiểm được**: gợi ý ASR sinh sống (19 → 29 → 43 → 52 dòng);
  chỗ thêm xanh `rgba(16,185,129,0.2)`, chỗ xóa đỏ gạch `line-through`; **Áp dụng** đổi câu đúng nội
  dung nghe được; **Bỏ qua** giữ nguyên câu gốc; **Undo** trả về **chính xác** câu gốc.
- **Chuyển phim và mất mạng không làm mất lời**: phim mới không hiện lời phim cũ (0 dòng + báo rõ);
  mất mạng vẫn giữ 38 dòng và có toast dự phòng; có mạng lại tự hồi phục đủ 38 dòng.
- **`&t=123s` không xóa lời** (38 dòng vẫn còn).

## 5. Chín mục chưa kiểm tra được (kèm lý do)

| Mục | Lý do |
|-----|-------|
| Bật audio ở môi trường **headless** | `tabCapture` bị Chrome từ chối: "Extension has not been invoked … Chrome pages cannot be captured." → **đã chạy lại được** trên trình duyệt DSH không headless (lượt 4) |
| Thanh overlay vẽ trên video + PiP | Instance sau khi trình duyệt tự khởi động lại có `video.readyState = 0`, media không tải |
| 30 lần Tab liên tiếp | Công cụ chặn gọi lặp lệnh; đã bù bằng đi bộ **361/361 phần tử focusable** (0 phần tử thiếu dấu hiệu focus) |
| Màu cấp `unknown` (`#94a3b8`) | Dữ liệu 38 dòng **không sinh** phần tử `jlpt-unknown` nào (0 phần tử) |
| Tắt trình duyệt rồi mở lại (G-4) | Không được tắt trình duyệt khi tổ khác đang dùng chung máy |
| Đồng bộ `/saved/sync` hai chiều, tombstone, Last-Write-Wins | Extension **không có đường gọi** endpoint này |
| Gemini 429/quota và lát cắt im lặng | Không điều khiển được quota, không tạo được im lặng có kiểm soát |
| Đồng bộ Drive + đổi tài khoản | Cần một lần bấm đồng ý tài khoản của người dùng; không tự bấm thay |
| Ứng dụng web Saved Items ở cổng 3000 | Không chạy trong môi trường này (`localhost:3000` không phản hồi) |
| Độ chính xác **nội dung** ASR | Cần người nghe đối chiếu tiếng thật; máy không tự chấm được |

## 6. Giới hạn bề mặt (ảnh hưởng tới kết luận nào)

1. **Khung đo là một tab thường, không phải lớp side-panel thật của Chrome.** Vì vậy:
   - Chiều rộng là do tôi ép; **280px chứng minh bố cục chịu được 280px nếu bị ép**, không chứng minh
     Chrome cho phép kéo panel thật xuống 280px. Ba con số cũ mâu thuẫn nhau
     (`TEST_PLAN_MATRIX.md:116` nói dưới 320px; `TC-UI-009` nói 280px; lần smoke thật đo **360px**) —
     nay vẫn **chưa chốt được** con số thật của Chrome.
   - Lần mở khung đầu tiên có thể ra **0 dòng** dù video có 50 cue, vì tab khung chiếm "active tab";
     gọi lại `get_state` (đúng luồng mở lại khung) thì đủ dòng. Ghi là giới hạn bề mặt, không tính lỗi.
2. **Mỗi tổ cài extension từ thư mục tạm nên `chrome.runtime.id` khác nhau**
   (`oiocgal…` của Lead, `lcgnommh…`, `aphg…`, `licdgb…` của các tổ) — vì gate cho tổ con chạy headless
   **không kèm `--load-extension`**, và manifest không có `key` nên Chrome suy id từ đường dẫn. Cùng bộ
   mã, cùng HEAD; **không ảnh hưởng** kết quả đo DOM/CSS, nhưng kho lưu của mỗi tổ nằm riêng.
3. **Trình duyệt DSH tự khởi động lại giữa phiên** (2 lần: pid 69856→77797, 77918→…; cổng CDP đổi
   52065→54641, 52125→54669). Mỗi tổ ghi rõ mốc thời gian từng mục, không trộn số trước/sau.
4. **Headless**: ảnh là chụp viewport, không có cửa sổ thật; không đánh giá được cảm giác cuộn bằng mắt.
5. **Một phần rê chuột** dùng `MouseEvent` tổng hợp (vì `hover` cần `uid` từ cây snapshot quá lớn) →
   chạy đúng listener thật và đo DOM/CSS/thời gian thật, nhưng bỏ qua hit-testing của trình duyệt.

## 7. Việc nên làm tiếp (đề nghị, chưa sửa gì trong lượt này)

1. **Sửa menu `⋯`**: thêm `keydown` Escape để đóng (`details.open = false`, trả focus về `summary`) và
   kẹp vị trí popover trong viewport (hoặc chuyển sang `popover` API để có Escape/click-ngoài miễn phí).
   Đây là chỗ chứa 2 hành động phá dữ liệu nên ưu tiên cao nhất trong 4 lỗi.
2. **Thêm `changes.savedCues`** vào điều kiện gọi `schedulePushExtensionState()`
   (`service_worker.js:714-718`) để món vừa lưu lên máy chủ cục bộ ngay.
3. **Cân nhắc ảo hóa danh sách** cho phim rất dài (2844 dòng → 112.711 phần tử) để p95 khung hình về
   dưới 16ms; đo lại bằng cùng phép đo trong `run-g-k.md`.
4. **Sửa tài liệu** `TEST_PLAN_MATRIX.md` Flow 4 cho khớp đường đồng bộ thật (`/extension_state`), và
   chốt lại con số chiều rộng hẹp thật của Chrome.
5. **`min-height: 24px`** cho `.sp-sub-btn` để đạt WCAG 2.5.8.
6. **Kiểm nốt 9 mục ở §5** khi có điều kiện: cần Chrome thật cho panel thật + `tabCapture`; cần người
   nghe đối chiếu ASR; cần một lần người dùng đồng ý tài khoản cho Drive.

## 8. Bằng chứng

- Báo cáo từng lượt: [run-a-b-c-e.md](sidepanel-runs-2026-10-25/run-a-b-c-e.md) ·
  [run-h-i.md](sidepanel-runs-2026-10-25/run-h-i.md) ·
  [run-d-f-j.md](sidepanel-runs-2026-10-25/run-d-f-j.md) ·
  [run-g-k.md](sidepanel-runs-2026-10-25/run-g-k.md)
- Thư mục bằng chứng: [evidence/](sidepanel-runs-2026-10-25/evidence/) — JSON số đo thô, ảnh chụp,
  tệp sao lưu/ xuất thật (`backup-FfUjmyCeK7s.json` 1,5 MB, `export-FfUjmyCeK7s.txt`), và
  `j-save-sync.json`, `d6-audio-diff-lead.json` của Lead.
- Quy ước đo dùng chung: [.tmp-sp/HARNESS.md](../.tmp-sp/HARNESS.md).
- Mọi số liệu lấy từ DOM/CSS thật trong trình duyệt thật (`getBoundingClientRect`, `getComputedStyle`,
  `PerformanceObserver`, `requestAnimationFrame`, `video.currentTime`, `curl` tới máy chủ cục bộ).
  **Không** kết luận đúng/sai bằng cách đọc chuỗi trong mã nguồn.
