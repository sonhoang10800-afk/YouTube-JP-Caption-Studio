<!-- date: 2026-10-25 -->
<!-- source: chat · user: "Viết plan test toàn diện side-panel." -->

# Kế hoạch kiểm tra đầy đủ khung bên phải (side-panel) — 2026-10-25

## 1. Mục đích và điều kiện xong

**Mục đích:** kiểm tra đầy đủ khung bên phải của phần mở rộng trên trình duyệt thật, gồm cả ba thẻ, hàng nút chọn kiểu hiện, hàng nút bật tắt dòng chữ, từng dòng câu, chân khung, chỗ nhập xuất sao lưu, chỗ lưu từ và câu, màu chữ theo trình độ, chữ nhỏ trên đầu chữ Nhật, bảng nhỏ khi câu dài, việc giữ bảng khi đưa chuột.

**Xong khi:**
- Mọi nhóm dưới đây đều có kết quả đúng hoặc sai kèm bằng chứng đo thật, không đoán.
- Mỗi bước quan trọng có ảnh chụp màn hình, luồng chính có đoạn phim quay màn hình.
- Mọi lỗi tìm được đều ghi rõ cách làm lại, kết quả thấy được, ảnh hoặc số đo.
- Báo cáo cuối ghi rõ phần nào chưa kiểm tra được và vì sao.

**Lựa chọn của bạn đã chốt trong lượt hỏi:** kiểm tra hết mọi thứ; thiếu thời gian thì chia ra làm nhiều lần. Vì vậy bản này chia làm 4 lượt chạy, lượt nào cũng có bằng chứng riêng. Các mục bạn chọn: cả 6 nhóm giao diện (ba thẻ, nút chọn kiểu hiện, nút bật tắt dòng chữ, từng dòng câu, chân khung, nhập xuất sao lưu), cả 4 loại phim (ngắn ít câu, dài trên 500 câu, không có lời thoại sẵn, nói khác chữ hiện sẵn và nhiều tiếng ồn), cả 3 tình huống màn hình (kéo hẹp, chữ to nhỏ, bấm chuyển và tua nhanh), nhóm sự cố (phim mới mà còn lời phim cũ; câu nghe được khác hẳn và giống hệt câu gốc), bằng chứng (ảnh chụp, phim quay màn hình, máy tự đo), cả 4 mức lưu giữ (ngôi sao, lưu khi mất mạng, nhập xuất sao lưu, gửi lên chỗ lưu trên mạng và đổi tài khoản), và cả 3 mục màu chữ theo trình độ, bảng nhỏ câu dài, giữ bảng khi đưa chuột.

## 2. Nền đã có, dùng lại không làm mới

