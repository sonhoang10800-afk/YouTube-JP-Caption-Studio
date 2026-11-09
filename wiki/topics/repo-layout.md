# Repo layout & Flatten execution (2026-08-05)

Status: **đã execute** (flatten done 2026-08-05). Root tree matches `README.md` layout; `youtube-jp-caption-studio/` wrapper deleted.

## Nguồn

- Plan: [plan/flatten-repo-layout-2026-08-05.md](../../plan/flatten-repo-layout-2026-08-05.md)
- Review: [review/flatten-repo-layout-execute-2026-08-05.md](../../review/flatten-repo-layout-execute-2026-08-05.md)

## Folder map

```text
# Product
extension/  local-bridge/  web/  macos-bridge-app/
ipad-app/   iphone-app/    scripts/  tools/  testdata/

# Knowledge / dataset owners
plan/  review/  wiki/  skills/
README.md  walkthrough.md   # product docs at ROOT (no docs/)
data/   # runtime — mostly gitignored

# Local only (gitignored)
.cursor/  .claude/  .obsidian/  .agents/  .vscode/  .codegraph/  .nodegraph/
*.sqlite*  .venv/  node_modules/
```

## Skill catalog (5 core skills)

`skills/ponytail`, `skills/codegraph`, `skills/language-caption`, `skills/local-bridge`, `skills/tokenize-regression`. `.cursor/skills` is a local symlink (gitignored).

## Knowledge map (§G — schema in CLAUDE.md §8)

| Loại | Chỗ đúng | GitHub? |
|------|----------|---------|
| Plan / review | `plan/`, `review/` | Có |
| Tổng hợp sống | `wiki/` | Có |
| Gist tham chiếu | `wiki/upstream/` | Có |
| Skill (5) | `skills/` | Có |
| Docs sản phẩm | Root `README` / `walkthrough` | Có |
| Deploy app | `ipad-app/Scripts/`, `iphone-app/Scripts/` | Có |
| Fixture test | `testdata/` | Có (nhỏ) |
| Dict / model | `data/dict/`, `local-bridge/data/` | Không (trừ seed nhỏ) |
| Subtitle runtime | `data/subtitles/` | Không |
| Config máy | `data/config/` | Không |
| Evidence tạm | `.tmp-*/` hoặc xóa | Không |
| IDE scratch | `.cursor/plans/`, `.agents/` | Không |

## Tool surface

- Bridge: `local-bridge/start.sh` → `127.0.0.1:8765` (`/health`, `/tokenize`, `/dict`, `/scripts/*`, `/ime/*`). Error log: `local-bridge/errors.log` (`ERROR:bridge:<msg>`).
- macOS menu-bar app: `macos-bridge-app/build.sh` (icon từ `ipad-app/Assets.xcassets`; `$BRIDGE` root ghi vào `bridge_root.txt`).
- Dict sqlite: `local-bridge/data/dict/dict.sqlite` (local, gitignored — từ `_stray-local-bridge-data/` merge 2026-08-05, đã xóa stray).

## Chi tiết thực thi Flatten (2026-08-05)

- **Flatten:** `git mv` `extension` `local-bridge` `web` `macos-bridge-app` `scripts` `tools` `testdata` `data` + `README.md` `walkthrough.md` `INCIDENTS.md` `Makefile` `docker-compose.yml` từ `youtube-jp-caption-studio/` → root; xóa wrapper rỗng.
- **GitHub lean:** `.gitignore` root hợp nhất (IDE/`*.sqlite*`/runtime); untrack `.cursor/` (rules, debug log), `.codegraph/`, `.vscode/`, `.cursor` + `docs/` của `web/saved-items`; xóa `.github/copilot-instructions.md`; xóa nested `.gitignore` + `AGENTS.md` + `CLAUDE.md`.
- **Skills:** Hợp nhất thành 5 core skills; xóa 5 meta `ponytail-*`; symlink local `.cursor/skills`.
- **Sync docs:** Cập nhật sync-line gọn, error-log phẳng (`local-bridge/errors.log`), feature docs, Bản đồ tri thức.
- **Stray dict:** `_stray-local-bridge-data/data/dict/dict.sqlite` (137M) → `local-bridge/data/dict/` (local); xóa `_stray-local-bridge-data/`.
- **Path cứng:** `macos-bridge-app/build.sh` (bỏ MONOREPO), `main.swift` fallback, DriveScriptsService iPad+iPhone, comment `script_store.py`.
- **Smoke:** bridge 35 files track; `/health` 200 `ready:true`; `/dict` `日本語`→Nhật Bản; `/tokenize` freq_ja; `/scripts` list; sqlite 4 bảng; Load-unpacked structure; `build.sh` build OK.

## Mở / Nợ kỹ thuật

- `en_vi.json` / `vnedict.txt` giữ track tạm (chưa có bootstrap/xác nhận docs seed — plan §A).
- Plan/review cũ trước ngày 2026-08-05 vẫn link path `youtube-jp-caption-studio/` — không sửa file immutable (disk wins khi sửa code).
- Wiki pages liên quan: [upstream/karpathy-llm-wiki.md](../upstream/karpathy-llm-wiki.md).
