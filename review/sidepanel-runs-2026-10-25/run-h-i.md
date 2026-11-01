<!-- date: 2026-10-25 -->
<!-- source: goal:execute sidepanel test plan · group H-I -->

# Run H–I — khung hẹp, bàn phím, màu trình độ, furigana, bảng nhỏ

Tổ `sp-layout-visual`. Bề mặt: **DSH Browser** (Chrome for Testing 1248, headless), trang khung là **tab thường** chứ không phải lớp side-panel của Chrome. Không dùng bsk, không đụng Chrome cá nhân.

- `git rev-parse --short HEAD` = `43399f3`; cây làm việc bẩn (`extension/sidepanel/sidepanel.html` đã sửa, 2 cầu nối thử + 1 script chưa vào kho) — bản đo là **bản chép từ cây đang bẩn này**.
- Extension trong trình duyệt của tổ: **`chrome.runtime.id` = `lcgnommhpcehndogddelgblaapbfcfjm`** (xem mục "Giới hạn bề mặt" để hiểu vì sao khác `oiocgalcdfmkbcikemohekbjjmlbpoll`).
- CDP port lúc đo: **52125**. Sau khi đo xong trình duyệt tự khởi động lại: pid 77918, port **54669**, extension tạm bị mất.
- Dữ liệu thật: video `66E0wpL6O9Q`, 38 dòng câu trong khung, JA + furigana + VI/EN.

## Bảng kết quả

