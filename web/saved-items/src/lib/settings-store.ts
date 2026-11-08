import {
  BRIDGE_BASE,
  getChromeStorage,
  getChromeStorageOnChanged,
  hasChromeStorage,
  type ChromeStorageChange,
} from "@/lib/chrome-env";
import {
  DEFAULT_HARDSUB_SETTINGS,
  type BridgeHealth,
  type HardsubSettings,
  type SettingsPersistSource,
} from "@/types/settings";
import { normalizeLevelColors } from "@/lib/level-colors";
import { readEnvelope, writeEnvelope } from "@/lib/storage-version";

export { BRIDGE_BASE };

/** localStorage mirror (localhost / fallback). Extension uses chrome.storage key `hardsubSettings`. */
export const SETTINGS_STORAGE_KEY = "ytcaption.hardsubSettings.v1";

export const CHROME_SETTINGS_KEY = "hardsubSettings";

/** The mirror was written by a newer build: it is neither read nor overwritten. */
function hasUnsupportedSettings(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return false;
    return readEnvelope(JSON.parse(raw)).kind === "unsupported";
  } catch {
    return false;
  }
}

/** Write the local mirror. A payload from a newer build is left alone. */
function writeLocalSettings(settings: HardsubSettings): void {
  if (typeof window === "undefined") return;
  if (hasUnsupportedSettings()) return;
  try {
    window.localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify(writeEnvelope(settings)),
    );
  } catch {
    /* ignore */
  }
}

/** Read the local mirror. `null` = nothing stored (or a newer build's payload). */
function readLocalSettings(): HardsubSettings | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    const read = readEnvelope<unknown>(JSON.parse(raw));
    if (read.kind === "unsupported") return null;
    return normalizeSettings(read.data);
  } catch {
    return null;
  }
}

