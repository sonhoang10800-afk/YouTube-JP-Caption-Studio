# Wiki index — plans & reviews

LLM-maintained layer over immutable `plan/` and `review/` (Karpathy LLM-wiki pattern).  
**You read; the LLM writes.** Schema: root [`CLAUDE.md`](../CLAUDE.md).

## Navigation

| Page | Summary |
|------|---------|
| [topics/code-taste-migration.md](topics/code-taste-migration.md) | Plan + native hooks installed; full IDE coverage **NOT VERIFIED** |
| [log.md](log.md) | Append-only ingest / query / lint timeline |
| [topics/repo-layout.md](topics/repo-layout.md) | Folder map + skill catalog + knowledge map §G — **xong** (flatten 2026-08-05) |
| [topics/flatten-repo-layout.md](topics/flatten-repo-layout.md) | Flatten repo layout execution — **xong** (2026-08-05) |
| [topics/p0-data-loss.md](topics/p0-data-loss.md) | Drive cue-merge + backup + extension rev guard — **done** (2026-08-05) |
| [topics/local-bridge-audit.md](topics/local-bridge-audit.md) | Bridge audit 2026-08-06 — **5/10 fixed, LB-6 tracked in perf audit, 4/10 open** |
| [topics/plans-completion.md](topics/plans-completion.md) | Inventory 17 plans — **product plans done / YAGNI cancelled** (2026-08-07) |
| [topics/codebase-review-2026-08-07.md](topics/codebase-review-2026-08-07.md) | Full source review — **closed** (2026-08-07): C1/H1–H8/M1–M10 all fixed |
| [topics/sub-load-furigana-100ms.md](topics/sub-load-furigana-100ms.md) | Sub load nhanh + furigana/level ≤100 ms — **done** (T1–T5 verified 2026-08-20) |
| [topics/netflix-support.md](topics/netflix-support.md) | Netflix subtitle support (DFXP/TTML + player hooks) — **shipped** (2026-08-19) |
| [topics/vietnamese-caption-loading.md](topics/vietnamese-caption-loading.md) | VI caption load fixes + Netflix parallel fetch — **shipped code, chờ test thật** (2026-08-21) |
| [topics/codebase-improvements-2026-08-22.md](topics/codebase-improvements-2026-08-22.md) | Codebase improvement plan (behavior-preserving) — **partial** (2026-08-23) |
| [topics/perf-ux-audit-2026-08-23.md](topics/perf-ux-audit-2026-08-23.md) | Multi-agent perf sweep + UX benchmark — **open** (2026-08-23) |
| [topics/overlay-resize-and-dual-subtitles.md](topics/overlay-resize-and-dual-subtitles.md) | Overlay resize + dual subtitles — **done** (2026-09-19) |
| [topics/studio-caption-fixes-and-ux-optimization.md](topics/studio-caption-fixes-and-ux-optimization.md) | Studio caption fixes, performance & UX optimization — **done** (2026-09-19) |
| [topics/youtube-sentence-enhancement-mvp.md](topics/youtube-sentence-enhancement-mvp.md) | YouTube sentence MVP — isolated real Chrome restore/Undo/reload/API PASS; main delivered; native activation/Gemini/Drive/full MVP open |
| [topics/audio-listening-model.md](topics/audio-listening-model.md) | Audio Listening Model — gated M0-M3 implemented; waiting human auditory ground truth review |
| [topics/p0-remediation-2026-10-20.md](topics/p0-remediation-2026-10-20.md) | P0 + P1 + P2 remediation of the 2026-10-18 full-codebase audit — **merged into `master`** (2fff75c48, all rows fixed + verified) |
| [topics/codebase-audit-2026-10-22.md](topics/codebase-audit-2026-10-22.md) | New full-repo audit — **8 P0 / 24 P1 open, not remediated** (2026-10-22) |
| [topics/swift-shared-package.md](topics/swift-shared-package.md) | Gộp 4 141 LOC Swift trùng (C-1) — **plan filed, chưa refactor** |
| [topics/extension-ux-verify-2026-10-24.md](topics/extension-ux-verify-2026-10-24.md) | Overlay **FAIL → fix `b155a56` → PASS live**; F1/F2 `d3b53f7`; C-7 UI; star `6a70ea7`; MP4; reload `812799f`; **sidepanel PASS**; CI gap |
| [upstream/karpathy-llm-wiki.md](upstream/karpathy-llm-wiki.md) | Karpathy LLM-wiki gist (concept) |