| Mã | Nhóm | Kỳ vọng | Đo được | Kết luận |
|----|------|---------|---------|----------|
| H-1 | H khung hẹp | Ở 280px không tràn ngang | `documentElement.scrollWidth` 280 = `clientWidth` 280 → tràn 0; body 0; `#sp-list` 265/265 → 0; `rowOverflowMax` 0; `winScrollX` 0 | PASS |
| H-2 | H khung hẹp | Ở 360px không tràn ngang | scrollWidth 360 = clientWidth 360 → tràn 0; list 345/345 → 0 | PASS |
| H-3 | H khung hẹp | Ở 520px không tràn ngang | scrollWidth 520 = clientWidth 520 → tràn 0 | PASS |
| H-4 | H khung hẹp | Header/footer co giãn, nút chân khung không rớt dòng lộn xộn | 280: header 89px, footer 62.78px, toolbar 53.78px, chân khung **2 hàng** (5 nút + `⋯`,`⚙`); 360: header 75px, footer 36.59px, **1 hàng 7 nút**; 520: header 77.19px, footer 38.59px, **1 hàng 7 nút** | PASS |
| H-5 | H khung hẹp | Không có nút chồng nhau | So từng cặp `getBoundingClientRect()` trong `.sp-footer` (7 nút hiện), `#sp-sub-visibility` (6 nút), `.sp-header-actions` (3 nút): **0 cặp chồng** ở cả 280/360/520 | PASS |
| H-6 | H khung hẹp | 280px chuyển sang bản rút gọn | 280: `#sp-caption-mode` = `Enh` (compact bật, full tắt), `#sp-audio-mode` = `🎧` (mini bật); 360: `Enh` + `Audio`; 520: `Enhanced · thử nghiệm` + `Nghe audio (thử nghiệm)`, badge `(thử nghiệm)` hiện | PASS |
| H-7 | H khung hẹp | Không nút nào bị cắt mép | 0/16 nút bị `leftOff`/`rightOff`, `offBy` 0 ở cả 3 chiều rộng (kể cả `✕` tại right 272/280) | PASS |
| H-8 | H bàn phím | Tab đi đúng thứ tự, focus thấy rõ | **13 lần Tab thật** (công cụ chặn gọi lặp nên không đủ 30) đi đúng thứ tự: Subtitles→Words→Saved→⚙→↗→✕→caption-mode→audio-mode→JA→VI→EN→Furi→nút ▶ dòng 1; mọi bước có `outline: 3px auto`, 2 bước có thêm `box-shadow`. Bù lại: đi bộ **toàn bộ 361 phần tử focusable** bằng `focus()` — 361/361 nhận focus, **0 phần tử thiếu dấu hiệu focus** | PASS (giới hạn: chỉ 13 Tab thật) |
| H-9 | H bàn phím | Enter/Space kích hoạt được nút bật tắt | Space trên `#sp-toggle-vi`: `active` true→false, `#sp-list` nhận `hide-vi`, `.sp-vi` đầu tiên 289×78.4 → **0×0** (`display:none`); Space lần 2: về true, VI hiện lại | PASS |
| H-10 | H bàn phím | Enter mở/đóng được menu `⋯` | Enter trên `summary`: `details.open` false→true, popover 190×399.6 tại l=135.2, t=361.8, **nằm trong** 360×800, 9 mục hiện; Enter lần 2: open→false | PASS |
| H-11 | H bàn phím | **Escape đóng menu `⋯`** | Sau `Escape`: `details.open` **vẫn `true`**, popover **vẫn render** (ảnh `shot-menu-after-escape.jpg`), focus vẫn ở `SUMMARY` | **FAIL** |
| H-12 | H khung hẹp | Trả viewport, trả trạng thái | `innerWidth` 1200, `innerHeight` 692 (đúng yêu cầu); sau khi chỉnh lại: JA/VI/EN/Furi **4/4 active**, `#sp-list` không còn class `hide-*`, menu đóng, popover ẩn, 38 dòng — giữ ổn định qua 4 mốc 0/200/500/1000/2000ms | PASS |
| I-1 | I màu trình độ | Màu từ đúng bảng `vocab_style.js` | Biến CSS khớp tuyệt đối: `--jlpt-n5 #7fd6a8`, `n4 #8fd3ff`, `n3 #f5d76e`, `n2 #e08a4a`, `n1 #e74c5c`, `unknown #94a3b8`. Token đo được: **n5 166/166** màu `rgb(127,214,168)`, **n4 30/30** `rgb(143,211,255)`, **n3 54/54** `rgb(245,215,110)`, **n2 11/11** `rgb(224,138,74)`, **n1 23/23** `rgb(231,76,92)` — không lệch một phần tử | PASS |
| I-2 | I màu trình độ | Màu cấp `unknown` = `#94a3b8` | Trong 38 dòng phụ đề: **0 phần tử** có class `jlpt-unknown` → cấp này không được dữ liệu kích hoạt | NOT TESTED |
| I-3 | I màu trình độ | Từ không rõ trình độ không bị tô bừa | 333 token không có class `jlpt-*` — **toàn bộ** `rgb(245,245,247)` = `var(--ja)` (màu chữ mặc định), không có màu lạ nào | PASS |
| I-4 | I furigana | Furigana hiện thật, không bị cắt | 145 `<ruby>` / 145 `<rt>`; **145/145 rt cao 12px > 0**, `rtZeroCount` 0, font 10px, `ruby-position: over`; mẫu あす/じょうくう/かえ/き; 128 ruby mang class cấp độ | PASS |
| I-5 | I bảng nhỏ | Bảng cao tối đa 280px, có thanh cuộn riêng | Popover nằm **trong khung** (`#sp-play-cue-popover`, `position: fixed`, `z-index: 10000`): `max-height: 280px`, `overflow-y: auto`. Nội dung tự nhiên cao 203.8px (chưa cần cuộn); ép nội dung dài: cao **279.6px**, `scrollHeight` 976 > `clientHeight` 278 → **cuộn được**; trả lại nội dung gốc về 203.8px | PASS (phần vượt 280px chỉ đo bằng nội dung ép) |
| I-6 | I bảng nhỏ | Tự chọn trên/dưới, không tràn mép | Dòng đang thấy: nút ▶ ở t=96–120 → bảng đặt **dưới** (t 126.7–301.9), `insideViewport: true`. Dòng sát đáy: nút ở t=710.4–734.4 → bảng **lật lên trên** (t 498–702.3), vẫn trong vùng nhìn | PASS |
| I-7 | I bảng nhỏ | Giữ bảng khi rê chuột (180ms) | Rời nút: bảng còn tới mốc đo **194ms** rồi ẩn (mẫu 20ms: 170ms còn, 194ms mất). Đưa chuột vào bảng trong 40ms: sau **300ms vẫn còn**; rời bảng: ẩn ở **210ms** | PASS |
| I-8 | I từ điển | Bấm từ có hiện nghĩa | Trong khung `#sp-dict` **hidden, 0×0** (đúng như HTML ghi "unused"); sau khi bấm token trong khung, từ điển hiện **trên trang video**: `#hardsub-ocr-dict` 380×322.1, `hidden:false`, nội dung `明日 [あした] Minh Nhật N5 … ngày mai … tomorrow` | PASS (nghĩa hiện ở trang video, không phải trong khung) |