- Cấu trúc thật trên đĩa: `extension/sidepanel/sidepanel.html` (174 dòng, 3 thẻ `subtitles words saved`; hàng nút `sp-caption-mode`, `sp-audio-mode`, `sp-toggle-ja/vi/en/furi`; chân khung `sp-add-cue`, `sp-reload`, `sp-overlay`, `sp-pip`, `sp-follow`, menu `sp-footer-more`; bảng nhập `sp-import-panel` và bảng lấy lại `sp-backup-panel`), `extension/sidepanel/sidepanel.js` (2934 dòng, nhận `SP_STATE` và gửi `SP_CMD`), `extension/sidepanel/sidepanel_pure.js` (thứ tự dòng, chữ nghĩa, dấu sao lưu), `extension/sidepanel/sidepanel.css`.
- Tài liệu cũ dùng lại, không viết lại: `docs/test-cases/TC_EXTENSION_SIDEPANEL_UI.md` (11 ca `TC-UI-001` tới `TC-UI-011`), `TEST_PLAN_MATRIX.md` (MOD-11 khung và nút bấm, MOD-12 bảng nhỏ và giữ bảng 180ms, MOD-07 chỗ khác nhau, MOD-08/MOD-09 lưu và đồng bộ, MOD-10 Drive), `plan/extension-ux-verify-bsk-2026-10-24.md` (cách đo và các bẫy môi trường), `review/sidepanel-smoke-2026-10-24.md` (đã mở được khung thật rộng 360px, bấm được hai thẻ qua cầu nối thử; chưa kiểm tra gõ chữ, tìm câu, xóa, cài đặt, chưa đo tương phản hay cỡ bấm).
- Cầu nối thử chỉ dùng khi làm thử: `extension/content/sp_test_bridge.js` + `extension/sidepanel/sp_test_bridge.js`; chỉ chạy khi bản chưa đóng gói, địa chỉ phim có `?sp_test=1`, và có mã ngẫu nhiên trong chỗ lưu cục bộ. Bình thường không chạy. Trước khi phát hành phải gỡ bỏ. Trình điều khiển trình duyệt không nhìn thẳng vào địa chỉ `chrome-extension://`, nên mọi bấm đo trong khung đều đi qua cầu nối này; ảnh nhìn bằng cách chụp cửa sổ từ ngoài, **không phải** ảnh chụp của trình điều khiển (bsk).
- Lệnh khói có sẵn: `scripts/bsk_sidepanel_bridge_smoke.js` (mở một phiên riêng, mở khung thật bằng một lần bấm, bấm thử thẻ `words`/`saved`, đóng khung rồi gọi lại để chắc đã đóng).
- Bản sửa lần trước chưa được ghi vào kho (đang ở trạng thái sửa dở trên đĩa): `extension/sidepanel/sidepanel.html` và hai tệp cầu nối thử mới. Lượt chạy phải ghi lại đúng trạng thái này để kết quả không lẫn với bản cũ.

## 3. Môi trường và dữ liệu phim

- Máy: cùng máy của bạn, cùng hồ sơ trình duyệt đã đăng nhập, **không** mở thêm trình duyệt thứ hai, **không** dùng trình duyệt thử nghiệm khác.
- Phim mẫu:
  - Phim ngắn ít câu: `watch?v=66E0wpL6O9Q` (55 câu, đã dùng trong lần kiểm tra trước).
  - Phim vừa, mã dự phòng: `FfUjmyCeK7s` (152 câu).
  - Phim dài nhiều câu trên 500 câu, nói nhanh: chốt mã trong lượt chạy 1, ưu tiên phim đã có trong `data/subtitles/`, ghi rõ mã phim vào báo cáo để các lượt sau dùng chung.
  - Phim không có sẵn lời thoại (chỉ có tiếng) và phim nhiều tiếng ồn nhiều người nói chồng nhau: chốt mã trong lượt chạy 1; ghi rõ mã phim và mốc thời gian ồn.
- Mạng: kiểm tra cả khi mạng tốt, khi ngắt mạng giữa chừng, khi máy chủ dịch bận, khi máy chủ nhận tiếng trong máy báo bận hoặc báo lỗi.
- Cỡ khung: rộng bình thường 360px, kéo hẹp còn 280px, nới rộng 520px. Chữ cỡ nhỏ nhất và lớn nhất trong phần cài đặt.

## 4. Nhóm kiểm tra chi tiết

### Nhóm A — Ba thẻ trên đầu
- Bấm lần lượt thẻ danh sách câu, thẻ danh sách từ, thẻ danh sách đã lưu, rồi bấm ngược lại.
- Kiểm tra: nội dung từng thẻ hiện đúng; thẻ đang chọn hiện rõ; chuyển thẻ nhanh dưới 50ms; quay lại thẻ câu thì vị trí kéo giữ nguyên; số lượng từ và món đã lưu hiện đúng.
- Trường hợp xấu: mở phim mới nhưng thẻ vẫn hiện lời phim cũ; tải lại mà lời không về; thẻ trắng không có câu.