export interface SettingsLoadResult {
  settings: HardsubSettings;
  source: SettingsPersistSource;
  note: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function normalizeRoi(raw: unknown): HardsubSettings["roi"] {
  const d = DEFAULT_HARDSUB_SETTINGS.roi;
  if (!isRecord(raw)) return { ...d };
  return {
    top: num(raw.top, d.top),
    left: num(raw.left, d.left),
    width: num(raw.width, d.width),
    height: num(raw.height, d.height),
  };
}

function normalizeSourceLang(v: unknown): HardsubSettings["sourceLang"] {
  return v === "ja" || v === "en" || v === "vi" || v === "auto" ? v : "ja";
}

function normalizeTargetLangs(raw: unknown): HardsubSettings["targetLangs"] {
  const d = DEFAULT_HARDSUB_SETTINGS.targetLangs;
  if (!Array.isArray(raw)) return [...d];
  const picked = raw.filter((l): l is "en" | "vi" => l === "en" || l === "vi");
  return picked.length ? picked : [...d];
}

function normalizeCopyFormat(v: unknown): HardsubSettings["copyFormat"] {
  return v === "full" || v === "ja_vi" || v === "ja" || v === "vi" ? v : "full";
}

function normalizeEnabledPlatforms(raw: unknown): HardsubSettings["enabledPlatforms"] {
  const d = DEFAULT_HARDSUB_SETTINGS.enabledPlatforms!;
  if (!isRecord(raw)) return { ...d };
  return {
    youtube: bool(raw.youtube, d.youtube),
    netflix: bool(raw.netflix, d.netflix),
    abema: bool(raw.abema, d.abema),
    animevietsub: bool(raw.animevietsub, d.animevietsub ?? true),
    web: bool(raw.web, d.web),
  };
}

/** Merge partial / legacy payloads into a full HardsubSettings object. */
export function normalizeSettings(raw: unknown): HardsubSettings {
  const d = DEFAULT_HARDSUB_SETTINGS;
  if (!isRecord(raw)) return { ...d, roi: { ...d.roi } };
  return {
    ...d,
    ...raw,
    enabled: bool(raw.enabled, d.enabled),
    autoTranslate: raw.autoTranslate === true,
    showOnVideo: bool(raw.showOnVideo, d.showOnVideo),
    autoOpen: bool(raw.autoOpen, d.autoOpen),
    showFurigana: bool(raw.showFurigana, d.showFurigana),
    dimHardsub: bool(raw.dimHardsub, d.dimHardsub),
    sourceLang: normalizeSourceLang(raw.sourceLang),
    targetLangs: normalizeTargetLangs(raw.targetLangs),
    copyFormat: normalizeCopyFormat(raw.copyFormat),
    exportFormat:
      typeof raw.exportFormat === "string" ? raw.exportFormat : d.exportFormat,
    roi: normalizeRoi(raw.roi),
    maxSentences: num(raw.maxSentences, d.maxSentences),
    dictShowSentence: raw.dictShowSentence !== false,
    barScale: num(raw.barScale, d.barScale),
    barBgOpacity:
      raw.barBgOpacity != null
        ? num(raw.barBgOpacity, d.barBgOpacity)
        : d.barBgOpacity,
    barTextOpacity:
      raw.barTextOpacity != null
        ? num(raw.barTextOpacity, d.barTextOpacity)
        : d.barTextOpacity,
    barShowJa: raw.barShowJa !== false,
    barShowEn: raw.barShowEn !== false,
    barShowVi: raw.barShowVi !== false,
    barPos: isRecord(raw.barPos)
      ? { nx: num(raw.barPos.nx, 0.5), ny: num(raw.barPos.ny, 0.5) }
      : null,
    vocabLevel: num(raw.vocabLevel, d.vocabLevel) || 5000,
    vocabHighlight: raw.vocabHighlight !== false,
    showKnownGreen: raw.showKnownGreen !== false,
    hideRareWords: bool(raw.hideRareWords, d.hideRareWords),
    // Always carry the JLPT coloring keys — dropping them here wiped the side
    // panel's level colors on every popup save (hardsubSettings full replace).
    levelHighlightEnabled: raw.levelHighlightEnabled !== false,
    levelColors: normalizeLevelColors(raw.levelColors),
    enabledPlatforms: normalizeEnabledPlatforms(raw.enabledPlatforms),
  };
}

async function pushSettingsToBridge(settings: HardsubSettings): Promise<void> {
  try {
    await fetch(`${BRIDGE_BASE}/extension_state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hardsubSettings: settings,
        source: hasChromeStorage() ? "extension-page" : "localhost",
      }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    /* bridge optional */
  }
}

export async function fetchSettingsFromBridge(): Promise<HardsubSettings | null> {
  try {
    const res = await fetch(`${BRIDGE_BASE}/extension_state`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { hardsubSettings?: unknown };
    if (data.hardsubSettings == null) return null;
    return normalizeSettings(data.hardsubSettings);
  } catch {
    return null;
  }
}

/**
 * Load settings: chrome.storage.local → bridge → localStorage → defaults.
 */
export async function loadSettingsAsync(): Promise<SettingsLoadResult> {
  if (typeof window === "undefined") {
    return {
      settings: normalizeSettings(null),
      source: "defaults",
      note: "SSR — defaults",
    };
  }

  if (hasChromeStorage()) {
    try {
      const store = getChromeStorage()!;
      const data = await store.get(CHROME_SETTINGS_KEY);
      const raw = data[CHROME_SETTINGS_KEY];
      if (raw != null) {
        return {
          settings: normalizeSettings(raw),
          source: "chrome.storage",
          note: "chrome.storage.local · hardsubSettings (live sync)",
        };
      }
      return {
        settings: normalizeSettings(null),
        source: "defaults",
        note: "Chưa có hardsubSettings — dùng mặc định; Lưu sẽ ghi chrome.storage.",
      };
    } catch {
      /* fall through */
    }
  }

  const fromBridge = await fetchSettingsFromBridge();
  if (fromBridge) {
    writeLocalSettings(fromBridge);
    return {
      settings: fromBridge,
      source: "bridge",
      note: "Đồng bộ từ bridge /extension_state (extension → bridge).",
    };
  }

  const local = readLocalSettings();
  if (local) {
    return {
      settings: local,
      source: "localStorage",
      note:
        "localStorage (localhost). Chạy extension để sync chrome.storage." +
        (hasUnsupportedSettings() ? " · Dữ liệu local mới hơn app — không ghi đè" : ""),
    };
  }

  return {
    settings: normalizeSettings(null),
    source: "defaults",
    note: "Dùng mặc định. Lưu vào storage khi bạn bấm Lưu.",
  };
}

/** Sync convenience for first paint before async hydrate (defaults only). */
export function loadSettings(): SettingsLoadResult {
  if (typeof window === "undefined") {
    return {
      settings: normalizeSettings(null),
      source: "defaults",
      note: "SSR — defaults",
    };
  }
  const local = readLocalSettings();
  if (local) {
    return {
      settings: local,
      source: "localStorage",
      note: "localStorage (tạm) — đang hydrate…",
    };
  }
  return {
    settings: normalizeSettings(null),
    source: "defaults",
    note: "Đang tải…",
  };
}

export async function persistSettingsAsync(
  settings: HardsubSettings,
): Promise<SettingsPersistSource> {
  const next = normalizeSettings(settings);
  if (typeof window === "undefined") return "defaults";

  if (hasChromeStorage()) {
    try {
      await getChromeStorage()!.set({ [CHROME_SETTINGS_KEY]: next });
      writeLocalSettings(next);
      void pushSettingsToBridge(next);
      return "chrome.storage";
    } catch {
      /* fall through */
    }
  }

  writeLocalSettings(next);
  void pushSettingsToBridge(next);
  return "localStorage";
}

export function persistSettings(settings: HardsubSettings): void {
  void persistSettingsAsync(settings);
}

export function resetOverlaySettings(prev: HardsubSettings): HardsubSettings {
  const d = DEFAULT_HARDSUB_SETTINGS;
  return {
    ...prev,
    barScale: d.barScale,
    barBgOpacity: d.barBgOpacity,
    barTextOpacity: d.barTextOpacity,
    barShowJa: true,
    barShowEn: true,
    barShowVi: true,
    barPos: null,
  };
}

export type HealthFetchResult =
  | { ok: true; line: string; data: BridgeHealth }
  | { ok: false; line: string };

export async function fetchBridgeHealth(): Promise<HealthFetchResult> {
  try {
    const res = await fetch(`${BRIDGE_BASE}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) {
      return {
        ok: false,
        line: "Bridge offline — chạy local-bridge/start.sh",
      };
    }
    const h = (await res.json()) as BridgeHealth;
    const sudachi = h.models_loaded?.sudachi;
    const dict = h.models_loaded?.dict;
    const freq = h.models_loaded?.freq;
    const line = `ready=${h.ready} · sudachi=${sudachi} · dict=${dict} · freq=${freq} · p50=${Math.round(h.latency_p50_ms || 0)}ms · pressure=${h.pressure ?? "?"}`;
    return { ok: true, line, data: h };
  } catch {
    return {
      ok: false,
      line: "Bridge offline — chạy local-bridge/start.sh",
    };
  }
}

export async function postBootstrap(): Promise<boolean> {
  try {
    const res = await fetch(`${BRIDGE_BASE}/bootstrap`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Subscribe to hardsubSettings changes (chrome.storage or bridge poll). */
export function subscribeSettings(
  onChange: (settings: HardsubSettings, source: SettingsPersistSource) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const onChanged = getChromeStorageOnChanged();
  if (hasChromeStorage() && onChanged) {
    const listener = (
      changes: Record<string, ChromeStorageChange>,
      area: string,
    ) => {
      if (area !== "local" || !changes[CHROME_SETTINGS_KEY]) return;
      onChange(
        normalizeSettings(changes[CHROME_SETTINGS_KEY].newValue),
        "chrome.storage",
      );
    };
    onChanged.addListener(listener);
    return () => onChanged.removeListener(listener);
  }

  let lastJson = "";
  let isPolling = false;
  const id = window.setInterval(() => {
    if (isPolling) return;
    isPolling = true;
    void (async () => {
      try {
        const fromBridge = await fetchSettingsFromBridge();
        if (!fromBridge) return;
        const j = JSON.stringify(fromBridge);
        if (j === lastJson) return;
        lastJson = j;
        writeLocalSettings(fromBridge);
        onChange(fromBridge, "bridge");
      } finally {
        isPolling = false;
      }
    })();
  }, 1500);
  return () => window.clearInterval(id);
}