## Trả lời 3 điểm Lead nêu

**(a) Nút 30.89×18px ở 280px — thu gọn hợp lý hay lỗi cỡ bấm?**
Cả hai mặt, tách rõ:
- Về **bố cục (nhóm H)**: đây là thu gọn **có chủ đích và chạy đúng**. `sidepanel.css` có `@container (max-width: 380px)` đổi nhãn sang bản ngắn và `@container (max-width: 310px)` đổi `Audio` → `🎧`; đo thực tế đúng như thiết kế: 280 → `Enh` + `🎧`, 360 → `Enh` + `Audio`, 520 → nhãn đầy đủ. Không có nút chồng, không cắt mép, không tràn ngang. Header 89px và chân khung 2 hàng là **hệ quả của việc xuống dòng**, không phải lỗi.
- Về **cỡ bấm (ngoài tiêu chí nhóm H, ghi nhận riêng)**: chiều cao 18px (280) và 19–21px (360/520) **nhỏ hơn ngưỡng 24×24px của WCAG 2.5.8 (AA)**. Với panel hẹp, người dùng chuột dễ bấm nhầm. Đề nghị: đặt `min-height: 24px` cho `.sp-sub-btn` (và cân nhắc 44px nếu coi là bề mặt cảm ứng). Tôi **không** tính đây là FAIL của nhóm H vì tiêu chí nhóm H là bố cục/không chồng/không tràn.

**(b) `outOfViewport: true` — bảng có bị đặt sai ra ngoài không?**
**Không phải lỗi.** Lần đo đầu tôi chọn dòng **dài nhất** (212 ký tự) mà dòng đó đang nằm **dưới đáy vùng nhìn**: nút ▶ của nó ở t≈1110 trong khi viewport cao 800 → bảng đặt dưới nút nên ra ngoài (t 1118.9). Không người dùng thật nào rê chuột vào nút đang nằm ngoài màn hình. Đo lại đúng cách: dòng đang thấy → bảng trong vùng nhìn, đặt dưới; dòng sát đáy → **lật lên trên** và vẫn trong vùng nhìn. Tôi ghi nhận đây là **giới hạn của phép đo**, đã sửa bằng phép đo lại, không phải khiếm khuyết sản phẩm.

**(c) `unknown` = 0 và 333 token `rgb(245,245,247)` — kết luận "không tô màu bừa" có đúng?**
**Đúng, nhưng phải nói hẹp lại cho chính xác:** kết luận chỉ là *"không có cơ chế tô màu tràn cho token không rõ cấp"*. 333 token không mang class `jlpt-*` đều rơi về màu chữ mặc định `var(--ja)` = `rgb(245,245,247)`, không màu lạ → **không tô bừa**. Nhưng **không** kết luận được rằng "cấp unknown hiển thị đúng `#94a3b8`", vì dữ liệu video này **không sinh ra phần tử `jlpt-unknown` nào** (0 phần tử) → dòng I-2 để **NOT TESTED**. Muốn đóng mục này cần một video/từ có `jlpt` không xác định (hoặc tab "Words").

## Lỗi phát hiện