## Active / recent work

| Status | Topic | Plan | Review |
|--------|-------|------|--------|
| shipped | [P0 remediation 2026-10-20](topics/p0-remediation-2026-10-20.md) | [plan](../plan/p0-remediation-2026-10-20.md) | [full-codebase audit](../review/full-codebase-improvement-audit-2026-10-18.md) |
| gated M0-M3 implemented | [Audio listening model](topics/audio-listening-model.md) | [gated plan](../plan/audio-listening-model-2026-10-12.md) | [audio feasibility M0](../review/audio-access-feasibility-2026-10-12.md), [ASR benchmark M1/M2](../review/asr-benchmark-2026-10-12.md) |
| active / legacy TXT deployed; isolated UI Undo reload fixed/main delivered; native activation/Drive/gold/Gemini/KPI open | [YouTube sentence enhancement MVP](topics/youtube-sentence-enhancement-mvp.md) | [latest revised plan](../plan/youtube-sentence-enhancement-mvp-2026-10-10.md), [prior filed plan](../plan/youtube-sentence-enhancement-mvp-2026-10-09.md), [execution decisions](../plan/youtube-sentence-mvp-execution-decisions-2026-10-09.md) | [source audit](../review/youtube-sentence-mvp-source-audit-2026-10-10.md), [queue/NLP/restore](../review/youtube-sentence-mvp-queue-nlp-backup-2026-10-10.md), [broker lifecycle](../review/youtube-sentence-mvp-broker-lifecycle-2026-10-10.md), [native cache identity](../review/youtube-sentence-mvp-native-cache-identity-2026-10-10.md), [source fingerprint](../review/youtube-sentence-mvp-source-fingerprint-2026-10-10.md), [runtime metrics](../review/youtube-sentence-mvp-runtime-metrics-2026-10-10.md), [selected track](../review/youtube-sentence-mvp-selected-track-2026-10-10.md), [script clock precision](../review/youtube-sentence-mvp-script-clock-precision-2026-10-10.md), [annotation candidates](../review/youtube-sentence-mvp-annotation-candidates-2026-10-10.md), [usage/cost](../review/youtube-sentence-mvp-cost-instrumentation-2026-10-10.md), [native metrics activation](../review/youtube-sentence-mvp-native-metrics-activation-2026-10-10.md), [metric clock](../review/youtube-sentence-mvp-metric-clock-2026-10-10.md), [TXT warning](../review/youtube-sentence-mvp-txt-export-warning-2026-10-10.md), [flags/native follow-up](../review/youtube-sentence-mvp-flags-native-followup-2026-10-10.md), [lifecycle](../review/youtube-sentence-mvp-lifecycle-instrumentation-2026-10-10.md), [native lifecycle](../review/youtube-sentence-mvp-native-lifecycle-2026-10-10.md), [bridge regression/runtime](../review/youtube-sentence-mvp-bridge-regression-runtime-2026-10-10.md), [native confirmation/source guard](../review/youtube-sentence-mvp-native-confirmation-source-guard-2026-10-10.md), [partial creator reference](../review/youtube-sentence-mvp-creator-reference-partial-2026-10-10.md), [Backrooms frame readiness/reference](../review/youtube-sentence-mvp-rra-reference-readiness-2026-10-10.md), [ordinal continuation](../review/youtube-sentence-mvp-ordinal-continuation-2026-10-10.md), [bilingual active-cue JLPT](../review/youtube-sentence-mvp-bilingual-active-cue-2026-10-10.md), [native latest reload/cost-clock](../review/youtube-sentence-mvp-native-latest-reload-cost-clock-2026-10-10.md), [semantic/runtime authority follow-up](../review/youtube-sentence-mvp-semantic-runtime-authority-2026-10-10.md), [live tokenizer recheck](../review/youtube-sentence-mvp-semantic-tokenizer-recheck-2026-10-10.md), [native bilingual package follow-up](../review/youtube-sentence-mvp-native-bilingual-package-followup-2026-10-10.md), [Enhanced default](../review/youtube-sentence-mvp-enhanced-default-2026-10-11.md), [delivery/evidence correction](../review/youtube-sentence-mvp-default-delivery-2026-10-11.md), [runtime/import clocks](../review/youtube-sentence-mvp-runtime-and-import-clocks-2026-10-11.md), [renderer independent](../review/youtube-sentence-mvp-renderer-independent-2026-10-11.md), [caller correction](../review/youtube-sentence-mvp-renderer-callers-correction-2026-10-11.md), [cue provenance/exact revision](../review/youtube-sentence-mvp-cue-provenance-2026-10-11.md), [source restore/runtime deployment](../review/youtube-sentence-mvp-source-restore-runtime-2026-10-11.md), [partial native reload and current data delta](../review/youtube-sentence-mvp-native-reload-partial-2026-10-11.md), [stale revision guard](../review/youtube-sentence-mvp-stale-revision-guard-2026-10-11.md), [revision deployment/mirror validation](../review/youtube-sentence-mvp-revision-deploy-mirror-validation-2026-10-11.md), [mirror deployment/revision race](../review/youtube-sentence-mvp-mirror-deploy-revision-race-2026-10-11.md), [equal-revision conflict](../review/youtube-sentence-mvp-equal-revision-conflict-2026-10-11.md), [conflict deployment / legacy TXT](../review/youtube-sentence-mvp-conflict-deploy-legacy-txt-2026-10-11.md), [legacy JSON/TXT candidate](../review/youtube-sentence-mvp-legacy-txt-sync-2026-10-11.md), [authorized legacy TXT deployment](../review/youtube-sentence-mvp-legacy-txt-deployment-2026-10-11.md), [native legacy checkpoint](../review/youtube-sentence-mvp-native-legacy-checkpoint-2026-10-11.md), [Chrome storage restart](../review/youtube-sentence-mvp-chrome-storage-restart-2026-10-11.md), [content Undo reload](../review/youtube-sentence-mvp-content-undo-reload-2026-10-11.md) |
| partial | Code taste: migration plan and edit hooks | [plan](../plan/migrate-codebase-to-house-style-2026-09-20.md) | [Live client evidence and gaps](../review/code-taste-other-clients-live-2026-09-20.md) |
| done | Studio Caption Fixes, Performance & UX Optimization | [fix-overlay-resize-and-subtitles](../plan/fix-overlay-resize-and-subtitles-2026-09-19.md), [fix-sidepanel-format-and-jp-only-overlay](../plan/fix-sidepanel-format-and-jp-only-overlay-2026-09-19.md) | (filed `code-review-2026-09-19.md` was never committed — no review exists for this work) |
| open — 8 P0 / 24 P1, not yet remediated | [Codebase audit 2026-10-22](topics/codebase-audit-2026-10-22.md) | — | [audit](../review/codebase-audit-2026-10-22.md) |
| PASS after fix `b155a56`; F1/F2 `d3b53f7`; C-7 UI; star `6a70ea7`; MP4; reload `812799f`; sidepanel PASS; CI gap | [Extension UX verify 2026-10-24](topics/extension-ux-verify-2026-10-24.md) | [plan](../plan/extension-ux-verify-bsk-2026-10-24.md) | [pre-fix FAIL](../review/ux-verify-2026-10-24.md), [post-fix PASS](../review/ux-verify-fix-2026-10-24.md), [matrix](../review/ux-verify-matrix-postfix-2026-10-24.md), [F1/F2 fix](../review/ux-verify-matrix-fix-2026-10-24.md), [C-7 UI](../review/ux-verify-c7-ui-2026-10-24.md), [star](../review/star-rehydration-2026-10-24.md), [MP4](../review/ux-verify-mp4-2026-10-24.md), [reload](../review/reload-helper-hardening-2026-10-24.md), [sidepanel](../review/sidepanel-smoke-2026-10-24.md) |

