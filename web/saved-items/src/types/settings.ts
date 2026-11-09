/**
 * Matches the extension `hardsubSettings` in chrome.storage.local. The defaults
 * live in `DEFAULTS` in `extension/content/content.js` (the old
 * `extension/popup/popup.js` was removed when the popup became this app).
 */
import { DEFAULT_LEVEL_COLORS, type LevelColors } from "@/lib/level-colors";

export interface HardsubRoi {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface HardsubSettings {
  /** Caption engine (tick / overlay). Not auto-MT. */
  enabled: boolean;
  /**
   * Legacy field kept for chrome.storage compat; ignored (no machine translation).
   */
  autoTranslate: boolean;
  showOnVideo: boolean;
  autoOpen: boolean;
  showFurigana: boolean;
  dimHardsub: boolean;
  sourceLang: "ja" | "en" | "vi" | "auto";
  /** Gemini / display targets within fixed EN/VI columns (M1). */
  targetLangs: Array<"en" | "vi">;
  copyFormat: "full" | "ja_vi" | "ja" | "vi";
  exportFormat: string;
  roi: HardsubRoi;
  maxSentences: number;
  dictShowSentence: boolean;
  barScale: number;
  barBgOpacity: number;
  barTextOpacity: number;
  barShowJa: boolean;
  barShowEn: boolean;
  barShowVi: boolean;
  barPos: { nx: number; ny: number } | null;
  vocabLevel: number;
  vocabHighlight: boolean;
  showKnownGreen: boolean;
  hideRareWords: boolean;
  /** Side panel "Làm nổi bật theo cấp độ" — master JLPT coloring toggle. */
  levelHighlightEnabled: boolean;
  /** Per-level colors — single source of truth: `@/lib/level-colors`. */
  levelColors: LevelColors;
  /** Per-platform enable/disable settings (default all true). */
  enabledPlatforms?: {
    youtube: boolean;
    netflix: boolean;
    abema: boolean;
    animevietsub?: boolean;
    web: boolean;
  };
  /**
   * Preserved through chrome.storage round-trips (never dropped on save):
   * status-class colors/categories used by content + side panel.
   */
  vocabColors?: Record<string, string>;
  vocabCats?: Record<string, boolean>;
}

/**
 * Must equal `extension/shared/hardsub_defaults.js` (the extension paints the
 * overlay, so it is the source of truth). Enforced by
 * `tests/settings-defaults.test.mts`.
 */
export const DEFAULT_HARDSUB_SETTINGS: HardsubSettings = {
  enabled: true,
  autoTranslate: false,
  showOnVideo: false,
  autoOpen: false,
  showFurigana: true,
  dimHardsub: false,
  sourceLang: "ja",
  targetLangs: ["en", "vi"],
  copyFormat: "full",
  exportFormat: "ja_en_vi",
  roi: { top: 0.75, left: 0.05, width: 0.9, height: 0.2 },
  maxSentences: 2000,
  dictShowSentence: true,
  barScale: 1,
  barBgOpacity: 0.4,
  barTextOpacity: 1,
  barShowJa: true,
  barShowEn: true,
  barShowVi: false,
  barPos: null,
  vocabLevel: 5000,
  vocabHighlight: true,
  showKnownGreen: true,
  hideRareWords: false,
  levelHighlightEnabled: true,
  levelColors: { ...DEFAULT_LEVEL_COLORS },
  enabledPlatforms: {
    youtube: true,
    netflix: true,
    abema: true,
    animevietsub: true,
    web: true,
  },
};

export type SettingsPersistSource =
  | "localStorage"
  | "defaults"
  | "chrome.storage"
  | "bridge";

export interface BridgeHealth {
  ready: boolean;
  ocr_engine?: string;
  mt_engine?: string;
  models_loaded?: {
    ocr?: boolean;
    mt?: boolean;
    sudachi?: boolean;
    dict?: boolean;
    freq?: boolean;
  };
  pressure?: string;
  latency_p50_ms?: number;
}