### Nhóm B — Hàng nút chọn kiểu hiện
- Nút kiểu gốc và kiểu nâng cao: bấm qua lại, xem màu nút đổi ngay, xem lời có đổi theo không, xem ghi chú khi bị hạ từ nâng cao về gốc.
- Nút nghe lại tiếng trong phim: bấm bật, xem nút có đổi màu xanh dương và báo đang nghe không; bấm tắt xem có dừng hẳn không.
- Trường hợp xấu: bấm khi đang sửa câu dở thì phải báo phải bấm Enter hoặc Escape trước, không được mất chữ đang sửa.
- Neo cần đo (đã đọc trên đĩa, chưa đo trên khung thật): `sidepanel.css:490-510` đặt nền xanh lá `#10b981` khi `#sp-caption-mode` mang `data-mode="enhanced"` hoặc lớp `enhanced`, và nền xanh dương `#0284c7` khi `#sp-audio-mode` mang lớp `active` hoặc `data-mode="active"`; `sidepanel.js:1806-1825` mới là chỗ đặt `dataset.mode`, lớp và đổi chữ trên nút; `sidepanel.js:1815` tắt nút kiểu nâng cao khi `enhancementAvailable` sai. Ba mốc này phải được đo thật trên khung, không được suy từ mã nguồn.

### Nhóm C — Hàng nút bật tắt dòng chữ
- Bốn nút tiếng Nhật, tiếng Việt, tiếng Anh, chữ nhỏ trên đầu: tắt từng nút rồi bật lại; dòng tương ứng ẩn hiện ngay trong khung; nút hiện rõ trạng thái đang bật hay tắt.
- Kiểm tra việc nhớ lựa chọn sau khi tắt mở khung, sau khi tải lại phim, sau khi đổi phim.
- Kiểm tra chữ cỡ to nhỏ: mở chữ to nhất và nhỏ nhất, xem chữ Nhật và chữ nhỏ trên đầu không bị vỡ, không bị chồng, không bị tràn hàng.
- Neo cần đo: bốn nút JA/VI/EN/Furi khi bật dùng nền tím `#7b5cff` (`sidepanel.css:483-488`), khác hẳn nền xanh của nút kiểu nâng cao — đo thật để tránh nhầm "nút đổi màu xanh" ở nhóm B với nút bật tắt ở nhóm C.

### Nhóm D — Từng dòng câu
- Mỗi dòng: nút phát lại đúng mốc thời gian; nút nghe lại một câu; nút ngôi sao để lưu và bỏ lưu; nút sửa câu rồi bấm Enter để giữ và Escape để bỏ; nút thêm câu mới tại thời điểm đang xem.
- Câu nghe được khác câu gốc: hiện rõ chỗ thêm màu xanh và chỗ sửa màu đỏ; bấm đồng ý dùng thì câu đổi và đánh dấu đã sửa; bấm bỏ thì về như cũ; dữ liệu gốc không mất.
- Trường hợp biên: hai câu giống hệt từng chữ thì không hiện chỗ khác nhau và ẩn nút gợi ý; hai câu khác nhau hoàn toàn thì hiện cả câu cũ gạch đỏ và câu mới nền xanh; không bị treo.

### Nhóm E — Chân khung
- Nút tải lại lời; nút hiện chữ trên phim; nút cửa sổ nổi; nút tự cuộn theo câu đang nói; nút mở thêm.
- Nút tự cuộn: bật thì khung tự chạy theo câu đang nói; người dùng tự kéo xem câu khác thì dừng bám theo; bấm lại thì về câu đang nói.
- Nút mở thêm: đóng mở êm, các món bên trong bấm được, không bị che.

### Nhóm F — Nhập xuất sao lưu và chỗ lưu trên mạng
- Nhập bản dịch: chế độ gộp theo mã câu hoặc thời điểm cộng trừ 0,35 giây cộng chữ Nhật; chế độ thay hết; ô chọn có gồm chữ Nhật và mốc thời gian hay không; bấm áp dụng rồi xem lời có đổi đúng không.
- Xuất bản chữ ra ngoài; sao lưu ra tệp; lấy lại bản sao lưu; quay lại trước khi lấy lại; xóa bản dịch giữ lại tiếng Nhật; xóa hết rồi tải lại từ đầu.
- Gửi bản chữ lên chỗ lưu trên mạng: chưa cho phép thì báo rõ; hủy đăng nhập thì không treo; đổi tài khoản khác thì thu hồi quyền cũ và chọn được tài khoản mới; chỉ xóa cờ chờ khi máy chủ báo đã nhận.
- Trường hợp mất dữ liệu: tắt giữa chừng; nhập tệp sai định dạng; sao lưu thiếu khóa, thiếu mốc thời gian, thiếu dữ liệu nâng cao.

