# Topic: Điểm chưa hợp lý 2026-11-22

## Status

**Mở.** Quét đọc code, chưa sửa product. Raw: [review/codebase-unreasonable-points-2026-11-22.md](../../review/codebase-unreasonable-points-2026-11-22.md).

## Đã thấy trên disk

- **P0.** `extension/content/content.js` nhận `AVS_SET_JIMAKU_KEY`, `AVS_SET_GEMINI_KEY`, `AVS_DEBUG_PING`, `AVS_TEST_TRANSLATE` từ `postMessage` không token. Content script chạy mọi http(s).
- **P1 side panel.** `SP_STATE` partial ghi đè `tabStates` (mất `videoId`/`cues`). `_seq` được ghi, không bị so để bỏ payload cũ. Tab Saved lọc bỏ `known`/`ignored`.
- **P1 iOS.** Wipe script `owned` không tải lại YouTube (`mergeWithLocal` trả cue chưa tombstone). `VocabDTO` thiếu `status`; merge bỏ từ đã có. iPhone `CueEditorRow` không sửa cue.
- **P1 bridge.** `POST /extension_state` thay cả map dù docstring nói partial. JSON hỏng → RAM rỗng → lần save sau đè file. Không auth trên loopback; CORS mọi extension id và mọi localhost.
- **P1 JLPT.** `BILINGUAL_MAP` khóa `どうして` và `出す` khai hai lần; bản sau thắng.
- **P1 test secret.** `anime_resolver_test.js` có fallback Jimaku key.

## Còn mở

Toàn bộ mục trên. Chưa có commit sửa.

## Mâu thuẫn wiki cũ

- Index audit 2026-10-22 vẫn “chưa remediate” trong khi topic đó đánh hầu hết dòng đã sửa. A-4 chưa hết: `capAcceptsReply` vẫn nhận reply khi `pageCapToken` rỗng.
- Index C-1 “chưa refactor” lệch plan và status topic (**HOÀN TẤT A–E**). Mục Open của `swift-shared-package.md` vẫn nói chưa có commit. `DriveScriptsService` và `ContentView` vẫn tách hai app. Header `MIRRORED FILE` còn trong `ios-shared` dù plan ghi grep = 0.
- Index P0 data-loss “done”; topic vẫn để extension chưa merge từng cue.

## Neo code

- `extension/content/content.js` — message page, `capAcceptsReply`, `publishSidePanelPartial`
- `extension/sidepanel/sidepanel.js` — `tabStates`, `_seq`, lọc Saved
- `extension/shared/vocab_style.js` — `BILINGUAL_MAP`
- `local-bridge/app/api/state.py` — load/save extension state
- `ios-shared/Sources/CaptionShared/Models/ScriptStore.swift` — `owned` + `wipeAll`
- `ios-shared/Sources/CaptionShared/Services/BackupService.swift` — vocab merge
