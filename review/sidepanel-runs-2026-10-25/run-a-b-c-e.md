<!-- date: 2026-10-25 -->
<!-- source: goal:execute sidepanel test plan · group A + B + C + E -->

# Run A+B+C+E — ba thẻ, nút chọn kiểu hiện, bật tắt dòng chữ, chân khung

**Bề mặt:** khung thật `chrome-extension://aphgfdmgjlkkpalcnlaikcodojnejknd/sidepanel/sidepanel.html` mở như **một tab** trong **DSH Browser** (Chrome for Testing, headless, profile tạm riêng của tổ), extension v0.11.3, `update_url = null`.
**Cách bấm:** click chuột thật qua CDP (`event.isTrusted === true`), không dùng `.click()` trong JS.
**Cách đo:** `getComputedStyle`, `getBoundingClientRect`, `dataset`, `aria-pressed`, `chrome.storage.local`, `MutationObserver` + `performance.now()` cho thời gian chuyển thẻ, `chrome.downloads` cho tệp xuất ra.
**Thời điểm:** 2026-10-25 18:11–18:41 JST. **Video:** `66E0wpL6O9Q` (50 cue, 38 dòng khung, có JA + furigana + VI/EN).

## Bảng kết quả

| Mã | Nhóm | Kỳ vọng | Đo được | Kết luận |
|----|------|---------|---------|----------|
| A1 | A — thẻ Words | Bấm thật vào tab Words; chỉ Words `.active`; `#sp-view-words` hiện; có số từ + danh sách | Click `isTrusted=true`; active duy nhất = `words`; display `words:flex`, hai view kia `none`; `#sp-words-count` = `184 từ`; 12 nhóm rank | PASS |
| A2 | A — thẻ Saved | Chỉ Saved `.active`; `#sp-view-saved` hiện; danh sách đã lưu đúng trạng thái | Active duy nhất = `saved`; `saved:flex`; danh sách rỗng kèm đúng câu “Chưa có từ hoặc câu nào được đánh dấu sao lưu trữ.”; đủ 5 nút thao tác (Mở trang web / View All / Practice / Export Anki / Show context) | PASS |
| A3 | A — về lại Subtitles + giữ cuộn | Về tab câu; giữ đúng vị trí cuộn đã đặt; thời gian chuyển nhanh | Đặt `#sp-list.scrollTop = 1500` trước khi rời; sau khi quay lại đọc được **1500** (khớp tuyệt đối); 38 dòng câu; display `subtitles:flex` | PASS |
| A4 | A — thời gian chuyển thẻ | Dưới 50 ms mỗi lần | Words→ **10.9 ms**; Saved→ **9.7 ms**; về Subtitles **3.7 ms** (đo bằng `performance.now()` trong trang, mốc click thật) | PASS |
| B1 | B — Original ↔ Enhanced | Enhanced nền `rgb(16,185,129)` = #10b981; Original nền `rgb(30,30,45)`; `dataset.mode`, `aria-pressed`, chữ đổi theo | Enhanced: `mode=enhanced`, `cls=sp-sub-btn enhanced`, `aria-pressed=true`, **bg `rgb(16, 185, 129)`**, chữ “Enhanced · thử nghiệm”, 38 dòng. Bấm → Original: `mode=original`, `cls=sp-sub-btn original`, `aria-pressed=false`, bg `rgb(30, 30, 45)`, chữ “Original”, **50 dòng** (cue nguồn). Bấm lại → về Enhanced đúng như đầu | PASS |
| B2 | B — nút Enhanced có bị disabled? | Ghi rõ nếu bị | Trong suốt lượt đo `disabled=false` (ba lần đọc) → không rơi vào ca NOT TESTED | PASS (đo được) |
| B3 | B — nút Nghe audio | Bật thì nền `rgb(2,132,199)` = #0284c7, `aria-pressed=true`, chữ đổi | **Không vào được trạng thái bật.** Hai lần thử (lần 2 đã ép tab video thành tab active) đều giữ `mode=idle`, `cls=sp-sub-btn`, `aria-pressed=false`, nền `rgb(47,47,68)`. Toast: “Không thể bật nghe audio: Extension has not been invoked for the current page (see activeTab permission). Chrome pages cannot be captured.” | NOT TESTED |
| C1 | C — JA tắt/bật | `#sp-list` có `hide-ja`; dòng JA ẩn thật; bật lại nền tím `rgb(123,92,255)` | Tắt: class `hide-ja`, nút `active=false`, nền `rgb(47,47,68)`, `.sp-ja-wrap` `display:none` (h=0). Bật lại: hết `hide-ja`, nút active, nền **`rgb(123, 92, 255)`**, dòng JA `display:block` cao 64 px | PASS |
| C2 | C — VI + EN cùng tắt | Hai class `hide-vi`, `hide-en`; hai dòng ẩn; nút hết active | Đo được `["sp-list","hide-vi","hide-en"]`; `.sp-vi` và `.sp-en` `display:none` (h=0); JA vẫn hiện cao 64 px; ảnh `04-toggles-vi-en-off.jpg` | PASS |
| C3 | C — Furi | `hide-furi`; toàn bộ `rt` ẩn; chiều cao dòng Nhật giảm thật | Class `hide-furi`; 4/4 `rt` `display:none`; dòng JA **từ 64 px xuống 30 px** → furigana bị ẩn thật (số đo pixel) | PASS |
| C4 | C — nhớ lựa chọn | Sau khi reload trang khung, trạng thái tắt/bật còn đúng | Tắt VI → `chrome.storage.local.hardsubSettings.sidepanelShowVi=false`; reload trang: vẫn `hide-vi`, nút VI không active, dòng VI `display:none`, 38 dòng; **sau khi browser khởi động lại** khung đọc lại từ storage vẫn VI tắt, ba nút kia bật | PASS |
| C5 | C — trả lại trạng thái ban đầu | Cả bốn nút bật lại, không còn class hide | `#sp-list` chỉ còn `sp-list`; bốn nút `active=true`, nền đều **`rgb(123, 92, 255)`**; storage `{ja:true, vi:true, en:true, furi:true}` | PASS |
| E1 | E — `#sp-overlay` | Bấm đổi trạng thái nút và ghi nhớ lựa chọn | Bật: `cls=sp-footer-btn active`, nền `rgb(67, 33, 104)`, `showOnVideo=true`. Tắt: bỏ `active`, nền `rgb(56, 39, 84)`, `showOnVideo=false` | PASS (trạng thái nút) |
| E2 | E — thanh overlay vẽ trên video | Bật overlay thì thanh phụ đề hiện trên trang video | **Không đo được trong instance này:** `<video>.readyState = 0`, `currentTime = 0` (media không tải/không tiến), `#hardsub-ocr-bar` vẫn `hidden`, kích thước 0×0. Ghi chú: ở instance trước khi browser restart (18:17) thanh overlay **có** vẽ thật: `t=20.3s`, có furigana `rt`, 26 phần tử `rt` | NOT TESTED |
| E3 | E — nút `#sp-follow` | Bấm tắt: chữ và trạng thái đổi; bấm lại: về như cũ | Tắt: `cls=sp-footer-btn sp-follow`, chữ **“⏸ Cuộn”**, `title` = “Tự động cuộn đang tắt…”, nền `rgb(44, 44, 61)`. Bật lại: `active`, chữ **“▶ Cuộn”**, `title` = “Đang tự động cuộn…”, nền `rgb(27, 71, 46)` | PASS |
| E4 | E — menu `⋯` (`#sp-footer-more`) | Mở được, đếm đủ mục | `details.open = true`; đếm **9 mục**: Nhập bản dịch, Xuất script TXT, Đồng bộ Drive, Sao lưu JSON, Xuất số đo, Khôi phục JSON, Quay lại trước khôi phục, Xóa bản dịch VI/EN, Xóa toàn bộ sub & tải lại | PASS |
| E5 | E — menu có tràn khỏi khung nhìn? | Không tràn | Popover `x=525, y=-26, w=190, h=400`, viewport `756×413` → **tràn mép trên 26 px**; ảnh cho thấy mục “Nhập bản dịch (Import)” bị cắt. Không tràn phải/trái/dưới | FAIL |
| E6 | E — đóng menu bằng Escape | Escape đóng menu | Bấm Escape: `details.open` vẫn `true`, popover vẫn `display:flex` → **không đóng**. Bấm lại `⋯` bằng chuột thì đóng (`open=false`) | FAIL |
| E7 | E — xuất bản chữ (mục an toàn) | Bấm “Xuất script (Export TXT)” tải được tệp đúng nội dung | Tải xong `yt-caption-66E0wpL6O9Q.txt`, **20 876 byte, 393 dòng**, đầu tệp có `URL:` đúng video + `Exported: 2026-10-25 09:36`, cuối tệp có `# ---`. Bản sao lưu bằng chứng: `export-txt-sample.txt` | PASS |
| E8 | E — `#sp-reload` | Bấm tải lại thì nạp lại caption và báo kết quả | Toast **“Đã tải 50 câu”**; sau đó 38 dòng; status `YT · page_multi_android · en:38 vi:46 · 50 cues`; vẫn Enhanced xanh | PASS |
| E9 | E — `#sp-pip` | Bật cửa sổ nổi hoặc báo lỗi rõ ràng | Toast: “PiP: Failed to execute 'requestPictureInPicture' on 'HTMLVideoElement': Metadata for the video element are not loaded yet.” — do media chưa có metadata (`readyState 0`), không phải lỗi nút | NOT TESTED |

