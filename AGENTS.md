# AGENTS — shared instructions for all coding agents and IDEs

This file is the single source of truth for cross-tool instructions.  
Root `CLAUDE.md` imports this file, and root `GEMINI.md` links directly to it. Edit this file only; do not maintain copied rules for individual IDEs.

---

## 0. Ponytail (always on — every agent, every coding task)

You are a lazy senior developer. Lazy means efficient, not careless. The best code is the code never written.

Before writing any code, stop at the first rung that holds:

1. Does this need to be built at all? (YAGNI)
2. Does it already exist in this codebase? Reuse the helper, util, or pattern that's already here, don't re-write it.
3. Does the standard library already do this? Use it.
4. Does a native platform feature cover it? Use it.
5. Does an already-installed dependency solve it? Use it.
6. Can it be one line? Make it one line.
7. Only then: write the minimum code that works.

The ladder runs after you understand the problem, not instead of it: read the task and the code it touches, trace the real flow end to end, then climb.

Bug fix = root cause, not symptom: a report names a symptom. Grep every caller of the function you touch and fix the shared function once — one guard there is a smaller diff than one per caller, and patching only the path the ticket names leaves a sibling caller still broken.

Rules:

- No abstractions that weren't explicitly requested.
- No new dependency if it can be avoided.
- No boilerplate nobody asked for.
- Deletion over addition. Boring over clever. Fewest files possible.
- Shortest working diff wins, but only once you understand the problem. The smallest change in the wrong place isn't lazy, it's a second bug.
- Question complex requests: "Do you actually need X, or does Y cover it?"
- Pick the edge-case-correct option when two stdlib approaches are the same size, lazy means less code, not the flimsier algorithm.
- Mark deliberate simplifications that cut a real corner with a known ceiling (global lock, O(n²) scan, naive heuristic) with a `ponytail:` comment naming the ceiling and upgrade path.

Not lazy about: understanding the problem (read it fully and trace the real flow before picking a rung), input validation at trust boundaries, error handling that prevents data loss, security, accessibility, hardware calibration, anything explicitly requested. Non-trivial logic leaves ONE runnable check behind (assert smoke / small self-check; no frameworks). Trivial one-liners need no test.

Off only if the user says: `stop ponytail` / `normal mode`.

---

## 1. Plan / review file placement

When you create or finalize a **plan** or **review**, write it under:

| Kind | Directory | Example |
|------|-----------|---------|
| Plan | `plan/` | `plan/p0-data-loss-fixes-2026-08-05.md` |
| Review | `review/` | `review/codebase-review-2026-08-04.md` |

Filename: `{kebab-topic}-{YYYY-MM-DD}.md` (new day → new file).

Header:

```markdown
<!-- date: 2026-08-05 -->
<!-- source: chat:<id> · user: <short ask> -->
```

`.agents/` is old teamwork scratch — not where plans, reviews, or instructions live. Always keep durable copies under `plan/` or `review/`.

---

## 2. Verify live code (cache ≠ disk)

Especially during reviews and bug fixes: an index or chat cache can disagree with files on disk.

Before claiming a bug or writing a fix:

1. Re-read the current file from disk.
2. Confirm cited lines still match the behavior.
3. If a review says “line N” and the file moved — relocate by symbol/string.
4. After another agent’s “P0 done” — confirm the fix is in source before re-opening the bug.

**Disk wins.**

---

## 3. Repo pointers

- iPad deploy / signing: `ipad-app/Scripts/COMMANDS.md`
- iPhone deploy / signing: `iphone-app/Scripts/COMMANDS.md`
- Local bridge backend (Python 3.10+): first setup from `local-bridge/` with `python3 -m venv .venv`, `source .venv/bin/activate`, and `python -m pip install -r requirements.txt`; run `python -m pytest -q tests/` (includes real caption HTTP checks).
- Tokenize/import integration: start the local bridge, then run `cd local-bridge && python3 tests/test_tokenize_import_enrich.py` (requires local runtime data).
- Saved Items app: `web/saved-items/` (Next.js); read the installed guides in `node_modules/next/dist/docs/` and run `npm run check` from that directory.
- Never delete the app on device just to update — overwrite install only (SwiftData wipe).

---

## 4. LLM wiki (`wiki/`) — plans & reviews

Karpathy pattern: **raw** = `plan/` + `review/` (immutable once filed); **wiki** = `wiki/` (LLM writes); **schema** = this section.

Never edit or rewrite files under `plan/` or `review/` during wiki maintenance — only add new dated files there per §1. Wiki pages use normal markdown links to raw paths.

