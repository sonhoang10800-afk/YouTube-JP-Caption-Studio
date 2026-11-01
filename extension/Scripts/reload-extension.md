# Reload Chrome extension after code changes

Unpacked MV3 does **not** hot-reload `content_scripts` / MAIN-world
`page_capture.js` by itself. Reload it without clicking `chrome://extensions`:

```sh
./scripts/reload-extension.sh
```

The script opens `chrome-extension://<id>/reload.html` (which calls
`chrome.runtime.reload()`), waits for the page to unload, closes only that tab,
restores the previous tab, refreshes the YouTube tab, and verifies that the
popup page loads. It prints the extension id and verification result. Add
`--json` for machine-readable output.

The extension id is `oiocgalcdfmkbcikemohekbjjmlbpoll`; override it with
`EXTENSION_ID=<id>` if the unpacked path changes. The shared helper is
`~/.local/bin/reload-chrome-extension`.

## Manual fallback (only if the script fails)

1. Open `chrome://extensions`
2. Find **YouTube JP Caption Studio**
3. Click **Reload** (↻)
4. Hard-refresh the YouTube tab (`Cmd+Shift+R`): SPA navigation alone keeps a
   stale MAIN-world inject

## First install (one time only)

Stock Google Chrome ignores `--load-extension`, so the first load is manual:

1. `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** -> select the `extension/` folder

After that, never ask for Load unpacked again; use the script above.

Version bump in `manifest.json` makes a successful reload visible on the card.
