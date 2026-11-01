<!-- date: 2026-10-31 -->
<!-- source: chat:d3bc · goal: finish Audio + Enhanced after OmniRoute key retrieval -->

# Audio + Enhanced — continuation checklist

Evidence: `.test-evidence/20261031-014356-audio-enhanced-continuation`

## Todo

- [x] Start a new evidence bundle; preserve the two historical bundles.
- [x] Confirm OmniRoute can export active Gemini credentials without exposing key material.
- [x] Select a working Gemini model/credential pair and record fresh/cache/fallback behavior. The primary returned 503 twice; `gemini-3.5-flash-lite` served all 20 VI and 20 EN cues.
- [x] Re-verify the 20 official JA/EN translation cues through the in-app browser and live Gemini. Fresh/cache/revision transport passed; the quality rubric did not.
- [x] Re-run the independent VI/EN rubric after the final prompt change. Result: 14/40 language-cue pairs and 4/20 cues in both languages pass; verdict FAIL.
- [x] Run the sidepanel attempt in the ChatGPT in-app browser and record the exact block. `chrome://extensions/` was rejected by URL policy; no fallback used, so UI is NOT TESTED.
- [x] Re-run real `/asr/transcribe` HTTP, ASR/DSP gates, and related Python/Node suites. Clean HTTP and silence pass; the five-model ASR gate fails.
- [x] Re-run `git diff` and `git diff --check`; inspect the final on-disk diff. Diff check exits 0.
- [x] Finish the evidence bundle and report only after every item above is resolved. Bundle finalized as `FAIL`; four bsk-only browser artifacts were waived because bsk was prohibited.

## Frozen restrictions

- Use only the ChatGPT in-app browser for browser work; no external Chrome, Playwright/Chromium fallback, or bsk.
- Never read, print, screenshot, or store the Gemini key.
- Do not alter historical evidence or lower any gate.
- Overall PASS requires real artifacts for ASR/DSP, Audio Extension, and Enhanced/UI.

## Status — 2026-10-31

- Evidence bundle: `.test-evidence/20261031-014356-audio-enhanced-continuation`.
- ASR/DSP: **FAIL**. Clean best is Whisper Turbo DSP-on at `293/2403 =
  12.193092%`; stress is `460/1484 = 30.997305%`. No configuration meets the
  clean 5.0% gate or the stress +2pp gate; `winner` is `null`. DSP-on is better
  than DSP-off on clean for four model pairs but not Qwen; Kotoba DSP-on loses on
  stress.
- Audio Extension: **PASS (logic only)** in the Node/runtime test harness;
  **NOT TESTED** in the real sidepanel. The 8s/6.5s cadence, playhead epoch
  cancellation, silence, one-cue coverage and Apply/Skip/Undo logic tests pass.
- Enhanced translation: **FAIL** on independent agent rubric. 26/40 pairs fail,
  36/160 fields score 1, and no score-0 fields; the 20-cue manifest remains
  `PENDING_AGENT_REVIEW` with blank reviewer/date provenance.
- Enhanced/UI: **NOT TESTED**. ChatGPT in-app browser refused
  `chrome://extensions/`; no Chrome, Playwright, bsk or CDP fallback was used.
- Overall: **FAIL**. `0.2%` is historical only and was not claimed; the prior
  `30.971%` evidence remains untouched.
