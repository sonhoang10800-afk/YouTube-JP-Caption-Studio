<!-- date: 2026-10-25 -->
<!-- source: goal:execute sidepanel test plan · group D+F+J -->

# Lượt D+F+J — thao tác dòng câu, nhập xuất sao lưu, lưu và đồng bộ

Tổ `sp-cue-save` chạy phần D và F rồi **dừng giữa chừng** (không ghi báo cáo, không làm nhóm J).
Bằng chứng thô của tổ còn nguyên trong `evidence/dfj/` và được dùng nguyên văn ở đây.
**Nhóm J do Lead tự chạy** sau đó, ghi vào `evidence/dfj/j-save-sync.json`.

Bề mặt: **DSH Browser** (Chrome for Testing, headless), khung mở như **tab thường**, không phải
lớp side-panel của Chrome. Video của lượt này: `FfUjmyCeK7s` (150 cue) cho D/F, và
`VkxU_zAjmY8` (95 cue) cho J. **Không** thao tác phá dữ liệu trên `66E0wpL6O9Q`.
`git rev-parse --short HEAD` = `43399f3`, cây làm việc bẩn như mục 6 của `.tmp-sp/HARNESS.md`.

## D — thao tác từng dòng câu

| Mã | Kỳ vọng | Đo được | Kết luận |
|----|---------|---------|----------|
| D-1 | Nút ▶ phát đúng mốc của câu | `video.currentTime` 59,9945 → **119,866** cho câu mốc 1:59,9 (lệch −0,03s); video tự phát tiếp (`paused_after: false`) | PASS |
| D-2 | ☆ lưu câu, nút đổi ★ | Trước 0 sao; bấm 2 dòng → sau vòng `SP_STATE`: **2 sao**, chữ `★`, class `sp-star active`, title đổi thành "Bỏ lưu câu". Ghi chú: đọc cùng nhịp bấm vẫn 0 vì trạng thái về qua vòng `SP_STATE` — đúng thiết kế | PASS |
| D-3 | Sửa câu: Enter giữ, Escape bỏ, không mất gốc | Mở `Sửa gốc`: chế độ chuyển `original`, `textarea.sp-ja` mở sẵn và được focus, có nội dung. Gõ `テスト` + Enter → câu chứa `テスト`, ô đóng, 150 dòng. Gõ `バツ` + Escape → **không** chứa `バツ`, vẫn giữ `テスト`, 150 dòng | PASS |
| D-4 | Nút + Cue thêm câu mới tại thời điểm đang phát | 150 → **151** dòng; dòng mới id `c-new-mvnmgp5m-29gdx8` tại `2:03.2` (đúng lúc đang phát), nội dung trống để người dùng nhập | PASS |
| D-5 | Xóa câu vừa thêm | 151 → **150** dòng, dòng mới biến mất. Vướng: nút × dùng `confirm()` gốc, Chrome for Testing headless tự bỏ hộp thoại nên lần đầu không xóa; tổ đã thay `window.confirm` trên **trang khung** để bấm được nút xóa thật (không sửa logic sản phẩm), chạy lại thì xóa đúng | PASS (có can thiệp môi trường) |
| D-6 | Gợi ý ASR: hiện khác nhau, bấm đồng ý/bỏ | **Lần đầu (headless, tổ):** bấm `#sp-audio-mode`, chờ 14 giây: nút vẫn `idle`, không sinh gợi ý nào → không có gì để bấm. **Lần hai (Lead, trình duyệt DSH role=main, không headless):** audio bật được, sinh gợi ý thật và kiểm đủ 3 nhánh bên dưới | **PASS** (xem mục "Lượt 4" ngay dưới) |

## F — nhập xuất và sao lưu

