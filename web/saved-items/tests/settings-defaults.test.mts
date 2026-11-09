/**
 * The popup's settings defaults must equal the extension's, because the extension
 * is what paints the overlay. `extension/shared/hardsub_defaults.js` is now the
 * single machine-readable copy; this test loads it in Node and compares values.
 *
 * Before this existed the two tables had already drifted: `barShowVi` (true vs
 * false), `roi.height` (0.22 vs 0.2), `maxSentences` (500 vs 2000) and
 * `barBgOpacity` (0.82 vs 0.4).
 *
 * Run: node --import ./tests/register.mjs --test tests/*.test.mts
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

import { DEFAULT_LEVEL_COLORS } from "@/lib/level-colors";
import { DEFAULT_HARDSUB_SETTINGS } from "@/types/settings";

const require = createRequire(import.meta.url);
const REPO_ROOT = "../../..";

type LevelEntry = { on: boolean; color: string };

interface ExtensionDefaults {
  enabled: boolean;
  showOnVideo: boolean;
  autoOpen: boolean;
  showFurigana: boolean;
  dimHardsub: boolean;
  sourceLang: string;
  copyFormat: string;
  exportFormat: string;
  roi: { top: number; left: number; width: number; height: number };
  maxSentences: number;
  barPos: unknown;
  barScale: number;
  barBgOpacity: number;
  barTextOpacity: number;
  barShowJa: boolean;
  barShowEn: boolean;
  barShowVi: boolean;
  dictShowSentence: boolean;
  enabledPlatforms: Record<string, boolean>;
  vocabLevel: number;
  vocabHighlight: boolean;
  showKnownGreen: boolean;
  hideRareWords: boolean;
  levelHighlightEnabled?: boolean;
  levelColors?: Record<string, LevelEntry>;
}

function loadExtensionDefaults(): ExtensionDefaults {
  require(`${REPO_ROOT}/extension/shared/vocab_style.js`);
  require(`${REPO_ROOT}/extension/shared/hardsub_defaults.js`);
  const defaults = (globalThis as unknown as { HardsubDefaults?: ExtensionDefaults }).HardsubDefaults;
  assert.ok(defaults, "extension/shared/hardsub_defaults.js must expose HardsubDefaults");
  return defaults;
}

/** Keys both sides model with the same meaning. */
const SHARED_SCALARS = [
  "enabled",
  "showOnVideo",
  "autoOpen",
  "showFurigana",
  "dimHardsub",
  "sourceLang",
  "copyFormat",
  "exportFormat",
  "maxSentences",
  "barScale",
  "barBgOpacity",
  "barTextOpacity",
  "barShowJa",
  "barShowEn",
  "barShowVi",
  "dictShowSentence",
  "vocabLevel",
  "vocabHighlight",
  "showKnownGreen",
  "hideRareWords",
] as const;

test("every shared settings default matches the extension", () => {
  const ext = loadExtensionDefaults();
  const web = DEFAULT_HARDSUB_SETTINGS as unknown as Record<string, unknown>;
  for (const key of SHARED_SCALARS) {
    assert.equal(web[key], ext[key], `${key}: web ${JSON.stringify(web[key])} vs extension ${JSON.stringify(ext[key])}`);
  }
});

test("nested defaults match (roi, barPos, platforms, targetLangs)", () => {
  const ext = loadExtensionDefaults();
  assert.deepEqual(DEFAULT_HARDSUB_SETTINGS.roi, ext.roi);
  assert.deepEqual(DEFAULT_HARDSUB_SETTINGS.barPos, ext.barPos);
  assert.deepEqual(DEFAULT_HARDSUB_SETTINGS.enabledPlatforms, ext.enabledPlatforms);
  assert.deepEqual(
    DEFAULT_HARDSUB_SETTINGS.targetLangs,
    (ext as ExtensionDefaults & { targetLangs?: string[] }).targetLangs,
  );
});

test("the JLPT highlight default is enabled, as a missing value means enabled", () => {
  const ext = loadExtensionDefaults();
  // The extension treats an absent flag as enabled and falls back to the shared
  // colour table; the popup models that explicitly instead of leaving it undefined.
  assert.equal(ext.levelHighlightEnabled ?? true, DEFAULT_HARDSUB_SETTINGS.levelHighlightEnabled);
  assert.deepEqual(DEFAULT_HARDSUB_SETTINGS.levelColors, ext.levelColors ?? DEFAULT_LEVEL_COLORS);
});
