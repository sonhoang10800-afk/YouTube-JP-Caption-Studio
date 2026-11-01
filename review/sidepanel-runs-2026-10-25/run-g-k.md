<!-- date: 2026-10-25 -->
<!-- source: goal:execute sidepanel test plan · group G + K (Lead) -->

# Lượt G+K — nhớ trạng thái, chuyển phim, giới hạn (Lead tự chạy)

Bề mặt: **DSH Browser** (Chrome for Testing, profile tạm `session-c3936854-…`), extension id
`oiocgalcdfmkbcikemohekbjjmlbpoll` v0.11.3 **unpacked** (`update_url = null`), tải trực tiếp từ
kho. Khung được mở bằng `chrome-extension://<id>/sidepanel/sidepanel.html` (phần thật, cùng
`sidepanel.html` + `.css` + `.js`), viewport mặc định 1200×692, có thể thu hẹp theo từng tab.
HEAD lúc chạy: `43399f3`, cây làm việc bẩn y như mục 6 của `.tmp-sp/HARNESS.md`.

## G — nhớ trạng thái và chuyển phim

| Mã | Kỳ vọng | Đo được | Kết luận |
|----|---------|---------|----------|
| G-1 | Tải lại trang khung vẫn giữ lời + lựa chọn, không cần reload trang phim | Trước: 38 dòng, `#sp-status` = "YT · page_multi_android · en:48 vi:46 · 50 cues", `data-mode="enhanced"`, 4/4 nút JA/VI/EN/Furi `active`, `#sp-list.scrollTop` đặt 800. Sau reload: 38 dòng, cùng status, `data-mode="enhanced"`, 4/4 `active`, `scrollTop` = 1928.5 (tự cuộn theo câu đang phát vì nút ▶ Cuộn đang bật). | **PASS** |
| G-2a | Mở phim mới không được hiện lời phim cũ | Trước: phim trực tiếp `hPq9LdURLxg` → 2844 dòng / 2844 cue. Chuyển sang `aqz-KE-bpKQ` (Big Buck Bunny, không có phụ đề Nhật): khung còn **0 dòng**, `#sp-empty` hiện "Chưa có caption (YT… · 0 cues · bridge?) Bấm Reload để tải lại." Sau 10 giây vẫn 0 dòng — **không còn dòng nào của phim cũ**. | **PASS** |
| G-2b | Quay lại phim có phụ đề phải nạp đúng phim đó | Chuyển về `66E0wpL6O9Q`: 38 dòng ngay (1ms, lấy từ bộ nhớ tạm theo tab), `#sp-status` = "bootstrap 72%" rồi "YT · page_multi_android · en:38 vi:46 · 50 cues". Dòng đầu đúng câu của phim này (`明日あすは上空…`). | **PASS** |
| G-3 | Thêm `&t=123s` khi tạm dừng không được xóa lời | Mở `watch?v=66E0wpL6O9Q&t=123s`: video chạy tới 148,5s, khung vẫn **38 dòng** / 50 cue, status bình thường. | **PASS** |
| G-4 | Tắt trình duyệt rồi mở lại vẫn còn dữ liệu | **Không chạy được**: không được phép tắt trình duyệt khi các tổ khác đang dùng chung máy; tự tắt cũng sẽ mất extension tạm (đúng như tổ H/I đã gặp: trình duyệt tự khởi động lại là mất extension, CDP port đổi 52125 → 54669). Ghi là bỏ dở, không suy đoán. | **NOT TESTED** |
| G-5 | Đóng rồi mở lại khung vẫn có lời | Đóng tab khung, mở lại `sidepanel.html`: 38 dòng ngay, không cần thao tác gì thêm. | **PASS** |

## K — trường hợp xấu và giới hạn