### Nhóm G — Nhớ trạng thái và chuyển phim
- Đổi phim: khung phải đổi theo phim mới, không hiện lời phim cũ, mốc phát về đầu.
- Tải lại giữa chừng: khung tự lấy lại trạng thái từ chỗ nhớ tạm, không cần tải lại trang.
- Tắt trình duyệt rồi mở lại: giữ được chỗ đang xem, kiểu hiện, lựa chọn bật tắt, món đã lưu.
- Tua nhanh nhiều lần; bấm tạm dừng có thêm `&t=123s` trên địa chỉ: không được xóa lời.

### Nhóm H — Khung hẹp và màn hình khác nhau
- Kéo khung còn 280px: thanh công cụ gọn lại, không có thanh kéo ngang, nút không rớt dòng lộn xộn hay đè lên nhau.
- Đo thật bằng số: `scrollWidth` so với `clientWidth`; chụp ảnh ở 280px / 360px / 520px; ghi rõ chỗ nào tràn.
- Bàn phím: bấm Tab đi hết các nút, nhìn thấy rõ nút đang được chọn, bấm Enter hoặc Space dùng được, bấm Escape đóng bảng nhỏ.

### Nhóm I — Màu chữ theo trình độ, chữ nhỏ trên đầu, bảng nhỏ câu dài
- Màu từng từ đúng bảng màu trong `vocab_style.js` từ dễ đến khó; từ không rõ trình độ hiện màu trung tính, không tô bừa; bấm vào từ hiện nghĩa đúng; không làm vỡ cấu trúc câu.
- Câu dài trên 5 dòng: đưa chuột vào hiện bảng nhỏ; bảng cao nhất 280px có thanh kéo riêng; tự chọn hiện lên trên hay xuống dưới để không tràn mép; giấu chữ gợi ý mặc định để không đè lên bảng.
- Giữ bảng: đưa chuột từ câu sang nút phát qua khoảng trống 10px trong 100ms thì bảng giữ 180ms không chớp tắt; dừng trong bảng thì bảng ở yên; rời hẳn quá 180ms thì bảng đóng êm.

### Nhóm J — Lưu từ câu và đồng bộ hai chiều
- Bấm sao để lưu; bỏ sao để xóa; tắt mở lại xem còn không; mở trang web món đã lưu xem có đủ không.
- Lưu khi không có mạng rồi có mạng lại: tự gửi lên máy chủ; không mất; không trùng; mục mới nhất thắng theo mốc giờ; mục đã xóa có dấu xóa để không bị gửi ngược về.
- Tìm kiếm tiếng Nhật: trả kết quả dưới 5ms với dữ liệu thường; từ ngắn dưới 3 ký tự vẫn tìm được bằng cách tìm gần đúng.

### Nhóm K — Trường hợp xấu và giới hạn
- Máy chủ dịch trả lỗi quá tải, hết giờ chờ 15 giây: hàng đợi nhả chỗ, không nghẽn, chờ ít nhất 1000ms rồi thử lại, báo rõ cho người dùng.
- Lát cắt tiếng rơi vào đoạn im lặng: bỏ qua, không sinh câu rác.
- Tắt tiếng của thẻ, thẻ bị trình duyệt đóng băng: tự nối lại âm thanh, báo rõ nếu không nối được.
- Câu chỉ 1 chữ như "あ", "うん"; câu trên 200 chữ Hán: vẫn hiện và dịch được, không vỡ khung.

