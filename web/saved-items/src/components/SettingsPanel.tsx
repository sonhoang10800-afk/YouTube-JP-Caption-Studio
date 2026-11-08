"use client";

import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import {
  DEFAULT_LEVEL_COLORS,
  LEVEL_KEYS,
  LEVEL_LABELS,
  normalizeLevelColors,
} from "@/lib/level-colors";
import {
  fetchBridgeHealth,
  loadSettingsAsync,
  persistSettingsAsync,
  postBootstrap,
  resetOverlaySettings,
  subscribeSettings,
} from "@/lib/settings-store";
import {
  DEFAULT_HARDSUB_SETTINGS,
  type HardsubSettings,
  type SettingsPersistSource,
} from "@/types/settings";

function ToggleRow({
  checked,
  onChange,
  label,
  id,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-3 rounded-md px-1 py-1.5 text-[14px] text-white/90 hover:bg-white/[0.04]"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-[#9c40bf]"
      />
      <span>{label}</span>
    </label>
  );
}

function Fieldset({
  legend,
  children,
}: {
  legend: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="rounded-lg border border-white/12 bg-white/[0.03] px-4 pt-2 pb-4">
      <legend className="px-1.5 text-[13px] font-medium text-white/70">
        {legend}
      </legend>
      <div className="mt-1 flex flex-col gap-3">{children}</div>
    </fieldset>
  );
}