## Raw catalogs (immutable)

Do not rewrite these from the wiki. Link only.

### Plans (`plan/`)

- [youtube-sentence-enhancement-mvp-2026-10-10.md](../plan/youtube-sentence-enhancement-mvp-2026-10-10.md) — latest byte-preserved user revision
- [youtube-sentence-enhancement-mvp-2026-10-09.md](../plan/youtube-sentence-enhancement-mvp-2026-10-09.md)
- [youtube-sentence-mvp-execution-decisions-2026-10-09.md](../plan/youtube-sentence-mvp-execution-decisions-2026-10-09.md)

- [caption-bugs-ui-and-auto-modes-2026-10-12.md](../plan/caption-bugs-ui-and-auto-modes-2026-10-12.md)
- [enhance-audio-db-sync-overhaul-2026-10-16.md](../plan/enhance-audio-db-sync-overhaul-2026-10-16.md)
- [fix-overlay-resize-and-subtitles-2026-09-19.md](../plan/fix-overlay-resize-and-subtitles-2026-09-19.md)
- [ja-vi-studio-dictionary-2026-08-26.md](../plan/ja-vi-studio-dictionary-2026-08-26.md)
- [whisper-turbo-audio-evaluation-2026-10-17.md](../plan/whisper-turbo-audio-evaluation-2026-10-17.md)
- [swift-shared-package-2026-10-23.md](../plan/swift-shared-package-2026-10-23.md) — plan C-1: gộp 4 141 LOC Swift trùng, chưa refactor