| Mã | Kỳ vọng | Đo được | Kết luận |
|----|---------|---------|----------|
| F-1 | Sao lưu JSON ra tệp, mở đọc được | Tải xong `yt-caption-FfUjmyCeK7s.json` **1.521.209 byte**; đọc bằng bash: `format: caption-studio-sentence-backup`, `version: 1`, `videoId` khớp, **150 cue**, mỗi cue có **VI + EN + mốc thời gian số + tokens** (150/150/150/150); khoá gồm `rawSource`, `mt_locked`, `normalization`, `text_source`, `translation_source` | PASS |
| F-2 | Nhập gộp theo cue, không mất câu | Nạp `import-merge-3cues.json` (3 cue lấy từ bản sao lưu, VI/EN gắn dấu `[IMPORT-TEST-n]`); nhãn tệp "3 mục", chế độ mặc định **merge**, `include_ja` mặc định **false**; 150 → **150** dòng; **3 dòng** mang dấu nhập; bảng nhập tự đóng | PASS |
| F-3 | Khôi phục bản sao lưu rồi quay lại được | Bảng xác nhận hiện "150 cue · 0 câu đã lưu"; khôi phục → dấu nhập **về 0**, 150 dòng, 150 dòng JA; "Quay lại trước khôi phục" → dấu nhập **trở lại 3** | PASS |
| F-4 | Xuất TXT, có cảnh báo thiếu khoá/Enhanced | Tải `yt-caption-FfUjmyCeK7s.txt` **57.971 byte / 1205 dòng**; đầu tệp có URL + giờ xuất; mẫu `[001] 0:00 → 0:06 / JA / furigana / EN / VI`; giao diện hiện đúng cảnh báo "TXT không giữ khóa, dữ liệu Enhanced hay câu đã lưu…" | PASS |
| F-5 | Xóa bản dịch: mất VI/EN, giữ JA | Trước: 150 JA, 1786 token, 150 VI, 150 EN. Sau xóa: **150 JA giữ nguyên**, token 0, **VI 0, EN 0**. Sau `Reload`: 150 dòng, 1786 token, **VI/EN trở lại 150** | PASS |
| F-6 | Xóa toàn bộ sub rồi tải lại từ đầu | Trước: 150 dòng / 1786 token / id đầu `c-0.680-台風30号…`. Thông báo lần lượt "Đang xóa sub đã lưu…", "Đang tải lại caption từ đầu…", "Đã tải lại 150 câu". Sau: **150 dòng / 1786 token**, id đầu **giống hệt** | PASS |

## J — lưu câu và đồng bộ (Lead tự chạy)

| Mã | Kỳ vọng | Đo được | Kết luận |
|----|---------|---------|----------|
| J-1 | Bấm sao thì lưu; tải lại khung vẫn còn | Bấm ☆ dòng 0 và 1 → 2 sao `active`, title "Bỏ lưu câu"; `chrome.storage.local.savedCues` = **2 mục** thật (đọc thẳng kho). Tải lại trang khung: **95 dòng, 2 sao còn nguyên, đúng 2 id cũ** | PASS |
| J-2 | Thẻ Saved hiện đúng món đã lưu | Bấm thẻ Saved: `#sp-view-saved` display `flex`, view câu `none`, `#sp-saved-list` có **2 mục**, mỗi mục có JA + VI + nút 🗑 | PASS |
| J-3 | Nút "Mở trang web" mở được nơi xem đầy đủ | Mở tab mới `popup/index.html`, tiêu đề "YT Caption — Từ đã lưu"; thẻ **"Câu đã lưu 2"** hiện đủ 2 dòng với **tiêu đề phim thật** (`【山口さん解説】平成30年北海道胆振東部地震…`), mốc `00:00–00:10` và `00:10–00:21`, đủ JA + VI + EN, kèm nút "Xuất Anki (2)". **Đây là chỗ mà review 2026-10-24 ghi là bị chặn (không bấm được tab popup) — nay đã đo được thật** | PASS |
| J-4 | Câu lưu phải lên máy chủ cục bộ để trang web đọc được | **FAIL** — xem lỗi F-J1 bên dưới. Bấm sao **không** đẩy lên máy chủ; phải có thay đổi từ vựng/cài đặt mới đẩy kèm | **FAIL** |
| J-5 | Đồng bộ hai chiều qua `POST /saved/sync` + bảng SQLite | `GET http://127.0.0.1:8765/saved/items` → HTTP 200, `[]` trống. Grep toàn bộ `extension/`: **không có chỗ nào gọi `/saved/sync`** (chỉ có `BRIDGE` và `/asr/transcribe`) | **NOT TESTED** — không tồn tại đường dẫn để kiểm |

## Lượt 4 — nghe audio và so khác nhau (Lead tự chạy, bù cho phần headless bỏ dở)

