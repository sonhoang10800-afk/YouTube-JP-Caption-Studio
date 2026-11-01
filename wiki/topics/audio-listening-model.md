# Audio Listening Model (Experimental ASR Spike)

<!-- date: 2026-10-12 -->
<!-- status: M0-M3 implemented; 2026-11-01 enhanced attempt FAIL at ASR gate -->
<!-- raw: plan/audio-listening-model-2026-10-12.md -->
<!-- reviews: review/audio-access-feasibility-2026-10-12.md, review/asr-benchmark-2026-10-12.md, review/audio-enhanced-pass-2026-11-01.md -->

Đường dẫn nghe audio thử nghiệm ("listen to audio") kiểm tra văn bản phụ đề tiếng Nhật tự động của YouTube với âm thanh thực tế, đề xuất các sửa đổi dưới dạng **ứng viên (candidates)** có provenance và khả năng Hoàn tác (Undo).

## Trạng thái & Những gì đã ship

- [x] **Milestone M0 (Feasibility Spike)**: Xác minh tính khả thi của `chrome.tabCapture` qua MV3 offscreen document và luồng slicing audio offline. Kết luận: **GATE M0: GO**, ghi nhận chế độ phụ đề trễ (delayed subtitle mode) 2.5s–5.5s và ràng buộc user gesture.
- [x] **Milestone M1 (Ground Truth Dataset & Slicing)**: 20 cửa sổ vàng được lập danh mục tại [`testdata/audio-gold/manifest.json`](../../testdata/audio-gold/manifest.json) trên 6 video Parako với 8+ loại lỗi ASR thực tế. Script [`scripts/slice_gold_audio.py`](../../scripts/slice_gold_audio.py) thực thi resample polyphase 16 kHz mono chuẩn xác.
- [x] **Milestone M2 (Apple Silicon Metal Benchmark)**: Script benchmark [`scripts/asr_benchmark.py`](../../scripts/asr_benchmark.py) đo CER Levenshtein và CER chuẩn hóa (bảo toàn `々` và `ー`). Xác minh model `mlx-community/whisper-large-v3-turbo` đạt RTF = 0.0505, RAM RSS = 1.728 GB, CER trên cue 19 đạt 0.00% (sửa đúng `勘無料` -> `感無量`).
- [x] **Milestone M3 (Candidate Integration)**:
  - Backend API: `POST /asr/transcribe` tại `local-bridge/app/api/asr.py` và `app/services/asr.py`.
  - Capture Extension: `extension/offscreen/audio_capture.html` và `audio_capture.js` chuyển tiếp âm thanh ra loa qua `AudioContext.destination` để không làm tắt tiếng video.
  - Invariant Bảo vệ Dữ liệu: `canReceiveAsrCandidate(cue)` ngăn chặn tuyệt đối việc ghi đè lên cue `mt_locked`, `user_owned`, `text_source: edit|manual|script|import` hoặc đã dịch bởi người dùng.
  - Giao diện Sidepanel: Nút bật/tắt `#sp-audio-mode`, hiển thị badge ứng viên với 2 nút `Áp dụng` (`sp-candidate-accept`) và `Bỏ qua` (`sp-candidate-revert`), tạo revision Undo an toàn.
  - Runtime handlers: `handleAsrCandidateReceived`, `getContentTabId`, `matchCuesForSegment` trong `extension/content/content.js`.

## Đợt Enhanced 2026-11-01

Kết quả đầy đủ: [Audio + Enhanced PASS attempt](audio-enhanced-pass-2026-11-01.md).

- **FAIL**: baseline clean CER tốt nhất 14.523512%; rolling Turbo cải thiện còn
  10.944653% nhưng stress 32.277628%, vẫn xa gate ≤ 5.0% và biên +2.0 pp. Không
  có winner và không promote model.
- Candidate matcher, word timestamps, real sidepanel Apply/Skip/Undo và
  Enhanced/Original/reload đã pass trong worktree.
- Translation vẫn thiếu prompt-16 live run và human sign-off; 8/40 cặp prompt 15
  dưới chuẩn.
- Beam search được thử thật nhưng backend `mlx-whisper` hiện tại không hỗ trợ;
  option đã được gỡ. Rolling context chỉ giữ cửa sổ ngay trước, reset ở
  video/gap, cap 200 ký tự và có regression A→B→A.
- Cloud ASR: **NOT TESTED**; cần approval riêng. Rolling DSP-off và raw timestamp
  range vẫn chưa được chứng minh đầy đủ.

## Code anchors

- [`plan/audio-listening-model-2026-10-12.md`](../../plan/audio-listening-model-2026-10-12.md): Bản kế hoạch chi tiết từng cổng (gated plan).
- [`review/audio-access-feasibility-2026-10-12.md`](../../review/audio-access-feasibility-2026-10-12.md): Báo cáo thử nghiệm cổng M0.
- [`review/asr-benchmark-2026-10-12.md`](../../review/asr-benchmark-2026-10-12.md): Báo cáo benchmark Metal và dataset vàng M1/M2.
- [`testdata/audio-gold/manifest.json`](../../testdata/audio-gold/manifest.json): Danh mục 20 cửa sổ kiểm thử lỗi ASR thực tế.
- [`scripts/slice_gold_audio.py`](../../scripts/slice_gold_audio.py): Công cụ cắt audio 16 kHz polyphase.
- [`scripts/asr_benchmark.py`](../../scripts/asr_benchmark.py): Công cụ đo CER, RTF và RAM trên Apple Silicon Metal.
- [`local-bridge/app/api/asr.py`](../../local-bridge/app/api/asr.py): Router endpoint `POST /asr/transcribe`.
- [`local-bridge/app/services/asr.py`](../../local-bridge/app/services/asr.py): Service xử lý MLX Whisper, downmixing, polyphase resample và decode audio.
- [`extension/offscreen/audio_capture.js`](../../extension/offscreen/audio_capture.js): Offscreen capture và streaming qua WebM Opus.
- [`extension/shared/sentence_candidates_test.js`](../../extension/shared/sentence_candidates_test.js): Bộ test unit cho toàn bộ vòng đời và invariant bảo vệ dữ liệu của ứng viên.
- [`review/audio-enhanced-pass-2026-11-01.md`](../../review/audio-enhanced-pass-2026-11-01.md): Kết quả PASS attempt mới nhất, gồm gate matrix và blockers.