**Tổng:** 16 PASS · 2 FAIL · 3 NOT TESTED (trên 21 mục đo được).

## Bằng chứng

Ảnh (chụp màn hình thật của tab khung):

- `evidence/abce/01-start-subtitles.jpg` — trạng thái đầu: 3 thẻ, Enhanced xanh, 4 nút tím, câu JA + furigana + VI/EN.
- `evidence/abce/02-words-tab.jpg` — thẻ Words: “184 từ”, 12 nhóm rank.
- `evidence/abce/03-saved-tab.jpg` — thẻ Saved: danh sách rỗng + 5 nút thao tác.
- `evidence/abce/04-toggles-vi-en-off.jpg` — VI và EN tắt: chỉ còn câu Nhật, hai nút VI/EN xám, JA/Furi tím.
- `evidence/abce/05-menu-more-open-clipped-top.jpg` — menu ⋯ mở, mục đầu bị cắt ở mép trên.

JSON số đo thô:

- `evidence/abce/group-a-tabs.json` — thời gian chuyển thẻ, scrollTop trước/sau, số dòng từng thẻ.
- `evidence/abce/group-b-modes.json` — màu/mode/aria-pressed/disabled của nút kiểu hiện; lỗi audio nguyên văn.
- `evidence/abce/group-c-toggles.json` — class hide-*, display từng dòng, màu nút, độ cao dòng Nhật trước/sau khi tắt Furi, lưu/khôi phục lựa chọn.
- `evidence/abce/group-e-footer.json` — follow, overlay, menu (9 mục, toạ độ, tràn 26 px, Escape), reload, PiP, xuất TXT.
- `evidence/abce/export-txt-sample.txt` — bản sao tệp TXT do nút xuất ra (20 876 byte).
- `evidence/abce/surface-manifest.json` — id/version extension, profile, CDP port, dòng thời gian, lý do id khác Lead.