### Layout

| Path | Role |
|------|------|
| `wiki/index.md` | Catalog + active status — read this first on query |
| `wiki/log.md` | Append-only timeline; entries `## [YYYY-MM-DD] kind \| Title` |
| `wiki/topics/*.md` | Syntheses (status, what shipped, open gaps, code anchors) |

### Ingest

When a new or updated plan/review is filed (or user says “ingest”):

1. Read the raw file(s) from disk (cache ≠ disk).
2. Update or create `wiki/topics/<kebab>.md` (status, links to raw, shipped/open, anchors).
3. Update `wiki/index.md` Active table + catalogs if new filenames appeared.
4. Append one line-block to `wiki/log.md`: `## [date] ingest | Title`.
5. Flag contradictions with existing topic pages (don’t silently drop them).

### Query

When user asks “what’s the status of…”, “what’s left from review…”, “which P0 is open…”:

1. Read `wiki/index.md`, then relevant `wiki/topics/*`.
2. Answer with citations to wiki + raw paths.
3. If the answer is reusable, file it back as a wiki page and log `## [date] query | Title`.

### Lint

When user says “lint wiki” / periodically after several ingests:

- Stale “active” rows whose plan todos are all `done`
- Topic claims that disagree with a newer review (verify on disk)
- Orphan topics / missing cross-links plan↔review
- Open gaps from codebase reviews not yet tracked as topics
- Append `## [date] lint | …` with findings

Optional: Obsidian vault on repo root for graph view — not required.

---

## 5. Skills (`skills/`)

Exactly five skills live at repo root (`skills/`):

| Skill | When |
|-------|------|
| `skills/ponytail` | Any coding task (same as §0) |
| `skills/codegraph` | Code navigation when a local `.codegraph/` index exists |
| `skills/youtube-caption` | Extension / bridge domain |
| `skills/local-bridge` | Bridge start / health / tokenize / IME |
| `skills/tokenize-regression` | Regression on tokenize / import |

Read the matching skill before a domain task. New skills go to `skills/<kebab>/` only when a repo domain genuinely needs one — then update this catalog.

---

## 6. Error log (`local-bridge/errors.log`)

On ANY error (build, runtime, test, API, tool failure, crash, user-reported bug), append one line matching the bridge logger format:

```text
ERROR:bridge:<short message>
WARNING:bridge:<short message>
```

One line per distinct error; no JSON, no timestamp prefix; message = what failed + where; append only. Logging never replaces the fix.

## 7. Feature docs

When you add a user-facing feature, update both `walkthrough.md` (what was added, how to try) and `README.md` (short discovery blurb). Skip for pure bugfixes, renames, or internal refactors with no new capability.

---

## 8. Bản đồ tri thức & dataset (knowledge map)

| Loại | Chỗ đúng | GitHub? |
|------|----------|---------|
| Plan / review | `plan/`, `review/` | Có |
| Tổng hợp sống | `wiki/` | Có |
| Gist tham chiếu | `wiki/upstream/` | Có |
| Skill (5: ponytail, codegraph, 3 domain) | `skills/` | Có |
| Docs sản phẩm | Root `README` / `walkthrough` — không `docs/` | Có |
| Deploy app | `ipad-app/Scripts/`, `iphone-app/Scripts/` | Có |
| Fixture test | `testdata/` | Có (nhỏ) |
| Dict / model | `data/dict/`, `local-bridge/data/` | Không (trừ seed nhỏ) |
| Subtitle runtime | `data/subtitles/` | Không |
| Config máy | `data/config/` | Không |
| Evidence tạm | `.tmp-*/` hoặc xóa | Không |
| Shared agent config | `.agents/rules/`, `.agents/agents/` | Có |
| IDE scratch | `.agents/` ngoài hai thư mục trên | Không |
| Codegraph index | `.codegraph/` | Không (local; skill hướng dẫn dùng) |

Khớp bảng trước khi tạo docs/dataset; không invent top-level folder; runtime data ≠ wiki; lint wiki bắt file mồ côi.

---

# CORE DIRECTIVES: MINIMAL DIFF, RIGOROUS PROOF & ZERO CURSOR

## 1. Anti-Faking & Evidence-Based Verification
Zero sycophancy. Never report a task finished or tests passed without real, undeniable terminal proof:
- **Proof Required:** Every claim of success must include the exact command executed, raw terminal stdout/stderr, and exit code 0.
- **No Mock/Canned Production Code:** Never write stubs that return hardcoded success (e.g., `{"status": "ok"}`) to pass tests or simulate logic.
- **Strict TDD Bugfix Loop:**
  1. **Red:** Execute a test proving the bug exists (must FAIL).
  2. **Green:** Apply the minimal fix to resolve root cause.
  3. **Verify:** Re-run test and show raw output proving it PASSES.
