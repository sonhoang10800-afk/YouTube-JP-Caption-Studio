# Topic: Gộp Swift trùng giữa 2 app (C-1)

## Status

**HOÀN TẤT A–E.** Raw plan:
[plan/swift-shared-package-2026-10-23.md](../../plan/swift-shared-package-2026-10-23.md).
Finding gốc: [review/codebase-audit-2026-10-22.md](../../review/codebase-audit-2026-10-22.md) C-1.

## Số liệu (đo trên disk 2026-10-23)

- **20/25 file .swift giống hệt byte-for-byte — 4 141 LOC.**
- 5 file khác: `DriveScriptsService` (739), `ContentView` (1218), `CueEditorRow` (329),
  `SidePanelToolbar` (162), `YouTubePlayerView` (322).
- Convention hiện tại là header `MIRRORED FILE — apply every change to BOTH copies`; cơ chế này
  **đã hỏng ≥3 lần** (B-6, B-10, B-11), nên nó là nguồn lỗi chứ không phải biện pháp.

## Quyết định (user, 2026-10-23)

User chọn **chỉ lập plan, chưa refactor** trong phiên này. Plan đầy đủ ở file raw, gồm:

1. Phương án chọn: local SwiftPM package `ios-shared/` + library `CaptionShared`, 2 `project.yml`
   khai báo package, `xcodegen generate` vẫn là đường build duy nhất.
2. Phương án bị loại: symlink, script copy lúc build, gộp 2 target.
3. **Rủi ro #1: SwiftData store** — 3 `@Model` đổi module có thể làm store cũ không mở được;
   phải test trên máy thật với dữ liệu thật, backup bằng `BackupService` trước; fallback giữ
   `Models/` ở lại mỗi app (vẫn xoá được ~2 500 LOC trùng).
4. Bước tuần tự A→E (mỗi bước 1 commit, build + `swift_store_smoke` xanh, bisect được).
5. Acceptance: chỉ còn 6 file khác nhau; `grep MIRRORED FILE` = 0; 2 app build Debug+Release;
   smoke 2 app exit 0; CI `ios-build` xanh; **test thiết bị** cho bước Models.

## Open

- A–E đã có trên disk (`ios-shared/`, plan ghi **HOÀN TẤT**). Dòng “chưa có commit” là lệch.
- Vẫn tách mỗi app: `DriveScriptsService.swift`, `ContentView.swift` (quét 2026-11-22).
- Header `MIRRORED FILE` còn trong vài file `ios-shared` dù plan ghi grep = 0.

## Liên quan

- `scripts/swift_store_smoke.sh` — harness macOS hiện compile file trong `ipad-app/`; sau bước A phải
  trỏ sang `ios-shared/Sources/CaptionShared/`.
- `scripts/verify_no_fake_tests.js` — không đụng tới Swift.
