# Audio + Enhanced PASS attempt — 2026-11-01

<!-- date: 2026-11-01 -->
<!-- status: FAIL — ASR gate, prompt-16 live translation and human sign-off not met -->
<!-- raw: review/audio-enhanced-pass-2026-11-01.md, plan/audio-enhanced-pass-2026-11-01.md -->

Đợt này hoàn thiện Audio candidate, word timestamps, sidepanel
Apply/Skip/Undo và dọn bridge test-only, sau đó thử beam search và rolling
context. Kết quả cuối vẫn là **FAIL**: không có model ASR local nào đạt gate,
prompt-16 chưa chạy live được vì OmniRoute không còn, và chưa có human sign-off.
Không promote model, không dùng cloud ASR, không tạo candidate giả, không hạ
gate và không gửi audio ra ngoài.

## Kết quả gate

| Gate | Kết quả | Bằng chứng |
|------|---------|------------|
| ASR clean CER ≤ 5.0% | **FAIL** — baseline tốt nhất 14.523512%; rolling Turbo 10.944653% | `logs/asr-clean-matrix-v3.json`, `logs/asr-clean-turbo-rolling-v1.json` |
| ASR stress CER ≤ clean + 2.0 pp | **FAIL** — rolling Turbo 32.277628%, Kotoba 41.711590% | `logs/asr-stress-turbo-rolling-v1.json`, `logs/asr-stress-kotoba-rolling-v1.json` |
| DSP-on không tệ hơn DSP-off | **NOT VERIFIED cho rolling** — chưa chạy cặp DSP-off tương ứng; không thể tạo winner | hai rolling matrix |
| Timestamp dùng được | **NOT VERIFIED đầy đủ** — có coverage 1.0 nhưng artifact không giữ raw segment/word ranges để kiểm tra range/monotonicity | rolling matrices |
| Không hallucinate silence | **PASS một probe** — HTTP 200, text rỗng, 0 segment, `skipped=silence` | `commands/asr-silence-http-probe-v1.stdout` |
| Word timestamps + candidate matcher | **PASS** — mixed-cue, overlap, gap và rolling cues có regression | `commands/green-mixed-cue-matcher-recheck-v1.stdout` |
| Sidepanel Audio thật (Apply/Skip/Undo) | **PASS (prior run)** — hai candidate thật, HTTP 200, Undo chính xác | `reports/e2e34-*.json`, `sidepanel/e2e34-*.png` |
| Enhanced ↔ Original + native Reload | **PASS (prior run)** — giữ 150 rows | `reports/e2e34-state-*.json` |
| Bridge cleanup | **PASS với hạn chế** — source/hook đã gỡ; runtime copy từng còn tiêu đề TEST | `sidepanel/screenshot-20261101-223125.png` |
| Rolling context lifecycle | **PASS sau fix** — chỉ cửa sổ ngay trước được dùng; cap đúng 200 ký tự; A→B→A reset qua red/green test | `commands/red-rolling-video-boundary-cap-v1.stdout`, `commands/green-rolling-video-boundary-cap-v1.stdout` |
| Translation prompt 15, 40 cặp | **FAIL** — 32/40 đạt; 8 cặp dưới 2 | `agents/translation-reviewer-prompt15-primary-fallback-v2/review.md` |
| Prompt 16 live rerun | **BLOCKED** — OmniRoute connection không còn | `commands/gemini-live-prompt16-primary-fallback-vi-en-v2.stderr` |
| Human sign-off | **NOT VERIFIED** — chưa có bảng quyết định của người dùng | `agents/translation-reviewer-prompt15-primary-fallback-v2/review.md` |
| Independent final review | **FAIL** — fix boundary đã verified; gate ASR/translation/sign-off vẫn mở | continuation `agents/final-code-reviewer/review.md` |

Bundle chính:

- `.test-evidence/20261101-015355-audio-enhanced-pass-2026-11-01` — sidepanel
  thật, candidate lifecycle, bridge cleanup và translation prompt 15.
- `.test-evidence/20261101-225522-audio-enhanced-continuation-2026-11-01` —
  beam/rolling, fix A→B→A, test suite cuối và hygiene.

Cả hai bundle là local-only, không commit/upload.

## Đã ship trong worktree

- `/asr/transcribe` nhận `segments[].words` tùy chọn, giữ tương thích response
  segment-only.
- Matcher dùng temporal overlap, độ giống text, word assignment và guard
  ambiguity; trả `null` thay vì ghi đè khi nhiều cue chồng nhau.
- Apply giữ provenance/model; Undo từ chối revision cũ; Skip chỉ xóa candidate.
- `PROMPT_VERSION = 16` với quy tắc ngữ nghĩa/biên tập tổng quát, không
  hardcode câu test.
- Rolling ASR dùng đúng một cửa sổ decode trước, reset khi đổi video/gap và cap
  200 ký tự. Beam search không được expose vì `mlx-whisper` hiện tại không cài
  đặt decoder đó; failed run 74/74 HTTP 500 được giữ làm evidence.
- Bridge test-only đã được gỡ khỏi source, manifest và runtime copy; extension
  reload exit 0.

## Verification

- Rolling clean/stress: Turbo 74/74 và 41/41 HTTP 200; Kotoba 74/74 và 41/41
  HTTP 200. CER lưu trong matrix được reviewer tính lại khớp chính xác.
- ASR suite sau fix: `116 passed, 5 skipped` (5 test real-MLX opt-in bị skip có
  guard, không được tính là pass).
- Sáu extension suite Node đều pass, gồm candidate matcher, service worker,
  audio capture và prompt-16 translation contract.
- Không còn beam/test-bridge trong source hoặc API; không còn bsk, local bridge,
  uvicorn, MLX hay OmniRoute chạy nền. Chrome cuối cùng chỉ còn tab Facebook của
  user.

## Blockers còn mở

1. Khôi phục OmniRoute đã được duyệt, chạy lại 20 cue × VI/EN với prompt 16
   fresh, kiểm tra cache hit và revision invalidation mà không đọc/log key.
2. Reviewer chấm độc lập đủ 40 cặp; mọi cặp dưới 2 phải sửa prompt, tăng
   version và chạy lại.
3. User trực tiếp `APPROVE`/`REJECT` 14 cặp fail của prompt 12 và mọi cặp mới
   dưới 2. Agent review không thay thế human approval.
4. ASR vẫn FAIL; cloud ASR cần user đồng ý riêng. Nếu mở lại gate, cần rolling
   DSP-off tương ứng và raw timestamp ranges để kiểm tra usability.

## Artifact & liên kết

- [Review hoàn tất](../../review/audio-enhanced-pass-2026-11-01.md)
- [Plan thực thi](../../plan/audio-enhanced-pass-2026-11-01.md)
- [Topic Audio Listening Model](audio-listening-model.md)
