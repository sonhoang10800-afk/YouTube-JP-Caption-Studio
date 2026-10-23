<!-- date: 2026-10-24 -->
<!-- source: goal:execute-todos · user: "Bắt đầu thực thi TO-dos." · TODO #2 C-7 saved-cue UI row -->

# Review — C-7 saved cue UI row (videoTitle)

BACKEND: bsk | instance: 35138c57 (Youtube-Agent) | Chrome 155.0.0.0 | PLAYWRIGHT: no

- **Target:** C-7 UI proof that a saved cue shows `videoTitle`, not only the data layer.
- **Surface tested:** Saved Items UI (same built React app as the extension popup), served as a
  normal page at `http://127.0.0.1:3101/index.html` from `extension/popup/`.
- **Data:** 2 saved cues copied from `data/config/extension_state.json` into localStorage
  (`ytcaption.savedCues.v1`, versioned envelope); first cue carries the real `videoTitle`.
- **Session:** bsk `qcmf` (web-app checks). Earlier popup-only sessions `kaga`/`azxb` died
  before input could be sent.
- **Evidence bundle:** `/Users/hoangson/Projects/YouTube JP Caption Studio/.test-evidence/20261024-042328-c7-saved-cue-ui`
  (`PASS WITH ISSUES`, 45 artifacts; bundle is local-only per AGENTS test-evidence rule).

## Verdict

**PASS WITH ISSUES** — the "Câu đã lưu" list renders a row with `00:19 – 00:22`, the cue
`videoTitle` `【最新気象】あすは寒気流入により北海道・東北北部では雪や風に注意／気温も前日より大幅に下がる予想`,
and the saved source text `時の総点です。大陸しっかり出てきます。`; title is 12 px, 576×18 within
a 682×21 row, `docOverflowX:false`. Real extension-popup surface could not be captured (see
limitations).

## What was attempted

| Surface | Result |
|---|---|
| Real popup as tab (`chrome-extension://…/popup/index.html`) | Page renders "Từ đã lưu", but bsk denies screenshot/evaluate/input (`restricted_tab_url`) and macOS System Events click fails with `-25211` (no assistive access) → "Câu đã lưu" tab not reachable |
| Saved Items static build at `127.0.0.1:3101` | PASS — clicked "Câu đã lưu" via bsk snapshot ref; 2 cue rows rendered; measured + screenshotted |

## Findings

| ID | Severity | Finding | Evidence (bundle-relative) |
|---|---|---|---|
| C-7-UI | Info (PASS) | Saved cue row shows the real `videoTitle` next to the time range and source; no horizontal overflow. | `screenshots/saved-phrases-static.png`, `c7-row-measure.json` |
| LIM-1 | Medium (limitation) | Real extension popup "Câu đã lưu" tab not switchable: bsk blocks DOM/input on `chrome-extension://`; System Events has no assistive access. | `commands/screenshot-popup-saved-words.stderr`, `screenshots/popup-c7-tab.png` |
| LIM-2 | Low (limitation) | UI proven in the same built app over localhost with localStorage seeded from the bridge snapshot; not live `chrome.storage.local.savedCues` inside the popup. | `seed_cues_static.json`, `screenshots/saved-phrases-static.png` |
| DEV-1 | Info | `next dev` HMR looped (WebSocket failures); the production static popup build was used instead. | `console-webapp.json`, `logs/console-01.json` |

## Not tested

- Real extension popup Saved tab reading live `chrome.storage` (bsk + System Events both blocked).
- Real popup window (500 px) visual/contrast/tap targets — only the localhost build at 1376×743.
- Sidepanel (separate surface; AGENTS §10 dev bridge not used here).
- Dark mode, keyboard traversal, screen reader.

## Attestation

- bsk instance `35138c57` (Youtube-Agent), Chrome `155.0.0.0`; no separate Chromium/Playwright.
- One session per live attempt; sessions died mid-run and were restarted (environment), no tab churn
  within a live session.
- Evidence bundle created before the first test action, validated with
  `evidence.py check --finish --verdict "PASS WITH ISSUES"` → `EVIDENCE OK` / 45 artifacts.
- Cleanup: static server and bridge stopped; `bsk session list` empty; no Agent tabs left in the
  user's Chrome windows.

## Evidence bundle note

The bundle is intentionally **not committed** (AGENTS test-evidence rule). Durable summary lives
in this review; screenshots referenced above remain in the local bundle path.