## Lỗi phát hiện

| Mã | Mức | Hiện tượng | Cách làm lại | Kỳ vọng vs thực tế |
|----|-----|-----------|--------------|-------------------|
| SPABCE-1 | P2 | Menu `⋯` mở ra bị tràn mép trên khung nhìn 26 px, mục đầu “Nhập bản dịch (Import)” bị cắt | Mở khung ở viewport 756×413, bấm `⋯` | Kỳ vọng menu nằm trọn trong khung; thực tế `rect.y = -26`, `rect.h = 400` > vùng còn lại phía trên nút (413−y_nút). Cần xác nhận lại ở chiều cao thật của side panel (~700–900 px) trước khi xếp P2; ở viewport nhỏ này là tràn thật |
| SPABCE-2 | P2 | Bấm Escape **không** đóng menu `⋯` | Mở `⋯` rồi bấm Escape | Kỳ vọng menu đóng như mọi popover; thực tế `details.open` vẫn `true`, popover vẫn `display:flex`. Chỉ đóng được bằng cách bấm lại `⋯` |
| SPABCE-3 | P3 (nghi vấn, chưa tái hiện) | Một lần bấm VI ngay sau khi reload trang khung không đổi trạng thái; bấm lần hai mới bật | Reload trang khung, bấm VI một lần, đọc `#sp-list` | Kỳ vọng một lần bấm đổi ngay; thực tế lần đầu không đổi. Các lần sau bấm một phát ăn ngay → cần thêm lượt để kết luận |

