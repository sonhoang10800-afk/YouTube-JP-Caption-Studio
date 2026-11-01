<!-- date: 2026-11-01 -->
<!-- source: chat:01a18e21-962b-7521-a9ca-98759c771931 · user: hoàn tất Audio + Enhanced để đạt PASS -->

# Audio + Enhanced completion — PASS plan

## Summary

Work only in this dirty worktree and preserve all existing evidence. Overall PASS
requires all four gates: ASR/DSP quality, translation quality, a real Chrome
side-panel Audio flow with Apply/Skip/Undo, and removal of every test-only bridge
hook. Do not lower a gate, inject candidates, edit old evidence, or include the
2026-10-25 side-panel backlog in this pass.

## ASR and DSP

- Re-establish the frozen clean/stress baseline, verify manifest hashes, verified
  window counts, reference lengths, overlap stitching, and S/D/I distribution.
  Fix a benchmark/reference defect with a red test before changing a model.
- Run the existing five local MLX models with DSP on/off and the four generic
  decode modes. For the two best local configurations, also evaluate beam search
  and rolling context from the previous decoded window. Never use cue, reference,
  or manifest text as a model hint.
- A winner must have clean CER <= 5.0%, stress CER <= clean + 2.0 pp, DSP-on no
  worse than DSP-off, no silence hallucination, and usable timestamps. Rank by
  clean CER, stress CER, then RTF.
- Promote the winner (model, decoder, DSP) and update the strict allowlist,
  backend mapping, requirements, notices, and security tests. Keep
  `/asr/transcribe` changes additive.
- If no local configuration passes, record FAIL and stop at the cloud checkpoint.
  Do not use a cloud key or send audio off-device without separate approval.

## Candidate matching and real Audio UI

- Add optional `segments[].words = [{text,start,end}]` when the engine supplies
  word timestamps; segment-only responses remain valid.
- Replace the one-cue-only matcher in `extension/content/content.js` with a
  temporal-overlap plus text-similarity decision. Accept only one unambiguous
  cue; reject equal/overlapping ambiguity, gaps, mixed-cue text, and fragments.
  Preserve the full-candidate-wins rule and ASR provenance.
- Add regressions for rolling overlap, equal overlap, contained segments, gaps,
  sentence groups, overwrite safety, and real `FfUjmyCeK7s` cues near 171–205 s.
- Recreate the absent test-only bridge, enabled only for an unpacked extension,
  `?sp_test=1`, and a random storage token. Use it to exercise the real side
  panel's logic/handlers. Use macOS `screencapture` of the Chrome window for
  visual evidence; never claim bsk can probe the side panel.
- In real Chrome, prove the captured tab, active heartbeat, HTTP 200 ASR, and at
  least two real candidates. Apply the first, capture before/after, Undo and
  verify exact restoration. Skip the second and verify its row is unchanged.
  Recheck Enhanced/Original and native Reload row counts.

## Translation and Enhanced UI

- Bump `PROMPT_VERSION` from 12 to 13 and add only general rules: preserve
  number/scope, tense/modality, actors, event order, and purpose clauses; do not
  add information; use natural register/collocations; remove dangling English
  modifiers. No test-sentence hints.
- Run 20 cues x VI/EN fresh, then verify cache hit and revision invalidation
  without reading or logging the key. An independent reviewer scores all 40
  pairs. Every field of every pair must score 2.
- The user directly reviews all 14 prompt-12 failures and every new row below 2.
  Record `cue | language | source | output | failed fields | decision |
  correction/note` with APPROVE/REJECT. A new prompt version requires a new run
  and fresh sign-off.
- Verify the real side panel displays VI/EN in Enhanced and preserves row counts
  after switching back to Original.

## Evidence, cleanup, and handoff

- Before the first test, create one new evidence bundle with `browser`,
  `sidepanel`, and `command` profiles. Record raw commands, exit codes,
  screenshots, panel state, ASR HTTP logs, and registered capture hashes. Leave
  the in-progress `20261031-231356` bundle untouched.
- Remove bridge files, manifest/HTML hooks, and test-only drivers after E2E;
  reload the extension and capture the normal side panel to prove cleanup.
- Run scoped Python/Node suites, real HTTP checks, `git diff`, `git diff --check`,
  and an independent review. Finish with `evidence.py check --finish`; the report
  must include `EVIDENCE`, `VERDICT`, `## Not tested`, `SURFACE`, `SIDEPANEL`,
  `SIDEPANEL SOURCE`, `BSK PROBE: no`, and the side-panel limitation.
- File the completion report under `review/` and update wiki index/log/topic. Do
  not commit or upload evidence.

## Interfaces and invariants

- `/asr/transcribe` gains optional word timestamps and bounded decode/context
  options; old responses remain valid.
- Candidate matching still returns one cue or `null`; output/provenance schemas
  do not change.
- Translation cache identity advances with prompt version 13; VI/EN output
  schema is unchanged.
- CER gates, the 0–2 rubric, 8 s/6.5 s cadence, and Apply/Skip/Undo semantics stay
  fixed.