- [agent-code-taste-migration-research-2026-09-20.md](../plan/agent-code-taste-migration-research-2026-09-20.md)
- [migrate-codebase-to-house-style-2026-09-20.md](../plan/migrate-codebase-to-house-style-2026-09-20.md)
- [auto-dich-sau-edit-2026-07-28.md](../plan/auto-dich-sau-edit-2026-07-28.md)
- [bridge-ram-sqlite-2026-08-01.md](../plan/bridge-ram-sqlite-2026-08-01.md)
- [codebase-improvement-plan-2026-08-22.md](../plan/codebase-improvement-plan-2026-08-22.md)
- [codebase-improvement-plan-2026-08-23.md](../plan/codebase-improvement-plan-2026-08-23.md)
- [codebase-improvement-plan-2026-08-26.md](../plan/codebase-improvement-plan-2026-08-26.md)
- [drive-folder-mirror-2026-08-02.md](../plan/drive-folder-mirror-2026-08-02.md)
- [fix-caption-throttle-stall-2026-08-24.md](../plan/fix-caption-throttle-stall-2026-08-24.md)
- [fix-missing-netflix-subs-2026-08-21.md](../plan/fix-missing-netflix-subs-2026-08-21.md)
- [fix-sidepanel-format-and-jp-only-overlay-2026-09-19.md](../plan/fix-sidepanel-format-and-jp-only-overlay-2026-09-19.md)
- [fix-sub-loading-blackout-2026-08-21.md](../plan/fix-sub-loading-blackout-2026-08-21.md)
- [fix-sub-loading-multitab-sidepanel-ui-2026-08-21.md](../plan/fix-sub-loading-multitab-sidepanel-ui-2026-08-21.md)
- [fix-yt-timedtext-empty-caption-2026-08-24.md](../plan/fix-yt-timedtext-empty-caption-2026-08-24.md)
- [flatten-repo-layout-2026-08-05.md](../plan/flatten-repo-layout-2026-08-05.md)
- [ipad-app-review-and-fix-plan-2026-08-04.md](../plan/ipad-app-review-and-fix-plan-2026-08-04.md)
- [ipad-build-run-signing-2026-08-02.md](../plan/ipad-build-run-signing-2026-08-02.md)
- [ipad-mvp-feature-parity-2026-08-02.md](../plan/ipad-mvp-feature-parity-2026-08-02.md)
- [iphone-app-normalized-2026-08-02.md](../plan/iphone-app-normalized-2026-08-02.md)
- [master-caption-translate-2026-07-28.md](../plan/master-caption-translate-2026-07-28.md)
- [multi-agent-review-plan-2026-07-29.md](../plan/multi-agent-review-plan-2026-07-29.md)
- [netflix-caption-fixes-2026-08-19.md](../plan/netflix-caption-fixes-2026-08-19.md)
- [netflix-caption-support-2026-08-19.md](../plan/netflix-caption-support-2026-08-19.md)
- [netflix-en-vi-caption-fix-2026-08-21.md](../plan/netflix-en-vi-caption-fix-2026-08-21.md)
- [netflix-replay-and-edit-fixes-2026-08-20.md](../plan/netflix-replay-and-edit-fixes-2026-08-20.md)
- [next-prev-settings-drive-2026-08-02.md](../plan/next-prev-settings-drive-2026-08-02.md)
- [normalize-docs-and-errors-2026-08-02.md](../plan/normalize-docs-and-errors-2026-08-02.md)
- [optimize-sub-loading-speed-2026-08-21.md](../plan/optimize-sub-loading-speed-2026-08-21.md)
- [overlay-multi-sub-2026-08-02.md](../plan/overlay-multi-sub-2026-08-02.md)
- [p0-data-loss-fixes-2026-08-04.md](../plan/p0-data-loss-fixes-2026-08-04.md)
- [p0-data-loss-fixes-2026-08-05.md](../plan/p0-data-loss-fixes-2026-08-05.md)
- [studio-caption-fixes-and-ux-optimization-2026-09-19.md](../plan/fix-overlay-resize-and-subtitles-2026-09-19.md) — filed plan was never committed; links to the two real 2026-09-19 plans that cover the same work
- [sub-load-furigana-100ms-2026-08-08.md](../plan/sub-load-furigana-100ms-2026-08-08.md)
- [timeline-yt-multi-sub-2026-08-02.md](../plan/timeline-yt-multi-sub-2026-08-02.md)
- [vietnamese-caption-fixes-2026-08-21.md](../plan/vietnamese-caption-fixes-2026-08-21.md)
- [yt-write-all-subs-2026-08-02.md](../plan/yt-write-all-subs-2026-08-02.md)
- [extension-ux-verify-bsk-2026-10-24.md](../plan/extension-ux-verify-bsk-2026-10-24.md) — Plan v3: verify extension UX/UI in the real Chrome via bsk; executed with review + fix