- **Test Integrity:** Never delete assertions, skip tests, or weaken expectations to make test suites pass.
- **Strict Honesty & Self-Evaluation Rule:** Không bịa kết quả, không bịa số liệu. Trung thực 100%. Luôn tự đánh giá kết quả sau khi làm. Nếu thấp hơn 9/10 thì tự làm lại.
- **Tuyệt Đối Cấm Test Giả Mạo (No Pseudo / String-Matching Tests):**
  - Nghiêm cấm viết script test chỉ đọc source code qua `fs.readFileSync`, `grep`, regex hoặc `string.includes()` để kiểm tra xem file code có chứa chuỗi đó hay không rồi kết luận "Test PASSED". Việc kiểm tra file text chứa chuỗi chỉ là static inspection, KHÔNG PHẢI là kiểm thử phần mềm (software verification).
  - Mọi bài test UI, layout, kéo giãn (resize), kéo thả (drag), phím tắt, hiển thị phụ đề PHẢI được chạy trong môi trường runtime thực tế (trình duyệt thật qua CDP/Playwright, hoặc headless DOM thật). Bắt buộc phải đo đạc thay đổi kích thước pixel (`getBoundingClientRect().width/height/top/left`) trước và sau khi tương tác.
  - Mọi bài test mạng/API/phụ đề timedtext PHẢI kiểm tra mã phản hồi HTTP thực tế và parse dữ liệu thật, không được mock dữ liệu tĩnh trả về `status: ok` khi máy chủ thật đang trả về HTTP 429/404.
  - Tuyệt đối không tự cho điểm 9/10 hay 10/10 dựa trên các bài test chuỗi tĩnh hoặc kết quả giả mạo. Mọi bài test ngụy tạo chuỗi tĩnh đều bị đánh giá 0/10 và bắt buộc phải xóa bỏ ngay lập tức.

### Independent review
- For code changes, use a separate reviewer agent or session when available. It must read the original request, current on-disk diff, and affected code, and must not rely on the implementer's claims.
- Before backend changes, map the request → route/controller → service → repository/model → database → response path; list acceptance criteria, error/permission cases, test commands, and risks. If the user asks for planning only, stop before edits; an implementation request already authorizes implementation.
- The reviewer is read-only. It independently checks each acceptance criterion, changed-file scope, test quality, skipped/only tests, regressions, and relevant runtime behavior. Report each criterion as `VERIFIED`, `NOT VERIFIED`, or `CONTRADICTED` with command, exit code, and actual output.
- Run build, unit, and integration/API checks that apply. For backend changes, inspect the actual HTTP status and parsed response, and verify database effects using an isolated test database. Never use production data or run destructive migration/DELETE operations against production.
- Run `git diff` and `git diff --check`; unexplained changes, missing evidence, skipped required checks, or unavailable reviewer prevent `PASS`.
- Overall status is `PASS` only when applicable checks and criteria have evidence and no blocking finding remains; use `FAIL` for a confirmed defect and `NOT VERIFIED` when reviewer or evidence is unavailable.
- Report in this format:

  ```text
  STATUS: PASS / FAIL / NOT VERIFIED
  REQUIREMENTS: criterion, expected, actual, evidence
  COMMANDS: exact command, exit code, actual output
  API_CHECKS: endpoint, method, HTTP status, parsed response
  DATABASE_CHECKS: expected state, actual state, evidence
  PROBLEMS / REQUIRED_FIXES: ...
  ```

- Do not call review automatic unless an actual hook or CI run produced evidence.
- Keep shell execution inside the IDE's workspace sandbox or approval mode; do not use unrestricted auto-execution for project commands.
- Root GitHub CI status checks are `bridge-test-suite` and `saved-items-check`; both should be required on the default branch before merging.

Reusable prompts for any IDE:

**Plan only:**

```text
Chưa sửa file. Phân tích task backend theo request → route/controller → service → repository/model → database → response. Liệt kê file liên quan, acceptance criteria, test/build/API cần chạy, rủi ro và thao tác dữ liệu cần tránh. Sau đó dừng lại.
```

**Implement after authorization:**