**F-1 (mức vừa, FAIL H-11) — Escape không đóng menu `⋯`.**
- Triệu chứng: mở menu dữ liệu (`Import / Export / Drive / Sao lưu / Khôi phục / Xoá bản dịch / Xoá toàn bộ sub`) bằng bàn phím (Enter trên `summary`) → menu mở (9 mục); bấm **Escape** → `details.open` vẫn `true`, popover vẫn render, focus vẫn ở `summary`.
- Cách làm lại: Tab tới nút `⋯` cuối khung → Enter (mở, đo `open=true`) → Escape → đọc `#sp-footer-more.open`.
- Kỳ vọng (theo yêu cầu kiểm thử): Escape đóng menu. Thực tế: **không đóng**.
- Nguyên nhân: menu là `<details>` thuần, `sidepanel.js` **không có** handler Escape nào cho menu này (chỉ có handler cho popover phát lại và các ô sửa). Người dùng bàn phím muốn thoát phải biết bấm Enter lần nữa hoặc bấm lại `summary`.
- Ảnh hưởng: menu chứa 2 hành động phá dữ liệu; không thoát được bằng phím quen thuộc dễ dẫn tới bấm nhầm.
- Đề nghị: thêm handler `keydown` Escape (đóng `details.open = false`, trả focus về `summary`) — hoặc chuyển menu sang `popover` API để có Escape/click-ngoài miễn phí.

**F-2 (mức nhẹ, a11y) — vùng bấm nút bật tắt quá thấp.** Cao 18px ở 280, 19–21px ở 360/520 (< 24px WCAG 2.5.8 AA). Số đo ở bảng H-4/H-6. Không ảnh hưởng bố cục.

**F-3 (quan sát, chưa kết luận) — trạng thái bật/tắt tự lệch trong lúc kiểm.** Giữa phiên, `#sp-toggle-vi` và `#sp-toggle-en` bị tắt dù tôi chỉ bấm Space 1 lần cho VI; đọc trạng thái ngay sau đó cho kết quả dao động (vi=false/en=false → vi=true/en=false → en=true/vi=false). Sau khi dừng thao tác và chờ, trạng thái ổn định và tôi đã bật lại đủ 4/4 (ổn định qua 2s, bảng H-12). Chưa xác định được nguyên nhân (có thể do đồng bộ `SP_STATE` từ content đè lên state cục bộ). **Chuyển cho tổ nhóm C** kiểm tra riêng; tôi không kết luận PASS/FAIL cho hiện tượng này.

**F-4 (quan sát) — thứ tự Tab rất dài.** 38 câu → **361 điểm dừng Tab** (mỗi dòng ~9 điểm: `sp-ja-wrap`, ▶, ☆, 2 ô thời gian, Sửa, ↶, 📋, `⋮`). Mọi điểm đều có dấu hiệu focus, nhưng người dùng bàn phím phải Tab 361 lần mới tới chân khung. Không phải lỗi chức năng; ghi nhận cho quyết định thiết kế a11y (ví dụ: cho `sp-ja-wrap` không nằm trong tab order mặc định).

## Chưa kiểm tra được

1. **30 lần Tab liên tiếp** — công cụ chặn gọi `press_key` lặp y hệt (báo "repeated tool call"). Đã làm **13 Tab thật** (đúng thứ tự) + đi bộ toàn bộ **361 phần tử focusable** bằng `focus()` để bù. Phần "Tab thật đủ 30" để NOT TESTED.
2. **Màu cấp `unknown`** (I-2): dữ liệu 38 dòng không có phần tử `jlpt-unknown`. Tôi định kiểm chéo ở tab "Words" nhưng **trình duyệt DSH tự khởi động lại** giữa lúc đó (pid 77918, port 54669) và mất extension tạm đã cài → không mở lại kịp.
3. **Bề mặt side-panel thật của Chrome**: tôi đo trên tab thường; xem "Giới hạn bề mặt".
4. **Rê chuột thật**: dùng `MouseEvent` tổng hợp (xem giới hạn bên dưới).

## Giới hạn bề mặt (ảnh hưởng tới kết luận nào)

