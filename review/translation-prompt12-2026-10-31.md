<!-- date: 2026-10-31 -->
<!-- source: chat:d3bc · independent prompt-v12 VI/EN review and required human spot-check -->

# Translation prompt 12 — review and human spot-check

## Agent review

- Input: `.test-evidence/20261031-035129-audio-enhanced-final-in-app-2026-10-31/reports/translation-review-input-prompt12.json`
- Reviewer artifact: `agents/translation-reviewer-prompt12/review.md`
- Live run: `.test-evidence/20261031-035129-audio-enhanced-final-in-app-2026-10-31/commands/gemini-live-38-full-final.stdout`
- All 40 fresh results completed on `gemini-3.6-flash`; cache, revision invalidation, missing-key and dummy-key checks passed.
- Agent verdict: `FAIL`. 26/40 language-pair outputs scored 2 on all four fields; 14/40 had at least one field below 2.
- Field failures: meaning 4, naturalness 8, fidelity 10, format 0.

## Human spot-check

`HUMAN SPOT-CHECK: NOT VERIFIED`

No human reviewer has confirmed any row below. The manifest remains
`PENDING_AGENT_REVIEW`; this file does not claim human approval and does not
upgrade the corpus provenance.

| Cue | Language | Failed fields | Independent finding |
| --- | --- | --- | --- |
| 04 | VI | meaning, fidelity | Singular first bilateral visit became a plural set of visits. |
| 07 | VI | naturalness | `sự bất tin lẫn nhau` is not publishable Vietnamese. |
| 07 | EN | meaning, fidelity | Concrete action and forward-looking statement were conflated. |
| 08 | VI | naturalness, fidelity | `ứng xử` does not carry the intended concrete response/measure meaning. |
| 09 | VI | naturalness | Repeated awkward `sự bất tin lẫn nhau` collocation. |
| 12 | VI | naturalness | Closing is too blunt for the formal register. |
| 13 | VI | meaning, fidelity | Announced future tightening/investigation became current action. |
| 13 | EN | meaning, fidelity | `has tightened` contradicts the announced future action. |
| 14 | VI | naturalness, fidelity | Diplomatic demarche was rendered as a generic formal complaint. |
| 17 | VI | fidelity | Added independent action not present in the source. |
| 17 | EN | naturalness, fidelity | Added `independently` and weakened the natural supply-chain cooperation wording. |
| 19 | VI | naturalness | `Trước môi trường chiến lược hiện tại` is not idiomatic here. |
| 20 | VI | fidelity | Final purpose `for shuttle diplomacy` was omitted. |
| 20 | EN | naturalness, fidelity | Dangling `after taking place`, added `series`, and omitted `for shuttle diplomacy`. |

Exact source/output evidence and suggested corrections for every row are in
`agents/translation-reviewer-prompt12/review.json`.

## Not tested

- Real human quality confirmation for the 14 rows above.
- Real Chrome extension/sidepanel/Enhanced UI under the in-app-only constraint.
- Human listening to the source audio; the review used the frozen transcript and manifest.