function RangeField({
  id,
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label htmlFor={id} className="block text-[13px] text-white/75">
      {label}
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 h-7 w-full accent-[#9c40bf]"
      />
      <span className="mt-0.5 block text-[12px] text-white/40 tabular-nums">
        {value}
      </span>
    </label>
  );
}

function SelectField({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label htmlFor={id} className="block text-[13px] text-white/75">
      {label}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 h-9 w-full rounded-md border border-white/15 bg-[#1c1e22] px-2.5 text-[14px] text-white outline-none focus:border-[#9c40bf]/70"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberField({
  id,
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label htmlFor={id} className="block text-[13px] text-white/75">
      {label}
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 h-9 w-full rounded-md border border-white/15 bg-[#1c1e22] px-2.5 text-[14px] text-white outline-none focus:border-[#9c40bf]/70"
      />
    </label>
  );
}

export function SettingsPanel() {
  const [settings, setSettings] = useState<HardsubSettings>(() =>
    normalizeClientDefaults(),
  );
  const [source, setSource] = useState<SettingsPersistSource>("defaults");
  const [note, setNote] = useState("");
  const [healthLine, setHealthLine] = useState("Checking bridge…");
  const [healthOk, setHealthOk] = useState(false);
  const [msg, setMsg] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await loadSettingsAsync();
      if (cancelled) return;
      setSettings(result.settings);
      setSource(result.source);
      setNote(result.note);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return subscribeSettings((next, src) => {
      setSettings(next);
      setSource(src);
      setNote(
        src === "chrome.storage"
          ? "Live · chrome.storage languageCaptionSettings"
          : src === "bridge"
            ? "Live · bridge /extension_state"
            : "Đã cập nhật",
      );
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      const h = await fetchBridgeHealth();
      if (cancelled) return;
      setHealthOk(h.ok);
      setHealthLine(h.line);
    }
    void tick();
    const id = window.setInterval(tick, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  function patch(partial: Partial<HardsubSettings>) {
    setSettings((prev) => ({ ...prev, ...partial }));
  }

  /** React may call a state updater twice (StrictMode), so the updater stays
   *  pure: the next value is computed here and the write happens in the
   *  handler, not inside the updater. */
  function patchOverlay(partial: Partial<HardsubSettings>) {
    const next = { ...settings, ...partial };
    setSettings(next);
    void persistSettingsAsync(next).then((src) => {
      setSource(src);
      setNote(
        src === "chrome.storage"
          ? "Overlay live → chrome.storage"
          : "Overlay live → localStorage + bridge",
      );
    });
  }

  function patchLevel(partial: Partial<HardsubSettings>) {
    const next = { ...settings, ...partial };
    setSettings(next);
    void persistSettingsAsync(next).then((src) => {
      setSource(src);
      setNote(
        src === "chrome.storage"
          ? "Tô màu live → chrome.storage"
          : "Tô màu live → localStorage + bridge",
      );
    });
  }

  function handleResetLevelColors() {
    patchLevel({ levelColors: normalizeLevelColors(DEFAULT_LEVEL_COLORS) });
    setMsg("Đã đặt lại màu cấp độ");
    window.setTimeout(() => setMsg(""), 2000);
  }

  function handleSave() {
    const next = { ...settings, enabled: true };
    setSettings(next);
    void persistSettingsAsync(next).then((src) => {
      setSource(src);
      setNote(
        src === "chrome.storage"
          ? "Đã lưu chrome.storage · languageCaptionSettings"
          : "Đã lưu localStorage + bridge",
      );
    });
    setMsg("Đã lưu");
    window.setTimeout(() => setMsg(""), 2000);
  }

  function handleResetOverlay() {
    const next = resetOverlaySettings(settings);
    setSettings(next);
    void persistSettingsAsync(next).then((src) => {
      setSource(src);
      setNote(
        src === "chrome.storage"
          ? "Đã đặt lại overlay · chrome.storage"
          : "Đã đặt lại overlay · localStorage",
      );
    });
    setMsg("Đã đặt lại overlay");
    window.setTimeout(() => setMsg(""), 2000);
  }

  async function handleBootstrap() {
    const ok = await postBootstrap();
    setMsg(ok ? "Bootstrap started" : "Bootstrap thất bại — bridge offline?");
    window.setTimeout(() => void fetchBridgeHealth().then((h) => {
      setHealthOk(h.ok);
      setHealthLine(h.line);
    }), 1500);
  }

  return (
    <div className="w-full px-1 pb-24">
      <header className="mb-5">
        <h1 className="font-[family-name:var(--font-brand)] text-[22px] font-normal tracking-wide text-white">
          Language Caption
        </h1>
        <p
          className={cn(
            "mt-1.5 text-[12px] leading-relaxed",
            healthOk ? "text-white/45" : "text-[#e08a4a]/90",
          )}
        >
          {healthLine}
        </p>
        <p className="mt-2 text-[12px] text-white/35">
          Nguồn: <code className="text-white/50">{source}</code>
          {ready ? ` · ${note}` : " · Đang tải…"}
        </p>
      </header>

      <div className="flex flex-col gap-1">
        <ToggleRow
          id="showOnVideo"
          checked={settings.showOnVideo}
          onChange={(v) => patch({ showOnVideo: v })}
          label="Dịch trên video (overlay)"
        />
        <ToggleRow
          id="autoOpen"
          checked={settings.autoOpen}
          onChange={(v) => patch({ autoOpen: v })}
          label="Tự mở side panel khi mở video (tùy chọn)"
        />
        <ToggleRow
          id="showFurigana"
          checked={settings.showFurigana}
          onChange={(v) => patch({ showFurigana: v })}
          label="Furigana"
        />
        <ToggleRow
          id="dimHardsub"
          checked={settings.dimHardsub}
          onChange={(v) => patch({ dimHardsub: v })}
          label="Làm mờ hardsub gốc"
        />
      </div>

      <div className="mt-5 flex flex-col gap-4">
        <Fieldset legend="Overlay trên video">
          <RangeField
            id="barScale"
            label="Cỡ chữ / khung (barScale)"
            value={settings.barScale}
            min={0.55}
            max={2.4}
            step={0.05}
            onChange={(v) => patchOverlay({ barScale: v })}
          />
          <RangeField
            id="barBgOpacity"
            label="Độ mờ nền"
            value={settings.barBgOpacity}
            min={0}
            max={1}
            step={0.02}
            onChange={(v) => patchOverlay({ barBgOpacity: v })}
          />
          <RangeField
            id="barTextOpacity"
            label="Độ mờ chữ"
            value={settings.barTextOpacity}
            min={0.2}
            max={1}
            step={0.02}
            onChange={(v) => patchOverlay({ barTextOpacity: v })}
          />
          <ToggleRow
            id="barShowJa"
            checked={settings.barShowJa}
            onChange={(v) => patchOverlay({ barShowJa: v })}
            label="Hiện JA"
          />
          <ToggleRow
            id="barShowEn"
            checked={settings.barShowEn}
            onChange={(v) => patchOverlay({ barShowEn: v })}
            label="Hiện EN"
          />
          <ToggleRow
            id="barShowVi"
            checked={settings.barShowVi}
            onChange={(v) => patchOverlay({ barShowVi: v })}
            label="Hiện VI"
          />
          <button
            type="button"
            onClick={handleResetOverlay}
            className="mt-1 w-fit rounded-md border border-white/15 bg-[#2a2a3a] px-3 py-1.5 text-[13px] text-white/85 hover:bg-[#3a3a50]"
          >
            Đặt lại overlay
          </button>
        </Fieldset>

        <Fieldset legend="Từ vựng">
          <ToggleRow
            id="vocabHighlight"
            checked={settings.vocabHighlight}
            onChange={(v) => patch({ vocabHighlight: v })}
            label="Làm nổi bật theo cấp độ"
          />
          <ToggleRow
            id="showKnownGreen"
            checked={settings.showKnownGreen}
            onChange={(v) => patch({ showKnownGreen: v })}
            label="Hiện từ đã biết (xanh)"
          />
          <ToggleRow
            id="hideRareWords"
            checked={settings.hideRareWords}
            onChange={(v) => patch({ hideRareWords: v })}
            label="Ẩn từ hiếm"
          />
          <NumberField
            id="vocabLevel"
            label="Mức từ vựng (rank)"
            value={settings.vocabLevel}
            min={500}
            max={15000}
            step={500}
            onChange={(v) => patch({ vocabLevel: v || 5000 })}
          />
        </Fieldset>

        <Fieldset legend="Tô màu theo cấp độ (JLPT)">
          <ToggleRow
            id="levelHighlightEnabled"
            checked={settings.levelHighlightEnabled !== false}
            onChange={(v) => patchLevel({ levelHighlightEnabled: v })}
            label="Bật tô màu theo JLPT"
          />
          <div className="flex flex-col gap-2">
            {LEVEL_KEYS.map((key) => {
              const entry =
                settings.levelColors?.[key] || DEFAULT_LEVEL_COLORS[key];
              return (
                <div key={key} className="flex items-center gap-2.5">
                  <input
                    id={`lvl-on-${key}`}
                    type="checkbox"
                    checked={entry.on !== false}
                    onChange={(e) =>
                      patchLevel({
                        levelColors: {
                          ...settings.levelColors,
                          [key]: { ...entry, on: e.target.checked },
                        },
                      })
                    }
                    className="size-4 accent-[#9c40bf]"
                  />
                  <label
                    htmlFor={`lvl-on-${key}`}
                    className="w-24 cursor-pointer text-[13px] text-white/75"
                  >
                    {LEVEL_LABELS[key] || key.toUpperCase()}
                  </label>
                  <input
                    type="color"
                    aria-label={`Màu ${LEVEL_LABELS[key] || key.toUpperCase()}`}
                    value={entry.color}
                    onChange={(e) =>
                      patchLevel({
                        levelColors: {
                          ...settings.levelColors,
                          [key]: { ...entry, color: e.target.value },
                        },
                      })
                    }
                    className="h-7 w-12 cursor-pointer rounded border border-white/15 bg-transparent p-0.5"
                  />
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {LEVEL_KEYS.filter(
              (k) => settings.levelColors?.[k]?.on !== false,
            ).map((key) => (
              <span
                key={key}
                className="size-3 rounded-full"
                style={{
                  backgroundColor:
                    settings.levelColors?.[key]?.color ||
                    DEFAULT_LEVEL_COLORS[key].color,
                }}
                title={LEVEL_LABELS[key] || key.toUpperCase()}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={handleResetLevelColors}
            className="mt-1 w-fit rounded-md border border-white/15 bg-[#2a2a3a] px-3 py-1.5 text-[13px] text-white/85 hover:bg-[#3a3a50]"
          >
            Đặt lại màu mặc định
          </button>
        </Fieldset>

        <SelectField
          id="sourceLang"
          label="Ngôn ngữ nguồn"
          value={settings.sourceLang}
          onChange={(v) =>
            patch({ sourceLang: v as HardsubSettings["sourceLang"] })
          }
          options={[
            { value: "ja", label: "Japanese" },
            { value: "en", label: "English" },
            { value: "vi", label: "Vietnamese" },
            { value: "auto", label: "Auto (nhận diện ja/en/vi)" },
          ]}
        />

        <Fieldset legend="Ngôn ngữ đích (Gemini / cột EN·VI)">
          <ToggleRow
            id="target-en"
            checked={settings.targetLangs?.includes("en") !== false}
            onChange={(v) => {
              const cur = new Set(settings.targetLangs?.length ? settings.targetLangs : ["en", "vi"]);
              if (v) cur.add("en");
              else cur.delete("en");
              if (!cur.size) cur.add("vi");
              patch({ targetLangs: Array.from(cur) as HardsubSettings["targetLangs"] });
            }}
            label="English"
          />
          <ToggleRow
            id="target-vi"
            checked={settings.targetLangs?.includes("vi") !== false}
            onChange={(v) => {
              const cur = new Set(settings.targetLangs?.length ? settings.targetLangs : ["en", "vi"]);
              if (v) cur.add("vi");
              else cur.delete("vi");
              if (!cur.size) cur.add("en");
              patch({ targetLangs: Array.from(cur) as HardsubSettings["targetLangs"] });
            }}
            label="Vietnamese"
          />
        </Fieldset>

        <SelectField
          id="copyFormat"
          label="Copy mặc định"
          value={settings.copyFormat}
          onChange={(v) =>
            patch({ copyFormat: v as HardsubSettings["copyFormat"] })
          }
          options={[
            { value: "full", label: "JA+furi+EN+VI" },
            { value: "ja_vi", label: "JA+VI" },
            { value: "ja", label: "Chỉ JA" },
            { value: "vi", label: "Chỉ VI" },
          ]}
        />

        <Fieldset legend="Nền tảng hỗ trợ">
          <ToggleRow
            id="plat-yt"
            checked={settings.enabledPlatforms?.youtube !== false}
            onChange={(v) =>
              patch({
                enabledPlatforms: {
                  youtube: v,
                  netflix: settings.enabledPlatforms?.netflix !== false,
                  abema: settings.enabledPlatforms?.abema !== false,
                  web: settings.enabledPlatforms?.web !== false,
                },
              })
            }
            label="YouTube"
          />
          <ToggleRow
            id="plat-netflix"
            checked={settings.enabledPlatforms?.netflix !== false}
            onChange={(v) =>
              patch({
                enabledPlatforms: {
                  youtube: settings.enabledPlatforms?.youtube !== false,
                  netflix: v,
                  abema: settings.enabledPlatforms?.abema !== false,
                  web: settings.enabledPlatforms?.web !== false,
                },
              })
            }
            label="Netflix"
          />
          <ToggleRow
            id="plat-abema"
            checked={settings.enabledPlatforms?.abema !== false}
            onChange={(v) =>
              patch({
                enabledPlatforms: {
                  youtube: settings.enabledPlatforms?.youtube !== false,
                  netflix: settings.enabledPlatforms?.netflix !== false,
                  abema: v,
                  web: settings.enabledPlatforms?.web !== false,
                },
              })
            }
            label="ABEMA"
          />
          <ToggleRow
            id="plat-web"
            checked={settings.enabledPlatforms?.web !== false}
            onChange={(v) =>
              patch({
                enabledPlatforms: {
                  youtube: settings.enabledPlatforms?.youtube !== false,
                  netflix: settings.enabledPlatforms?.netflix !== false,
                  abema: settings.enabledPlatforms?.abema !== false,
                  web: v,
                },
              })
            }
            label="Web video khác"
          />
        </Fieldset>

        <Fieldset legend="ROI (% video intrinsic)">
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              id="roiTop"
              label="Top"
              value={settings.roi.top}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) =>
                patch({ roi: { ...settings.roi, top: v } })
              }
            />
            <NumberField
              id="roiHeight"
              label="Height"
              value={settings.roi.height}
              min={0.05}
              max={0.5}
              step={0.01}
              onChange={(v) =>
                patch({ roi: { ...settings.roi, height: v } })
              }
            />
            <NumberField
              id="roiLeft"
              label="Left"
              value={settings.roi.left}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) =>
                patch({ roi: { ...settings.roi, left: v } })
              }
            />
            <NumberField
              id="roiWidth"
              label="Width"
              value={settings.roi.width}
              min={0.2}
              max={1}
              step={0.01}
              onChange={(v) =>
                patch({ roi: { ...settings.roi, width: v } })
              }
            />
          </div>
        </Fieldset>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          className="rounded-lg bg-[#9c40bf] px-4 py-2 text-[14px] font-medium text-white hover:bg-[#b04dd4]"
        >
          Lưu
        </button>
        <button
          type="button"
          onClick={() => void handleBootstrap()}
          className="rounded-lg border border-white/15 bg-[#2a2a3a] px-4 py-2 text-[14px] text-white/85 hover:bg-[#3a3a50]"
        >
          Bootstrap models
        </button>
        {msg && (
          <span className="text-[13px] text-[#7fd6a8]">{msg}</span>
        )}
      </div>
    </div>
  );
}

function normalizeClientDefaults(): HardsubSettings {
  return {
    ...DEFAULT_HARDSUB_SETTINGS,
    roi: { ...DEFAULT_HARDSUB_SETTINGS.roi },
  };
}