## Chưa kiểm tra được (và vì sao)

1. **Audio bật (`#sp-audio-mode`, màu #0284c7) — NOT TESTED.** Chrome từ chối `tabCapture` vì extension chưa được “invoke” trên tab video (bề mặt mở khung bằng URL, không bấm icon extension). Đã thử 2 lần, lần 2 ép tab video thành active, vẫn cùng lỗi. Đây là **giới hạn bề mặt**, không kết luận sản phẩm sai; nhưng câu thông báo lỗi hiện ra rõ ràng, người dùng biết vì sao.
2. **Thanh overlay vẽ trên video — NOT TESTED.** Instance sau khi browser khởi động lại có `video.readyState = 0`, `currentTime = 0` (media không tải), nên thanh không vẽ dù nút đã bật và storage `showOnVideo=true`. Trước restart (18:17) đã đo thanh overlay vẽ thật ở `t=20.3s` với 26 phần tử furigana.
3. **PiP — NOT TESTED.** Cùng nguyên nhân media chưa có metadata; toast lỗi đã ghi nguyên văn.
4. **Menu ở chiều cao side panel thật** chưa đo (chỉ đo ở tab 756×413). Toàn bộ số tràn 26 px thuộc viewport nhỏ này.

## Giới hạn bề mặt

- Khung được mở như **một tab** của DSH Browser, **không phải** lớp side-panel thật của Chrome. Hệ quả đo được: khi tab khung là tab đang active, `chrome.tabs.query({active:true})` trả về chính tab khung → lần mở đầu khung có thể **0 dòng** dù video đã có 50 cue (lúc đó khung hiện “Chưa có caption … Bấm Reload để tải lại”). Tôi phải gọi lại `SP_CMD get_state` một lần (đúng luồng “mở lại khung” của sản phẩm) thì khung nhận đủ 38 dòng. Việc này **không** được tính là lỗi sản phẩm vì ở side panel thật khung không chiếm tab active.
- Extension trong trình duyệt của tổ có id **`aphgfdmgjlkkpalcnlaikcodojnejknd`**, khác id của Lead (`oiocgalcdfmkbcikemohekbjjmlbpoll`): DSH Browser ở vai **subagent** spawn Chrome headless và **không nạp extension lúc khởi động** (`dsh-browser/src/gate/launch-args.ts`: nhánh `role === 'subagent'` bỏ `--load-extension`). Tôi cài bằng tool `install_extension` từ **bản copy** của `extension/` sang thư mục tạm; Chrome tính id theo đường dẫn nên id đổi. Mã nguồn giống hệt bản trong kho (v0.11.3, `update_url=null`).
- CDP port: instance đầu **52065**, sau khi browser khởi động lại **54641** (profile `/Users/hoangson/.dsh/browser/profiles/tmp/363d538e-e0b7-4ed8-92e9-3d90a1878bfd`).
- Browser **bị khởi động lại giữa lượt chạy** (pid 69856 → 77797); sau đó extension cài runtime biến mất và phải cài lại. Nhóm A, B, C đo trước restart; nhóm E đo sau restart. Không có số liệu nào bị trộn giữa hai instance vì mỗi mục đều ghi thời điểm và trạng thái bề mặt.

## Trạng thái trả lại sau test

`#sp-list` không còn class `hide-*`; JA/VI/EN/Furi đều bật, nền tím `rgb(123,92,255)`; storage `{ja:true, vi:true, en:true, furi:true}`; `#sp-follow` bật (“▶ Cuộn”); `#sp-overlay` tắt (`showOnVideo=false`); menu `⋯` đã đóng; kiểu hiện giữ **Enhanced** như lúc nhận bàn giao; thẻ đang mở: **Subtitles**. Tệp TXT tải về đã copy vào evidence rồi **xóa khỏi** `/Users/hoangson/Downloads/DSH-download/`.
