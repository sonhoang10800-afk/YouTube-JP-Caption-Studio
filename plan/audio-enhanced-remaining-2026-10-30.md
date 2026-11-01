<!-- date: 2026-10-30 -->
<!-- source: chat:d3bc · goal: finish Audio + Enhanced after OmniRoute key retrieval -->

# Audio + Enhanced — remaining todo

## Done

- [x] Export a working Gemini credential through OmniRoute without printing or adding it to evidence.
- [x] Verify the chosen key against the live Gemini model catalog; `gemini-3.6-flash` returns HTTP 200.
- [x] Start a new evidence bundle for the resumed live run: `.test-evidence/20261030-070753-audio-enhanced-omniroute-resume`; the historical bundles remain immutable.
- [x] Download the official MOFA 2026-01-09 source audio (`PV0xVuhmBQI`, 16 kHz mono WAV).
- [x] Reproduce the translation-corpus mapping failure: the independent reviewer returned `FAIL` with 5 contradicted and 10 unverified cues; exact source text was 19/20 JA and 20/20 EN.
- [x] Replace disjoint ASR-window links with one exact 16 kHz mono clip per official cue interval; fix the cue-04 official punctuation and add a coverage regression test (red then green).
- [x] Validate the rebuilt corpus: 20/20 JA exact, 20/20 EN exact, 20/20 interval-exact clips, 20/20 audio hashes, all clips 16 kHz mono PCM.

## Remaining

- [x] Run live Gemini VI and EN translations through the extension module using the OmniRoute-derived key.
- [x] Test fresh API, cache reuse, revision invalidation, missing key, dummy key, injected 429, network failure, missing/duplicate IDs, wrong revision, and model fallback.
- [x] Re-run the independent corpus reviewer against the rebuilt 20-cue manifest and apply provenance only after all cues were verified.
- [x] Run independent agent reviewers against the 20-cue four-part rubric and the final on-disk evidence.
- [x] Attempt the real worktree extension load and sidepanel in the ChatGPT in-app browser; record the exact block if the browser policy prevents it.
- [ ] Run live Audio Extension E2E: 8 s / 6.5 s capture, pause, seek, rate change, tab stop, 15 s silence, candidate mapping, Apply, Skip, Undo.
- [ ] Run Enhanced/UI checks: Original/Enhanced switching, button color/state, edit preservation, Undo revision, stale-translation visibility.
- [x] Rerun the scoped Python and Node suites plus `git diff --check` after the last change.
- [x] Finish the independent review and final report with honest `PASS` / `FAIL` / `BLOCKED` per layer.

The real sidepanel remains blocked: the ChatGPT in-app browser rejects `chrome://extensions` with its URL policy. No external Chrome, Playwright, Chromium or `bsk` fallback was used. Real Audio Extension and Enhanced/UI E2E must therefore stay `NOT TESTED`.

## Known open defects outside this todo

- The final production HTTP ASR gate remains `FAIL`: Kotoba DSP-on clean is `551/2417 = 22.796856%` CER, and stress is `550/1484 = 37.061995%` (`+14.265139 pp` over clean).
- The independent translation reviewer reports `19/40` failed VI/EN cue pairs and `42/160` rubric fields below 2; no rubric threshold was lowered.
- The full bridge suite is not green: one unrelated dictionary test fails (`tests/test_dictionary_service.py::test_exact_spelling_keeps_rare_mazii_hanviet`).