### Reviews

- [Actual content Undo reload](../review/youtube-sentence-mvp-content-undo-reload-2026-10-11.md) — isolated restore/Undo/reload/API and guarded main delivery PASS; native/full MVP open
- [Real Chrome storage restart](../review/youtube-sentence-mvp-chrome-storage-restart-2026-10-11.md) — isolated MV3 local durability PASS; content restore/Drive/Gemini/fullMVP open

- [Native legacy checkpoint](../review/youtube-sentence-mvp-native-legacy-checkpoint-2026-10-11.md) — actual reload/export and independent bounded artifact PASS; protected/Gemini/fullMVP NOT VERIFIED

- [youtube-sentence-mvp-conflict-deploy-legacy-txt-2026-10-11.md](../review/youtube-sentence-mvp-conflict-deploy-legacy-txt-2026-10-11.md) — authorized2backend+worker delivered;48data preserved; separate legacy JSON/TXT diagnostic contradicted

- [youtube-sentence-mvp-equal-revision-conflict-2026-10-11.md](../review/youtube-sentence-mvp-equal-revision-conflict-2026-10-11.md) — same-revision collision Red/Green; explicit revision/worker candidate independentlyPASS/notdeployed

- [youtube-sentence-mvp-mirror-deploy-revision-race-2026-10-11.md](../review/youtube-sentence-mvp-mirror-deploy-revision-race-2026-10-11.md) — approved one-file mirror deployment/PID8005/48preserved; separate revision/worker candidate PASS/notdeployed, equal-rev boundary open

- [youtube-sentence-mvp-revision-deploy-mirror-validation-2026-10-11.md](../review/youtube-sentence-mvp-revision-deploy-mirror-validation-2026-10-11.md) — approved revision deployment48preserved; mirror validation candidate PASS/notdeployed; partial human references

- [youtube-sentence-mvp-stale-revision-guard-2026-10-11.md](../review/youtube-sentence-mvp-stale-revision-guard-2026-10-11.md)

- [youtube-sentence-mvp-native-reload-partial-2026-10-11.md](../review/youtube-sentence-mvp-native-reload-partial-2026-10-11.md) (`review/`)

