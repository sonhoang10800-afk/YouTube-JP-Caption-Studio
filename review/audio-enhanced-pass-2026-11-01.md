<!-- date: 2026-11-01 -->
<!-- source: chat:01a18e21-962b-7521-a9ca-98759c771931 · user: hoàn tất Audio + Enhanced để đạt PASS -->

# Audio + Enhanced PASS attempt — final review

**Status: FAIL.** The implementation is materially improved, but the overall gate
cannot pass without a qualifying local ASR model and translation sign-off. No
model was promoted, no candidate or evidence was fabricated, no audio left the
machine, and no gate was lowered.

Evidence bundles (local only, not committed):

- `.test-evidence/20261101-015355-audio-enhanced-pass-2026-11-01` — real
  sidepanel/Apply/Skip/Undo, Enhanced/Original, Reload, bridge cleanup, earlier
  ASR matrix and prompt-15 translation review.
- `.test-evidence/20261101-225522-audio-enhanced-continuation-2026-11-01` —
  beam attempt, rolling-context matrices, A→B→A fix, final test and hygiene run.

Plan: `plan/audio-enhanced-pass-2026-11-01.md`.

## Gate results

| Gate | Result | Evidence |
| --- | --- | --- |
| ASR clean CER <= 5.0% | **FAIL** — best baseline 14.523512%; best new rolling run 10.944653% (Turbo) | `logs/asr-clean-matrix-v3.json`, `logs/asr-clean-turbo-rolling-v1.json` |
| Stress CER <= clean + 2.0 pp | **FAIL** — Turbo rolling 32.277628%, Kotoba 41.711590%; no eligible winner | `logs/asr-stress-turbo-rolling-v1.json`, `logs/asr-stress-kotoba-rolling-v1.json` |
| DSP-on no worse than DSP-off | **NOT VERIFIED for rolling** — no matching rolling DSP-off run; this cannot create a winner | continuation bundle, rolling matrices |
| Timestamp usability | **NOT VERIFIED beyond presence** — native coverage is 74/74 and 41/41, but raw segment/word ranges were not retained for monotonicity/range checks | rolling matrices |
| Silence hallucination | **PASS for one probe** — HTTP 200, empty text, zero segments, `skipped=silence` | `commands/asr-silence-http-probe-v1.stdout` |
| Word timestamps and candidate matcher | **PASS** — optional words, ambiguity rejection, 85/15 mixed-cue guard, rolling/gap regressions | `commands/green-mixed-cue-matcher-recheck-v1.stdout` |
| Real Audio side panel Apply/Skip/Undo | **PASS (prior run)** — two real candidates, HTTP 200 ASR, exact Undo, Skip without source change | `reports/e2e34-*.json`, `sidepanel/e2e34-*.png` |
| Enhanced/Original and native Reload | **PASS (prior run)** — 150 rows retained | `reports/e2e34-state-*.json` |
| Bridge cleanup | **PASS with limitation** — source/hooks absent, extension reloaded, normal panel captured; runtime copy still displayed a `TEST` title | `commands/cleanup-bridge-removed-reload-v1.stdout`, `sidepanel/screenshot-20261101-223125.png` |
| Rolling context state | **PASS after fix** — only the immediately previous decoded window seeds the next prompt; exact 200-character cap; A→B→A reset proved by red/green regression | `commands/red-rolling-video-boundary-cap-v1.stdout`, `commands/green-rolling-video-boundary-cap-v1.stdout` |
| Translation prompt 15, 40 pairs | **FAIL** — 32/40 pass; eight pairs below 2 | `agents/translation-reviewer-prompt15-primary-fallback-v2/review.md` |
| Prompt 16 live rerun | **BLOCKED** — OmniRoute connection missing; preflight exit 1 | `commands/gemini-live-prompt16-primary-fallback-vi-en-v2.stderr` |
| Human sign-off | **NOT VERIFIED** — `humanApproval=false`; no user decision table | `agents/translation-reviewer-prompt15-primary-fallback-v2/review.md` |
| Independent final review | **FAIL** — boundary fix verified; ASR, translation and sign-off gates remain unmet | continuation `agents/final-code-reviewer/review.md` |

## What shipped in the worktree

- `/asr/transcribe` accepts optional `segments[].words` while preserving the old segment-only response.
- Candidate matching uses temporal overlap, text similarity, word assignment and ambiguity guards; mixed-cue and rolling-overlap cases return `null` instead of overwriting a cue.
- Apply keeps candidate provenance and model; Undo rejects a stale revision; Skip clears only the candidate.
- `PROMPT_VERSION` is 16 with general semantic/edit rules, not cue-specific test hints.
- The rolling benchmark keeps only the immediately previous decoded window, compares `videoId`, resets on gaps/video changes and caps context at 200 characters. The installer-supported `mlx-whisper` does not implement beam search, so the attempted beam option was removed rather than exposed as a broken API.
- The bridge files and manifest hook were removed after the real side-panel E2E; the extension was reloaded and visually recaptured.

## Verification

- Real HTTP rolling matrices: Turbo and Kotoba clean 74/74 HTTP 200; stress 41/41 HTTP 200. The reported CERs reproduce independently.
- ASR suite after the final fix: `116 passed, 5 skipped`; the skipped tests are opt-in real-MLX guards.
- Extension suite: all six Node suites pass, including candidate matching, service worker, audio capture and prompt-16 translation contract tests.
- No beam or test-bridge source/API references remain. No local bridge, uvicorn, MLX or OmniRoute process remains.
- A read-only Chrome tab listing at the end showed only the user's Facebook tab; no test tab was left open.

## Blockers and next actions

1. Restore an approved OmniRoute connection, then run 20 cues x VI/EN with
   prompt 16 fresh; verify cache hit and revision invalidation without reading
   or logging the key.
2. Independently score all 40 prompt-16 pairs. Any pair below 2 needs another
   prompt version and a fresh run.
3. Obtain the user's direct `APPROVE`/`REJECT` decisions for the prompt-12
   failures and every new row below 2; do not describe agent review as human
   approval.
4. ASR remains explicit FAIL. A local rerun only matters if a configuration can
   beat the 5.0% clean gate; cloud ASR needs separate user approval and no audio
   may leave the device without it.
5. If the ASR gate is reopened, add matching rolling DSP-off evidence and retain
   raw timestamp ranges before claiming timestamp usability.

## Not tested

- Cloud ASR or any off-device audio processing.
- Matching rolling DSP-off configurations.
- Raw timestamp range/monotonicity semantics.
- Successful prompt-16 live translation, cache/revision checks, and 40-pair review.
- Human quality approval.
- Full real-MLX opt-in tests (5 tests skipped by their guard).
- A new browser/sidepanel run in the continuation; prior sidepanel results are not represented as a rerun.

No commit or evidence upload was performed. Test backends and test tabs were
stopped; the only retained Chrome tab at the end was the user's Facebook tab.