Hai tổ chạy Chrome for Testing **headless** đều không bật được audio: `tabCapture` bị từ chối với
thông báo nguyên văn *"Extension has not been invoked … Chrome pages cannot be captured."* Trên
trình duyệt DSH ở vai `main` (không headless), đường này chạy được — nên đây là lần đầu nhóm này
được đo thật. Bằng chứng: `evidence/dfj/d6-audio-diff-lead.json`.

| Mã | Kỳ vọng | Đo được | Kết luận |
|----|---------|---------|----------|
| K-7 | Nút nghe audio bật được, đổi màu đúng | `#sp-audio-mode`: `active` true, `mode="active"`, `aria-pressed="true"`, chữ đổi thành "Đang nghe audio…"; nền **`rgb(2, 132, 199)`** = `#0284c7` đúng mã đã chốt; nút cao 118×21. Bấm lần hai: về `idle`, chữ "Nghe audio (thử nghiệm)", nền về mặc định — tắt sạch | PASS |
| K-8 | Gợi ý ASR sinh ra theo tiếng thật | Số dòng có gợi ý tăng dần theo thời gian: **19 → 29 → 43 → 52** (dữ liệu sống, không phải mẫu tĩnh) | PASS |
| K-9 | Chỗ thêm hiện xanh, chỗ xóa hiện đỏ gạch | `ins`: nền `rgba(16,185,129,0.2)`, chữ `rgb(52,211,153)` (họ xanh lá `#10b981`). `del`: nền `rgba(239,68,68,0.2)`, chữ `rgb(248,113,113)`, `text-decoration: line-through`. Ví dụ dòng `c-134.239…`: xóa `が1つで、`, thêm `を` + `雨雲が大きく広がっている分` | PASS |
| K-10 | Bấm "Áp dụng" thì câu đổi theo gợi ý | Trước: `が1つで、前線降りていっても北側の方の` → sau khi bấm: **`前線を降りていっても北側の方の雨雲が大きく広がっている分`**; gợi ý biến mất, dấu `ins` về 0, xuất hiện nút **Undo** ("Hoàn tác câu này về bản trước") | PASS |
| K-11 | Bấm "Bỏ qua" thì giữ nguyên câu gốc | Dòng `c-137.040…`: chữ **không đổi** (`雨雲が大きく広がっている分、ま、ね、`), gợi ý biến mất | PASS |
| K-12 | Hoàn tác trả về đúng câu gốc | Bấm Undo: chữ về **chính xác** `が1つで、前線降りていっても北側の方の` (`restoredToOriginal: true`), gợi ý không quay lại, nút Undo biến mất | PASS |

**Chưa kiểm được ở lượt 4:** độ **chính xác nội dung** của ASR so với tiếng thật trong video (cần
người nghe đối chiếu — đây là việc của người, không phải máy đo); ca Gemini trả 429/quota (K-5) và
ca lát cắt im lặng (K-6) vì không điều khiển được khoá/quota và không tạo được im lặng có kiểm soát.

## Lỗi phát hiện

**F-J1 (P2, FAIL J-4) — câu đã lưu không được đẩy lên máy chủ cục bộ khi vừa bấm sao.**
- Cách làm lại: (1) bấm ☆ hai câu trong khung; (2) đọc `chrome.storage.local.savedCues` → 2 mục;
  (3) gọi `curl http://127.0.0.1:8765/extension_state` → `savedCues` **0**, `updatedAt` cũ **4232,8 giây**
  (70 phút, từ lần chạy trước); (4) bật/tắt nút JA (ghi `hardsubSettings`); (5) gọi lại → `savedCues`
  **2**, `updatedAt` mới (13,8 giây).
- Kỳ vọng: vừa lưu câu là máy chủ cục bộ nhận được. Thực tế: chỉ nhận khi có thay đổi **từ vựng hoặc
  cài đặt** xảy ra sau đó.
- Nguyên nhân (đọc mã để biết chỗ, không dùng mã làm bằng chứng): `service_worker.js:714-718` —
  `chrome.storage.onChanged` chỉ gọi `schedulePushExtensionState()` khi `changes.userVocab ||
  changes.hardsubSettings`; **thiếu nhánh `changes.savedCues`**. Hàm đẩy
  (`service_worker.js:617-653`) có gửi kèm `savedCues` (dòng 630-632) nhưng chỉ chạy khi được gọi.