- [youtube-sentence-mvp-source-restore-runtime-2026-10-11.md](../review/youtube-sentence-mvp-source-restore-runtime-2026-10-11.md) (`review/`)

- [youtube-sentence-mvp-cue-provenance-2026-10-11.md](../review/youtube-sentence-mvp-cue-provenance-2026-10-11.md)
- [youtube-sentence-mvp-renderer-independent-2026-10-11.md](../review/youtube-sentence-mvp-renderer-independent-2026-10-11.md)
- [youtube-sentence-mvp-renderer-callers-correction-2026-10-11.md](../review/youtube-sentence-mvp-renderer-callers-correction-2026-10-11.md)

- [youtube-sentence-mvp-runtime-and-import-clocks-2026-10-11.md](../review/youtube-sentence-mvp-runtime-and-import-clocks-2026-10-11.md)

- [youtube-sentence-mvp-enhanced-default-2026-10-11.md](../review/youtube-sentence-mvp-enhanced-default-2026-10-11.md)
- [youtube-sentence-mvp-default-delivery-2026-10-11.md](../review/youtube-sentence-mvp-default-delivery-2026-10-11.md)

- [youtube-sentence-mvp-semantic-tokenizer-recheck-2026-10-10.md](../review/youtube-sentence-mvp-semantic-tokenizer-recheck-2026-10-10.md)
- [youtube-sentence-mvp-native-bilingual-package-followup-2026-10-10.md](../review/youtube-sentence-mvp-native-bilingual-package-followup-2026-10-10.md)
- [youtube-sentence-mvp-native-latest-reload-cost-clock-2026-10-10.md](../review/youtube-sentence-mvp-native-latest-reload-cost-clock-2026-10-10.md)
- [youtube-sentence-mvp-bilingual-active-cue-2026-10-10.md](../review/youtube-sentence-mvp-bilingual-active-cue-2026-10-10.md)

- [youtube-sentence-mvp-ordinal-continuation-2026-10-10.md](../review/youtube-sentence-mvp-ordinal-continuation-2026-10-10.md)

- [youtube-sentence-mvp-rra-reference-readiness-2026-10-10.md](../review/youtube-sentence-mvp-rra-reference-readiness-2026-10-10.md)

- [youtube-sentence-mvp-creator-reference-partial-2026-10-10.md](../review/youtube-sentence-mvp-creator-reference-partial-2026-10-10.md)

- [youtube-sentence-mvp-native-confirmation-source-guard-2026-10-10.md](../review/youtube-sentence-mvp-native-confirmation-source-guard-2026-10-10.md)

- [youtube-sentence-mvp-native-lifecycle-2026-10-10.md](../review/youtube-sentence-mvp-native-lifecycle-2026-10-10.md)

- [youtube-sentence-mvp-lifecycle-instrumentation-2026-10-10.md](../review/youtube-sentence-mvp-lifecycle-instrumentation-2026-10-10.md)

- [youtube-sentence-mvp-flags-native-followup-2026-10-10.md](../review/youtube-sentence-mvp-flags-native-followup-2026-10-10.md)

- [youtube-sentence-mvp-txt-export-warning-2026-10-10.md](../review/youtube-sentence-mvp-txt-export-warning-2026-10-10.md)

- [youtube-sentence-mvp-metric-clock-2026-10-10.md](../review/youtube-sentence-mvp-metric-clock-2026-10-10.md)

- [youtube-sentence-mvp-cost-instrumentation-2026-10-10.md](../review/youtube-sentence-mvp-cost-instrumentation-2026-10-10.md)
- [youtube-sentence-mvp-native-metrics-activation-2026-10-10.md](../review/youtube-sentence-mvp-native-metrics-activation-2026-10-10.md)

- [youtube-sentence-mvp-broker-lifecycle-2026-10-10.md](../review/youtube-sentence-mvp-broker-lifecycle-2026-10-10.md)
- [youtube-sentence-mvp-native-cache-identity-2026-10-10.md](../review/youtube-sentence-mvp-native-cache-identity-2026-10-10.md)

- [youtube-sentence-mvp-queue-nlp-backup-2026-10-10.md](../review/youtube-sentence-mvp-queue-nlp-backup-2026-10-10.md)

