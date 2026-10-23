<!-- date: 2026-10-24 -->
<!-- source: goal:execute-todos · user: "Bắt đầu thực thi TO-dos." · TODO #3 reload helper hardening -->

# Review — reload helper: verify before refreshing tabs

BACKEND: bsk | instance: 35138c57 (Youtube-Agent) | Chrome 155.0.0.0 | PLAYWRIGHT: no

- **Problem:** the shared helper refreshed the YouTube tab **before** verifying the reloaded
  extension. A video page loaded/refreshed during extension startup rendered the overlay with no
  tokens (plain cue) until reloaded again — see`review/enhancement-fallback-repro-2026-10-24.md`.
- **Code:** commit **`812799f`** — `scripts/reload-extension.sh` (v2).
- **Evidence bundle (local, not committed):**
  `/Users/hoangson/Projects/YouTube JP Caption Studio/.test-evidence/20261024-063617-reload-helper-hardening`
  — `PASS`, 36 artifacts.

## Change

`scripts/reload-extension.sh` now:

1. invokes the shared helper **without** `--refresh-url-prefix` (reload only),
2. re-verifies the popup page itself (`chrome-extension://…/popup/index.html`) with title
   polling when the helper's 1.0 s verify races,
3. refreshes the first tab whose URL starts with `https://www.youtube.com/` **only after**
   verification,
4. keeps `--json`, `--dry-run`, `--wait`, `--refresh-url-prefix` options and returns the
   helper's JSON plus a `wrapper.order: "reload->verify->refresh"` field.

The shared global helper at `~/.local/bin/reload-chrome-extension` is unchanged (repo-local
wrapper only), so other projects are unaffected.

## Verification

- 3 consecutive wrapper runs: `ok:true`, `reload_page.verdict=closed_after_reload`, popup
  verify `ok:true`, refresh after verify, tab counts stable (run 2 cleaned one transient tab).
- After the last reload: new video page at 22 s, H ON → **12 tokens/furigana**
  (`時ときの総点そうてんです。大陸しっかり出でてきます。`); 0 `Unsafe` console entries.
- Chrome afterwards: one user window, 4 tabs, no extension/verify-tab litter.
- `bash -n` clean; `--dry-run`/`--help` checked.

## Findings

| ID | Severity | Finding | Evidence (bundle) |
| --- | --- | --- | --- |
| RELOAD-1 | Info (PASS) | 3/3 runs reload+verify+refresh in the correct order; tab counts stable. | `commands/wrapper-run-1.stdout`, `commands/wrapper-run-2.stdout`, `commands/wrapper-run-3.stdout` |
| RELOAD-2 | Info (PASS) | New video page after hardened reload gets 12 tokens (first-page plain-cue regression gone in this scenario). | `screenshots/tokens-after-hardened-reload.png`, `logs/measure-h-on.json` |
| RELOAD-3 | Info (PASS) | No extension-tab litter; user window untouched (4 tabs). | `commands/chrome-tabs-after.stdout` |
| LIM-1 | Low | Wrapper acts on Chrome's front window (same as helper); multi-profile/non-macOS not tested. | `commands/wrapper-run-2.stdout` |
| LIM-2 | Low | Helper's own 1 s verify may still report false; wrapper's polling is the safety net. | `commands/wrapper-run-1.stdout` |

## Not tested

- Multi-profile Chrome, non-macOS hosts, `--wait` override behavior beyond syntax.
- Extension-internal race instrumentation (validated by behavior instead).
- Sidepanel/popup surfaces.

## Attestation

- bsk `35138c57`, Chrome `155.0.0.0`; no separate Chromium/Playwright.
- Evidence bundle validated with `evidence.py check --finish --verdict PASS`.
- Sessions stopped, bridge stopped, no Agent/extension tabs left in the user window.

## Note for TODO #8

The wrapper is now tracked in `812799f`. Still uncommitted from before this work: `AGENTS.md`,
`README.md`, `extension/Scripts/reload-extension.md` modifications (pre-existing; not part of
this commit).