- Ảnh hưởng: dữ liệu **không mất** (kho của extension là nguồn thật, đã kiểm tra còn 2 mục sau khi tải
  lại), nhưng trang web ở cổng 3000 — vốn đọc máy chủ cục bộ — sẽ thấy danh sách cũ/trống cho tới khi
  người dùng đổi một cài đặt nào đó. Với người dùng chỉ lưu câu rồi mở web xem, món vừa lưu **không
  xuất hiện**.
- Đề nghị: thêm `changes.savedCues` vào điều kiện gọi `schedulePushExtensionState()`.

**F-J2 (P3, lệch nhãn) — nút "Mở trang web" mở trang popup, không phải trang web.**
- Nhãn "↗ Mở trang web", tooltip "Mở trang web Saved Items đầy đủ trong tab mới", nhưng đích thật là
  `chrome-extension://<id>/popup/index.html` (khớp `sidepanel.js:2790-2795`), không phải
  `localhost:3000`. Hành vi không sai so với mã, nhưng nhãn gây hiểu là mở ứng dụng web đầy đủ.
- Đề nghị: sửa nhãn/tooltip, hoặc trỏ tới ứng dụng web khi nó đang chạy.

**F-J3 (ghi nhận, không phải lỗi sản phẩm) — `confirm()` gốc không dùng được trong Chrome headless.**
Nút xóa câu dùng `confirm()`; Chrome for Testing headless tự bỏ hộp thoại nên lần đầu không xóa.
Đã thay `window.confirm` **trên trang khung** để bấm được nút thật; không sửa logic sản phẩm. Trên
Chrome thường của người dùng, hộp thoại hiện bình thường.

**F-J4 (P2, lệch tài liệu) — `TEST_PLAN_MATRIX.md` Flow 4 mô tả sai đường đồng bộ.**
Tài liệu nói `service_worker.js` "định kỳ gửi dữ liệu tới local-bridge qua endpoint `POST /saved/sync`".
Thực tế: extension dùng `POST /extension_state` (ảnh chụp JSON), và **không** gọi `/saved/sync`; bảng
SQLite `/saved/items` trống. Cần sửa tài liệu hoặc nối đường đồng bộ còn thiếu.

## Chưa kiểm tra được

1. **Độ chính xác nội dung ASR** — luồng giao diện (nhận/bỏ/hoàn tác) đã PASS ở lượt 4, nhưng câu
   nghe được có đúng tiếng trong video hay không thì cần người nghe đối chiếu; máy không tự chấm được.
2. **Nhóm J-5 (`/saved/sync` hai chiều, tombstone, Last-Write-Wins)** — extension không có đường gọi
   endpoint này, nên không có gì để kiểm từ phía extension.
3. **Ca Gemini 429/quota (K-5)** và **lát cắt im lặng (K-6)** — không điều khiển được quota, không tạo
   được im lặng có kiểm soát trong lượt này.
4. **Đồng bộ Drive và đổi tài khoản** — cần một lần bấm đồng ý tài khoản của người dùng; không tự bấm thay.
5. **Trang web Saved Items ở cổng 3000** — không chạy trong môi trường này (`http://localhost:3000`
   không phản hồi), nên chỉ kiểm được phía extension + máy chủ cục bộ.

## Giới hạn bề mặt

1. Khung là **tab thường**, không phải lớp side-panel của Chrome (giống các lượt khác).
2. Chrome for Testing headless: `confirm()` tự bỏ, `tabCapture` bị chặn → ảnh hưởng D-5 (phải can
   thiệp). D-6/lượt 4 sau đó đã chạy lại được trên trình duyệt DSH không headless (xem "Lượt 4").
3. Bấm trong khung dùng `element.click()` trên phần tử thật (listener delegated chạy, có vòng
   `SP_CMD` thật tới content script và ghi kho thật). Việc bấm **thẻ** bằng chuột thật
   (`isTrusted=true`) đã được tổ `sp-ui-modes` xác minh riêng ở lượt A.
4. Mỗi tổ cài extension từ thư mục tạm nên `chrome.runtime.id` khác nhau giữa các tổ; cùng bộ mã,
   cùng HEAD. Lượt J này chạy trên id thật của repo `oiocgalcdfmkbcikemohekbjjmlbpoll`.