- [youtube-sentence-mvp-source-audit-2026-10-10.md](../review/youtube-sentence-mvp-source-audit-2026-10-10.md)
- [youtube-sentence-mvp-source-fingerprint-2026-10-10.md](../review/youtube-sentence-mvp-source-fingerprint-2026-10-10.md)
- [youtube-sentence-mvp-runtime-metrics-2026-10-10.md](../review/youtube-sentence-mvp-runtime-metrics-2026-10-10.md)
- [youtube-sentence-mvp-selected-track-2026-10-10.md](../review/youtube-sentence-mvp-selected-track-2026-10-10.md)
- [youtube-sentence-mvp-script-clock-precision-2026-10-10.md](../review/youtube-sentence-mvp-script-clock-precision-2026-10-10.md)
- [youtube-sentence-mvp-annotation-candidates-2026-10-10.md](../review/youtube-sentence-mvp-annotation-candidates-2026-10-10.md)

- [antigravity-hook-retry-2026-09-20.md](../review/antigravity-hook-retry-2026-09-20.md)
- [code-taste-other-clients-live-2026-09-20.md](../review/code-taste-other-clients-live-2026-09-20.md)
- [code-taste-codex-live-probe-2026-09-20.md](../review/code-taste-codex-live-probe-2026-09-20.md)
- [code-taste-hooks-followup-2026-09-20.md](../review/code-taste-hooks-followup-2026-09-20.md)
- [code-taste-hooks-verification-2026-09-20.md](../review/code-taste-hooks-verification-2026-09-20.md)
- [bridge-refactor-review-pass-2026-07-29.md](../review/bridge-refactor-review-pass-2026-07-29.md)
- [bugbot-review-2026-08-01.md](../review/bugbot-review-2026-08-01.md)
- [caption-bugs-ui-and-auto-modes-review-2026-10-12.md](../review/caption-bugs-ui-and-auto-modes-review-2026-10-12.md)
- [enhance-audio-db-sync-overhaul-review-2026-10-16.md](../review/enhance-audio-db-sync-overhaul-review-2026-10-16.md)
- [codebase-audit-2026-10-22.md](../review/codebase-audit-2026-10-22.md) — **8 P0 / 24 P1**; vocab data-loss both directions, iPhone bridge dead, popup broken on fresh clone
- [codebase-review-2026-07-29.md](../review/codebase-review-2026-07-29.md)
- [codebase-review-2026-08-04.md](../review/codebase-review-2026-08-04.md)
- [codebase-review-2026-08-07.md](../review/codebase-review-2026-08-07.md)
- [codebase-review-2026-08-23.md](../review/codebase-review-2026-08-23.md)
- [deepseek-ipad-code-review-2026-08-04.md](../review/deepseek-ipad-code-review-2026-08-04.md)
- [deepseek-ipad-review-eval-2026-08-04.md](../review/deepseek-ipad-review-eval-2026-08-04.md)
- [extension-web-refactor-review-pass-2026-07-29.md](../review/extension-web-refactor-review-pass-2026-07-29.md)
- [fix-missing-netflix-subs-review-2026-08-21.md](../review/fix-missing-netflix-subs-review-2026-08-21.md)
- [fix-sub-loading-blackout-review-2026-08-21.md](../review/fix-sub-loading-blackout-review-2026-08-21.md)
- [flatten-repo-layout-execute-2026-08-05.md](../review/flatten-repo-layout-execute-2026-08-05.md)
- [local-bridge-audit-2026-08-06.md](../review/local-bridge-audit-2026-08-06.md)
- [multi-model-desktop-bugs-perf-2026-08-03.md](../review/multi-model-desktop-bugs-perf-2026-08-03.md)
- [netflix-en-vi-caption-fix-review-2026-08-21.md](../review/netflix-en-vi-caption-fix-review-2026-08-21.md)
- [netflix-replay-edit-verify-2026-08-20.md](../review/netflix-replay-edit-verify-2026-08-20.md)
- [netflix-vi-caption-fix-review-2026-08-21.md](../review/netflix-vi-caption-fix-review-2026-08-21.md)
- [optimize-sub-loading-speed-review-2026-08-21.md](../review/optimize-sub-loading-speed-review-2026-08-21.md)
- [p0-data-loss-fixes-review-2026-08-05.md](../review/p0-data-loss-fixes-review-2026-08-05.md)
- [p0-fixes-report-2026-08-04.md](../review/p0-fixes-report-2026-08-04.md)
- [perf-ux-audit-2026-08-23.md](../review/perf-ux-audit-2026-08-23.md)
- [plans-completion-check-2026-08-07.md](../review/plans-completion-check-2026-08-07.md)