### Nhóm L — Cách đo và bằng chứng
- Vừa kiểm bằng tay vừa cho máy tự bấm và tự đo số thật trên màn hình; **không** đoán bằng cách đọc chữ trong mã nguồn.
- Mỗi bước quan trọng giữ một ảnh chụp cửa sổ từ ngoài; luồng chính giữ một đoạn phim quay màn hình dài 60 tới 90 giây; kiểm tra tệp còn dùng được và dung lượng lớn hơn 0.
- Mọi số đo ghi rõ lệnh đã chạy, kết quả trả về, mã thoát, ảnh đi kèm. Không dùng số liệu giả, không dùng chữ trong mã để kết luận đúng sai.

## 5. Chia làm 4 lượt chạy

- **Lượt 1 — Khung và dòng câu:** nhóm A, B, C, D, G; phim ngắn 55 câu; khung 360px.
- **Lượt 2 — Lưu, nhập xuất và mạng:** nhóm F, J, G, K; thử ngắt mạng, thử đổi phim, thử tắt mở lại.
- **Lượt 3 — Nhìn và cảm giác dùng:** nhóm H, I, E; khung 280px / 360px / 520px; chữ to nhất nhỏ nhất; bảng nhỏ câu dài.
- **Lượt 4 — Nghe và chỗ khác nhau:** nhóm B, D, K; phim ồn nhiều người nói; câu nghe được khác hẳn và giống hệt; bấm đồng ý dùng rồi bỏ.

Mỗi lượt xong viết một báo cáo riêng trong `review/`, ảnh để trong thư mục bằng chứng cùng ngày, không dồn hết vào một tệp.

## 6. Tiêu chí nhận

- **Đúng:** màu nút đúng mã đã chốt; chuyển thẻ mượt và giữ vị trí kéo; bật tắt dòng chữ có tác dụng ngay và nhớ được; ngôi sao lưu đúng và còn sau khi mở lại; nhập gộp và thay hết đúng như mô tả; bảng nhỏ có thanh kéo và giữ 180ms; chỗ khác nhau hiện đúng thẻ thêm và thẻ xóa; khung hẹp không tràn ngang.
- **Sai:** nút bấm không đổi màu; thẻ hiện lời phim cũ; lưu rồi mà mở lại mất; nhập sai mà mất hết lời cũ; bảng nhỏ tắt ngay khi đưa chuột qua; chữ Nhật bị tách sai vỡ nghĩa; khung 280px bị tràn ngang hay nút đè nhau.
- Báo cáo cuối phải có mục "chưa kiểm tra được", ghi rõ lý do và một bước nhờ bạn chụp giúp nếu cầu nối không làm được.

## 7. Việc không làm trong bản này

- Không sửa mã sản phẩm, không nâng phiên bản, không thêm giao diện mới.
- Không kiểm tra ứng dụng trên máy tính bảng, điện thoại, ứng dụng thanh công cụ trên máy tính.
- Không kiểm tra trang web món đã lưu ngoài việc mở xem có đủ món hay không.
- Không gỡ cầu nối thử trong bản này, nhưng ghi rõ đây là việc phải dọn trước khi phát hành.

## 8. Giả định và rủi ro

- Giả định: trình duyệt của bạn đã đăng nhập và mở được phim mẫu; máy chủ nhận tiếng trong máy chạy được trên máy của bạn; cầu nối thử còn dùng được với bản chưa đóng gói.
- Rủi ro lớn nhất: trình điều khiển không nhìn thẳng vào khung nên không đo được chữ và nút từ bên trong, phải đi qua cầu nối thử; nếu cầu nối hỏng thì phần đó ghi là chưa kiểm tra được kèm lỗi nguyên văn, không đoán.
- Rủi ro thứ hai: phim dài trên 500 câu và phim ồn chưa chốt mã; lượt 1 phải chốt mã phim và ghi vào báo cáo để các lượt sau dùng chung.
- Rủi ro thứ ba: mất mạng và đổi tài khoản lưu trên mạng cần bạn cho phép một lần bấm đồng ý; tôi không tự bấm thay phần cho phép của tài khoản.
