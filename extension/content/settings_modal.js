/**
 * In-page Settings Modal for Language Caption.
 * Dark-mode minimalist design:
 * 1. Word colors toggles & preview
 * 2. Display & Overlay (Opacity slider with live preview, dictionary, autopause, etc.)
 * 3. Supported Platforms (YouTube, Netflix, ABEMA)
 * 4. JLPT Level Colors (N5..N1, Unknown)
 * 5. Keyboard Shortcuts Reference
 */
(function (root) {
  let modalEl = null;

  // One source for the JLPT palette: shared/vocab_style.js owns the defaults
  // (the content script, the side panel CSS and this modal read the same
  // table). The local copy drifted (different "unknown" colour).
  const DEFAULT_JLPT_COLORS =
    (root.HardsubVocab && root.HardsubVocab.DEFAULT_LEVEL_COLORS) || {
      n5: { on: true, color: "#7fd6a8" },
      n4: { on: true, color: "#8fd3ff" },
      n3: { on: true, color: "#f5d76e" },
      n2: { on: true, color: "#e08a4a" },
      n1: { on: true, color: "#e74c5c" },
      unknown: { on: true, color: "#c5c5d0" },
    };

  function createModalHtml(settings) {
    const s = settings || {};
    const cats = s.vocabCats || {
      known: true,
      suggested: true,
      learning: true,
      learningBorder: true,
      ignored: true,
      special: true,
    };
    const platforms = s.enabledPlatforms || {
      youtube: true,
      netflix: true,
      abema: true,
      animevietsub: true,
      web: true,
    };
    const jlpt = s.levelColors || DEFAULT_JLPT_COLORS;
    const opacityVal = s.barBgOpacity != null ? Number(s.barBgOpacity) : 0.4;
    const opacityPct = Math.round(opacityVal * 100);

    return `
      <div class="lr-settings-backdrop" id="lr-settings-backdrop">
        <div class="lr-settings-dialog" role="dialog" aria-modal="true">
          <div class="lr-settings-header">
            <h2>Language Caption — Cài đặt</h2>
            <button type="button" class="lr-settings-close" id="lr-settings-close-x" aria-label="Close">✕</button>
          </div>
          <div class="lr-settings-body">
            <!-- Section 1: Word colors -->
            <div class="lr-settings-section">
              <div class="lr-settings-section-title">
                <span>Màu sắc từ vựng (Word Colors):</span>
                <button type="button" class="lr-link-btn" id="lr-reset-colors">Đặt lại mặc định</button>
              </div>

              <div class="lr-color-toggles">
                <label class="lr-toggle-row">
                  <span class="lr-toggle-label"><i class="lr-dot lr-dot-known"></i> Từ đã biết (Known words)</span>
                  <input type="checkbox" id="lr-cat-known" class="lr-switch" ${cats.known !== false ? "checked" : ""}>
                </label>
                <label class="lr-toggle-row">
                  <span class="lr-toggle-label"><i class="lr-dot lr-dot-suggested"></i> Từ gợi ý học (Suggested Words)</span>
                  <input type="checkbox" id="lr-cat-suggested" class="lr-switch" ${cats.suggested !== false ? "checked" : ""}>
                </label>
                <label class="lr-toggle-row">
                  <span class="lr-toggle-label"><i class="lr-dot lr-dot-learning"></i> Đang học (Marked to Learn)</span>
                  <input type="checkbox" id="lr-cat-learning" class="lr-switch" ${cats.learning !== false ? "checked" : ""}>
                </label>
                <label class="lr-toggle-row">
                  <span class="lr-toggle-label"><i class="lr-border-box"></i> Đang học - Viền chữ (Outline)</span>
                  <input type="checkbox" id="lr-cat-learning-border" class="lr-switch" ${cats.learningBorder !== false ? "checked" : ""}>
                </label>
                <label class="lr-toggle-row">
                  <span class="lr-toggle-label"><i class="lr-dot lr-dot-ignored"></i> Bỏ qua (Don't learn)</span>
                  <input type="checkbox" id="lr-cat-ignored" class="lr-switch" ${cats.ignored !== false ? "checked" : ""}>
                </label>
                <label class="lr-toggle-row">
                  <span class="lr-toggle-label"><i class="lr-dot lr-dot-special"></i> Từ đặc biệt (Special words)</span>
                  <input type="checkbox" id="lr-cat-special" class="lr-switch" ${cats.special !== false ? "checked" : ""}>
                </label>
              </div>

              <div class="lr-preview-box">
                <div class="lr-preview-title">Ví dụ minh họa (Preview):</div>
                <div class="lr-preview-content" id="lr-preview-text">
                  The first night I went to <span class="tok-known">sleep</span> on the <span class="tok-rare">sand</span>, a <span class="tok-learning">thousand</span> miles from any <span class="tok-special">human</span> habitation. I was more <span class="tok-ignored">isolated</span> than a shipwrecked sailor on a raft in the <span class="tok-known">middle</span> of the ocean.
                </div>
              </div>
            </div>

            <div class="lr-settings-divider"></div>

            <!-- Section 2: Display & Overlay -->
            <div class="lr-settings-section">
              <div class="lr-settings-section-title">
                <span>Hiển thị & Lớp phủ Subtitle (Overlay):</span>
              </div>

              <div class="lr-slider-group">
                <div class="lr-slider-header">
                  <span>Độ mờ nền Overlay (Opacity)</span>
                  <span class="lr-slider-val" id="lr-opacity-val">${opacityPct}%</span>
                </div>
                <input type="range" id="lr-opt-opacity" class="lr-range-slider" min="0" max="1" step="0.05" value="${opacityVal}">
              </div>

              <div class="lr-display-toggles">
                <label class="lr-toggle-row">
                  <span>Hiện từ điển mini khi hover vào từ</span>
                  <input type="checkbox" id="lr-opt-dict" class="lr-switch" ${s.showMiniDict !== false ? "checked" : ""}>
                </label>
                <label class="lr-toggle-row">
                  <span>Hiện thanh điều khiển phụ đề (Trái / Phải)</span>
                  <input type="checkbox" id="lr-opt-sub-controls" class="lr-switch" ${s.showSubControls !== false ? "checked" : ""}>
                </label>
                <label class="lr-toggle-row">
                  <span>Tự động tạm dừng (AP) khi hết câu phụ đề</span>
                  <input type="checkbox" id="lr-opt-autopause" class="lr-switch" ${s.autoPause ? "checked" : ""}>
                </label>
                <label class="lr-toggle-row">
                  <span>Hiện phụ đề bên dưới video</span>
                  <input type="checkbox" id="lr-opt-below-video" class="lr-switch" ${s.subBelowVideo ? "checked" : ""}>
                </label>
                <label class="lr-toggle-row">
                  <span>Tô màu JLPT cho bản dịch VI/EN song ngữ</span>
                  <input type="checkbox" id="lr-opt-bilingual-jlpt" class="lr-switch" ${s.enableBilingualJlptColor !== false ? "checked" : ""}>
                </label>
              </div>
            </div>

            <div class="lr-settings-divider"></div>

            <!-- Section 3: Supported Platforms -->
            <div class="lr-settings-section">
              <div class="lr-settings-section-title">
                <span>Nền tảng kích hoạt Extension & Side Panel:</span>
              </div>
              <div class="lr-platform-toggles">
                <label class="lr-toggle-row">
                  <span class="lr-toggle-label">YouTube (youtube.com)</span>
                  <input type="checkbox" id="lr-plat-youtube" class="lr-switch" ${platforms.youtube !== false ? "checked" : ""}>
                </label>
                <label class="lr-toggle-row">
                  <span class="lr-toggle-label">Netflix (netflix.com)</span>
                  <input type="checkbox" id="lr-plat-netflix" class="lr-switch" ${platforms.netflix !== false ? "checked" : ""}>
                </label>
                <label class="lr-toggle-row">
                  <span class="lr-toggle-label">ABEMA TV (abema.tv)</span>
                  <input type="checkbox" id="lr-plat-abema" class="lr-switch" ${platforms.abema !== false ? "checked" : ""}>
                </label>
                <label class="lr-toggle-row">
                  <span class="lr-toggle-label">AnimeVietSub (animevietsub)</span>
                  <input type="checkbox" id="lr-plat-animevietsub" class="lr-switch" ${platforms.animevietsub !== false ? "checked" : ""}>
                </label>
                <label class="lr-toggle-row">
                  <span class="lr-toggle-label">Mọi trang web khác (web)</span>
                  <input type="checkbox" id="lr-plat-web" class="lr-switch" ${platforms.web !== false ? "checked" : ""}>
                </label>
              </div>
            </div>

            <div class="lr-settings-divider"></div>

            <!-- Section 4: JLPT Level Colors -->
            <div class="lr-settings-section">
              <div class="lr-settings-section-title">
                <span>Màu cấp độ JLPT (Level Colors):</span>
              </div>
              <div class="lr-jlpt-pickers">
                ${["n5", "n4", "n3", "n2", "n1", "unknown"]
                  .map((lvl) => {
                    const cfg = (jlpt && jlpt[lvl]) || DEFAULT_JLPT_COLORS[lvl];
                    const label = lvl === "unknown" ? "Từ chưa rõ (Unknown)" : `JLPT ${lvl.toUpperCase()}`;
                    return `
                      <div class="lr-jlpt-row">
                        <div class="lr-jlpt-left">
                          <input type="color" class="lr-color-input" id="lr-jlpt-color-${lvl}" value="${cfg.color || DEFAULT_JLPT_COLORS[lvl].color}">
                          <span>${label}</span>
                        </div>
                        <input type="checkbox" class="lr-switch" id="lr-jlpt-on-${lvl}" ${cfg.on !== false ? "checked" : ""}>
                      </div>
                    `;
                  })
                  .join("")}
              </div>
            </div>

            <div class="lr-settings-divider"></div>

            <!-- Section 5: Keyboard Shortcuts -->
            <div class="lr-settings-section">
              <div class="lr-settings-section-title">
                <span>Phím tắt thao tác nhanh (Keyboard Shortcuts):</span>
              </div>
              <div class="lr-shortcuts-list">
                <div class="lr-shortcut-row">
                  <span>Bật / tắt thanh phụ đề Video</span>
                  <span class="lr-kbd">Alt + H</span>
                </div>
                <div class="lr-shortcut-row">
                  <span>Bật / tắt Picture-in-Picture (PiP)</span>
                  <span class="lr-kbd">Alt + P</span>
                </div>
                <div class="lr-shortcut-row">
                  <span>Phát lại câu phụ đề hiện tại</span>
                  <span class="lr-kbd">S</span>
                </div>
                <div class="lr-shortcut-row">
                  <span>Tạm dừng / Tiếp tục video</span>
                  <span class="lr-kbd">Space</span>
                </div>
              </div>
            </div>

            <div class="lr-settings-divider"></div>

            <!-- Section 6: AI Translation (Gemini) -->
            <div class="lr-settings-section">
              <div class="lr-settings-section-title">
                <span>Dịch thuật AI (Gemini 3.8 Flash):</span>
              </div>
              <p style="font-size: 11px; color: #a0aec0; margin: 0 0 8px 0; line-height: 1.4;">
                Tự động dịch JA → VI theo lô 25 câu khi mở video thiếu sub. Nhập Google AI Studio API Key:
              </p>
              <div style="display: flex; gap: 8px; margin-bottom: 6px;">
                <input type="password" id="lr-gemini-key-input" placeholder="Dán Gemini API Key (AI Studio) tại đây" autocomplete="off" style="flex: 1; background: #12141a; border: 1px solid #333846; color: #fff; border-radius: 4px; padding: 6px 10px; font-size: 12px; outline: none;">
                <button type="button" id="lr-save-gemini-key" style="background: #3182ce; color: #fff; border: none; border-radius: 4px; padding: 6px 14px; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap;">Lưu Key</button>
              </div>
              <div id="lr-gemini-status" style="font-size: 11px; min-height: 16px; margin-bottom: 8px; line-height: 1.3;"></div>
              <button type="button" id="lr-btn-translate-now" style="width: 100%; background: #232733; color: #cbd5e0; border: 1px solid #3c4257; border-radius: 4px; padding: 8px 12px; font-size: 12px; font-weight: 600; cursor: pointer; transition: background 0.15s;">⚡ Dịch ngay bằng Gemini AI</button>
            </div>

            <div class="lr-settings-divider"></div>

            <!-- Section 7: Anime Script (Jimaku.cc API) -->
            <div class="lr-settings-section">
              <div class="lr-settings-section-title">
                <span>Anime Script (Jimaku.cc API):</span>
              </div>
              <p style="font-size: 11px; color: #a0aec0; margin: 0 0 8px 0; line-height: 1.4;">
                Tự động tải phụ đề tiếng Nhật gốc từ Jimaku.cc khi xem anime trên AnimeVietSub:
              </p>
              <div style="display: flex; gap: 8px; margin-bottom: 6px;">
                <input type="password" id="lr-jimaku-key-input" placeholder="Dán Jimaku.cc API Key tại đây" autocomplete="off" style="flex: 1; background: #12141a; border: 1px solid #333846; color: #fff; border-radius: 4px; padding: 6px 10px; font-size: 12px; outline: none;">
                <button type="button" id="lr-save-jimaku-key" style="background: #3182ce; color: #fff; border: none; border-radius: 4px; padding: 6px 14px; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap;">Lưu Key</button>
              </div>
              <div id="lr-jimaku-status" style="font-size: 11px; min-height: 16px; margin-bottom: 8px; line-height: 1.3;"></div>
            </div>
          </div>

          <div class="lr-settings-footer">
            <button type="button" class="lr-btn-close" id="lr-settings-close-btn">Đóng</button>
          </div>
        </div>
      </div>
    `;
  }

  async function openSettingsModal(currentSettings, onSettingsChanged, extraActions) {
    if (modalEl) closeModal();

    const host = document.createElement("div");
    host.id = "lr-settings-modal-host";
    host.innerHTML = createModalHtml(currentSettings);
    document.body.appendChild(host);
    modalEl = host;

    const closeBtn = host.querySelector("#lr-settings-close-btn");
    const closeX = host.querySelector("#lr-settings-close-x");
    const backdrop = host.querySelector("#lr-settings-backdrop");

    const handleClose = () => closeModal();
    closeBtn?.addEventListener("click", handleClose);
    closeX?.addEventListener("click", handleClose);
    backdrop?.addEventListener("click", (e) => {
      if (e.target === backdrop) closeModal();
    });

    // Reset Word Colors
    const resetBtn = host.querySelector("#lr-reset-colors");
    resetBtn?.addEventListener("click", () => {
      currentSettings.vocabCats = {
        known: true,
        suggested: true,
        learning: true,
        learningBorder: true,
        ignored: true,
        special: true,
      };
      ["known", "suggested", "learning", "learning-border", "ignored", "special"].forEach((cat) => {
        const el = host.querySelector(`#lr-cat-${cat}`);
        if (el) el.checked = true;
      });
      if (typeof onSettingsChanged === "function") onSettingsChanged(currentSettings);
    });

    // Opacity Slider — live preview on every tick, persist only on release.
    const optOpacity = host.querySelector("#lr-opt-opacity");
    const opacityValEl = host.querySelector("#lr-opacity-val");
    optOpacity?.addEventListener("input", () => {
      const val = Number(optOpacity.value);
      if (opacityValEl) opacityValEl.textContent = `${Math.round(val * 100)}%`;
      currentSettings.barBgOpacity = val;
      const bar = document.getElementById("hardsub-ocr-bar");
      if (bar) {
        bar.style.setProperty("--bar-bg-a", String(val));
      }
    });
    optOpacity?.addEventListener("change", () => {
      if (typeof onSettingsChanged === "function") onSettingsChanged(currentSettings);
    });

    // Platform toggles
    ["youtube", "netflix", "abema", "animevietsub", "web"].forEach((plat) => {
      const el = host.querySelector(`#lr-plat-${plat}`);
      el?.addEventListener("change", () => {
        if (!currentSettings.enabledPlatforms) currentSettings.enabledPlatforms = {};
        currentSettings.enabledPlatforms[plat] = !!el.checked;
        if (typeof onSettingsChanged === "function") onSettingsChanged(currentSettings);
      });
    });

    // JLPT color pickers & toggles
    ["n5", "n4", "n3", "n2", "n1", "unknown"].forEach((lvl) => {
      const colorInput = host.querySelector(`#lr-jlpt-color-${lvl}`);
      const onInput = host.querySelector(`#lr-jlpt-on-${lvl}`);
      if (!currentSettings.levelColors) currentSettings.levelColors = JSON.parse(JSON.stringify(DEFAULT_JLPT_COLORS));
      colorInput?.addEventListener("change", () => {
        if (!currentSettings.levelColors[lvl]) currentSettings.levelColors[lvl] = {};
        currentSettings.levelColors[lvl].color = colorInput.value;
        if (typeof onSettingsChanged === "function") onSettingsChanged(currentSettings);
      });
      onInput?.addEventListener("change", () => {
        if (!currentSettings.levelColors[lvl]) currentSettings.levelColors[lvl] = {};
        currentSettings.levelColors[lvl].on = !!onInput.checked;
        if (typeof onSettingsChanged === "function") onSettingsChanged(currentSettings);
      });
    });

    // Category toggles & preview
    const cats = ["known", "suggested", "learning", "learning-border", "ignored", "special"];
    cats.forEach((cat) => {
      const el = host.querySelector(`#lr-cat-${cat}`);
      el?.addEventListener("change", () => {
        const catKey = cat === "learning-border" ? "learningBorder" : cat;
        if (!currentSettings.vocabCats) currentSettings.vocabCats = {};
        currentSettings.vocabCats[catKey] = !!el.checked;
        if (typeof onSettingsChanged === "function") {
          onSettingsChanged(currentSettings);
        }
      });
    });

    // Display options
    const optDict = host.querySelector("#lr-opt-dict");
    optDict?.addEventListener("change", () => {
      currentSettings.showMiniDict = !!optDict.checked;
      if (typeof onSettingsChanged === "function") onSettingsChanged(currentSettings);
    });

    const optSubCtrl = host.querySelector("#lr-opt-sub-controls");
    optSubCtrl?.addEventListener("change", () => {
      currentSettings.showSubControls = !!optSubCtrl.checked;
      if (typeof onSettingsChanged === "function") onSettingsChanged(currentSettings);
    });

    const optAP = host.querySelector("#lr-opt-autopause");
    optAP?.addEventListener("change", () => {
      currentSettings.autoPause = !!optAP.checked;
      if (typeof onSettingsChanged === "function") onSettingsChanged(currentSettings);
    });

    const optBelow = host.querySelector("#lr-opt-below-video");
    optBelow?.addEventListener("change", () => {
      currentSettings.subBelowVideo = !!optBelow.checked;
      if (typeof onSettingsChanged === "function") onSettingsChanged(currentSettings);
    });

    const optBilingual = host.querySelector("#lr-opt-bilingual-jlpt");
    optBilingual?.addEventListener("change", () => {
      currentSettings.enableBilingualJlptColor = !!optBilingual.checked;
      if (typeof onSettingsChanged === "function") onSettingsChanged(currentSettings);
    });

    // Gemini AI Translation settings
    const geminiKeyInput = host.querySelector("#lr-gemini-key-input");
    const saveGeminiKeyBtn = host.querySelector("#lr-save-gemini-key");
    const geminiStatusEl = host.querySelector("#lr-gemini-status");
    const translateNowBtn = host.querySelector("#lr-btn-translate-now");

    if (globalThis.HardsubGeminiTranslate && geminiKeyInput) {
      globalThis.HardsubGeminiTranslate.getStoredApiKey().then((k) => {
        if (k && geminiKeyInput) geminiKeyInput.value = k;
      });
    }

    saveGeminiKeyBtn?.addEventListener("click", async () => {
      const key = geminiKeyInput?.value.trim() || "";
      if (!key) {
        if (geminiStatusEl) {
          geminiStatusEl.textContent = "Vui lòng nhập Gemini API Key.";
          geminiStatusEl.style.color = "#f56565";
        }
        return;
      }
      if (geminiStatusEl) {
        geminiStatusEl.textContent = "Đang kiểm tra API Key...";
        geminiStatusEl.style.color = "#a0aec0";
      }
      try {
        if (globalThis.HardsubGeminiTranslate) {
          const check = await globalThis.HardsubGeminiTranslate.testApiKey(key);
          if (!check.ok) {
            if (geminiStatusEl) {
              geminiStatusEl.textContent = `Lỗi key: ${check.error || "Không hợp lệ"}`;
              geminiStatusEl.style.color = "#f56565";
            }
            return;
          }
          await globalThis.HardsubGeminiTranslate.saveApiKey(key);
        }
        if (geminiStatusEl) {
          geminiStatusEl.textContent = "✓ Đã lưu API Key thành công!";
          geminiStatusEl.style.color = "#48bb78";
        }
      } catch (err) {
        if (geminiStatusEl) {
          geminiStatusEl.textContent = `Lỗi: ${err.message || String(err)}`;
          geminiStatusEl.style.color = "#f56565";
        }
      }
    });

    // Jimaku API Key settings
    const jimakuKeyInput = host.querySelector("#lr-jimaku-key-input");
    const saveJimakuKeyBtn = host.querySelector("#lr-save-jimaku-key");
    const jimakuStatusEl = host.querySelector("#lr-jimaku-status");

    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local && jimakuKeyInput) {
      chrome.storage.local.get("jimakuApiKey").then((data) => {
        if (data?.jimakuApiKey && jimakuKeyInput) jimakuKeyInput.value = data.jimakuApiKey;
      }).catch(() => {});
    }

    saveJimakuKeyBtn?.addEventListener("click", async () => {
      const key = jimakuKeyInput?.value.trim() || "";
      if (!key) {
        if (jimakuStatusEl) {
          jimakuStatusEl.textContent = "Vui lòng nhập Jimaku API Key.";
          jimakuStatusEl.style.color = "#f56565";
        }
        return;
      }
      try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
          await chrome.storage.local.set({ jimakuApiKey: key });
        }
        if (jimakuStatusEl) {
          jimakuStatusEl.textContent = "✓ Đã lưu Jimaku API Key thành công!";
          jimakuStatusEl.style.color = "#48bb78";
        }
      } catch (err) {
        if (jimakuStatusEl) {
          jimakuStatusEl.textContent = `Lỗi: ${err.message || String(err)}`;
          jimakuStatusEl.style.color = "#f56565";
        }
      }
    });

    translateNowBtn?.addEventListener("click", () => {
      if (typeof extraActions?.onTranslateNow === "function") {
        extraActions.onTranslateNow();
      }
      closeModal();
    });
  }

  function closeModal() {
    if (modalEl) {
      modalEl.remove();
      modalEl = null;
    }
  }

  root.HardsubSettingsModal = {
    open: openSettingsModal,
    close: closeModal,
    // Exposed for the markup regression test (sidepanel/sidepanel_pure_test.js).
    createModalHtml,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