- [youtube-sentence-mvp-bridge-regression-runtime-2026-10-10.md](../review/youtube-sentence-mvp-bridge-regression-runtime-2026-10-10.md)

- [ux-test-2026-10-23.md](../review/ux-test-2026-10-23.md) — real-machine backend/iOS/extension test round 2026-10-23; CSP inject bug + iOS Debug crash evidence
- [ux-verify-2026-10-24.md](../review/ux-verify-2026-10-24.md) — pre-fix FAIL: overlay never renders cues (stale cap in MAIN world + slow ANDROID path discarded); evidence pack
- [ux-verify-fix-2026-10-24.md](../review/ux-verify-fix-2026-10-24.md) — post-fix PASS after `b155a56`: 4/4 flows, C-7 data layer, mobile 44px
- [ux-verify-matrix-postfix-2026-10-24.md](../review/ux-verify-matrix-postfix-2026-10-24.md) — 3-viewport matrix PASS WITH ISSUES: F1 mobile bar overflow, F2 ctrl touch targets <44
- [ux-verify-matrix-postfix-evidence-2026-10-24/](../review/ux-verify-matrix-postfix-evidence-2026-10-24/) — matrix screenshots, probe/measure/console/keyboard JSON
- [ux-verify-matrix-fix-2026-10-24.md](../review/ux-verify-matrix-fix-2026-10-24.md) — F1/F2 fix verified: mobile bar inside video + ctrl 44×44; tablet/desktop unchanged
- [ux-verify-matrix-fix-evidence-2026-10-24/](../review/ux-verify-matrix-fix-evidence-2026-10-24/) — pre/post measurements, fix screenshots, probe/console JSON
- [ux-verify-c7-ui-2026-10-24.md](../review/ux-verify-c7-ui-2026-10-24.md) — C-7 UI row PASS WITH ISSUES: Saved Items row shows videoTitle; real popup blocked (bsk/System Events)
- [star-rehydration-2026-10-24.md](../review/star-rehydration-2026-10-24.md) — star matcher fallback + unit tests + live persistence (commit 6a70ea7)
- [ux-verify-mp4-2026-10-24.md](../review/ux-verify-mp4-2026-10-24.md) — post-fix 35 s MP4 of overlay + dict flow (criterion e)
- [enhancement-fallback-repro-2026-10-24.md](../review/enhancement-fallback-repro-2026-10-24.md) — first page after extension reload loses tokens; root cause + helper fix recommendation
- [reload-helper-hardening-2026-10-24.md](../review/reload-helper-hardening-2026-10-24.md) — reload → verify → refresh order; new page after reload gets 12 tokens (commit 812799f)
- [sidepanel-smoke-2026-10-24.md](../review/sidepanel-smoke-2026-10-24.md) — real sidepanel smoke PASS: 360 px, tabs/click/close, window-only visual
- [ux-verify-evidence-2026-10-24/](../review/ux-verify-evidence-2026-10-24/) + [ux-verify-fix-evidence-2026-10-24/](../review/ux-verify-fix-evidence-2026-10-24/) — screenshots, before/after JSON, test log

## Open gaps

Tracked lightly until ingested into their own topic pages:

- Extension cue-merge (only rev-skip today)
- iPhone fullscreen pinning drift

- [Legacy JSON/TXT mirror reconciliation — candidate, not deployed](../review/youtube-sentence-mvp-legacy-txt-sync-2026-10-11.md) — 2026-10-11; independent bounded PASS; full MVP open.

- [Authorized legacy JSON/TXT deployment](../review/youtube-sentence-mvp-legacy-txt-deployment-2026-10-11.md) — 2026-10-11; independent one-file deployment PASS; full MVP incomplete.
