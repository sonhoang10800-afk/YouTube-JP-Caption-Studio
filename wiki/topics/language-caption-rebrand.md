# Language Caption rebrand + M1 + any-site panel

**Status:** shipped on branch `cursor/language-caption-rebrand-b15e` (2026-11-09)  
**Raw plan:** [plan/language-caption-rebrand-m1-2026-11-09.md](../../plan/language-caption-rebrand-m1-2026-11-09.md)

## What shipped

| Phase | Outcome |
|-------|---------|
| P0 | AVS docs/tests cherry-picked; no wholesale anime/whisper merge; `frame_relay.js` stays unwired |
| P1 | Panel + content scripts on any `http(s)`; `isSupportedUrl` / sidepanel gate / `web` toggle |
| P2 | M1: `sourceLang` `auto\|ja\|en\|vi`, `targetLangs`, pair-aware Gemini, NLP skip for non-JA |
| P3 | User-visible **Language Caption** / `LC` badge / Saved Items rebuild |
| P4 | `languageCaptionSettings` dual-write; Drive `language-caption-*.json` dual-read; iOS bundle `com.example.LanguageCaption*`; Xcode projects renamed |
| P5 | Plan filed; skill `skills/language-caption`; wiki ingest |

## Open / owner actions

- **GitHub repo rename** to `language-caption` is manual (Settings → Rename). README already points at the new clone URL.
- After Load unpacked path changes, measure new Chrome extension ID and set `EXTENSION_ID` for `scripts/reload-extension.sh`.
- Google Cloud OAuth allowlist: add new iOS bundle IDs / new extension ID when measured.
- Remote branches `whisper_turbo_audio_evaluation` / `anime_auto_inject_script_panel` left for owner archive (not deleted).

## Code anchors

- Gates: `extension/background/service_worker.js` (`isSupportedUrl`, Drive dual-read)
- Settings keys: `extension/shared/settings_keys.js`
- M1: `extension/shared/hardsub_defaults.js` (`targetLangs`), `extension/shared/gemini_translate.js`
- iOS: `ipad-app/LanguageCaption.xcodeproj`, `ios-shared/.../SettingsSync.swift`
