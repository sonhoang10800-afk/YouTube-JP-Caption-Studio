<!-- date: 2026-10-31 -->
<!-- source: chat:d3bc · user: finish Audio + Enhanced under in-app-only -->

# Hoàn tất Audio + Enhanced — in-app-only — 2026-10-31

## Scope

Continue from the dirty `d3bc` worktree without rewriting history or historical
evidence. Keep the recent gates: clean CER <= 5.0% over >= 2,400 characters,
stress CER <= clean + 2.0 percentage points over >= 1,200 characters, DSP-on no
worse than DSP-off, and usable timestamps. The `0.2%` target remains historical.

Only the ChatGPT in-app browser may be used. No external Chrome,
Playwright/Chromium, bsk or screencapture fallback. If the in-app browser still
rejects extension management, the sidepanel is `NOT TESTED/BLOCKED` and the
overall verdict cannot be PASS.

## Checklist

- [x] Create the task evidence bundle and record the starting worktree state.
- [x] Audit ASR window-boundary references and overlap stitching; add a red
      regression test if the benchmark overcounts boundary text or overlap.
- [x] If the audit finds a benchmark defect, fix the builder/stitcher, rebuild the
      clean and stress manifests from the frozen official sources, review them,
      and freeze their hashes before the final measurement.
- [x] Run the five-model DSP/decode matrix without reference or cue leakage.
      Completed clean and stress matrices. Clean: 74/74 windows, 2,403 reference
      characters, best 13.982522%. Stress: 41/41 windows, 1,484 reference
      characters, best 25.067385%. All 80 model/configuration runs returned HTTP
      200; 36/40 clean configurations had usable timestamps.
- [x] Select the winner by clean CER, stress CER, then RTF. No configuration met
      the clean gate, so the result is `winner: null` and production keeps Kotoba.
      The dirty worktree's pre-existing 40 Hz high-pass chain was used by both
      DSP arms but was not independently A/B tested against the 100 Hz chain.
      The DSP-on/off pair gate is enforced across clean and stress matrices; its
      red->green regression rejects 18 configurations whose DSP-on result is worse.
- [x] Add handler-level tests for Apply, Skip, Undo, silence and revision safety.
- [x] Attempt the real extension surface once in the in-app browser and record the
      exact block; do not substitute a fixture or bridge for the real sidepanel.
- [x] Replace test-sentence-specific translation hints with general editing rules,
      bump `PROMPT_VERSION` to 12, and invalidate the old translation cache.
- [x] Run live Gemini VI/EN through OmniRoute without reading or printing the key.
- [x] Run independent agent review of all 40 pairs. The reviewer returned `FAIL`:
      26/40 pairs scored 2 on all four fields and 14/40 had at least one field
      below 2.
- [ ] Complete human spot-check of every pair with any score below 2. No human
      confirmation exists, so this remains `NOT VERIFIED`.
- [x] Run scoped Python/Node suites, full bridge suite, and `git diff --check`.
      Scoped suites and all six Node suites exited 0, including the final scoped
      Python rerun after the DSP-gate fix. The full bridge suite had only the
      pre-existing out-of-scope `剕 -> PHÍ` dictionary failure (`1 failed, 183
      passed, 6 skipped`); `git diff --check` exited 0.
- [x] Complete the final independent read-only review and record its verdict. The
      re-audit verified the DSP-pair fix and the final scoped/full test results;
      its verdict remains FAIL because the measured ASR, translation quality,
      human review, and real UI gates do not pass.
- [ ] Finish the new evidence bundle and stop the bridge; never modify old evidence.

## Outcome

- ASR/DSP: `FAIL`. The best clean configuration was Whisper Large v3 Turbo with
  DSP on, `condition_on_previous_text=false`, and the generic prompt at
  `336/2403 = 13.982522%` CER (RTF 0.0717). Its stress CER was `36.455526%`.
  The gates remain clean `<=5.0%` and stress `<= clean + 2.0 pp`; no gate was
  relaxed after measuring.
- Enhanced translation: `FAIL`. The fresh OmniRoute run completed 20 VI and 20 EN
  cues, but the independent review found 14/40 pairs below the required standard.
  Human review is `NOT VERIFIED`; corpus provenance was not upgraded.
- Audio extension: logic suites passed, including handler-level Apply/Skip/Undo,
  revision safety, silence, 8 s/6.5 s windows, pause/seek/rate, WAV 16 kHz mono,
  and AudioWorklet paths. The real sidepanel/YouTube E2E is `NOT TESTED` because
  the in-app browser rejected `chrome://extensions` under its URL policy.
- Enhanced real UI: `NOT TESTED` for the same URL-policy block. No external
  Chrome, Playwright/Chromium, bsk, screencapture, bridge, or fixture substitute
  was used.
- Overall verdict: `FAIL`. A PASS is impossible without both a passing ASR gate
  and real extension/UI evidence, and translation quality also failed.

## Acceptance

PASS requires artifacts for ASR/DSP, real Audio Extension E2E and real Enhanced/UI.
Under the in-app-only constraint the last two may remain blocked; the final report
must state that honestly. A failed gate is reported as FAIL, never lowered or
mocked. Every defect fix follows red -> green -> rerun of related callers.

## Evidence

Bundle: `.test-evidence/20261031-035129-audio-enhanced-final-in-app-2026-10-31`.

Final independent audit: `agents/final-auditor/audit-after-dsp-gate.md`.
