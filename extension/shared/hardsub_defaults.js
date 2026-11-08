/**
 * Hardsub overlay + vocab defaults: one machine-readable copy.
 *
 * The content script paints the overlay from these values, and the Saved Items
 * popup shows sliders seeded from them, so the two used to carry separate copies
 * that disagreed (`barShowVi`, `roi.height`, `maxSentences`, `barBgOpacity` had all
 * drifted). The web app keeps its TypeScript interface, and
 * `web/saved-items/tests/settings-defaults.test.mts` asserts its defaults equal
 * this object.
 *
 * Load order: after `shared/vocab_style.js` (it spreads the vocab defaults).
 */
(() => {
  globalThis.HardsubDefaults = {
    /** Caption engine (tick / overlay / panel sync). */
    enabled: true,
    showOnVideo: false,
    /** Try open side panel once per tab session (default off — use DỊCH toggle). */
    autoOpen: false,
    showFurigana: true,
    dimHardsub: false,
    sourceLang: "ja",
    copyFormat: "full",
    exportFormat: "ja_en_vi",
    roi: { top: 0.75, left: 0.05, width: 0.9, height: 0.2 },
    maxSentences: 2000,
    barPos: null,
    /** User multiplier on video-height-derived overlay fonts/padding (1 = default). */
    barScale: 1,
    /** Overlay background alpha (0–1). */
    barBgOpacity: 0.4,
    /** Overlay text alpha (0–1). */
    barTextOpacity: 1,
    barShowJa: true,
    barShowEn: true,
    barShowVi: false,
    /** Dict popup: show cue sentence (VI/EN) under the gloss. */
    dictShowSentence: true,
    enabledPlatforms: {
      youtube: true,
      netflix: true,
      abema: true,
      animevietsub: true,
      web: true,
    },
    // Vocab highlight defaults live in vocab_style.js; pulled in here so the content
    // script and the web app read one table instead of two copies.
    ...((globalThis.HardsubVocab || {}).DEFAULT_VOCAB_SETTINGS || {}),
  };
})();
