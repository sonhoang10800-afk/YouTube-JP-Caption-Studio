<!-- date: 2026-10-24 -->
<!-- source: goal:execute-todos · user: "Bắt đầu thực thi TO-dos." · TODO #5 post-fix MP4 -->

# Review — post-fix overlay flow MP4 (criterion e)

BACKEND: bsk | instance: 35138c57 (Youtube-Agent) | Chrome 155.0.0.0 | PLAYWRIGHT: no

- **Criterion (e):** one MP4 recorded from the real video tab, proving the post-fix overlay
  flow; the pre-fix FAIL run only had a 20 s repro clip.
- **Recording:** `review/ux-verify-mp4-2026-10-24/overlay-flow-fixed.mp4` — H.264, 1280×690,
  36 frames, 35.000 s, 2,345,695 bytes,
  SHA-256 `b4c7065b39c89b5542c69037befe22aa1e811507558bf6dfac5d5ac16781994a`.
- **Flow in the clip:** H ON → click a token (dictionary popup) → Escape → H OFF → H ON.
  Frame at 3 s (`dict-popup-frame.jpg`) shows the dict popup over the rendered overlay.
- **Evidence bundle (local, not committed):**
  `/Users/hoangson/Projects/YouTube JP Caption Studio/.test-evidence/20261024-054743-overlay-mp4-fixed`
  — `PASS`, 36 artifacts (video, ffprobe JSON, SHA-256, frames, console/network, session after).
- **Session:** bsk `qwaz`, one tab `1847742926`, stopped once after recording; 46 console
  entries, 0 `Unsafe attempt to load URL`.

## Findings

| ID | Severity | Finding | Evidence |
| --- | --- | --- | --- |
| MP4-1 | Info (PASS) | 35 s MP4 of the post-fix overlay + dict flow exists and is playable; codec/size/duration verified. | `overlay-flow-fixed.mp4`, `ffprobe.json` |
| MP4-2 | Info | Dictionary popup is visible over the rendered overlay at 3 s (frame extracted). | `dict-popup-frame.jpg` |
| LIM-1 | Low (limitation) | bsk video records no audio; the clip proves visuals/sequence only. | `ffprobe.json` |
| LIM-2 | Low (limitation) | Standard quality 1280×690, timings approximate; desktop only. | `overlay-flow-fixed.mp4` |

## Not tested

- Audio, mobile/tablet recording, popup/sidepanel recording.
- Full 4-state C-7 flow in the clip (star state shown but not toggled to avoid altering user data;
  dict/H off/H on are covered).

## Notes

- `bsk video stop` without `--recording` failed because two recordings were retained (old repro
  clip + this run); stopped explicitly by recording id (`duration_limit`, `state: ready`).
- This review completes criterion (e); the pre-fix repro clip remains separate in
  `.ux-audit/20261024-ux-verify-ext/`.