1. **Không phải lớp side-panel Chrome:** khung là một tab thường, chiều rộng = chiều rộng viewport tôi ép. Vì vậy **280px có thể không đạt được** trong side panel thật (Chrome có bề rộng tối thiểu; lần smoke 2026-10-24 đo panel thật = 360px). Ảnh hưởng: H-1 (280px) chứng minh **layout chịu được 280px nếu bị ép**, không chứng minh rằng Chrome cho phép kéo xuống 280px.
2. **Extension ID khác:** gate của máy chủ trình duyệt cho tổ con chạy **headless và không kèm `--load-extension`**, nên extension của repo không tự nạp. Tôi phải chép `extension/` vào thư mục tạm và `install_extension`. Manifest **không có `key`** → Chrome suy ID từ **đường dẫn tuyệt đối**, nên ID thành **`lcgnommhpcehndogddelgblaapbfcfjm`**, khác ID repo `oiocgalcdfmkbcikemohekbjjmlbpoll` (và khác `aphgfdmgjlkkpalcnlaikcodojnejknd` của Lead — mỗi thư mục tạm cho một ID). Ảnh hưởng: mọi URL `chrome-extension://` trong bằng chứng dùng ID của tôi; **không ảnh hưởng** kết quả đo DOM/CSS vì cùng một bộ mã nguồn.
3. **Bản chép từ cây đang bẩn:** bản cài là snapshot `extension/` tại thời điểm đo (HEAD `43399f3` + `sidepanel.html` đã sửa + 2 cầu nối thử). Không phải bản phát hành.
4. **Headless:** không có cửa sổ thật; ảnh là chụp viewport. Không đánh giá được cảm giác cuộn/mượt bằng mắt thật.
5. **Sự kiện chuột tổng hợp:** `mcp__dsh-browser__hover` cần `uid` từ `take_snapshot` (cây 38 dòng quá lớn), nên phần giữ bảng dùng `dispatchEvent(new MouseEvent(...))` trên đúng phần tử → chạy đúng listener thật và đo DOM/CSS/thời gian thật, nhưng **bỏ qua hit-testing của trình duyệt**. Vì vậy "rê chuột qua khoảng trống" được mô phỏng bằng `mouseout` rồi `mouseenter` vào bảng, không phải đường đi pixel thật.
6. **Trạng thái dữ liệu:** khung nhận `SP_STATE` từ tab video của tôi; VI/EN chuyển ngữ ở vài dòng vẫn ở trạng thái "chờ dịch câu" nên phần chữ Việt/Anh trong bảng nhỏ chỉ là bản dịch sẵn có.

## Bằng chứng

Ảnh (6): `evidence/hi/shot-w280.jpg`, `shot-w360.jpg`, `shot-w520.jpg`, `shot-menu-after-escape.jpg`, `shot-popover.jpg`, `shot-focus-reload.jpg`.

Số đo thô (JSON):
- `evidence/hi/h-w280.json`, `h-w360.json`, `h-w520.json` — innerWidth/Height, `scrollWidth`/`clientWidth`, tràn ngang, header/footer/toolbar, danh sách nút + toạ độ + cờ cắt mép, danh sách cặp chồng, nhãn compact, badge.
- `evidence/hi/h-w280-scroll.json` — tràn ngang của document/body/`#sp-list` và từng dòng ở 280px.
- `evidence/hi/h-tab-focus.json` — 13 bước Tab thật (thứ tự, id, nhãn, outline, box-shadow).
- `evidence/hi/h-focuswalk.json` — 361 phần tử focusable: nhận focus, dấu hiệu focus trước/sau, toạ độ.
- `evidence/hi/h-restore.json`, `h-restore-final.json`, `h-restore-final2.json` — khôi phục viewport 1200×692 và trạng thái 4/4 toggle (ổn định 2s).
- `evidence/hi/i-colors.json` — biến `--jlpt-*`, số lượng + màu từng cấp, token không tô màu, số ruby/rt + chiều cao.
- `evidence/hi/i-popover.json` — max-height/overflow/scrollHeight, thời điểm ẩn sau `mouseout` (194ms), giữ khi vào bảng (300ms), ẩn sau `mouseleave` (210ms).
- `evidence/hi/i-dict-page.json` — từ điển hiện trên trang video (`#hardsub-ocr-dict` 380×322.1).

## Tự đánh giá

- Đo bằng DOM/CSS/time thật, không đọc chuỗi mã nguồn để kết luận. Mã nguồn chỉ dùng để biết **cần đo cái gì** (tên popover, nơi gắn listener, breakpoint media/container).
- Không mục nào ghi PASS mà thiếu số đo hoặc ảnh tương ứng; phần không đo được đã ghi NOT TESTED kèm lý do.
- Một kiểm tra bị bỏ dở (tab "Words" cho cấp `unknown`) do trình duyệt khởi động lại — ghi đúng là bỏ dở, không thay bằng suy đoán.
