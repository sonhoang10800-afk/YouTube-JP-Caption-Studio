<!-- date: 2026-10-29 -->
<!-- source: chat:d3bc · user: audio + enhanced machine-verified completion -->

# Audio + Enhanced completion — machine-verified implementation plan

## Scope and verdict model

Preserve the dirty worktree and both historical evidence bundles. The earlier
`30.971%` clean CER and the finalized `FAIL` remain immutable history. This task
uses a new bundle and reports three independent verdicts:

1. ASR/DSP quality.
2. Audio capture and candidate behavior in the real extension.
3. Enhanced translation and UI behavior.

Overall PASS requires a real artifact for every applicable layer. The corpus is
`machine-verified, agent-reviewed`; it is not human-approved. PASS is limited to
the two frozen official sources and does not generalize to YouTube.

## Frozen official sources

- Clean: `PV0xVuhmBQI`, MOFA JA `kaikenw_000001_00200.html`, EN
  `kaikenwe_000001_00221.html`.
- Stress: `pLaFPvO2pnA`, Okinawa transcript `260821-2_kaiken.pdf`.
- Official text is the sole reference. YouTube captions provide timing only.
- Do not use Kantei for this holdout.

## Corpus construction and freeze

- Clean: true 8-second windows with a 6.5-second hop, normalized reference length
  >= 2,400 characters, alignment coverage >= 0.90.
- Stress: >= 1,200 characters total; each of BGM, outro, noise, quiet, dialect,
  homophone and multi-speaker has >= 120 characters. Deterministic WAV transforms
  are allowed for BGM/outro/noise/quiet.
- Every window records video ID, source, start/end, stream reference, SHA-256,
  review date and `reviewKind=agent-official-crosscheck`; `reviewedBy` starts with
  `agent:`. Audio transcripts may only expose disagreements.
- Before final measurement, freeze SHA-256 for manifests, normalization, prompts,
  model allowlist and decode parameters. No threshold, sample or normalization
  changes after seeing final results.

## Implementation slices

### ASR and DSP

- Verify the existing `/asr/transcribe` request contract and additive `backend` /
  `timestampSource` response fields.
- Run the real HTTP matrix for Kotoba, Whisper Turbo, Whisper Large v3, Parakeet
  JA and Qwen3-ASR, each with DSP on/off. The five-model allowlist is benchmark-only;
  production keeps only the measured winner.
- Add optional `mlx-audio==0.6.3` with lazy imports for Parakeet/Qwen and retain
  `mlx-whisper` for Whisper. Record MIT, Apache-2.0 and CC-BY-4.0 attribution.
- Aggregate CER from total edits over total reference characters. Report S/D/I,
  Wilson interval, cluster bootstrap, hallucination/repetition, RTF, RSS, Metal
  peak and fresh-process cold start. Use fuzzy bounded overlap stitching without
  double-counting overlap.
- DSP stays default only when clean DSP-on CER <= DSP-off. Verify high-pass 40 Hz,
  low-pass 8 kHz, noise reduction, quiet amplification, sample count, finite
  samples and peak range with signal spectra.

### Audio extension

- Finish the PCM worklet path: 8-second true windows, 6.5-second hop, 16 kHz mono
  WAV. Anchor playhead on play, pause, seeking, seeked, rate change and tab stop.
- Pause/seek/rate change increments epoch, cancels partial/in-flight windows and
  prevents stale candidates. Fifteen seconds of silence produces no candidate and
  no state write.
- A candidate must match exactly one cue with cue and segment coverage >= 0.60;
  multi-cue segments are rejected. A complete candidate cannot be overwritten by a
  boundary fragment. Apply, Skip and Undo must use the correct revision.

### Enhanced, Gemini and UI

- Use the 20 frozen MOFA cues with official JA/EN. A separate agent reviewer scores
  VI/EN for meaning, naturalness, fidelity and format from 0–2; any score below 2
  is a defect. CER/BLEU are not translation quality gates.
- Test fresh API and cache, revision invalidation, missing/dummy key, network
  failure, missing/duplicate IDs and model fallback. A real local proxy injects
  429 and artifacts label it `injected: true`.
- The user enters the Gemini key directly in Settings once. Never read, log,
  screenshot, dump or place it in evidence.
- Use the ChatGPT in-app browser only. Attempt to load/reload the worktree
  extension from `chrome://extensions`. If blocked, record BLOCKED/NOT TESTED;
  never fall back to external Chrome, Playwright/Chromium or bsk.
- A user-consented macOS capture of the specific browser window may prove the
  sidepanel visual. A temporary test bridge may inspect logic/DOM, then must be
  removed and its source file restored.

## Gates

- ASR/DSP PASS: clean aggregate CER <= 5.0% over >= 2,400 characters; stress CER
  <= clean CER + 2.0 percentage points over >= 1,200 characters; DSP-on <= DSP-off;
  no silence hallucination; winner chosen by clean CER, stress CER, then RTF and
  must provide usable timestamps.
- Audio E2E PASS: 8/6.5-second cadence; pause/seek/rate/stop do not drift; silence
  emits no candidate/state; one-cue candidate mapping; Apply/Skip/Undo exact.
- Enhanced/UI PASS: no rubric item below 2 for VI/EN; correct missing-key/dummy/
  429/network/revision states; no key leakage; stable fresh/cache behavior; UI and
  Undo preserve revisions.

## Verification and evidence

- Every new defect follows red runtime/HTTP/audio reproduction -> minimal root fix
  -> green regression -> related caller rerun. No mocked HTTP/UI or cue hardcoding.
- Run benchmark Python tests, ASR/API/DSP tests, real HTTP transcription, six related
  Node suites, real sidepanel smoke, full bridge suite, `git diff` and
  `git diff --check`.
- One new `test-evidence` bundle stores every command/stdout/stderr/exit code,
  benchmark JSON, key-filtered HTTP artifacts, DOM snapshot, window image and report.
- Finish with `evidence.py check --finish`. An independent reviewer reads the
  on-disk diff, reruns checks and marks each criterion VERIFIED / NOT VERIFIED /
  CONTRADICTED. Old evidence is never modified.

## Known blockers

- The in-app extension currently points at a stale checkout and the Gemini key is
  absent. If the in-app browser cannot load the worktree extension, open its
  sidepanel, capture the specific window or accept the user-entered key, the
  affected layer is BLOCKED / NOT TESTED.

## Final outcome — 2026-10-30

- Evidence: `.test-evidence/20261030-070753-audio-enhanced-omniroute-resume`.
- ASR/DSP: `FAIL`. Final production HTTP clean Kotoba DSP-on is `551/2417 =
  22.796856%` CER and stress DSP-on is `550/1484 = 37.061995%`; DSP-on is better
  than DSP-off on clean only.
- Translation corpus/provenance: `PASS` after independent agent review. Enhanced
  translation quality: `FAIL`, with `19/40` language-cue pairs and `42/160` rubric
  fields below 2.
- Audio Extension and Enhanced/UI: `NOT TESTED` in the real sidepanel. The ChatGPT
  in-app browser rejects `chrome://extensions`; no external browser or automation
  fallback was used.
- The independent final reviewer confirms `FAIL`, and the full bridge suite remains
  non-green on one unrelated dictionary test. Overall verdict is `FAIL`, not PASS.