```text
Triển khai task trong phạm vi đã thống nhất. Viết/cập nhật test phù hợp; chạy build, unit và integration/API checks liên quan; kiểm tra HTTP status và parse response thật; xác minh database bằng dữ liệu test riêng; chạy git diff và git diff --check. Nếu thiếu bằng chứng, ghi NOT VERIFIED.
```

**Independent review:**

```text
Review độc lập yêu cầu gốc, diff hiện tại trên disk và code liên quan. Không tin báo cáo của agent sửa code. Tự chạy các kiểm tra liên quan; xác minh HTTP response và database side effect khi cần. Không sửa file. Trả về PASS, FAIL hoặc NOT VERIFIED cùng requirement, command, exit code, output thật, vấn đề và sửa chữa cần thiết.
```

## 2. Bilingual Token Segmentation & JLPT Color Invariants
- **Anti-Clumping**: Never insert entire clauses or multi-phrase sentences (>3-4 syllables) into compound tables (`VIETNAMESE_COMPOUND_WORDS`, `BILINGUAL_MAP`, `GRAMMAR_PATTERNS`). Keep compound entries strictly lexical (e.g. `cuối tuần`, `tuyệt vời`, `sự nỗ lực`, `sau khi`). Surrounding pronouns, particles, and auxiliary verbs must remain independent tokens.
- **Dynamic 1-to-1 Color Matching**: Every translated word must inherit the exact JLPT level of its corresponding Japanese lemma/surface in the active cue (e.g. `自分` N4 -> `Tôi` N4; `びっくり` N3 -> `ngạc nhiên` N3; `始める` N4 -> `bắt đầu` N4).
- **Anti-Monochrome (Zero Blanket Fallbacks)**: Never use a sentence-wide fallback level (e.g. `sentenceContentLevel = "n5"`) that paints unmapped content words green. Unmapped words must render as plain neutral text without `jlpt-*` color classes.
- **Generalization Across All Cues**: Never write cue-index-specific or hardcoded single-sentence branches. Every heuristic must be driven by token POS, lemma dictionary lookup, de-inflection, and systematic grammar pattern matching that works uniformly on any YouTube caption cue.

## 3. Strict Machine-Wide Cursor Ban (Zero Tolerance)
- **Absolute Prohibition:** Never create, edit, suggest, recommend, or maintain any Cursor files or directories (`.cursorrules`, `.cursor/`, `.cursorignore`, etc.).
- **Auto-Purge:** If any Cursor file or directory is detected in any workspace or repository, delete it immediately without asking.
- **Standard Alternatives Only:** Use standard configuration files (`AGENTS.md`, `CLAUDE.md`, standard config files).

## 9. Extension reload (no manual clicks)
- Never ask the user to click **Reload** or **Load unpacked** when the extension is already installed.
- Run `./scripts/reload-extension.sh` from the project root. It wraps `~/.local/bin/reload-chrome-extension`: opens `chrome-extension://oiocgalcdfmkbcikemohekbjjmlbpoll/reload.html`, waits for the extension to reload, restores the previous tab, refreshes the YouTube tab, and verifies the popup page.
- First install is the only manual step: stock Google Chrome ignores `--load-extension`, so `chrome://extensions` -> Developer mode -> Load unpacked is done once, never repeated.
- Do not use System Events/AX clicks on `chrome://extensions`; use the extension's own reload page.
- If the script exits `3` (`extension_not_loaded`), report the one-time Load unpacked step; do not claim the reload succeeded.

## 10. Real sidepanel test bridge (dev-only)

- bsk only drives tabs. It cannot attach to `chrome-extension://` pages or Chrome's side panel
  (`permission_denied / restricted_tab_url`); do not retry bsk DOM tools there.
- The dev-only bridge is `extension/content/sp_test_bridge.js` +
  `extension/sidepanel/sp_test_bridge.js`. It is enabled only for an unpacked build
  (`getManifest().update_url` absent), a page URL with `?sp_test=1` / `#sp_test=1`, and a random
  token in `chrome.storage.local`. It is inert in normal use and must be removed before release.
- Run `node scripts/bsk_sidepanel_bridge_smoke.js [--out DIR]`. It starts one bsk session on a
  YouTube watch page, opens the real side panel (one click on the injected `#sp-test-open`;
  Chrome may still require one manual open), then snapshots/clicks the real panel via the bridge.
- Visual evidence is external `screencapture` of the Chrome window, not bsk screenshot. The bridge
  reports the actual panel width; it has no 320/380/520 width matrix.
- The smoke script prints `SURFACE: real Chrome side panel via dev-only bridge`; do not present it
  as a fixture or as installed-extension production verification.