| Mã | Kỳ vọng | Đo được | Kết luận |
|----|---------|---------|----------|
| K-1 | Phim không có phụ đề: báo rõ, không treo | `aqz-KE-bpKQ`: 0 dòng, thông báo rõ ràng có nút Reload gợi ý; khung vẫn bấm được thẻ/nút, không treo. | **PASS** |
| K-2a | Mất mạng: không mất lời đang có, báo trạng thái | Đặt `networkConditions: Offline` trên tab phim rồi tải lại tab phim: khung vẫn giữ **38 dòng**, `#sp-status` xuống "YT… · 50 cues · bridge?", có toast dự phòng "Bản lưu mới hơn đã có. Xuất backup JSON trước khi Reload…"; 15 mẫu liên tiếp đều 38 dòng, không nhảy. | **PASS** |
| K-2b | Có mạng lại: tự hồi phục | Bỏ chế độ offline, tải lại tab phim: extension inject lại (`#hardsub-ocr-page-script` api 7), video dài 167s, khung trở lại **38 dòng** với status đầy đủ `en:38 vi:46 · 50 cues`. | **PASS** |
| K-3 | Phim rất dài phải vẫn dùng được, đo được chi phí | Phim trực tiếp `hPq9LdURLxg`: **2844 dòng / 2844 cue**, **112.711 phần tử DOM** trong `#sp-list`, `scrollHeight` 354.617px. Cuộn 2 giây: khung hình p50 **8,4ms**, p95 **25,5ms**, max **130,5ms**, 1 long task **51ms** (183 khung hình đo được). | **PASS có khiếm khuyết** — chạy được nhưng p95 25,5ms là tụt khung rõ ở 60fps; 2844 dòng dựng toàn bộ DOM (không ảo hóa) là nguyên nhân. Ghi thành **lỗi hiệu năng F-P1**. |
| K-4 | Câu nghe được khác/giống hệt câu gốc, gợi ý đồng ý/bỏ | **Không có** phần tử gợi ý ASR nào xuất hiện (`.sp-candidate-accept`, `.sp-candidate-revert`, `ins`/`del` đều không có) vì ASR không chạy trong môi trường này (không có engine nhận tiếng được bật). Không tạo dữ liệu giả để "cho có". | **NOT TESTED** |
| K-5 | Máy chủ dịch quá tải 429 / hết giờ 15s: hàng đợi nhả chỗ | Không điều khiển được khóa Gemini/quota để tạo 429 thật. | **NOT TESTED** |
| K-6 | Lát cắt im lặng: bỏ qua, không sinh câu rác | Phụ thuộc ASR (K-4). | **NOT TESTED** |

## L — bằng chứng

- Số đo lấy từ `chrome-extension://` thật trong DSH Browser bằng `getBoundingClientRect`,
  `getComputedStyle`, `PerformanceObserver("longtask")`, `requestAnimationFrame`, đọc
  `video.currentTime`, và gọi thẳng cầu nối cục bộ `http://localhost:8765/…` bằng `curl`.
- Không dùng cách đọc chuỗi trong mã nguồn để kết luận. Không chụp màn hình trình duyệt ngoài.
- Ảnh: `evidence/lead/panel-after-recovery-1200x692.jpg` — khung sau khi có mạng lại: 38 dòng,
  `#sp-caption-mode` xanh lá "Enhanced · thử nghiệm", 4 nút JA/VI/EN/Furi đang bật (tím),
  `Overlay` đang bật (tím), `▶ Cuộn` đang bật (xanh), furigana + màu JLPT hiện đủ.
- Số đo còn lại ghi nguyên văn trong các bảng ở trên (đọc từ DOM thật, không phải đọc mã nguồn).

## Giới hạn bề mặt (áp dụng cho cả báo cáo)

1. Khung được đo là **trang tab** `sidepanel.html` trong DSH Browser, **không phải** lớp
   side-panel của Chrome. Vì vậy: không có thanh tiêu đề side-panel, chiều rộng không bị Chrome
   giới hạn như panel thật, và không đo được hành vi khi Chrome tự mở/đóng panel.
2. Chrome của DSH Browser chạy `--headless` cho các tổ con và **không** kèm `--load-extension`;
   mỗi tổ phải cài bản chép trong thư mục tạm, nên `chrome.runtime.id` khác nhau giữa các lần
   (`oiocgal…` của Lead, `lcgnommh…`/`aphg…`/`licdgb…` của các tổ). Cùng bộ mã, cùng HEAD; chỉ
   khác id do manifest không có `key`. Id khác nhau **không** làm sai kết quả đo giao diện, nhưng
   nghĩa là dữ liệu lưu của mỗi tổ nằm ở kho riêng của id đó.
3. Một tổ gặp trình duyệt tự khởi động lại giữa phiên (mất extension tạm) → mục I-2 phải bỏ dở.

## Lỗi phát hiện ở lượt này

| Mã | Mức | Hiện tượng | Số đo |
|----|-----|-----------|-------|
| F-P1 | Trung bình | Khung dựng toàn bộ DOM cho phim rất dài, cuộn bị tụt khung | 2844 dòng → 112.711 node; frame p95 25,5ms, max 130,5ms, 1 long task 51ms |
| — | Ghi nhận | Status khi mất mạng còn "bridge?" nhưng khung vẫn giữ lời và có toast dự phòng — hành vi đúng, không phải lỗi | 15 mẫu × 38 dòng |
