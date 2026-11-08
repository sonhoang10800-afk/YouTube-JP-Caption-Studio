/**
 * Language Caption settings storage keys + migrate-on-read.
 *
 * New key: languageCaptionSettings. Legacy: hardsubSettings.
 * Read prefers new, falls back to legacy and copies forward.
 * Write dual-writes both keys for one release so older builds still see settings.
 */
(() => {
  const KEY = "languageCaptionSettings";
  const LEGACY_KEY = "hardsubSettings";

  async function readSettings(local = chrome.storage.local) {
    const data = await local.get([KEY, LEGACY_KEY]);
    if (data[KEY] != null && typeof data[KEY] === "object") return data[KEY];
    if (data[LEGACY_KEY] != null && typeof data[LEGACY_KEY] === "object") {
      try {
        await local.set({ [KEY]: data[LEGACY_KEY] });
      } catch (_) {
        /* ignore migrate write failures */
      }
      return data[LEGACY_KEY];
    }
    return null;
  }

  async function writeSettings(settings, local = chrome.storage.local) {
    await local.set({ [KEY]: settings, [LEGACY_KEY]: settings });
  }

  /** True when a storage onChanged batch touches either settings key. */
  function changeTouchesSettings(changes) {
    return !!(changes && (changes[KEY] || changes[LEGACY_KEY]));
  }

  function settingsFromChanges(changes) {
    if (!changes) return null;
    if (changes[KEY]?.newValue != null) return changes[KEY].newValue;
    if (changes[LEGACY_KEY]?.newValue != null) return changes[LEGACY_KEY].newValue;
    return null;
  }

  globalThis.LanguageCaptionSettings = {
    KEY,
    LEGACY_KEY,
    readSettings,
    writeSettings,
    changeTouchesSettings,
    settingsFromChanges,
  };
})();
