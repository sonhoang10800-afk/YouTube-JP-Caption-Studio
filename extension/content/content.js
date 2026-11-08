/**
 * Content script: YouTube caption overlay (no OCR, no machine translation).
 * Load timedtext → normalize → merge cache → timeline overlay.
 * EN/VI from import or manual edit; furigana via bridge /tokenize.
 */
(() => {
  const Vocab = globalThis.HardsubVocab || {
    DEFAULT_VOCAB_SETTINGS: {},
    DEFAULT_VOCAB_COLORS: {},
    DEFAULT_LEVEL_COLORS: {},
    classForToken: () => "",
    applyColorVars: () => {},
    applyHighlightVars: (el, s) => {
      // stub: status colors only if shared script missing
      const apply = globalThis.HardsubVocab?.applyColorVars;
      if (apply) apply(el, s?.vocabColors);
    },
    normalizeLevelColors: (c) => c || {},
    tokensNeedEnrich: () => false,
  };

  if (!globalThis.HardsubDefaults) {
    console.warn("[jpcap] shared/hardsub_defaults.js missing — stale content script? Reload the extension + refresh tab.");
  }
  /** Shared overlay/vocab defaults + the content-only keys below. */
  const DEFAULTS = {
    ...(globalThis.HardsubDefaults || {}),
    enhanced_subtitles_enabled: true,
    sentence_grouping_enabled: true,
    sentence_translation_prefetch_enabled: true,
    panelWidth: 480,
    /** Independent box size multipliers (width / height). */
    barScaleW: 1,
    barScaleH: 1,
  };

  const CACHE_MATCH_TOL = 0.6;
  const SAVE_DEBOUNCE_MS = 400;

  const Timedtext = globalThis.HardsubTimedtextParse || {
    decodeEntities: (s) => String(s || ""),
    parseTimedtextXml: () => [],
    parseJson3Cues: () => [],
    parseTimedtextBody: () => [],
  };
  if (!globalThis.HardsubTimedtextParse) {
    console.warn("[jpcap] shared/timedtext_parse.js missing — stale content script? Reload the extension + refresh tab.");
  }

  const Normalize = globalThis.HardsubNormalize || {
    normalizeCues: (cues) => cues || [],
  };

  const CueTiming = globalThis.HardsubCueTiming || {
    clampCueEndsToNextStart: (cues) => cues || [],
    MIN_DUR: 0.45,
    GAP: 0.05,
  };

  const FillYtSecondary = globalThis.HardsubFillYtSecondary || {
    fillYtSecondary: () => 0,
  };

  let settings = { ...DEFAULTS };
  /** @type {Record<string, string>} */
  let userVocab = {};
  /** @type {Record<string, any>} */
  let savedCues = {};
  let apLastPausedCueId = "";
  let barPosIndex = 0;
  let translatingWithGemini = false;
  let lastBackgroundPrefetchTime = 0;
  let lrHotkeysBound = false;
  let translatingIds = new Set();
  let loopTimer = null;
  let healthTimer = null;
  let saveTimer = null;
  let reqSeq = 0;
  const pending = new Map();
  /** @type {Cue[]} */
  let cues = [];
  let captionMode = "original";
  let sentenceProjection = null;
  let sentenceProjectionCues = null;
  let sentenceSourceKey = "";
  let enhancedCues = [];
  let sentenceTranslations = {};
  let sentenceTokens = {};
  let sentenceUndoIds = new Set();
  let sentenceUndoRevisions = {};
  let sentenceUndoAppliedRevisions = {};
  let sentenceCandidates = {};
  let audioListeningActive = false;
  let sentenceTrackKind = "asr";
  let audioListeningAutoStarted = false;
  let sentenceStateLoadedKey = "", sentenceStateLoadedGen = -1, sentenceStateLoad = null;
  let sentenceRawTrack = null;
  let sentenceBenchmark = null;
  let sentenceRestorePending = false;
  const sentenceTokenPending = new Set(), sentenceTokenRetryAt = new Map();
  let currentMediaTime = 0;
  let iframePlayerTime = null;
  let currentVideoId = "";
  /** Video the page last reported a timedtext capture for (empty = none yet). */
  let pageCaptureVideoId = "";
  /** Which site family loaded cues (youtube / abema / web) — cache key namespace. */
  let currentSource = "youtube";
  /** Bumps on each yt-navigate; stale onNavigate/loadAllCaptions bail out. */
  let navigateGen = 0;
  let bridgeReady = false;
  let captionsStatus = "idle";
  let captionsInfo = "";
  let activeCueId = "";
  let listDirty = true;
  /** @returns {{ owned: boolean, tombstones: string[], rev: number, deviceId: string }} */
  const emptyMeta = () => ({ owned: false, tombstones: [], rev: 0, deviceId: "" });
  let transcriptMeta = emptyMeta();
  /** Which copy loadCachedCues last picked — shown in the side panel status line. */
  let scriptSource = { origin: "", rev: 0, updatedAt: "" };
  /** Session: side panel auto-open attempted once per tab (not per navigate). */
  let autoOpenPanelTried = false;
  /** Chrome blocked sidePanel.open — retry on next player gesture. */
  let pendingOpenSidePanel = false;
  let gestureOpenBound = false;

  /**
   * @typedef {{
   *   id: string,
   *   start_media_time: number,
   *   end_media_time: number,
   *   source: string,
   *   en: string,
   *   vi: string,
   *   tokens: any[],
   *   translated: boolean,
   *   text_source: string,
   *   mt_locked?: boolean,
   *   translation_source?: string,
   * }} Cue
   */

  /** User/import owns EN/VI — do not overwrite on cache merge (tokens enrich OK). */
  function isMtLocked(c) {
    if (!c) return false;
    if (c.mt_locked) return true;
    const src = String(c.translation_source || "");
    return src === "user" || src === "import";
  }

  function lockCueTranslation(c, source) {
    if (!c) return;
    c.mt_locked = true;
    c.translation_source = source === "import" ? "import" : "user";
  }

  function unlockCueTranslation(c) {
    if (!c) return;
    c.mt_locked = false;
    c.translation_source = "";
  }

  // Must match MAIN parser/capture capability, including source provenance.
  const PAGE_API_VER = 7;
  let pageBridgeReady = false;
  // Capability token: per-injection secret the MAIN-world reply must echo back,
  // so a hostile page script can't forge caption results by spoofing
  // source:"hardsub-ocr-page" (it never sees this token).
  let pageCapToken = "";

  /**
   * Capability gate for MAIN-world replies. A *missing* token must be rejected
   * exactly like a wrong one: the previous `expected && provided && provided !==
   * expected` form only rejected a wrong token, so a forged reply got through by
   * simply omitting `cap`.
   *
   * ponytail: `expected` is still "" when injectPageScript() early-returns on an
   * already-present script element (content-script reload without a re-inject), so
   * in that one window any token-bearing reply is accepted. Upgrade by minting the
   * token before that early return, then drop the `!expected` escape.
   */
  function capAcceptsReply(expected, provided) {
    if (!provided) return false;
    return !expected || provided === expected;
  }

  function injectPageScript(force = false) {
    const existing = document.getElementById("hardsub-ocr-page-script");
    if (existing && !force) return;
    if (existing) existing.remove();
    // Fresh token on every inject — stale MAIN-world copies hold an invalid cap.
    try { crypto.getRandomValues(new Uint8Array(16)); } catch (_) {}
    pageCapToken =
      (crypto.randomUUID && crypto.randomUUID()) ||
      Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
        b.toString(16).padStart(2, "0")
      ).join("");
    // Marker element (plain div: no URL load involved) carrying version + cap for
    // the MAIN-world helpers, which find it by id (same lookup as before).
    const marker = document.createElement("div");
    marker.id = "hardsub-ocr-page-script";
    marker.hidden = true;
    marker.dataset.v = chrome.runtime.getManifest().version;
    marker.dataset.cap = pageCapToken;
    marker.dataset.api = String(PAGE_API_VER);
    (document.head || document.documentElement).appendChild(marker);
    // Execute the helpers directly in the MAIN world via the scripting API.
    // DOM <script src="chrome-extension://..."> tags are subject to the page's
    // CSP script-src (YouTube does not allow the extension scheme), so they fail
    // with "Unsafe attempt to load URL" even when web_accessible_resources lists
    // the files (verified live 2026-10-23). executeScript reads the files from
    // disk and is exempt. Order in `files` is execution order (parser first).
    // Fire-and-forget safe: failures surface as bridge-not-ready to the PING loop.
    return (async () => {
      const tabId = await ensureContentTabId();
      if (tabId == null || !chrome?.scripting?.executeScript) {
        throw new Error("page inject unavailable (no tab id or scripting API)");
      }
      if (force) {
        // Clear the MAIN-world guard so page_capture.js can rebind. This used to
        // be an inline <script>, which the page CSP also blocks.
        await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: () => {
            try {
              if (window.__hardsubPageMsgHandler) {
                window.removeEventListener("message", window.__hardsubPageMsgHandler);
                delete window.__hardsubPageMsgHandler;
              }
              delete window.__HARDSubOCRCapture;
            } catch (_) {}
          },
        });
      }
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        files: ["shared/timedtext_parse.js", "injected/page_capture.js"],
      });
      return true;
    })().catch(() => false);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function waitForPageBridge(maxMs = 8000) {
    injectPageScript(false);
    const t0 = Date.now();
    let forced = false;
    while (Date.now() - t0 < maxMs) {
      const r = await pageCall("PING", {}, 300);
      if (r?.ok && Number(r.apiVer) === PAGE_API_VER) {
        pageBridgeReady = true;
        return true;
      }
      if (r?.ok && Number(r.apiVer) !== PAGE_API_VER && !forced) {
        forced = true;
        injectPageScript(true);
      } else if (!r?.ok && !forced && Date.now() - t0 > 600) {
        forced = true;
        injectPageScript(true);
      }
      await sleep(150);
    }
    return false;
  }

  function pageCall(type, payload, timeoutMs = 800) {
    const requestId = `r${++reqSeq}`;
    return new Promise((resolve) => {
      pending.set(requestId, resolve);
      window.postMessage({ source: "hardsub-ocr-ext", type, requestId, payload }, "*");
      setTimeout(() => {
        if (pending.has(requestId)) {
          pending.delete(requestId);
          resolve({ ok: false, reason: "timeout" });
        }
      }, timeoutMs);
    });
  }

  const decodeEntities = (s) => Timedtext.decodeEntities(s);
  const parseJson3Cues = (data) => Timedtext.parseJson3Cues(data, { includeSource: true });
  const parseTimedtextXml = (xml) => Timedtext.parseTimedtextXml(xml);
  const parseTimedtextBody = (body) => Timedtext.parseTimedtextBody(body, { includeSource: true });

  async function loadCaptionsViaBackground(videoId, lang, extra = {}) {
    try {
      const r = await chrome.runtime.sendMessage({
        type: "YT_LOAD_CAPTIONS",
        videoId,
        lang: lang || "ja",
        baseUrl: extra.baseUrl || "",
        asr: !!extra.asr,
        force: !!extra.force,
      });
      if (r?.ok && Array.isArray(r.cues) && r.cues.length) return r;
      return r || { ok: false, reason: "sw_empty", cues: [] };
    } catch (err) {
      return { ok: false, reason: "sw_exception", message: String(err), cues: [] };
    }
  }

  async function fetchTimedtextInContent(baseUrl) {
    if (!baseUrl) return null;
    let url = String(baseUrl);
    const tryUrls = [url];
    if (!url.includes("fmt=")) {
      tryUrls.push(`${url}${url.includes("?") ? "&" : "?"}fmt=json3`);
      tryUrls.push(`${url}${url.includes("?") ? "&" : "?"}fmt=srv3`);
    } else {
      if (!url.includes("fmt=srv3")) tryUrls.push(url.replace(/([?&])fmt=[^&]+/, "$1fmt=srv3"));
      if (!url.includes("fmt=json3")) tryUrls.push(url.replace(/([?&])fmt=[^&]+/, "$1fmt=json3"));
    }
    for (const cred of ["omit", "include"]) {
      for (const u of tryUrls) {
        try {
          const res = await fetch(u, { credentials: cred, cache: "no-store" });
          if (res.ok) {
            const body = await res.text();
            if (body && body.trim()) {
              const cues = parseTimedtextBody(body);
              if (cues.length) return cues;
            }
          }
        } catch {
          /* next */
        }
      }
    }
    for (const u of tryUrls) {
      try {
        const sw = await chrome.runtime.sendMessage({ type: "YT_FETCH", url: u });
        if (sw?.text) {
          const cues = parseTimedtextBody(sw.text);
          if (cues.length) return cues;
        }
      } catch {
        /* next */
      }
    }
    return null;
  }

  // Last-resort tier: bridge-cached captions when SW + page paths all miss.
  // ponytail: JA source only; en/vi secondaries not served by this endpoint —
  // extend when /captions returns them. Capped at 12s so a slow upstream fetch
  // (bridge retries YouTube) can't stall the empty-state UI for half a minute.
  async function fetchCaptionsFromBridge(videoId, lang, maxMs = 12000) {
    try {
      const res = await Promise.race([
        bridgeFetch(
          `/captions/${encodeURIComponent(videoId)}?lang=${lang || "ja"}`,
        ),
        sleep(maxMs).then(() => null),
      ]);
      const cues = res?.data?.cues;
      if (!res?.ok || res?.data?.ok !== true || !Array.isArray(cues) || !cues.length) {
        return null;
      }
      // Bridge serves ms {id,start,duration,text}; pipeline wants seconds {start,end,text}.
      return cues
        .map((c) => ({
          start: (Number(c.start) || 0) / 1000,
          end:
            ((Number(c.start) || 0) + Math.max(0, Number(c.duration) || 0)) / 1000,
          text: String(c.text || "").trim(),
        }))
        .filter((c) => c.text);
    } catch {
      return null; // endpoint may not exist yet — silent miss
    }
  }

  async function syncToPlayhead() {
    if (!cues.length) {
      activeCueId = "";
      updateBar(null);
      return null;
    }
    const mtRes = await pageCall("GET_MEDIA_TIME", {}, 400);
    const mediaTime = Number(mtRes?.mediaTime);
    if (!Number.isFinite(mediaTime)) return null;
    currentMediaTime = mediaTime;
    const active = findActiveCue(mediaTime);
    activeCueId = active?.id || "";
    updateBar(active);
    return active;
  }

  async function applyLoadedCues(rawCues, info, opts = {}) {
    const gen = navigateGen;
    const vid = currentVideoId;
    // Guard against non-Japanese captions arriving in JA slot:
    const detected = detectCuesLanguage(rawCues);
    const jaCount = (rawCues || []).filter((c) =>
      /[\u3040-\u30ff\u4e00-\u9faf]/.test(c?.text || c?.source || "")
    ).length;
    const isActuallyJa = jaCount >= Math.max(1, Math.floor((rawCues?.length || 0) * 0.15));
    if (!isActuallyJa && (detected === "en" || detected === "vi")) {
      if (cues.length > 0) {
        if (detected === "vi") applyYtSecondaryFill({ viCues: rawCues });
        else applyYtSecondaryFill({ enCues: rawCues });
        listDirty = true;
        renderList(true);
        publishSidePanelState({ forceList: true });
      }
      return;
    }

    captionsStatus = "ok";
    captionsInfo = info;
    paintPendingT0 = performance.now();
    const normalized = Normalize.normalizeCues(rawCues, { includeSource: true });
    if (currentSource === "youtube" && gen === navigateGen && vid === currentVideoId) {
      const sourceKey = sentenceTrackKey();
      const sourceTrack = opts.sourceTrack ? Object.fromEntries(["trackId", "language", "kind", "format"]
        .map(key => [key, typeof opts.sourceTrack[key] === "string" ? opts.sourceTrack[key] : null])) : null;
      sentenceTrackKind = (opts.sourceTrack?.kind === "asr" || opts.asr) ? "asr" : (opts.sourceTrack ? "manual" : "asr");
      const fingerprint = await sentenceSourceFingerprint(sourceKey, rawCues, sourceTrack);
      if (gen !== navigateGen || vid !== currentVideoId || sourceKey !== sentenceTrackKey()) return;
      sentenceRawTrack = { version: 1, sourceKey, fingerprint, sourceTrack, cues: structuredClone(rawCues) };
      sentenceBenchmark?.trackLoaded(performance.now());
    }
    // Fresh YT only — skip chrome.storage + disk merge (after wipe / hard reset).
    if (opts.skipCache) {
      if (gen !== navigateGen || currentVideoId !== vid) return;
      const inMemoryWithTrans = (cues || []).filter((c) => c && (c.vi || c.en || c.translated));
      transcriptMeta = emptyMeta();
      cues = mergeCache(normalized, inMemoryWithTrans, transcriptMeta);
      applyYtSecondaryFill(opts);
      listDirty = true;
      // T2: start token enrich in parallel, await it (capped) so the first
      // publish already carries furigana/JLPT — one phase when bridge is warm.
      const enrichP = enrichTokensAfterImport();
      await Promise.race([enrichP, sleep(200)]);
      if (gen !== navigateGen || currentVideoId !== vid) return;
      await syncToPlayhead();
      updateCaptionStatusLine();
      renderList(true);
      publishSidePanelState({ forceList: true });
      if (cues.some((c) => c.tokens?.length)) markFuriganaPainted();
      void triggerGeminiTranslationIfNeeded();
      await saveTranscript({ force: true });
      return;
    }
    const [cached, meta] = await Promise.all([
      loadCachedCues(currentVideoId),
      loadTranscriptMeta(currentVideoId),
    ]);
    if (gen !== navigateGen || currentVideoId !== vid) return;
    transcriptMeta = meta;
    // Preserve any existing in-memory translations from current cues so re-fetch never wipes them:
    const inMemoryWithTrans = (cues || []).filter((c) => c && (c.vi || c.en || c.translated));
    const effectiveCache = inMemoryWithTrans.length ? mergeCacheLists(inMemoryWithTrans, cached) : cached;
    const merged = mergeCache(normalized, effectiveCache, meta);
    // Owned/import script wins: mergeCache keeps file timeline and does not
    // append unmatched YT cues (score-based pick used to prefer polluted merges).
    cues = merged;
    if (meta.owned) captionsInfo = `${info} · owned script`;
    applyYtSecondaryFill(opts);
    listDirty = true;
    // T2: enrich in parallel with playhead-align; cap the wait so cold-bridge
    // still renders JA plain fast (enrich's own publish fills furigana later).
    const enrichP = enrichTokensAfterImport();
    await Promise.race([enrichP, sleep(200)]);
    if (gen !== navigateGen || currentVideoId !== vid) return;
    // Align list/overlay to current playhead before first publish (mid-video open).
    await syncToPlayhead();
    if (gen !== navigateGen || currentVideoId !== vid) return;
    // Status first so the publish includes real cached N/M (not stale 0/0).
    updateCaptionStatusLine();
    renderList(true);
    publishSidePanelState({ forceList: true });
    if (cues.some((c) => c.tokens?.length)) markFuriganaPainted();
    void triggerGeminiTranslationIfNeeded();
    // Never auto-save a YT merge that would clobber a richer owned script.
    if (!meta.owned || scriptListScore(cues) >= scriptListScore(cached)) {
      scheduleSaveTranscript();
    }
  }

  /**
   * Union-merge YT en/vi into cue rows (±tol or overlap): fill empty unlocked,
   * append orphans when not owned. Triggers save + panel via callers.
   */
  function applyYtSecondaryFill(opts) {
    const n = FillYtSecondary.fillYtSecondary(cues, opts?.enCues, opts?.viCues, {
      tol: CACHE_MATCH_TOL,
      isLocked: isMtLocked,
      // Owned timeline is authoritative — paint blanks only, no orphan rows.
      appendOrphans: !transcriptMeta.owned,
    });
    // Heal pending count when en/vi already present but translated flag lagged.
    for (const c of cues) {
      if (c.translated) continue;
      if (String(c.en || "").trim() || String(c.vi || "").trim()) {
        c.translated = true;
      }
    }
    return n;
  }

  function langFromTimedtextUrl(url) {
    try {
      const u = new URL(String(url || ""), location.href);
      return u.searchParams.get("tlang") || u.searchParams.get("lang") || "";
    } catch {
      return "";
    }
  }

  function sourceLangFromTimedtextUrl(url) {
    try {
      const u = new URL(String(url || ""), location.href);
      return u.searchParams.get("lang") || "";
    } catch {
      return "";
    }
  }

  function isJaLang(lang) {
    return String(lang || "")
      .toLowerCase()
      .startsWith("ja");
  }

  function isViLang(lang) {
    const s = String(lang || "").toLowerCase();
    return s.startsWith("vi") || s === "vie" || s === "vietnamese";
  }

  function isEnLang(lang) {
    const s = String(lang || "").toLowerCase();
    return s.startsWith("en") || s === "eng" || s === "english";
  }

  function detectCuesLanguage(list) {
    if (!Array.isArray(list) || !list.length) return "unknown";
    const sample = list
      .slice(0, 50)
      .map((c) => (c ? c.text || c.source || "" : ""))
      .join(" ");
    if (/[\u3040-\u30ff\u4e00-\u9faf]/.test(sample)) return "ja";
    if (/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđĐ]/i.test(sample)) return "vi";
    if (/[a-zA-Z]/.test(sample)) return "en";
    return "unknown";
  }

  function stampSecondaryStatus(enN, viN) {
    const base = String(captionsInfo || "").replace(/\s*·\s*en:\d+\s+vi:\d+\s*$/i, "");
    captionsInfo = `${base} · en:${enN} vi:${viN}`;
  }

  function logYtSecondaryMiss(sw, enN, viN) {
    const msg = `yt secondary miss video=${currentVideoId || "?"} hasEn=${!!sw?.hasEn} hasVi=${!!sw?.hasVi} en:${enN} vi:${viN} via=${sw?.via || "?"} reason=${sw?.reason || "?"} bridge=${sw?.bridge || "n/a"} trackCount=${sw?.trackCount || "?"}${sw?.lastError ? ` lastError=${sw.lastError}` : ""}`;
    void bridgeFetch("/log", {
      method: "POST",
      body: { level: "WARNING", message: msg },
    }).catch(() => {});
  }

  // T5 gate: t0 set when cues arrive; warn once per video when the first
  // ruby-capable publish took > 150ms (furigana painted target ~100ms).
  let paintPendingT0 = 0;
  let furiganaWarnedVideo = "";
  function markFuriganaPainted() {
    if (!paintPendingT0) return;
    const ms = performance.now() - paintPendingT0;
    paintPendingT0 = 0;
    if (ms <= 150) return;
    if (furiganaWarnedVideo === currentVideoId) return;
    furiganaWarnedVideo = currentVideoId || "?";
    void bridgeFetch("/log", {
      method: "POST",
      body: {
        level: "WARNING",
        message: `furigana painted slow=${Math.round(ms)}ms video=${currentVideoId || "?"}`,
      },
    }).catch(() => {});
  }

  /**
   * Await SW pack, union-fill EN/VI, publish. Never fire-and-forget — silent n===0
   * left VI/EN blank after ja-intercept early-win.
   */
  async function applySecondaryFromSw(sw) {
    if (!sw) return 0;
    const enN = Array.isArray(sw.enCues) ? sw.enCues.length : 0;
    const viN = Array.isArray(sw.viCues) ? sw.viCues.length : 0;
    const n = applyYtSecondaryFill({ enCues: sw.enCues, viCues: sw.viCues });
    stampSecondaryStatus(enN, viN);
    if ((sw.hasEn || sw.hasVi) && enN + viN === 0) {
      logYtSecondaryMiss(sw, enN, viN);
    }
    if (n) {
      listDirty = true;
      scheduleSaveTranscript();
    }
    // Always push cue rows — status-only publish left EN/VI blank in the panel.
    updateCaptionStatusLine();
    publishSidePanelState({ forceList: true });
    return n;
  }

  /**
   * B6: when SW hasEn/hasVi but empty packs (or no packs), page-fetch (web then
   * ANDROID rescue) — no setOption per lang. VI stays in viCues only.
   */
  async function ensureSecondaryPacks(sw) {
    let enCues = Array.isArray(sw?.enCues) ? sw.enCues : [];
    let viCues = Array.isArray(sw?.viCues) ? sw.viCues : [];
    let hasEn = !!sw?.hasEn;
    let hasVi = !!sw?.hasVi;
    const needPage =
      (hasEn && !enCues.length) ||
      (hasVi && !viCues.length) ||
      (!enCues.length && !viCues.length);
    if (!needPage) {
      return { enCues, viCues, hasEn, hasVi };
    }
    // Stale page API (pre-FETCH_MULTI_LANG) → force reinject before multi-fetch.
    const ping = await pageCall("PING", {}, 400);
    if (!ping?.ok || Number(ping.apiVer) !== PAGE_API_VER) {
      // Await: injection goes through the async scripting API, so a fixed sleep
      // could race the MAIN-world script and drop the retry.
      await injectPageScript(true);
    }
    const page = await pageCall(
      "FETCH_MULTI_LANG",
      { videoId: currentVideoId, lang: settings.sourceLang },
      20000
    );
    if (Array.isArray(page?.enCues) && page.enCues.length) enCues = page.enCues;
    if (Array.isArray(page?.viCues) && page.viCues.length) viCues = page.viCues;
    if (page?.hasEn) hasEn = true;
    if (page?.hasVi) hasVi = true;
    if ((hasEn || hasVi) && !enCues.length && !viCues.length) {
      logYtSecondaryMiss(
        { hasEn, hasVi, via: page?.via || page?.reason || "page_multi" },
        0,
        0
      );
    }
    return {
      enCues,
      viCues,
      hasEn,
      hasVi,
      // Optional JA rescue for callers that still need source — never put VI here.
      cues: Array.isArray(page?.cues) ? page.cues : [],
      via: page?.via || "page_multi",
    };
  }

  /** B7: fill EN/VI async after JA paint — do not block panel return. */
  function kickSecondaryFill(sw) {
    const gen = navigateGen;
    const vid = currentVideoId;
    void (async () => {
      try {
        const packs = await ensureSecondaryPacks(sw);
        if (gen !== navigateGen || currentVideoId !== vid) return;
        await applySecondaryFromSw(packs);
      } catch (_) {
        /* secondary miss already logged inside apply when needed */
      }
    })();
  }

  window.addEventListener("message", (ev) => {
    // Only the page script we inject (same window) may answer — a cross-origin
    // iframe or page-world script could otherwise forge caption results.
    if (ev.source !== window) return;
    // The page reports a timedtext capture for a video: remember which one so
    // the page-world poll can stop asking the same question again.
    if (ev.data?.type === "__HARDSUB_TIMEDTEXT_CAPTURED__") {
      pageCaptureVideoId = String(ev.data.videoId || "");
    }
    if (!ev.data || typeof ev.data !== "object" || ev.data.source !== "hardsub-ocr-page") return;
    const { requestId, result, cap } = ev.data;
    // Capability token gate: check top-level cap or result.cap
    const msgCap = cap || result?.cap;
    if (!capAcceptsReply(pageCapToken, msgCap)) return;
    const resolve = pending.get(requestId);
    if (resolve) {
      pending.delete(requestId);
      resolve(result);
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "DRIVE_RESTORED") {
      const only = Array.isArray(msg.videoIds) ? msg.videoIds : null;
      if (only && currentVideoId && !only.includes(currentVideoId)) {
        sendResponse({ ok: true, skipped: "other_video" });
        return true;
      }
      // Bridge disk updated from Drive — drop the stale cue cache only. Keeping
      // transcriptMeta keeps `owned` alive, which is what made restores fall back to YT.
      void (async () => {
        try {
          if (currentVideoId) {
            // Rev guard: transcriptMeta.rev is the max of both sides, so compare the
            // raw chrome.storage rev against the disk rev Drive just restored to.
            // Local Chrome edits at least as new (>=) + owned cues → keep them,
            // skip the remove + re-apply so Drive can't roll back local edits.
            const mKey = metaStorageKey(currentVideoId);
            const rawMeta = (await chrome.storage.local.get([mKey]))[mKey] || {};
            const diskMeta = (await loadDiskMeta(currentVideoId)) || {};
            if (
              (Number(rawMeta.rev) || 0) >= (Number(diskMeta.rev) || 0) &&
              cues.some(isOwnedCue)
            ) {
              return;
            }
            await chrome.storage.local.remove([`transcript:${tabPrefix()}${currentVideoId}`]);
          }
          const restored = await tryApplySavedScript("drive", { quiet: true });
          if (!restored) {
            await loadAllCaptions(true, { skipCache: false });
          } else if (cues.some(isOwnedCue)) {
            transcriptMeta.owned = true;
            await saveTranscriptMeta();
          }
        } catch (_) {}
      })();
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.type === "TOGGLE_OVERLAY") {
      void toggleShowOnVideo();
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.type === "TOGGLE_PIP") {
      void togglePictureInPicture();
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.type === "ASR_CANDIDATE_RECEIVED") {
      void handleAsrCandidateReceived(msg);
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.type === "ASR_CAPTURE_ERROR") {
      // The offscreen document could not capture the tab audio. Without this
      // the overlay would keep showing "listening" while no recorder runs.
      // The message is broadcast, so only the tab that asked for the capture
      // may act on it.
      if (msg?.tabId != null && contentTabId != null && msg.tabId !== contentTabId) {
        sendResponse({ ok: false, error: "not_this_tab" });
        return true;
      }
      // Only act when this tab thinks it is listening. The error is also
      // reported through the answer of the AUDIO_START_CAPTURE request, which
      // is where the user-facing message is shown - here we only make sure the
      // overlay leaves the "listening" state.
      if (!audioListeningActive) {
        sendResponse({ ok: true, error: "not_listening" });
        return true;
      }
      audioListeningActive = false;
      publishSidePanelState({ forceList: true });
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.type !== "SP_CMD") return;
    handleSidePanelCmd(msg)
      .then((r) => sendResponse(r || { ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  });

  async function handleSidePanelCmd(msg) {
    const cmd = msg.cmd;
    if (!currentVideoId) {
      currentSource = sourceFromHost();
      currentVideoId = videoIdFromUrl();
    }
    if (cmd === "ping" || cmd === "get_state") {
      // Side panel open / reconnect / tab switch must always receive the full cue list.
      publishSidePanelState({ forceList: true });
      return { ok: true, videoId: currentVideoId, count: cues.length };
    }
    if (cmd === "set_caption_mode") {
      await loadSentenceState();
      cancelSentencePrefetch();
      refreshSentenceProjection(true);
      const enhancementAvailable = sentenceEnhancementEnabled();
      // "enhanced" only applies when the sentence engine is ready AND enabled.
      // Answer the mode that was really applied so the panel can show the
      // downgrade instead of a silent "original".
      const applied =
        msg.mode === "enhanced" && sentenceProjection && enhancementAvailable
          ? "enhanced"
          : "original";
      captionMode = applied;
      await syncToPlayhead();
      publishSidePanelState({ forceList: true });
      void enrichSentenceGroups();
      void triggerGeminiTranslationIfNeeded();
      return {
        ok: true,
        captionMode: applied,
        requestedMode: msg.mode === "enhanced" ? "enhanced" : "original",
        enhancementAvailable,
      };
    }
    if (cmd === "toggle_audio_listening") {
      return toggleAudioListening(msg.active != null ? msg.active : !audioListeningActive, { auto: false });
    }
    if (cmd === "accept_asr_candidate") {
      const cue = resolveSourceCue(msg.id);
      const cand = (cue && sentenceCandidates[cue.id]) || sentenceCandidates[msg.id];
      if (!cue || !cand) return { ok: false, error: "Candidate not found" };

      if (!canReceiveAsrCandidate(cue)) {
        if (cue) delete sentenceCandidates[cue.id];
        delete sentenceCandidates[msg.id];
        await saveSentenceState();
        publishSidePanelState({ forceList: true });
        return { ok: false, error: "Cue is locked or user-edited" };
      }

      const rev = sentenceCueRevision(cue);
      cue.source = cand.text;
      cue.text_source = cand.provenance || (cand.model ? `asr:${cand.model}` : "asr:whisper-large-v3-turbo");
      cue.normalization = null;
      sentenceUndoRevisions[cue.id] = rev;
      sentenceUndoAppliedRevisions[cue.id] = sentenceCueRevision(cue);
      sentenceUndoIds.add(cue.id);
      if (cue) delete sentenceCandidates[cue.id];
      delete sentenceCandidates[msg.id];
      delete sentenceTokens[cue.id];
      delete sentenceTranslations[cue.id];
      listDirty = true;
      refreshSentenceProjection(true);
      await saveSentenceState();
      await syncToPlayhead();
      publishSidePanelState({ forceList: true });
      toast("Đã áp dụng gợi ý audio (có thể Undo)");
      return { ok: true };
    }
    if (cmd === "revert_asr_candidate" || cmd === "dismiss_asr_candidate") {
      const cue = resolveSourceCue(msg.id);
      if (cue && sentenceCandidates[cue.id]) {
        delete sentenceCandidates[cue.id];
      }
      if (sentenceCandidates[msg.id]) {
        delete sentenceCandidates[msg.id];
      }
      await saveSentenceState();
      publishSidePanelState({ forceList: true });
      toast("Đã bỏ qua gợi ý");
      return { ok: true };
    }
    if (cmd === "undo_sentence") {
      cancelSentencePrefetch();
      refreshSentenceProjection();
      const original = cues.find(c => c.id === msg.id) || resolveSourceCue(msg.id);
      if (original && sentenceUndoRevisions[original.id]) {
        if (sentenceUndoAppliedRevisions[original.id] &&
            sentenceUndoAppliedRevisions[original.id] !== sentenceCueRevision(original)) {
          return { ok: false, error: "Sentence changed; refresh before undo" };
        }
        try {
          const parsed = JSON.parse(sentenceUndoRevisions[original.id]);
          original.source = parsed[1];
          original.start_media_time = parsed[2];
          original.end_media_time = parsed[3];
          original.rawSource = parsed[4];
          original.text_source = parsed[5];
          if (parsed.length > 8) original.normalization = parsed[8];
          delete sentenceUndoRevisions[original.id];
          delete sentenceUndoAppliedRevisions[original.id];
          sentenceUndoIds.delete(original.id);
          delete sentenceTokens[original.id];
          delete sentenceTranslations[original.id];
          listDirty = true;
          refreshSentenceProjection(true);
          await saveSentenceState();
          await syncToPlayhead();
          publishSidePanelState({ forceList: true });
          toast("Đã hoàn tác");
          return { ok: true };
        } catch (_) {}
      }
      const unit = enhancedCues.find(c => c.id === msg.id);
      if (!unit) return { ok: false, error: "Sentence changed; refresh before undo" };
      for (const ref of unit.sourceRefs) sentenceUndoIds.add(ref.cueId);
      for (const ref of unit.sourceRefs) {
        const orig = cues.find(c => c.id === ref.cueId);
        if (orig) sentenceUndoRevisions[orig.id] = sentenceCueRevision(orig);
      }
      refreshSentenceProjection(true);
      await saveSentenceState();
      await syncToPlayhead();
      publishSidePanelState({ forceList: true });
      return { ok: true };
    }
    if (cmd === "reload") {
      toast("Đang tải caption…");
      if (!currentVideoId) {
        currentVideoId = videoIdFromUrl();
      }
      // Force fresh YT timeline (skip stale overlapping chrome/disk ends).
      await loadAllCaptions(true, { skipCache: false });
      if (cues.length && !transcriptMeta.owned) {
        listDirty = true;
        scheduleSaveTranscript();
        publishSidePanelState({ forceList: true });
      }
      if (cues.length) toast(`Đã tải ${cues.length} câu`);
      else toast(`Không có caption (${captionsInfo || captionsStatus})`);
      return { ok: true, count: cues.length };
    }
    if (cmd === "refresh_script") {
      await checkDriveFresh(currentVideoId, { force: true });
      const ok = await tryApplySavedScript("refresh", { quiet: true });
      toast(ok ? `Đã làm mới (${cues.length} câu)` : "Không có bản lưu nào mới");
      return { ok: true, count: cues.length };
    }
    if (cmd === "wipe_saved_and_reload") {
      await wipeSavedScriptAndReload();
      return { ok: true, count: cues.length };
    }
    if (cmd === "toggle_overlay") {
      const showOnVideo = await toggleShowOnVideo();
      return { ok: true, showOnVideo };
    }
    if (cmd === "toggle_pip") {
      await togglePictureInPicture();
      return { ok: true };
    }
    if (cmd === "export") {
      exportTxt();
      return { ok: true };
    }
    if (cmd === "export_json") {
      const gen = navigateGen, key = sentenceTrackKey();
      await loadSentenceState();
      if (gen !== navigateGen || key !== sentenceTrackKey()) return { ok: false, error: "Video changed; export again" };
      const backup = sentenceBackupSnapshot();
      downloadCaptionFile(JSON.stringify(backup, null, 2), `yt-caption-${currentVideoId || "session"}.json`, "application/json;charset=utf-8");
      toast("Đã xuất backup JSON");
      return { ok: true };
    }
    if (cmd === "export_benchmark") {
      if (!sentenceBenchmark) return { ok: false, error: "Số đo chưa khả dụng; tải lại video YouTube" };
      const benchmark = sentenceBenchmark.snapshot({ videoId: currentVideoId, sourceKey: sentenceTrackKey(),
        fingerprint: sentenceRawTrack?.sourceKey === sentenceTrackKey() ? sentenceRawTrack.fingerprint || null : null,
        network: navigator.connection?.effectiveType || null });
      downloadCaptionFile(JSON.stringify(benchmark, null, 2), `yt-caption-${currentVideoId}-benchmark.json`, "application/json;charset=utf-8");
      return { ok: true };
    }
    if (cmd === "restore_sentence_backup" || cmd === "restore_previous_backup") {
      if (sentenceRestorePending) return { ok: false, error: "Restore already in progress" };
      const gen = navigateGen, key = sentenceTrackKey();
      sentenceRestorePending = true;
      return withTranscriptWrite(async () => {
        try {
          if (gen !== navigateGen || key !== sentenceTrackKey()) return { ok: false, error: "Video changed; restore again" };
          await loadSentenceState();
          const recoveryKey = `sentenceRecovery:v1:${key}`;
          const backup = cmd === "restore_previous_backup"
            ? (await chrome.storage.local.get(recoveryKey))[recoveryKey] : msg.backup;
          if (gen !== navigateGen || key !== sentenceTrackKey()) return { ok: false, error: "Video changed; restore again" };
          validateSentenceBackup(backup);
          const restored = structuredClone(backup);
          // Original token arrays are disposable too; legacy offsets may be code points.
          for (const cue of restored.cues) {
            if (Object.hasOwn(cue, "tokens") && !originalTokensMatch(cue.source, cue.tokens)) cue.tokens = [];
          }
          const diskMeta = await loadDiskMeta(currentVideoId);
          if (gen !== navigateGen || key !== sentenceTrackKey()) return { ok: false, error: "Video changed; restore again" };
          const recovery = sentenceBackupSnapshot();
          // Restore gets a new revision; the write queue orders older local saves.
          restored.transcriptMeta.rev = Math.max(Number(transcriptMeta.rev) || 0,
            Number(restored.transcriptMeta.rev) || 0, Number(diskMeta?.rev) || 0) + 1;
          if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
          // The worker serializes the global saved map with stars from every tab.
          const result = await chrome.runtime.sendMessage({ type: "SAVED_CUES_MUTATE", op: "restore_video",
            videoId: currentVideoId, sourceKey: key, entries: restored.savedSentences, patch: { [recoveryKey]: recovery,
            [`transcript:${tabPrefix()}${currentVideoId}`]: restored.cues,
            [metaStorageKey(currentVideoId)]: restored.transcriptMeta,
            [sentenceStateStorageKey()]: restored.enhancement,
            [`tokens:${tabPrefix()}${currentVideoId}`]: Object.fromEntries(restored.cues.map(c => [c.id, c.tokens || []])) } });
          if (!result?.ok) throw new Error(result?.error || "Backup storage failed");
          if (gen !== navigateGen || key !== sentenceTrackKey()) return { ok: false, error: "Restored previous video; reopen it to view" };
          cancelSentencePrefetch();
          navigateGen++;
          cues = restored.cues;
          transcriptMeta = restored.transcriptMeta;
          savedCues = result.savedCues;
          captionMode = "original";
          sentenceSourceKey = key;
          sentenceUndoRevisions = restored.enhancement.undoRevisions || {};
          sentenceUndoAppliedRevisions = restored.enhancement.undoAppliedRevisions || {};
          sentenceTranslations = restored.enhancement.translations || {};
          sentenceTokens = restored.enhancement.tokens || {};
          sentenceRawTrack = restored.enhancement.rawTrack || null;
          sentenceStateLoadedKey = sentenceStateStorageKey();
          sentenceStateLoadedGen = navigateGen;
          sentenceStateLoad = Promise.resolve();
          listDirty = true;
          refreshSentenceProjection(true);
          await saveTranscriptToDisk(cues);
          await syncToPlayhead();
          publishSidePanelState({ forceList: true });
          return { ok: true, count: cues.length, recoveryAvailable: true };
        } finally { sentenceRestorePending = false; }
      });
    }
    if (cmd === "play") {
      void seekToTime(Number(msg.mediaTime));
      return { ok: true };
    }
    if (cmd === "copy" || cmd === "edit_ja" || cmd === "edit_en" || cmd === "edit_vi" || cmd === "edit_timeline") {
      const idx = resolveCueIndex(msg);
      // Out-of-range / unknown cue: nothing was edited — answer an error
      // instead of {ok:true} (the panel would show a phantom success).
      if (idx < 0) return { ok: false, error: "Cue not found" };
      if (cmd === "copy") {
        const ok = await copyCue(idx, msg.format || "full");
        return { ok: !!ok };
      }
      if (cmd === "edit_ja") {
        await onJaEdit(idx, msg.text);
        return { ok: true };
      }
      if (cmd === "edit_en") {
        await onEnEdit(idx, msg.text);
        return { ok: true };
      }
      if (cmd === "edit_vi") {
        await onViEdit(idx, msg.text);
        return { ok: true };
      }
      await onTimelineEdit(idx, msg.start, msg.end);
      return { ok: true };
    }
    if (cmd === "add_cue") {
      const added = await addCue({
        afterId: msg.afterId || "",
        atTime: msg.atTime,
      });
      return { ok: !!added, id: added?.id || "", count: cues.length };
    }
    if (cmd === "delete_cue") {
      const ok = await deleteCueById(String(msg.id || ""));
      return { ok, count: cues.length };
    }
    if (cmd === "clear_translations") {
      await clearTranslations();
      return { ok: true, count: cues.length };
    }
    if (cmd === "import_cues") {
      const mode = msg.mode === "replace" ? "replace" : "merge";
      const stats = await importCues(msg.cues || [], {
        mode,
        // Full replace always includes JA + timeline from the file.
        includeJa: mode === "replace" ? true : !!msg.includeJa,
      });
      return { ok: true, count: cues.length, ...stats };
    }
    if (cmd === "set_user_vocab") {
      await setUserVocabStatus(msg.lemma, msg.status || "");
      return { ok: true };
    }
    if (cmd === "SHOW_PAGE_DICT" || cmd === "show_dict") {
      ensureUI();
      await showPageDictFromSidePanel(msg);
      return { ok: true };
    }
    if (cmd === "SCHEDULE_HIDE_DICT" || cmd === "schedule_hide_dict") {
      scheduleHideDict(msg.delayMs ?? 1000);
      return { ok: true };
    }
    if (cmd === "HIDE_PAGE_DICT" || cmd === "hide_dict") {
      hideDictImmediately();
      return { ok: true };
    }
    if (cmd === "toggle_star_cue") {
      refreshSentenceProjection();
      const sentence = enhancedCues.find(c => c.id === msg.id);
      await toggleStarCue(sentence || msg.id);
      return { ok: true, starred: isCueStarred(msg.id), savedCues: Object.values(savedCues || {}) };
    }
    if (cmd === "trigger_gemini_translate") {
      void triggerGeminiTranslationIfNeeded(!!msg.force);
      return { ok: true };
    }
    if (cmd === "open_settings") {
      openSettingsModal();
      return { ok: true };
    }
    return { ok: false, reason: "unknown_cmd" };
  }

  function resolveSourceCue(id) {
    if (!id) return null;
    let cue = cues.find(c => c.id === id);
    if (cue) return cue;
    const unit = (enhancedCues || []).find(c => c.id === id);
    if (unit) {
      if (Array.isArray(unit.sourceRefs)) {
        for (const ref of unit.sourceRefs) {
          if (sentenceCandidates[ref.cueId] || sentenceUndoRevisions[ref.cueId]) {
            cue = cues.find(c => c.id === ref.cueId);
            if (cue) return cue;
          }
        }
      }
      if (unit.sourceCueId) {
        cue = cues.find(c => c.id === unit.sourceCueId);
        if (cue) return cue;
      }
      if (Array.isArray(unit.sourceRefs)) {
        for (const ref of unit.sourceRefs) {
          cue = cues.find(c => c.id === ref.cueId);
          if (cue) return cue;
        }
      }
    }
    return null;
  }

  async function toggleAudioListening(forceActive, opts = {}) {
    const nextState = forceActive != null ? !!forceActive : !audioListeningActive;
    if (audioListeningActive === nextState) return { ok: true, audioListeningActive };
    audioListeningActive = nextState;
    const tabId = await getContentTabId();
    if (audioListeningActive) {
      // Fail closed: without a tab id the capture cannot be routed.
      if (!tabId) {
        audioListeningActive = false;
        if (!opts.auto) toast("Không bật được nghe audio: chưa lấy được tab id");
        return { ok: false, error: "no_tab_id", audioListeningActive: false };
      }
      if (!opts.auto) toast("Đang bật nghe audio (Whisper trên Apple Silicon)...");
      try {
        const video = findVideo();
        const res = await chrome.runtime.sendMessage({
          type: "AUDIO_START_CAPTURE",
          tabId,
          videoId: currentVideoId,
          playhead: Math.max(0, Number(video?.currentTime ?? currentMediaTime) || 0),
          playbackRate: Number(video?.playbackRate) > 0 ? Number(video.playbackRate) : 1,
          paused: video ? !!video.paused : false,
        });
        if (!res?.ok) {
          audioListeningActive = false;
          if (!opts.auto) toast("Không thể bật nghe audio: " + (res?.error || "Lỗi capture"));
        }
      } catch (e) {
        audioListeningActive = false;
        if (!opts.auto) toast("Lỗi bật nghe audio: " + e.message);
      }
    } else {
      if (!opts.auto) toast("Đã tắt nghe audio");
      try {
        await chrome.runtime.sendMessage({
          type: "AUDIO_STOP_CAPTURE",
          tabId,
        });
      } catch (_) {}
    }
    publishSidePanelState({ forceList: true });
    return { ok: true, audioListeningActive };
  }

  async function getContentTabId() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "CONTENT_GET_TAB_ID" });
      return res?.tabId || null;
    } catch (_) {
      return null;
    }
  }

  function canReceiveAsrCandidate(cue) {
    if (!cue) return false;
    if (cue.mt_locked) return false;
    if (isOwnedCue(cue)) return false;
    if (cue.user_owned) return false;
    if (["user", "import"].includes(cue.translation_source)) return false;
    if (["edit", "import", "manual", "script"].includes(cue.text_source)) return false;
    if (cue.deleted) return false;
    return true;
  }

  function matchCuesForSegment(cuesList, segStart, segEnd) {
    return (cuesList || []).filter((c) => {
      const { start: cStart, end: cEnd } = asrCueBounds(c);
      return Math.max(cStart, segStart) < Math.min(cEnd, segEnd);
    });
  }

  function asrCueBounds(cue) {
    const start = Number(cue?.start_media_time ?? cue?.start) || 0;
    const rawEnd = Number(cue?.end_media_time ?? cue?.end);
    const end = Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : start + 1;
    return { start, end };
  }

  function asrNormalizeMatchText(text) {
    return String(text || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\[(?:音楽|拍手|鼻息|雑音|笑い|拍手喝采)\]/g, "")
      .replace(/[\s!！?？.。,:：;；~～\-_—…·、。「」『』（）()\[\]【】]+/g, "");
  }

  function asrTextSimilarity(leftText, rightText) {
    const left = asrNormalizeMatchText(leftText);
    const right = asrNormalizeMatchText(rightText);
    if (!left || !right) return 0;
    if (left === right) return 1;
    if (left.length < 2 || right.length < 2) return 0;

    const grams = new Map();
    for (let i = 0; i < left.length - 1; i++) {
      const gram = left.slice(i, i + 2);
      grams.set(gram, (grams.get(gram) || 0) + 1);
    }
    let shared = 0;
    for (let i = 0; i < right.length - 1; i++) {
      const gram = right.slice(i, i + 2);
      const count = grams.get(gram) || 0;
      if (count > 0) {
        shared++;
        grams.set(gram, count - 1);
      }
    }
    return (2 * shared) / ((left.length - 1) + (right.length - 1));
  }

  function findBestCueForSegmentByIoU(cuesList, segStart, segEnd, segText = "", segWords = []) {
    const start = Number(segStart);
    const end = Number(segEnd);
    const segDuration = Math.max(0, end - start);
    if (segDuration <= 0) return null;
    const matched = matchCuesForSegment(cuesList, start, end);
    if (!matched.length) return null;

    const words = (Array.isArray(segWords) ? segWords : [])
      .map((word) => {
        const wordStart = Number(word?.start);
        const wordEnd = Number(word?.end);
        return {
          text: String(word?.text || word?.word || "").trim(),
          start: wordStart,
          end: wordEnd,
        };
      })
      .filter((word) => word.text && Number.isFinite(word.start) &&
        Number.isFinite(word.end) && word.end > word.start);
    const wordAssignments = new Map();

    for (const word of words) {
      const overlaps = matched.map((cue) => {
        const { start: cStart, end: cEnd } = asrCueBounds(cue);
        return {
          cue,
          overlap: Math.max(0, Math.min(cEnd, word.end) - Math.max(cStart, word.start)),
        };
      }).sort((a, b) => b.overlap - a.overlap);
      const best = overlaps[0];
      const second = overlaps[1];
      if (!best || best.overlap <= 0) {
        continue;
      }
      let chosen = best;
      if (second && Math.abs(best.overlap - second.overlap) < 1e-6) {
        const tied = overlaps.filter((item) => Math.abs(item.overlap - best.overlap) < 1e-6)
          .map((item) => ({
            ...item,
            textScore: asrTextSimilarity(word.text, item.cue.source ?? item.cue.text),
          }))
          .sort((a, b) => b.textScore - a.textScore);
        if (!tied[1] || tied[0].textScore - tied[1].textScore < 0.05) continue;
        chosen = tied[0];
      }
      const assigned = wordAssignments.get(chosen.cue) || { words: [], duration: 0 };
      assigned.words.push(word.text);
      assigned.duration += word.end - word.start;
      wordAssignments.set(chosen.cue, assigned);
    }
    const assignedWordDuration = [...wordAssignments.values()]
      .reduce((sum, assignment) => sum + assignment.duration, 0);

    const scored = matched.map((cue) => {
      const { start: cStart, end: cEnd } = asrCueBounds(cue);
      const cueDuration = Math.max(0, cEnd - cStart);
      const cueText = cue.source ?? cue.text;
      if (cueDuration <= 0 || !asrNormalizeMatchText(cueText)) return null;
      const overlap = Math.max(0, Math.min(cEnd, end) - Math.max(cStart, start));
      if (overlap <= 0) return null;
      const segmentCoverage = overlap / segDuration;
      const cueCoverage = overlap / cueDuration;
      const assignment = wordAssignments.get(cue);
      const wordShare = assignment && assignedWordDuration > 0
        ? assignment.duration / assignedWordDuration
        : 0;
      const evidenceText = assignment?.words.join("") || segText;
      const textScore = asrTextSimilarity(evidenceText, cueText);
      const temporalScore = Math.max(
        0.7 * segmentCoverage + 0.3 * cueCoverage,
        wordShare > 0 ? 0.5 * wordShare + 0.3 * segmentCoverage + 0.2 * cueCoverage : 0,
      );
      return {
        cue,
        cueCoverage,
        segmentCoverage,
        textScore,
        wordShare,
        score: 0.62 * temporalScore + 0.38 * textScore,
      };
    }).filter(Boolean).sort((a, b) => b.score - a.score);

    if (!scored.length) return null;
    const best = scored[0];
    const second = scored[1];

    if (scored.length === 1) {
      if (best.segmentCoverage < 0.55 || best.cueCoverage < 0.2) return null;
      return best.cue;
    }

    // A word belongs to exactly one cue. Any duration assigned to another
    // overlapping cue means the transcript spans cues, even if the majority
    // share is high (for example 85/15).
    if (words.length && best.wordShare < 1 - 1e-6) return null;
    if (best.textScore < 0.1) return null;
    if (best.score - second.score < 0.12) return null;
    if (Math.abs(best.segmentCoverage - second.segmentCoverage) < 0.1 &&
        Math.abs(best.cueCoverage - second.cueCoverage) < 0.1 &&
        best.textScore < 0.85) return null;

    // Segment-only text cannot isolate each overlapping row. If the full text
    // fits the union of the top two cues better than either one alone, it is a
    // mixed transcript and must not be attached to one cue.
    if (!words.length) {
      const unionText = `${best.cue.source ?? best.cue.text ?? ""} ${second.cue.source ?? second.cue.text ?? ""}`;
      if (asrTextSimilarity(segText, unionText) > best.textScore + 0.08) return null;
    }

    return best.cue;
  }

  function asrCandidateCoverage(candidate, cue) {
    const cStart = Number(cue?.start_media_time ?? cue?.start) || 0;
    const cEnd = Number(cue?.end_media_time ?? cue?.end) || (cStart + 1);
    const pStart = Number(candidate?.start) || 0;
    const pEnd = Number(candidate?.end) || pStart;
    const duration = Math.max(0, cEnd - cStart);
    if (duration <= 0) return 0;
    const covered = Math.max(0, Math.min(cEnd, pEnd) - Math.max(cStart, pStart));
    return covered / duration;
  }

  function shouldReplaceAsrCandidate(existing, incoming, cue) {
    if (!existing) return true;
    const existingCoverage = asrCandidateCoverage(existing, cue);
    const incomingCoverage = asrCandidateCoverage(incoming, cue);
    const EPSILON = 1e-6;
    if (incomingCoverage > existingCoverage + EPSILON) return true;
    if (incomingCoverage + EPSILON < existingCoverage) return false;
    return String(incoming?.text || "").trim().length > String(existing?.text || "").trim().length;
  }

  function asrSegmentBounds(msg, segment) {
    const playbackRate = Number(msg?.playbackRate) > 0 ? Number(msg.playbackRate) : 1;
    const windowStart = Number(msg?.startSec) || 0;
    const rawStart = Number(segment?.start) || 0;
    const parsedEnd = Number(segment?.end);
    const rawEnd = Number.isFinite(parsedEnd) && parsedEnd > rawStart ? parsedEnd : rawStart + 1;
    return {
      start: windowStart + rawStart * playbackRate,
      end: windowStart + rawEnd * playbackRate,
    };
  }

  function isValidAsrCandidateText(text) {
    if (!text) return false;
    const clean = String(text).replace(/[\s!！?？.。,:：;；~～\-_—…·、。「」『』（）()[\]【】]+/g, "").trim();
    return clean.length > 0;
  }

  async function handleAsrCandidateReceived(msg) {
    if (!msg || !msg.result) return;
    if (msg.videoId && currentVideoId && msg.videoId !== currentVideoId) return;

    let updated = false;
    const segments = Array.isArray(msg.result.segments) && msg.result.segments.length > 0
      ? msg.result.segments
      : null;

    const provenanceModel = String(msg.result?.model || "kaiinui/kotoba-whisper-v2.0-mlx");
    if (segments) {
      for (const seg of segments) {
        const segText = String(seg?.text || "").trim();
        if (!isValidAsrCandidateText(segText)) continue;
        const { start: segStart, end: segEnd } = asrSegmentBounds(msg, seg);
        const segWords = Array.isArray(seg?.words)
          ? seg.words.map((word) => ({
              text: word?.text,
              ...asrSegmentBounds(msg, word),
            }))
          : [];
        const cue = findBestCueForSegmentByIoU(cues, segStart, segEnd, segText, segWords);
        if (cue && canReceiveAsrCandidate(cue)) {
          const candidate = {
            text: segText,
            provenance: `asr:${provenanceModel}`,
            model: provenanceModel,
            start: segStart,
            end: segEnd,
            createdAt: Date.now(),
          };
          if (shouldReplaceAsrCandidate(sentenceCandidates[cue.id], candidate, cue)) {
            sentenceCandidates[cue.id] = candidate;
            updated = true;
          }
        }
      }
    } else if (msg.result.text) {
      const text = String(msg.result.text).trim();
      if (isValidAsrCandidateText(text)) {
        const segStart = Number(msg.startSec) || 0;
        const segEnd = Number(msg.endSec) || (segStart + 1);
        const cue = findBestCueForSegmentByIoU(cues, segStart, segEnd);
        if (cue && canReceiveAsrCandidate(cue)) {
          const candidate = {
            text,
            provenance: `asr:${provenanceModel}`,
            model: provenanceModel,
            start: segStart,
            end: segEnd,
            createdAt: Date.now(),
          };
          if (shouldReplaceAsrCandidate(sentenceCandidates[cue.id], candidate, cue)) {
            sentenceCandidates[cue.id] = candidate;
            updated = true;
          }
        }
      }
    }


    if (updated) {
      await saveSentenceState();
      publishSidePanelState({ forceList: true });
    }
  }

  function bridgeFetch(path, opts = {}) {
    if (!chrome?.runtime?.sendMessage) {
      return Promise.reject(new Error("Extension context invalidated"));
    }
    try {
      return chrome.runtime.sendMessage({
        type: "BRIDGE_FETCH",
        path,
        method: opts.method || "GET",
        body: opts.body,
        isForm: !!opts.isForm,
      }).catch((err) => Promise.reject(err));
    } catch (err) {
      return Promise.reject(err);
    }
  }

  /** Site family this tab belongs to — controls which caption engine runs. */
  function sourceFromHost() {
    try {
      const h = location.hostname.toLowerCase();
      if (
        h === "www.youtube.com" ||
        h === "youtube.com" ||
        h === "m.youtube.com" ||
        h === "youtu.be" ||
        h.endsWith(".youtube.com") ||
        h.endsWith("youtube-nocookie.com")
      ) {
        return "youtube";
      }
      if (h === "abema.tv" || h.endsWith(".abema.tv")) return "abema";
      if (h === "netflix.com" || h.endsWith(".netflix.com")) return "netflix";
      if (h === "animevietsub.best" || h.includes("animevietsub")) return "animevietsub";
      return "web";
    } catch {
      return "web";
    }
  }

  /**
   * Source-scoped storage key for captions/scripts/tokens/tombstones.
   * YouTube keeps its bare videoId (existing data stays intact); other sites
   * get a "<source>__<pathId>" key, scrubbed to [A-Za-z0-9_-]{6,64} (fits the
   * bridge script-store regex, Drive folder names, and the SW allowlist).
   */
  function videoIdFromUrl() {
    const domVid = (currentSource === "youtube" || sourceFromHost() === "youtube")
      ? (document.querySelector("ytd-watch-flexy, ytd-watch-grid")?.getAttribute("video-id") || "")
      : "";
    if (globalThis.HardsubUrlHash?.videoIdFromUrl) {
      return globalThis.HardsubUrlHash.videoIdFromUrl(location.href, domVid);
    }
    const source = sourceFromHost();
    if (source === "youtube") {
      try {
        const v = new URLSearchParams(location.search).get("v");
        if (v) return v;
        const m = location.pathname.match(/\/(?:shorts|live|embed|v)\/([A-Za-z0-9_-]{11})/);
        if (m && m[1]) return m[1];
        const domVid = document.querySelector("ytd-watch-flexy, ytd-watch-grid")?.getAttribute("video-id");
        if (domVid) return domVid;
        return "";
      } catch {
        return "";
      }
    }
    if (source === "netflix") {
      try {
        const m = location.pathname.match(/\/(?:watch|title)\/(\d+)/);
        if (m && m[1]) return `netflix__${m[1]}`;
      } catch (_) {}
    }
    if (source === "animevietsub") {
      try {
        const phimMatch = location.pathname.match(/\/phim\/([^\/]+)/);
        const tapMatch = location.pathname.match(/tap-(\d+)/);
        const slug = phimMatch ? phimMatch[1] : "anime";
        const ep = tapMatch ? tapMatch[1].padStart(2, "0") : "01";
        const cleanSlug = slug.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48);
        return `avs__${cleanSlug}__ep${ep}`.slice(0, 64);
      } catch (_) {}
    }
    const rawPath = String(location.pathname || "").replace(/\/+$/, "");
    const pathId = rawPath.split("/").filter(Boolean).pop() || "";
    const fallback = source === "abema" ? "top" : "page";
    const raw = `${source}__${pathId || fallback}`;
    const key = raw.replace(/[^A-Za-z0-9_-]/g, "_");
    return key.length > 64 ? key.slice(0, 64) : key;
  }

  function isCurrentPlatformEnabled() {
    if (!settings.enabled) return false;
    const ep = settings.enabledPlatforms || DEFAULTS.enabledPlatforms;
    return ep[currentSource] !== false;
  }

  function teardownUI() {
    stopLoop();
    if (videoLayoutTimer) {
      clearInterval(videoLayoutTimer);
      videoLayoutTimer = null;
    }
    if (playerToggleObserver) {
      playerToggleObserver.disconnect();
      playerToggleObserver = null;
    }
    document.getElementById("hardsub-ocr-root")?.remove();
    document.getElementById(PLAYER_TOGGLE_ID)?.remove();
    cues = [];
    activeCueId = "";
    updateBar(null);
    publishSidePanelState({ forceList: true, cues: [] });
  }

  function sourceLabel() {
    if (currentSource === "abema") return "ABEMA";
    if (currentSource === "netflix") return "Netflix";
    if (currentSource === "animevietsub") return "AVS";
    if (currentSource === "youtube") return "YT";
    if (currentSource === "web") return "Web";
    return String(currentSource || "YT").toUpperCase();
  }

  function canonicalPageWatchKey() {
    const src = sourceFromHost();
    const vid = videoIdFromUrl();
    if (vid) return `${src}|vid:${vid}`;
    return `${src}|path:${location.pathname}`;
  }

  /** SPA fires no yt-navigate on ABEMA — poll for URL/source change cheaply.
   * Only triggers on video identity change, never on &t= query updates during pause/scrub.
   */
  let pageWatchKey = "";
  function checkPageWatch() {
    const key = canonicalPageWatchKey();
    if (key === pageWatchKey) return;
    pageWatchKey = key;
    void onNavigate();
  }

  /**
   * Fill every default exactly once. `loadSettings` and the storage listener
   * must not drift apart — a default missing in one of them silently drops a
   * feature (e.g. the bilingual JLPT colours) until the next full reload.
   */
  function normalizeSettings(next) {
    const s = { ...DEFAULTS, ...(next || {}) };
    if (s.vocabColors) {
      s.vocabColors = {
        ...(Vocab.DEFAULT_VOCAB_COLORS || {}),
        ...s.vocabColors,
      };
    }
    s.levelColors = Vocab.normalizeLevelColors(
      s.levelColors || Vocab.DEFAULT_LEVEL_COLORS
    );
    if (s.levelHighlightEnabled == null) {
      s.levelHighlightEnabled = true;
    }
    if (s.dictShowSentence == null) s.dictShowSentence = true;
    if (s.autoOpen == null) s.autoOpen = DEFAULTS.autoOpen;
    if (s.showOnVideo == null) s.showOnVideo = DEFAULTS.showOnVideo;
    if (s.barBgOpacity == null) s.barBgOpacity = DEFAULTS.barBgOpacity;
    if (s.barTextOpacity == null) s.barTextOpacity = DEFAULTS.barTextOpacity;
    if (s.barShowJa == null) s.barShowJa = true;
    if (s.barShowEn == null) s.barShowEn = true;
    if (s.barShowVi == null) s.barShowVi = false;
    if (s.enableBilingualJlptColor == null) s.enableBilingualJlptColor = true;
    if (s.barScale == null || !Number.isFinite(Number(s.barScale))) {
      s.barScale = DEFAULTS.barScale;
    }
    // Migrate legacy uniform barScale → independent W/H when missing.
    if (s.barScaleW == null || !Number.isFinite(Number(s.barScaleW))) {
      s.barScaleW = Number(s.barScale) || DEFAULTS.barScaleW;
    }
    if (s.barScaleH == null || !Number.isFinite(Number(s.barScaleH))) {
      s.barScaleH = Number(s.barScale) || DEFAULTS.barScaleH;
    }
    return s;
  }

  async function loadSettings() {
    const data = await chrome.storage.local.get(["hardsubSettings", "userVocab", "savedCues"]);
    settings = normalizeSettings(data.hardsubSettings);
    if (!settings.barViDefaultMigratedV2) {
      settings.barShowVi = false;
      settings.barViDefaultMigratedV2 = true;
      void saveSettings();
    }
    userVocab = data.userVocab && typeof data.userVocab === "object" ? data.userVocab : {};
    savedCues = data.savedCues && typeof data.savedCues === "object" ? data.savedCues : {};
  }

  async function saveSettings() {
    await chrome.storage.local.set({ hardsubSettings: settings });
  }

  async function setUserVocabStatus(lemma, status) {
    const key = String(lemma || "").trim();
    if (!key) return;
    if (!status) {
      delete userVocab[key];
    } else {
      userVocab[key] = status;
    }
    await chrome.storage.local.set({ userVocab: { ...userVocab } });
    listDirty = true;
    const active = getActiveDisplayCue();
    if (active) updateBar(active);
    publishSidePanelState();
  }

  function markButtonsHtml(lemma) {
    const cur = userVocab[lemma] || "";
    const isSpecial = cur === "special";
    return `<div class="dict-marks" data-lemma="${escapeAttr(lemma)}">
      <button type="button" data-mark="special" class="dict-save-btn ${isSpecial ? "active" : ""}">
        <span>${isSpecial ? "★" : "☆"}</span> ${isSpecial ? "Đã lưu từ vựng" : "Lưu từ vựng"}
      </button>
      <div class="dict-status-pills">
        <button type="button" data-mark="learning" class="dict-pill ${cur === "learning" ? "active" : ""}">Đang học</button>
        <button type="button" data-mark="known" class="dict-pill ${cur === "known" ? "active" : ""}">Đã thuộc</button>
        <button type="button" data-mark="ignored" class="dict-pill ${cur === "ignored" ? "active" : ""}">Bỏ qua</button>
      </div>
    </div>`;
  }

  function bindDictMarks(dictEl) {
    dictEl.querySelectorAll(".dict-marks button").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const wrap = btn.closest(".dict-marks");
        const lemma = wrap?.dataset.lemma || "";
        const cur = userVocab[lemma] || "";
        const mark = btn.dataset.mark || "";
        const nextMark = cur === mark ? "" : mark;
        setUserVocabStatus(lemma, nextMark);
        if (wrap) {
          const saveBtn = wrap.querySelector(".dict-save-btn");
          if (saveBtn) {
            const isSpec = nextMark === "special";
            saveBtn.classList.toggle("active", isSpec);
            saveBtn.innerHTML = `<span>${isSpec ? "★" : "☆"}</span> ${isSpec ? "Đã lưu từ vựng" : "Lưu từ vựng"}`;
          }
          wrap.querySelectorAll(".dict-status-pills button").forEach((b) => {
            b.classList.toggle("active", b.dataset.mark === nextMark && !!nextMark);
          });
        }
      });
    });
  }

  /**
   * Segmentation can re-key a cue between load paths (intercept vs ANDROID),
   * so a saved cue may live under a different id than the current projection.
   * Match on video + start + source text as a fallback; the direct id wins.
   */
  function savedCueMatches(cue, saved, videoId) {
    if (!cue || !saved) return false;
    if (saved.videoId && videoId && saved.videoId !== videoId) return false;
    const start = Number(cue.start_media_time ?? cue.startTime ?? cue.start);
    const savedStart = Number(saved.start_media_time ?? saved.startTime ?? saved.start);
    if (!Number.isFinite(start) || !Number.isFinite(savedStart) || Math.abs(start - savedStart) > 0.3) {
      return false;
    }
    const a = normalizeCueText(cue.source);
    const b = normalizeCueText(saved.source);
    return !!a && a === b;
  }

  function findSavedCueForCue(cue) {
    if (!cue || !savedCues) return null;
    for (const saved of Object.values(savedCues)) {
      if (savedCueMatches(cue, saved, currentVideoId)) return saved;
    }
    return null;
  }

  function isCueStarred(cueOrId) {
    const cue = typeof cueOrId === "object" && cueOrId ? cueOrId : enhancedCues.find(c => c.id === cueOrId);
    const id = cue?.savedCueId || cue?.id || String(cueOrId || "");
    if (id && savedCues[id]) return true;
    return cue ? !!findSavedCueForCue(cue) : false;
  }

  /** The exact object stored for a starred cue (also what the Saved Items page reads). */
  function savedCueSnapshot(cueObj, id) {
    return {
      id: id,
      source: cueObj?.source || "",
      vi: cueObj?.vi || "",
      en: cueObj?.en || "",
      start_media_time: Number(cueObj?.start_media_time) || 0,
      end_media_time: Number(cueObj?.end_media_time) || 0,
      videoId: currentVideoId || "",
      videoTitle: pageTitle() || "",
      savedAt: Date.now(),
      ...(cueObj?.enhanced ? { provenance: cueObj.provenance, enhanced: true } : {}),
    };
  }

  async function toggleStarCue(cueOrId) {
    let id = "";
    let cueObj = null;
    if (typeof cueOrId === "object" && cueOrId) {
      cueObj = cueOrId;
    } else {
      id = String(cueOrId || "");
      cueObj = cues.find((c) => c.id === id) || enhancedCues.find(c => c.id === id) || null;
    }
    id = cueObj?.savedCueId || cueObj?.id || id;
    if (!id) return false;
    // A re-keyed cue can be saved under another id; unstar that row instead of
    // creating a duplicate.
    const matched = cueObj && !savedCues[id] ? findSavedCueForCue(cueObj) : null;
    const targetId = matched?.id || id;
    if (!cueObj && !savedCues[targetId]) return false;

    const snapshot = cueObj && targetId === id ? savedCueSnapshot(cueObj, id) : null;
    const result = await chrome.runtime.sendMessage({ type: "SAVED_CUES_MUTATE", id: targetId,
      op: snapshot ? "toggle" : "delete", cue: snapshot });
    if (!result?.ok) throw new Error(result?.error || "Saved state unavailable");
    savedCues = result.savedCues;
    toast(savedCues[targetId] ? "Đã lưu câu vào mục Đã lưu ★" : "Đã bỏ lưu câu");
    const active = getActiveDisplayCue();
    if (active) updateBar(active);
    publishSidePanelState();
    return !!savedCues[targetId];
  }

  function findVideo() {
    return (
      document.querySelector("video.html5-main-video") ||
      document.querySelector("video")
    );
  }

  function audioPlayheadMessage(event, video) {
    if (!audioListeningActive || !video) return null;
    return {
      type: "AUDIO_UPDATE_PLAYHEAD",
      event,
      playhead: Math.max(0, Number(video.currentTime) || 0),
      playbackRate: Number(video.playbackRate) > 0 ? Number(video.playbackRate) : 1,
      paused: !!video.paused,
    };
  }

  function sendAudioPlayheadAnchor(event, video = findVideo()) {
    const msg = audioPlayheadMessage(event, video);
    if (!msg) return;
    try {
      chrome.runtime.sendMessage(msg).catch(() => {});
    } catch (_) {}
  }

  function bindAudioAnchorEvents(video) {
    if (!video?.addEventListener) return () => {};
    const events = ["play", "pause", "seeking", "seeked", "ratechange", "ended"];
    const listeners = events.map((event) => {
      const listener = () => sendAudioPlayheadAnchor(event, video);
      video.addEventListener(event, listener, { passive: true });
      return [event, listener];
    });
    return () => {
      for (const [event, listener] of listeners) video.removeEventListener(event, listener);
    };
  }

  async function seekToTime(sec) {
    const t = Math.max(0, Number(sec) || 0);
    const v = findVideo();
    if (v) {
      v.currentTime = t;
      const p = v.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
    if (currentSource === "animevietsub") {
      const iframes = document.querySelectorAll("iframe");
      for (const frame of iframes) {
        try {
          frame.contentWindow?.postMessage({ type: "AVS_PLAYER_SEEK", time: t }, "*");
        } catch (_) {}
      }
    }
    await pageCall("PLAY_AT", { mediaTime: t });
  }

  async function repeatCurrentCue() {
    const sorted = getSortedCues();
    if (!sorted.length) return;
    const v = findVideo();
    const curTime = v ? v.currentTime : (Number((await pageCall("GET_MEDIA_TIME", {}, 300))?.mediaTime) || 0);
    const active = findActiveCue(curTime);
    if (active) {
      await seekToTime(active.start_media_time);
      return;
    }
    let target = sorted[0];
    for (const c of sorted) {
      if (c.start_media_time <= curTime) target = c;
      else break;
    }
    if (target) await seekToTime(target.start_media_time);
  }

  async function seekPrevCue() {
    const sorted = getSortedCues();
    if (!sorted.length) return;
    const curIdx = activeCueId ? sorted.findIndex((c) => c.id === activeCueId) : -1;
    let target = null;
    if (curIdx > 0) {
      target = sorted[curIdx - 1];
    } else {
      const v = findVideo();
      const curTime = v ? v.currentTime : (Number((await pageCall("GET_MEDIA_TIME", {}, 300))?.mediaTime) || 0);
      for (let i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i].start_media_time < curTime - 0.1) {
          target = sorted[i];
          break;
        }
      }
    }
    if (target) await seekToTime(target.start_media_time);
  }

  async function seekNextCue() {
    const sorted = getSortedCues();
    if (!sorted.length) return;
    const curIdx = activeCueId ? sorted.findIndex((c) => c.id === activeCueId) : -1;
    let target = null;
    if (curIdx >= 0 && curIdx < sorted.length - 1) {
      target = sorted[curIdx + 1];
    } else {
      const v = findVideo();
      const curTime = v ? v.currentTime : (Number((await pageCall("GET_MEDIA_TIME", {}, 300))?.mediaTime) || 0);
      for (let i = 0; i < sorted.length; i++) {
        if (sorted[i].start_media_time > curTime + 0.1) {
          target = sorted[i];
          break;
        }
      }
    }
    if (target) await seekToTime(target.start_media_time);
  }

  /**
   * Overlay bar positions in normalized video coords. `center` keeps the bar
   * horizontally centred (the transform offsets its own width); without real
   * nx/ny all three presets collapsed into the centred default.
   */
  const BAR_POS_LEVELS = [
    { nx: 0.5, ny: 0.72, center: true },
    { nx: 0.5, ny: 0.55, center: true },
    { nx: 0.5, ny: 0.82, center: true },
  ];
  async function toggleBarPosition() {
    barPosIndex = (barPosIndex + 1) % BAR_POS_LEVELS.length;
    settings.barPos = { ...BAR_POS_LEVELS[barPosIndex] };
    applyBarPosition();
    await saveSettings();
  }

  function setupLRControls() {
    const nextBtn = document.getElementById("lr-btn-next");
    nextBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      seekNextCue();
    });
    const repeatBtn = document.getElementById("lr-btn-repeat");
    repeatBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      repeatCurrentCue();
    });
    const prevBtn = document.getElementById("lr-btn-prev");
    prevBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      seekPrevCue();
    });
    const apToggle = document.getElementById("lr-toggle-ap");
    apToggle?.addEventListener("click", async (e) => {
      e.stopPropagation();
      settings.autoPause = !settings.autoPause;
      syncAPControl();
      await saveSettings();
      toast(settings.autoPause ? "Auto-Pause (AP) Bật" : "Auto-Pause (AP) Tắt");
    });
    const moveBtn = document.getElementById("lr-btn-move");
    moveBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleBarPosition();
    });

    syncAPControl();

    if (!lrHotkeysBound) {
      lrHotkeysBound = true;
      window.addEventListener("keydown", (e) => {
        const tag = e.target?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "button" || e.target?.isContentEditable) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;

        // H key: Toggle overlay on/off
        if (e.key === "h" || e.key === "H") {
          e.preventDefault();
          settings.showOnVideo = !settings.showOnVideo;
          applyBarVisibility();
          syncPlayerToggle();
          void saveSettings();
          toast(settings.showOnVideo ? "Overlay: BẬT" : "Overlay: TẮT");
          return;
        }

        // Space: Toggle Play/Pause when overlay is shown and focused outside inputs
        if (e.key === " " && settings.showOnVideo) {
          const v = findVideo();
          if (v) {
            e.preventDefault();
            if (v.paused) v.play();
            else v.pause();
            return;
          }
        }

        if (!settings.showOnVideo) return;
        if (e.key === "s" || e.key === "S" || e.key === "k" || e.key === "K") {
          e.preventDefault();
          repeatCurrentCue();
        } else if (e.key === "a" || e.key === "A" || e.key === "j" || e.key === "J") {
          e.preventDefault();
          seekPrevCue();
        } else if (e.key === "d" || e.key === "D" || e.key === "l" || e.key === "L") {
          e.preventDefault();
          seekNextCue();
        }
      });
    }
  }

  function syncAPControl() {
    const apToggle = document.getElementById("lr-toggle-ap");
    if (!apToggle) return;
    apToggle.classList.toggle("active", !!settings.autoPause);
  }

  function openSettingsModal() {
    if (globalThis.HardsubSettingsModal) {
      globalThis.HardsubSettingsModal.open(
        settings,
        async (newSettings) => {
          if (newSettings.geminiApiKey !== undefined) {
            triggerGeminiTranslationIfNeeded();
          }
          Object.assign(settings, newSettings);
          await saveSettings();
          applyBarVisibility();
        },
        {
          onTranslateNow: () => {
            void triggerGeminiTranslationIfNeeded(true);
          },
        }
      );
    }
  }

  let sentencePublishTimer = null, sentencePublishGen = 0;
  function scheduleTranslationPaint(gen) {
    sentencePublishGen = gen;
    listDirty = true;
    updateBar(getActiveDisplayCue());
    if (sentencePublishTimer) return;
    sentencePublishTimer = setTimeout(() => {
      sentencePublishTimer = null;
      if (sentencePublishGen !== navigateGen) return;
      publishSidePanelState({ forceList: true });
      void saveSentenceState();
    }, 100);
  }

  async function triggerGeminiTranslationIfNeeded(force = false) {
    if (!force && settings.sentence_translation_prefetch_enabled === false) return;
    if (force && translatingWithGemini) return;
    const translator = globalThis.HardsubGeminiTranslate;
    if (!translator) return;
    const gen = navigateGen, vid = currentVideoId, input = cues, trace = sentenceBenchmark, mode = captionMode;
    const isCurrent = () => gen === navigateGen && vid === currentVideoId && input === cues && mode === captionMode &&
      (force || settings.sentence_translation_prefetch_enabled !== false);
    await loadSentenceState();
    if (!isCurrent()) return;
    const apiKey = await translator.getStoredApiKey();
    if (!isCurrent()) return;
    if (!apiKey) {
      if (force) toast("Chưa cấu hình Gemini API Key. Mở Cài đặt của Side Panel để nhập key.");
      return;
    }
    const rate = Number(findVideo()?.playbackRate) || 1;
    const ahead = Math.min(60, Math.max(20, 30 * rate));
    const inWindow = c => force || (c.end_media_time >= currentMediaTime && c.start_media_time <= currentMediaTime + ahead);
    if (force) translatingWithGemini = true;
    try {
      let report;
      if (captionMode === "enhanced" && currentSource === "youtube") {
        refreshSentenceProjection();
        const projection = sentenceProjection;
        if (!projection) return;

        const isVisible = c => c.end_media_time >= currentMediaTime && c.start_media_time <= currentMediaTime + 5;
        const isAhead = c => c.end_media_time > currentMediaTime + 5 && c.start_media_time <= currentMediaTime + ahead;
        const visibleGroupIds = new Set(enhancedCues.filter(isVisible).flatMap(c => c.groupIds));
        const aheadGroupIds = new Set(enhancedCues.filter(isAhead).flatMap(c => c.groupIds));
        const wantedGroupIds = new Set(enhancedCues.flatMap(c => c.groupIds));

        const now = Date.now();
        const canPrefetchBackground = force || (now - lastBackgroundPrefetchTime >= 6000);
        let queuedBackgroundCount = 0;

        const languages = [
          (settings.barShowVi !== false || settings.sidepanelShowVi !== false) ? "vi" : "",
          (settings.barShowEn !== false || settings.sidepanelShowEn === true) ? "en" : "",
        ].filter(Boolean);
        const jobs = [];
        for (const group of projection.groups) {
          if (group.protected || !wantedGroupIds.has(group.id)) continue;
          const isVis = visibleGroupIds.has(group.id);
          const isAh = aheadGroupIds.has(group.id);
          const isBg = !isVis && !isAh;

          if (isBg && !canPrefetchBackground) continue;
          if (isBg && queuedBackgroundCount >= 30) continue;

          const jobPriority = force ? (isVis ? 40 : (isAh ? 30 : 10)) : (isVis ? 30 : (isAh ? 20 : 10));

          for (const language of languages) {
            if (!force && sentenceTranslations[group.id]?.revision === group.revision && sentenceTranslations[group.id]?.[language]) continue;
            // A language that just failed must not be retried for 30s, even when
            // the revision moved on (the group text is the same, only the
            // context changed) - otherwise every automatic prefetch hammers a
            // failing service.
            if (!force && (sentenceTranslations[group.id]?.retryAt?.[language] || 0) > Date.now()) continue;
            jobs.push({ id: group.id, revision: group.revision, source: group.text, sourceKey: projection.sourceKey,
              algorithmVersion: projection.version, context: group.context, language, priority: jobPriority });
            if (isBg) queuedBackgroundCount++;
          }
        }
        if (queuedBackgroundCount > 0 && !force) {
          lastBackgroundPrefetchTime = now;
        }
        trace?.translationsQueued?.(jobs, force, mode, performance.now());
        report = await translator.translateGroups(jobs, { apiKey, force, priority: force ? 40 : 0, scope: force ? "manual" : "automatic",
          onResult: result => {
            trace?.request(result.request, performance.now());
            if (!isCurrent() || !sentenceEnhancementEnabled() || result.status === "cancelled") {
              trace?.translationResult?.(result, false, mode, performance.now());
              return;
            }
            refreshSentenceProjection(true);
            const current = sentenceProjection?.groups.find(g => g.id === result.id && g.revision === result.revision && !g.protected);
            if (!current) {
              trace?.translationResult?.(result, false, mode, performance.now());
              return;
            }
            const previous = sentenceTranslations[current.id]?.revision === current.revision ? sentenceTranslations[current.id] : {};
            sentenceTranslations[current.id] = { ...previous, revision: current.revision,
              ...(result.status === "ready" ? { [result.language]: result.text, model: result.model } : {}),
              states: { ...previous.states, [result.language]: result.status },
              retryAt: { ...previous.retryAt, [result.language]: result.status === "error" ? Date.now() + 30000 : 0 } };
            refreshSentenceProjection(true);
            trace?.translationResult?.(result, true, mode, performance.now());
            scheduleTranslationPaint(gen);
          },
          onProgress: p => { if (force && isCurrent()) toast(`Dịch câu: ${p.done}/${p.total} bản dịch · lỗi ${p.failed}`); },
        });
      } else {
        const languages = [
          (settings.barShowVi !== false || settings.sidepanelShowVi !== false) ? "vi" : "",
          (settings.barShowEn !== false || settings.sidepanelShowEn === true) ? "en" : "",
        ].filter(Boolean);
        if (!languages.length) languages.push("vi");

        let targetCues = input.filter(inWindow);
        if (!force && targetCues.length < 25) {
          const bgCandidates = input.filter(c => !inWindow(c) && (!c.vi || (languages.includes("en") && !c.en)));
          targetCues = targetCues.concat(bgCandidates.slice(0, 25 - targetCues.length));
        }

        const reports = await Promise.all(
          languages.map(language =>
            translator.translateCues(targetCues, apiKey, p => {
              if (!isCurrent()) return;
              scheduleTranslationPaint(gen);
              if (force) toast(`Dịch (${language.toUpperCase()}): ${p.done}/${p.total} · lỗi ${p.failed}`);
            }, { force, priority: force ? 0 : 10, scope: force ? "manual" : "automatic", sourceKey: `${currentSource}:${vid}:ja`, language, isCurrent,
              onQueued: jobs => trace?.translationsQueued?.(jobs, force, mode, performance.now()),
              onResult: (result, accepted) => {
                trace?.request(result.request, performance.now());
                trace?.translationResult?.(result, accepted, mode, performance.now());
              } })
          )
        );
        report = {
          completed: reports.reduce((acc, r) => acc + (r?.completed || 0), 0),
          failed: reports.reduce((acc, r) => acc + (r?.failed || 0), 0),
          total: reports.reduce((acc, r) => acc + (r?.total || 0), 0),
          applied: reports.reduce((acc, r) => acc + (r?.applied || 0), 0),
          results: reports.flatMap(r => r?.results || [])
        };
        if (isCurrent() && report.applied) scheduleSaveTranscript();
      }
      for (const result of report.results || []) trace?.request(result.request, performance.now());
      if (force && isCurrent()) toast(`Đã nhận ${report.completed}/${report.total} bản dịch hợp lệ · lỗi ${report.failed}`);
      if (report.failed > 0 && report.results?.some(r => r.httpStatus === 401)) {
        toast("Gemini API Key không hợp lệ hoặc đã hết hạn (HTTP 401). Nhập Google AI Studio API Key trong Cài đặt.");
      }
    } catch (err) {
      if (isCurrent() && force) toast(`Lỗi dịch: ${err.message || "Không nhận được bản dịch hợp lệ"}`);
    } finally {
      if (force) translatingWithGemini = false;
    }
  }

  function compactSource(s) {
    return String(s || "")
      .normalize("NFKC")
      .replace(/\s+/g, "")
      .trim();
  }

  function cueEndTime(value, start) {
    const end = typeof value === "number" || (typeof value === "string" && value.trim()) ? Number(value) : NaN;
    return Number.isFinite(end) && end >= start ? end : start + 2;
  }

  function flattenCached(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      if (Array.isArray(item.segments)) {
        for (const cue of flattenCached(item.segments)) out.push(cue);
        continue;
      }
      const start = Number(item.start_media_time ?? item.start ?? item.media_time) || 0;
      const cue = {
        start_media_time: start,
        end_media_time: cueEndTime(item.end_media_time ?? item.end, start),
        source: item.source || item.text || "",
        en: item.en || "",
        vi: item.vi || "",
        tokens: item.tokens || [],
        translated: !!(item.translated || (item.vi && String(item.vi).trim())),
        id: item.id || "",
        text_source: item.text_source || "yt",
        mt_locked: !!item.mt_locked,
        translation_source: item.translation_source || "",
      };
      out.push({ ...cue, ...cachedSourceMetadata({ ...cue, rawSource: item.rawSource, normalization: item.normalization }) });
    }
    return out;
  }

  /** Saved mapping is disposable: retain it only for this exact unedited source. */
  function cachedSourceMetadata(cue) {
    const raw = cue.rawSource, mapping = cue.normalization;
    if (isOwnedCue(cue) || cue.text_source === "import" || typeof raw?.text !== "string" ||
        !Number.isFinite(raw.start) || !Number.isFinite(raw.end) || raw.start < 0 || raw.end < raw.start ||
        raw.start !== cue.start_media_time || raw.end !== cue.end_media_time ||
        !["json3-text", "loader-text"].includes(raw.sourceDomain) || !Number.isInteger(raw.trackIndex) || raw.trackIndex < 0 ||
        !Array.isArray(raw.segmentAnchors) || !raw.segmentAnchors.every(a => a &&
          Number.isInteger(a.charStart) && Number.isInteger(a.charEnd) && a.charStart >= 0 &&
          a.charEnd >= a.charStart && a.charEnd <= raw.text.length && Number.isFinite(a.time) &&
          a.time >= raw.start && a.time <= raw.end && typeof a.speakerChange === "boolean") ||
        mapping?.text !== cue.source || mapping.offsetUnit !== "utf16" || mapping.sourceDomain !== raw.sourceDomain ||
        !Array.isArray(mapping.spans) || typeof Normalize.normalizeTextWithMapping !== "function") return {};
    const expected = Normalize.normalizeTextWithMapping(raw.text);
    if (expected.text !== cue.source || expected.spans.length !== mapping.spans.length ||
        !expected.spans.every((span, i) => ["charStart", "charEnd", "rawStart", "rawEnd"]
          .every(key => span[key] === mapping.spans[i]?.[key]))) return {};
    return { rawSource: raw, normalization: mapping };
  }

  function cacheCueScore(c) {
    let s = 0;
    if (c?.translated) s += 4;
    if (String(c?.vi || "").trim()) s += 2;
    if (String(c?.en || "").trim()) s += 1;
    if (Array.isArray(c?.tokens) && c.tokens.length) s += 1;
    if (isOwnedCue(c)) s += 3;
    if (String(c?.source || "").trim()) s += 1;
    else s += 0.5; // empty draft still counts
    return s;
  }

  function scriptListScore(list) {
    let s = 0;
    for (const c of list || []) s += cacheCueScore(c);
    s += (list || []).length * 0.25;
    return s;
  }

  function isOwnedCue(c) {
    const src = String(c?.text_source || "");
    return src === "edit" || src === "manual" || src === "script";
  }

  function cacheCueKey(c) {
    const start = Number(c?.start_media_time) || 0;
    return `${start.toFixed(2)}|${compactSource(c?.source)}`;
  }

  function tombstoneKey(c) {
    return cacheCueKey(c);
  }

  /** Shared namespace so multiple tabs can reuse cached captions/tokens for the same video. */
  function tabPrefix() {
    return "";
  }

  function metaStorageKey(videoId) {
    return `transcriptMeta:${tabPrefix()}${videoId}`;
  }

  /** Cheap freshness probe (~113 B) — compare rev before pulling a 144 KB body. */
  async function loadDiskMeta(videoId) {
    if (!videoId) return null;
    try {
      const res = await bridgeFetch(`/scripts/${encodeURIComponent(videoId)}/meta`, {
        method: "GET",
      });
      if (!res?.ok || !res.data?.video_id) return null;
      return res.data;
    } catch (_) {
      return null;
    }
  }

  /**
   * chrome.storage may be wiped (Drive restore, profile reset) while disk keeps the
   * truth, so `owned` / `rev` / `deviceId` come from whichever side has the higher rev.
   * Tombstones only ever live in chrome.storage.
   */
  async function loadTranscriptMeta(videoId) {
    if (!videoId) return emptyMeta();
    const key = metaStorageKey(videoId);
    const data = await chrome.storage.local.get([key]);
    const raw = data[key] || {};
    const disk = (await loadDiskMeta(videoId)) || {};
    const localRev = Number(raw.rev) || 0;
    const diskRev = Number(disk.rev) || 0;
    const owner = diskRev > localRev || !data[key] ? disk : raw;
    return {
      owned: !!owner.owned,
      rev: Math.max(localRev, diskRev),
      deviceId: String(raw.deviceId || disk.deviceId || ""),
      tombstones: Array.isArray(raw.tombstones)
        ? raw.tombstones.map(String).filter(Boolean)
        : [],
    };
  }

  async function saveTranscriptMeta() {
    if (!currentVideoId) return;
    const result = await chrome.runtime.sendMessage({ type: "SAVED_CUES_MUTATE", op: "save_meta", videoId: currentVideoId,
      meta: {
        owned: !!transcriptMeta.owned,
        rev: Number(transcriptMeta.rev) || 0,
        deviceId: String(transcriptMeta.deviceId || ""),
        updatedAt: new Date().toISOString(),
        tombstones: Array.from(new Set(transcriptMeta.tombstones || [])),
      },
    });
    if (!result?.ok) throw new Error(result?.error || "Script metadata save failed");
    if (result.skipped) toast("Script mới hơn ở tab khác; Reload trước khi chỉnh tiếp");
  }

  async function markScriptOwned() {
    transcriptMeta.owned = true;
    await saveTranscriptMeta();
  }

  /** Prefer richer MT among chrome.storage + disk script caches. */
  function mergeCacheLists(...lists) {
    const byKey = new Map();
    for (const list of lists) {
      for (const c of flattenCached(list)) {
        // Keep empty drafts (owned/manual) — only drop totally empty unknown rows.
        if (!c.source && !c.vi && !c.en && !c.id && !isOwnedCue(c)) continue;
        const key = c.id ? `id:${c.id}` : cacheCueKey(c);
        const prev = byKey.get(key);
        if (!prev) {
          byKey.set(key, c);
          continue;
        }
        // Same stable id: richer wins. A poor YT auto-save in chrome.storage
        // must not permanently shadow an owned/translated disk script (same ids).
        // "Xóa dịch" awaits disk, so cleared chrome is not resurrected from stale disk.
        if (cacheCueScore(c) > cacheCueScore(prev)) byKey.set(key, c);
      }
    }
    return Array.from(byKey.values());
  }

  async function loadDiskScript(videoId) {
    if (!videoId) return [];
    try {
      const res = await bridgeFetch(`/scripts/${encodeURIComponent(videoId)}`, {
        method: "GET",
      });
      if (!res?.ok || !res.data?.found) return [];
      return flattenCached(res.data.cues || []);
    } catch (_) {
      return [];
    }
  }

  /**
   * Lamport rev decides, so deletes survive; equal revs fall back to richness and
   * finally deviceId so two machines at the same rev still agree on a winner.
   * @returns {"local"|"disk"}
   */
  function pickCacheSide(local, disk) {
    const lRev = Number(local?.rev) || 0;
    const dRev = Number(disk?.rev) || 0;
    if (lRev !== dRev) return lRev > dRev ? "local" : "disk";
    const lScore = Number(local?.score) || 0;
    const dScore = Number(disk?.score) || 0;
    if (lScore !== dScore) return lScore > dScore ? "local" : "disk";
    return String(local?.deviceId || "") >= String(disk?.deviceId || "") ? "local" : "disk";
  }

  /** Sole gate every load path goes through (navigate / restore / YT merge). */
  async function loadCachedCues(videoId) {
    const cached = await loadLegacyCachedCues(videoId);
    try {
      const key = sentenceStateStorageKey(videoId);
      const state = (await chrome.storage.local.get(key))[key];
      if (state?.version !== 1 || state.sourceKey !== sentenceTrackKey(videoId) || !Array.isArray(state.sourceCues)) return cached;
      const rawById = new Map(state.sourceCues.filter(c => c && typeof c.id === "string").map(c => [c.id, c]));
      return cached.map(c => {
        const raw = rawById.get(c.id);
        if (!raw || raw.source !== c.source || raw.start_media_time !== c.start_media_time ||
            raw.end_media_time !== c.end_media_time) return c;
        return { ...c, ...cachedSourceMetadata({ ...c, rawSource: raw.rawSource, normalization: raw.normalization }) };
      });
    } catch (_) { return cached; }
  }

  async function loadLegacyCachedCues(videoId) {
    if (!videoId) return [];
    const key = `transcript:${tabPrefix()}${videoId}`;
    const mKey = metaStorageKey(videoId);
    const data = await chrome.storage.local.get([key, mKey]);
    let local = flattenCached(data[key] || []);
    if (detectCuesLanguage(local) === "vi") local = [];
    const localMeta = data[mKey] || {};
    const diskMeta = (await loadDiskMeta(videoId)) || {};
    const noteSide = (side) => {
      const m = side === "local" ? localMeta : diskMeta;
      scriptSource = {
        origin: side === "local" ? "chrome" : "disk",
        rev: Math.max(Number(localMeta.rev) || 0, Number(diskMeta.rev) || 0),
        updatedAt: String(m.updatedAt || m.updated_at || ""),
      };
      return side;
    };
    const sameRev = (Number(localMeta.rev) || 0) === (Number(diskMeta.rev) || 0);
    // Same rev from the same writer is the same save — the copy in hand will do.
    if (sameRev && local.length && localMeta.deviceId && localMeta.deviceId === diskMeta.deviceId) {
      noteSide("local");
      return hydrateTokens(videoId, local);
    }
    // A real tie (two writers at one rev) is the only case needing both bodies.
    if (sameRev) {
      let disk = await loadDiskScript(videoId);
      if (detectCuesLanguage(disk) === "vi") disk = [];
      const side = noteSide(
        pickCacheSide(
          { rev: localMeta.rev, score: scriptListScore(local), deviceId: localMeta.deviceId },
          { rev: diskMeta.rev, score: scriptListScore(disk), deviceId: diskMeta.deviceId }
        )
      );
      return hydrateTokens(
        videoId,
        side === "local" ? mergeCacheLists(local, disk) : mergeCacheLists(disk, local)
      );
    }
    if (noteSide(pickCacheSide(localMeta, diskMeta)) === "local" && local.length) {
      return hydrateTokens(videoId, local);
    }
    let disk = await loadDiskScript(videoId);
    if (detectCuesLanguage(disk) === "vi") disk = [];
    noteSide(disk.length ? "disk" : "local");
    return hydrateTokens(videoId, disk.length ? disk : local);
  }

  function originalTokensMatch(source, tokens) {
    return Array.isArray(tokens) && tokens.length > 0 &&
      tokens.every(t => t && typeof t === "object" && typeof t.surface === "string") &&
      tokens.map(t => t.surface).join("") === source;
  }

  /** cues.json / chrome.storage carry no tokens — refill from tokens cache, bridge only on miss. */
  async function hydrateTokens(videoId, list) {
    if (!list.length) return list;
    for (const c of list) {
      if (c.tokens !== undefined && !originalTokensMatch(c.source, c.tokens)) c.tokens = [];
    }
    // Fill only cues still missing tokens (partial in-memory tokens must not skip the rest).
    if (list.every((c) => !String(c.source || "").trim() || c.tokens?.length)) return list;
    const cacheKey = `tokens:${tabPrefix()}${videoId}`;
    const fill = (map) => {
      if (!map) return;
      for (const c of list) {
        if (c.tokens?.length) continue;
        const t = map[c.id];
        if (originalTokensMatch(c.source, t)) c.tokens = t;
      }
    };
    try {
      const cached = await chrome.storage.local.get([cacheKey]);
      fill(cached[cacheKey]);
    } catch (_) {}
    if (list.every((c) => !String(c.source || "").trim() || c.tokens?.length)) return list;
    try {
      const res = await bridgeFetch(`/scripts/${encodeURIComponent(videoId)}/tokens`, {
        method: "GET",
      });
      const map = res?.ok && res.data && typeof res.data === "object" ? res.data : null;
      fill(map);
      if (map && Object.keys(map).length) {
        // T3: keep chrome.storage copy fresh so reloads skip this bridge RTT.
        void chrome.storage.local.set({ [cacheKey]: map }).catch(() => {});
      }
    } catch (_) {}
    return list;
  }

  function scheduleSaveTranscript() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveTranscript();
    }, SAVE_DEBOUNCE_MS);
  }

  function pageTitle() {
    try {
      const t =
        document.querySelector("h1.ytd-watch-metadata yt-formatted-string")?.textContent ||
        document.querySelector("h1.title")?.textContent ||
        document.title ||
        "";
      return String(t)
        .replace(/\s*-\s*YouTube\s*$/i, "")
        .trim();
    } catch {
      return "";
    }
  }

  /** Non-YouTube: fetch native cues (textTracks / <track> VTT) via page world. */
  async function loadPageCues(force = false) {
    if (!pageBridgeReady) {
      const ready = await waitForPageBridge(1500);
      if (!ready) {
        captionsStatus = "none";
        captionsInfo = "page_bridge_timeout";
        return;
      }
      await pageCall("BIND", {}, 300);
    }
    const pc = await pageCall(
      "FETCH_CAPTIONS",
      { force: !!force },
      3500
    );
    if (Array.isArray(pc?.cues) && pc.cues.length) {
      await applyLoadedCues(pc.cues, `${pc.via || "page"} · ${pc.count || pc.cues.length} cues`, {
        enCues: pc.enCues,
        viCues: pc.viCues,
      });
      return;
    }
    captionsStatus = "none";
    captionsInfo = pc?.reason || "no_cues";
  }

  /** AnimeVietSub: fetch Japanese script from Jimaku.cc via Service Worker. */
  async function loadAnimeVietsubCues(force = false) {
    captionsStatus = "loading";
    captionsInfo = "Đang tìm script tiếng Nhật...";
    updateCaptionStatusLine();

    try {
      const epEl = document.querySelector(".btn-episode.active, .episode-link.active, a.active[href*='tap-']");
      const domInfo = {
        title: document.title || "",
        h1: document.querySelector("h1")?.innerText || "",
        h2: document.querySelector("h2")?.innerText || "",
        activeEpisode: epEl?.innerText || "",
        activeEpisodeUrl: epEl?.href || ""
      };

      const res = await chrome.runtime.sendMessage({
        type: "FETCH_ANIME_SCRIPT",
        url: location.href,
        domInfo
      });

      if (!res?.ok || !Array.isArray(res.cues) || !res.cues.length) {
        captionsStatus = "none";
        captionsInfo = res?.message || res?.error || "Không tìm thấy phụ đề";
        updateCaptionStatusLine();
        publishSidePanelState({ forceList: true, cues: [] });
        return;
      }

      await applyLoadedCues(
        res.cues,
        `${res.animeTitle || "AVS"} · Tập ${res.episode || 1} · ${res.cues.length} câu`,
        { skipCache: !!force }
      );
    } catch (err) {
      captionsStatus = "none";
      captionsInfo = `Lỗi: ${err?.message || String(err)}`;
      updateCaptionStatusLine();
      publishSidePanelState({ forceList: true, cues: [] });
    }
  }

  async function saveTranscriptToDisk(payload) {
    if (!currentVideoId) return;
    // Empty payload is an intentional wipe only when the script is owned (delete-all).
    if (!payload?.length && !transcriptMeta.owned) return;
    const videoId = currentVideoId, gen = navigateGen;
    try {
      const res = await bridgeFetch("/scripts/save", {
        method: "POST",
        body: {
          video_id: videoId,
          url: location.href || "",
          title: pageTitle(),
          cues: payload,
          owned: !!transcriptMeta.owned,
          rev: Number(transcriptMeta.rev) || 0,
        },
      });
      if (!res?.ok) {
        if (videoId === currentVideoId && gen === navigateGen &&
            (res?.status === 409 || res?.skipped === "stale_revision")) {
          toast("Bản lưu mới hơn đã có. Xuất backup JSON trước khi Reload để giữ chỉnh sửa ở tab này.");
        }
        return { ok: false, skipped: res?.skipped === "stale_revision" || res?.status === 409 };
      }
      // Bridge answers with the Lamport rev it just wrote — adopt it, never guess.
      const rev = Number(res?.data?.rev) || 0;
      if (rev && videoId === currentVideoId && rev > (Number(transcriptMeta.rev) || 0)) {
        transcriptMeta.rev = rev;
        await saveTranscriptMeta();
      }
      // Idle-debounced Drive mirror of this one video's folder.
      try {
        chrome.runtime
          .sendMessage({ type: "DRIVE_UPLOAD_SCHEDULE", videoId })
          .catch(() => {});
      } catch (_) {}
      return { ok: true, skipped: false };
    } catch (_) {
      /* bridge offline — chrome.storage still holds a copy */
      return { ok: false, skipped: false };
    }
  }

  let transcriptWritePending = Promise.resolve();
  function withTranscriptWrite(write) {
    const result = transcriptWritePending.then(write);
    transcriptWritePending = result.catch(() => {});
    return result;
  }
  async function saveTranscript(opts = {}) {
    if (!currentVideoId) return { saved: false, skipped: false, diskWritten: false };
    const gen = navigateGen, videoId = currentVideoId, input = cues;
    const current = () => gen === navigateGen && videoId === currentVideoId && input === cues;
    return withTranscriptWrite(async () => {
      // Every path returns a result: the caller (clearTranslations) must be
      // able to tell "saved" from "nothing was written".
      if (!current()) return { saved: false, skipped: true, diskWritten: false };
      const force = !!opts.force;
      // Persist the full cue list — display limits (settings.maxSentences) apply at
      // render only, never here (a truncated save would drop owned cues on reload).
      const payload = cues.map((c) => ({
        id: c.id,
        start_media_time: c.start_media_time,
        end_media_time: c.end_media_time,
        source: c.source,
        en: c.en,
        vi: c.vi,
        tokens: c.tokens || [],
        translated: !!c.translated,
        text_source: c.text_source || "yt",
        mt_locked: !!c.mt_locked,
        translation_source: c.translation_source || "",
      }));
      // Guard: an in-memory list older than what is cached must not roll it back.
      // force=true for intentional clears / replace so a wipe is never blocked.
      const rev = Number(transcriptMeta.rev) || 0;
      try {
        if (!force) {
          const mKey = metaStorageKey(currentVideoId);
          const existingMeta = (await chrome.storage.local.get([mKey]))[mKey];
          if (!current()) return;
          if (rev < (Number(existingMeta?.rev) || 0)) return;
        }
      } catch (_) {}
      if (!current()) return;
      // Compare revision inside the worker queue so sibling tabs cannot roll back restore.
      const result = await chrome.runtime.sendMessage({ type: "SAVED_CUES_MUTATE", op: "save_script", videoId,
        meta: { owned: !!transcriptMeta.owned, rev, deviceId: String(transcriptMeta.deviceId || ""),
          updatedAt: new Date().toISOString(), tombstones: Array.from(new Set(transcriptMeta.tombstones || [])) },
        cues: payload.map(({ tokens, ...rest }) => rest) });
      if (!result?.ok) {
        throw new Error(result?.error || "Script save failed");
      }
      if (result.skipped) {
        toast("Script mới hơn ở tab khác; Reload trước khi chỉnh tiếp");
        return { saved: false, skipped: true, diskWritten: false };
      }
      if (!current()) return;
      await saveSentenceState();
      if (!current()) return;
      if (!force) {
        try {
          const diskMeta = await loadDiskMeta(currentVideoId);
          if (!current()) return;
          if (rev < (Number(diskMeta?.rev) || 0)) return;
        } catch (_) {}
      }
      // Persist readable script.txt + cues.json under scripts/{videoId}/ via bridge.
      const disk = current() ? await saveTranscriptToDisk(payload) : { ok: false };
      return { saved: true, skipped: false, diskWritten: !!(disk && disk.ok) };
    });
  }

  function cueId(start, source) {
    return `c-${start.toFixed(3)}-${compactSource(source).slice(0, 24)}`;
  }

  function newStableCueId() {
    return `c-new-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function findCachedMatch(cacheList, start, source, usedIds = new Set()) {
    // ponytail: linear scan per cue is fine for a video; index time windows if long tracks become costly.
    const compact = compactSource(source);
    let hit = null, nearest = Infinity;
    for (const prev of cacheList || []) {
      const dt = Math.abs((Number(prev.start_media_time) || 0) - start);
      if (dt > CACHE_MATCH_TOL || dt >= nearest || usedIds.has(prev.id)) continue;
      const prevSrc = String(prev.source || "");
      if (prevSrc === source || compactSource(prevSrc) === compact) {
        hit = prev;
        nearest = dt;
      }
    }
    return hit;
  }

  /**
   * Merge YT timedtext with saved cache.
   * Owned scripts: keep saved timing/source; skip tombstones; never append YT.
   */
  function mergeCache(ytCues, cached, meta = transcriptMeta) {
    let cacheList = cached || [];
    const cacheLang = detectCuesLanguage(cacheList);
    if (cacheLang === "vi" || cacheLang === "en") {
      cacheList = [];
    }
    const stones = new Set(meta?.tombstones || []);
    const owned = !!meta?.owned || cacheList.some(isOwnedCue);

    if (owned) {
      // Owned/import timeline is authoritative — keep script start/end exactly.
      // Do not append unmatched YT cues (Reload must not pollute import replace).
      const out = cuesFromSavedScript(cacheList, meta);
      for (const raw of ytCues || []) {
        const start = Number(raw.start) || 0;
        const source = String(raw.text || "").trim();
        const tKey = `${start.toFixed(2)}|${compactSource(source)}`;
        if (stones.has(tKey)) continue;
        for (const prev of out) {
          const dt = Math.abs((Number(prev.start_media_time) || 0) - start);
          if (dt > CACHE_MATCH_TOL) continue;
          const prevSrc = String(prev.source || "");
          if (
            !(
              prevSrc === source ||
              compactSource(prevSrc) === compactSource(source) ||
              (isOwnedCue(prev) && dt <= CACHE_MATCH_TOL)
            )
          ) {
            continue;
          }
          // Fill missing MT from cache hit only if owned cue lacks it.
          if (!prev.translated && !prev.mt_locked && !["user", "import"].includes(prev.translation_source)) {
            const hit = findCachedMatch(cacheList, start, source);
            if (hit && (hit.vi || hit.en) && compactSource(hit.source) === compactSource(prev.source)) {
              prev.en = hit.en || prev.en || "";
              const hitVi = hit.vi || "";
              if (!Normalize.isBogusInterjectionTranslation(prev.source, hitVi)) {
                prev.vi = hitVi || prev.vi || "";
              }
              if (originalTokensMatch(prev.source, hit.tokens)) prev.tokens = hit.tokens;
              prev.translated = !!(prev.vi || prev.en);
              if (hit.mt_locked) {
                prev.mt_locked = true;
                prev.translation_source =
                  hit.translation_source || prev.translation_source || "import";
              }
            }
          }
          break;
        }
      }
      out.sort((a, b) => a.start_media_time - b.start_media_time);
      return out;
    }

    // Fresh / non-owned: YT timeline + MT from cache; honor tombstones.
    const usedIds = new Set();
    return (ytCues || [])
      .map((c, index) => {
        const start = Number(c.start) || 0;
        const end = cueEndTime(c.end, start);
        const source = String(c.text || "").trim();
        const tKey = `${start.toFixed(2)}|${compactSource(source)}`;
        if (stones.has(tKey)) return null;
        const hit = findCachedMatch(cacheList, start, source, usedIds);
        let id = (hit && hit.id) || cueId(start, source);
        while (usedIds.has(id)) id += `:yt:${index}`;
        usedIds.add(id);
        const hitVi = hit && !hit.mt_locked && Normalize.isBogusInterjectionTranslation(source, hit.vi) ? "" : ((hit && hit.vi) || "");
        const hasVi = !!String(hitVi || "").trim();
        const hasEn = !!(hit && String(hit.en || "").trim());
        const hasMt = hasVi || hasEn;
        const translated = !!(hit && (hit.translated || hasMt));
        return {
          id,
          start_media_time: hit && isOwnedCue(hit) ? Number(hit.start_media_time) || start : start,
          end_media_time: hit && isOwnedCue(hit) ? Number(hit.end_media_time) || end : end,
          source: hit && isOwnedCue(hit) ? String(hit.source || source) : source,
          en: (hit && hit.en) || "",
          vi: hitVi,
          tokens: originalTokensMatch(source, hit?.tokens) ? hit.tokens : [],
          translated,
          text_source: hit && isOwnedCue(hit) ? hit.text_source : "yt",
          mt_locked: !!(hit && hit.mt_locked),
          translation_source: (hit && hit.translation_source) || "",
          // Metadata belongs only to this exact fresh source, never to an edited hit.
          ...(c.rawSource && !(hit && isOwnedCue(hit)) ? { rawSource: c.rawSource, normalization: c.normalization } : {}),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.start_media_time - b.start_media_time);
  }

  /** Build overlay cues entirely from a saved disk/chrome script (no YT timedtext). */
  function cuesFromSavedScript(cached, meta = transcriptMeta) {
    const stones = new Set(meta?.tombstones || []);
    return (cached || [])
      .filter(c => !stones.has(tombstoneKey(c)))
      .map((c) => {
        const start = Number(c.start_media_time) || 0;
        const end = cueEndTime(c.end_media_time, start);
        const source = String(c.source || "");
        const hasMt = !!(String(c.vi || "").trim() || String(c.en || "").trim());
        const translated = !!(c.translated && hasMt);
        return {
          id: c.id || cueId(start, source || "empty"),
          start_media_time: start,
          end_media_time: end,
          source,
          en: hasMt ? c.en || "" : "",
          vi: hasMt ? c.vi || "" : "",
          tokens: originalTokensMatch(source, c.tokens) ? c.tokens : [],
          translated,
          text_source: c.text_source || "yt",
          mt_locked: !!c.mt_locked,
          translation_source: c.translation_source || "",
          ...cachedSourceMetadata(c),
        };
      })
      .sort((a, b) => a.start_media_time - b.start_media_time);
  }

  /** Ask the SW whether Drive holds a newer rev for this video (SW caches the probe). */
  function checkDriveFresh(videoId, opts = {}) {
    if (!videoId) return Promise.resolve(null);
    return chrome.runtime
      .sendMessage({
        type: "DRIVE_MIRROR_DOWN",
        videoIds: [videoId],
        maxAgeMs: opts.force ? 0 : 10000,
      })
      .catch(() => null);
  }

  async function tryApplySavedScript(reason = "disk", opts = {}) {
    const gen = navigateGen;
    const vid = currentVideoId;
    const cached = await loadCachedCues(currentVideoId);
    if (gen !== navigateGen || currentVideoId !== vid) return false;
    const meta = await loadTranscriptMeta(currentVideoId);
    if (gen !== navigateGen || currentVideoId !== vid) return false;
    transcriptMeta = meta;
    if (cached.some(isOwnedCue)) transcriptMeta.owned = true;
    let fromScript = cuesFromSavedScript(cached);
    if (!fromScript.length && !meta.owned) return false;
    // Keep original authentic timing on restore.
    captionsStatus = "ok";
    captionsInfo = `${reason} · ${fromScript.length} cues`;
    cues = fromScript;
    listDirty = true;
    // Restore revision-bound Undo/cache before publishing or auto-saving the script.
    await loadSentenceState();
    if (gen !== navigateGen || currentVideoId !== vid) return false;
    // T2: enrich alongside playhead-align; first publish carries tokens if warm.
    const enrichP = enrichTokensAfterImport();
    await Promise.race([enrichP, sleep(200)]);
    if (gen !== navigateGen || currentVideoId !== vid) return false;
    await syncToPlayhead();
    if (gen !== navigateGen || currentVideoId !== vid) return false;
    updateCaptionStatusLine();
    renderList(true);
    publishSidePanelState({ forceList: true });
    scheduleSaveTranscript();
    if (cues.some((c) => c.tokens?.length)) markFuriganaPainted();
    if (!opts.quiet) toast(`Đã tải script đã lưu (${fromScript.length} câu)`);
    return true;
  }

  let videoLayoutObserver = null;
  let videoLayoutTimer = null;
  let playerToggleObserver = null;
  let playerToggleEnsureScheduled = false;
  const PLAYER_TOGGLE_ID = "hardsub-ocr-player-toggle";
  let dictHideTimer = null;
  let dictReqSeq = 0;
  let lastBarFingerprint = "";
  let activeDictTokEl = null;

  function getVideoRect() {
    const candidates = [
      document.querySelector("video.html5-main-video"),
      document.querySelector("#movie_player video"),
      document.querySelector("ytd-player video"),
      document.querySelector("#player video"),
      document.querySelector("#movie_player"),
      document.querySelector("#player-container"),
      document.querySelector("ytd-player"),
    ];
    if (currentSource === "animevietsub") {
      const p = document.querySelector("#media-player iframe, #media-player, #media-player-box");
      if (p) candidates.unshift(p);
    }
    if (currentSource !== "youtube") {
      // Generic players (ABEMA / hls.js / shaka): the <video> itself is the anchor.
      const v = document.querySelector("video");
      if (v) candidates.unshift(v);
    }
    for (const el of candidates) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width >= 80 && r.height >= 60) return r;
    }
    return null;
  }

  let _listenersAttached = false;

  function ensureVideoLayoutSync() {
    if (videoLayoutTimer) return;
    videoLayoutTimer = setInterval(() => {
      // Hidden tabs do not need layout work, and a disabled platform must not
      // re-create the overlay the teardown just removed.
      if (document.hidden) return;
      if (!isCurrentPlatformEnabled()) return;
      ensureUI();
      applyBarPosition();
      applyDim();
      ensurePlayerToggle();
    }, 250);
    const observeTarget =
      document.querySelector("#movie_player") ||
      document.querySelector("ytd-player") ||
      document.querySelector(".watch-video") ||
      document.querySelector(".NFPlayer") ||
      document.querySelector("#player-container") ||
      document.body;
    if (typeof ResizeObserver !== "undefined" && observeTarget) {
      if (videoLayoutObserver) videoLayoutObserver.disconnect();
      videoLayoutObserver = new ResizeObserver(() => applyBarPosition());
      videoLayoutObserver.observe(observeTarget);
      const vid = document.querySelector("video.html5-main-video");
      if (vid) videoLayoutObserver.observe(vid);
    }
    if (!_listenersAttached) {
      _listenersAttached = true;
      window.addEventListener("resize", applyBarPosition);
      document.addEventListener("fullscreenchange", syncFullscreenMount);
      document.addEventListener("webkitfullscreenchange", syncFullscreenMount);
    }
  }

  function syncFullscreenMount() {
    const root = document.getElementById("hardsub-ocr-root");
    if (!root) return;
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl && fsEl !== root.parentElement) {
      fsEl.appendChild(root);
    } else if (!fsEl && root.parentElement !== document.documentElement && root.parentElement !== document.body) {
      document.documentElement.appendChild(root);
    }
    applyBarPosition();
    applyBarVisibility();
  }

  function ensureUI() {
    if (document.getElementById("hardsub-ocr-root")) return;
    const root = document.createElement("div");
    root.id = "hardsub-ocr-root";
    // On-video overlay with Language Reactor 5.1.8 design
    root.innerHTML = `
      <div id="hardsub-ocr-bar" class="hardsub-bar lr-bar-container" hidden></div>
      <div id="lr-nav-left" class="lr-nav-left" hidden>
        <button type="button" class="lr-nav-btn" id="lr-btn-prev" title="Prev sub (A)">&lt;</button>
        <button type="button" class="lr-nav-btn" id="lr-btn-repeat" title="Repeat sub (S)">
          ↻<span class="lr-tooltip">Repeat ['S' key]</span>
        </button>
        <button type="button" class="lr-nav-btn" id="lr-btn-next" title="Next sub (D)">&gt;</button>
      </div>
      <div id="lr-ctrl-right" class="lr-ctrl-right" hidden>
        <div class="lr-ap-toggle" id="lr-toggle-ap" title="Auto-Pause (stop video when sub finishes)">
          <div class="lr-ap-switch"></div>
          <span class="lr-ap-label">AP</span>
        </div>
        <button type="button" class="lr-move-btn" id="lr-btn-move" title="Move subtitle position">↕</button>
      </div>
      <div id="hardsub-ocr-dict" class="hardsub-dict" hidden></div>
      <div id="hardsub-dim" class="hardsub-dim" hidden></div>
    `;
    (document.body || document.documentElement).appendChild(root);
    setupBarDrag();
    setupBarDict();
    setupLRControls();
    ensureVideoLayoutSync();
    ensurePlayerToggleObserver();
    ensurePlayerToggle();
    applyBarPosition();
    applyBarVisibility();
  }

  function userBarScale() {
    const n = Number(settings.barScale);
    return Number.isFinite(n) ? Math.max(0.55, Math.min(2.4, n)) : 1;
  }

  function clampBarBoxScale(n) {
    const x = Number(n);
    return Number.isFinite(x) ? Math.max(0.55, Math.min(2.4, x)) : 1;
  }

  function userBarScaleW() {
    return clampBarBoxScale(settings.barScaleW);
  }

  function userBarScaleH() {
    return clampBarBoxScale(settings.barScaleH);
  }

  /**
   * Edge/corner resize: adjust W and/or H; keep the opposite edge fixed via left/top.
   * dir is one of n,s,e,w,nw,ne,sw,se.
   */
  function computeBarEdgeResize(dir, start, dx, dy) {
    const w0 = Math.max(1, start.w0);
    const h0 = Math.max(1, start.h0);
    let scaleW = start.scaleW;
    let scaleH = start.scaleH;
    let left = start.left;
    let top = start.top;
    if (dir.includes("e")) scaleW = clampBarBoxScale(start.scaleW + dx / w0);
    if (dir.includes("w")) {
      scaleW = clampBarBoxScale(start.scaleW - dx / w0);
      left = start.left + (start.scaleW - scaleW) * w0;
    }
    if (dir.includes("s")) scaleH = clampBarBoxScale(start.scaleH + dy / h0);
    if (dir.includes("n")) {
      scaleH = clampBarBoxScale(start.scaleH - dy / h0);
      top = start.top + (start.scaleH - scaleH) * h0;
    }
    return { scaleW, scaleH, left, top };
  }

  /**
   * Caption-box reference size from video rect (at userScale=1).
   * CSS multiplies by --bar-user-scale-w/h so edge handles grow each axis alone.
   * Content length must not grow the box (overflow scrolls inside).
   */
  function applyBarBoxSize(bar, rect, scaleW, scaleH) {
    if (!bar) return;
    const sw = clampBarBoxScale(scaleW);
    const sh = clampBarBoxScale(scaleH);
    let w0;
    let h0;
    if (!rect) {
      w0 = Math.min(920, window.innerWidth * 0.7);
      h0 = Math.max(96, Math.min(220, window.innerHeight * 0.16));
    } else {
      w0 = Math.min(rect.width * 0.68, 920);
      // ~3 caption lines zone at scale 1; user scales grow it via CSS.
      h0 = Math.max(88, Math.min(rect.height * 0.22, 240));
    }
    bar.style.setProperty("--bar-box-w0", `${Math.round(w0)}px`);
    bar.style.setProperty("--bar-box-h0", `${Math.round(h0)}px`);
    bar.style.setProperty("--bar-user-scale-w", String(sw));
    bar.style.setProperty("--bar-user-scale-h", String(sh));
    // Drop legacy inline dims so CSS calc owns size.
    bar.style.width = "";
    bar.style.height = "";
    bar.style.maxWidth = "";
    bar.style.minWidth = "";
    bar.style.maxHeight = "";
    bar.style.minHeight = "";
  }

  /**
   * Keep the caption bar inside the player on narrow/short videos: shrink the
   * JP text (--bar-fit-scale) and nudge top up so the bar never covers page
   * content below the player. Desktop/tablet widths keep fit=1.
   */
  function clampBarIntoVideo(bar, rect) {
    if (!bar || !rect) return;
    const maxH = rect.height * 0.92;
    let r = bar.getBoundingClientRect();
    if (r.height > maxH) {
      const cur = Number(getComputedStyle(bar).getPropertyValue("--bar-fit-scale")) || 1;
      const next = Math.max(0.5, (cur * maxH) / r.height);
      if (next < cur - 0.01) {
        bar.style.setProperty("--bar-fit-scale", String(next));
        r = bar.getBoundingClientRect();
      }
    }
    const maxBottom = rect.bottom - 4;
    if (r.bottom > maxBottom) {
      bar.style.top = `${Math.max(rect.top + 4, maxBottom - r.height)}px`;
    } else if (r.top < rect.top + 4) {
      bar.style.top = `${rect.top + 4}px`;
    }
  }

  function applyBarPosition() {
    const bar = document.getElementById("hardsub-ocr-bar");
    if (!bar) return;
    const rect = getVideoRect();
    const pos = settings.barPos;
    const userScale = userBarScale();
    const scaleW = userBarScaleW();
    const scaleH = userBarScaleH();

    if (!rect) {
      // Fallback before player mounts — viewport lower-third.
      bar.style.left = "50%";
      bar.style.top = "";
      bar.style.bottom = "14vh";
      bar.style.transform = "translateX(-50%)";
      bar.style.setProperty("--bar-scale", String(userScale));
      bar.style.setProperty("--bar-fit-scale", "1");
      applyBarBoxSize(bar, null, scaleW, scaleH);
      applyBarStyle(bar);
      return;
    }

    const base = Math.max(0.55, Math.min(1.45, rect.height / 720));
    const scale = base * userScale;
    bar.style.setProperty("--bar-scale", String(scale));
    // Narrow players: shrink JP text so a wrapped cue fits above the page.
    bar.style.setProperty("--bar-fit-scale", String(Math.max(0.55, Math.min(1, rect.width / 520))));
    applyBarBoxSize(bar, rect, scaleW, scaleH);
    applyBarStyle(bar);
    bar.style.bottom = "auto";

    // Legacy absolute px drag → migrate to normalized video coords once.
    if (pos && pos.left != null && pos.top != null && pos.nx == null) {
      settings.barPos = {
        nx: (pos.left - rect.left) / Math.max(1, rect.width),
        ny: (pos.top - rect.top) / Math.max(1, rect.height),
      };
    }

    const np = settings.barPos;
    if (np && np.nx != null && np.ny != null) {
      const left = rect.left + np.nx * rect.width;
      const top = rect.top + np.ny * rect.height;
      // A centred preset keeps the translateX(-50%) offset (the bar is wider
      // than its anchor); a dragged position is anchored by its left edge.
      bar.style.transform = np.center ? "translateX(-50%)" : "none";
      bar.style.left = `${Math.max(rect.left + 4, Math.min(rect.right - 40, left))}px`;
      bar.style.top = `${Math.max(rect.top + 4, Math.min(rect.bottom - 24, top))}px`;
    } else {
      // Default: horizontally centered, lower-third caption zone (~above hardsubs).
      const left = rect.left + rect.width / 2;
      const top = rect.top + rect.height * 0.70;
      bar.style.transform = "translateX(-50%)";
      bar.style.left = `${left}px`;
      bar.style.top = `${top}px`;
    }

    const dim = document.getElementById("hardsub-dim");
    if (dim) {
      dim.style.left = `${rect.left + rect.width * 0.05}px`;
      dim.style.width = `${rect.width * 0.9}px`;
      dim.style.top = `${rect.top + rect.height * 0.78}px`;
      dim.style.bottom = "auto";
      dim.style.height = `${rect.height * 0.18}px`;
    }

    const navLeft = document.getElementById("lr-nav-left");
    const ctrlRight = document.getElementById("lr-ctrl-right");
    if (navLeft) {
      navLeft.style.position = "fixed";
      navLeft.style.left = `${Math.max(10, rect.left + 14)}px`;
      navLeft.style.top = `${rect.top + rect.height / 2}px`;
      navLeft.style.transform = "translateY(-50%)";
    }
    if (ctrlRight) {
      ctrlRight.style.position = "fixed";
      ctrlRight.style.left = "auto";
      ctrlRight.style.right = `${Math.max(10, window.innerWidth - rect.right + 14)}px`;
      ctrlRight.style.top = `${rect.top + rect.height / 2}px`;
      ctrlRight.style.transform = "translateY(-50%)";
    }
    clampBarIntoVideo(bar, rect);
  }

  const BAR_RESIZE_DIRS = ["n", "s", "e", "w", "nw", "ne", "sw", "se"];

  function ensureBarResizeHandle(bar) {
    if (!bar) return;
    // Upgrade legacy single corner handle → 8 edge/corner handles.
    if (!bar.querySelector(".bar-resize-se") || bar.querySelectorAll(".bar-resize").length < 8) {
      bar.querySelectorAll(".bar-resize").forEach((el) => el.remove());
    } else {
      return;
    }
    for (const dir of BAR_RESIZE_DIRS) {
      const handle = document.createElement("div");
      handle.className = `bar-resize bar-resize-${dir}`;
      handle.dataset.dir = dir;
      handle.title = "Kéo cạnh để đổi kích thước";
      bar.appendChild(handle);
    }
  }

  function setupBarDrag() {
    const bar = document.getElementById("hardsub-ocr-bar");
    if (!bar || bar.dataset.dragBound) return;
    bar.dataset.dragBound = "1";
    ensureBarResizeHandle(bar);
    let dragging = false;
    let resizing = false;
    let resizeDir = "";
    let ox = 0;
    let oy = 0;
    let startX = 0;
    let startY = 0;
    /** @type {{ scaleW: number, scaleH: number, left: number, top: number, boxW: number, boxH: number, w0: number, h0: number } | null} */
    let resizeStart = null;

    const onPointerMove = (e) => {
      if (resizing && resizeStart) {
        const next = computeBarEdgeResize(
          resizeDir,
          resizeStart,
          e.clientX - startX,
          e.clientY - startY
        );
        settings.barScaleW = next.scaleW;
        settings.barScaleH = next.scaleH;
        const vrect = getVideoRect();
        let left = next.left;
        let top = next.top;
        const w = next.scaleW * resizeStart.w0;
        const h = next.scaleH * resizeStart.h0;
        if (vrect) {
          left = Math.max(vrect.left + 4, Math.min(vrect.right - w - 4, left));
          top = Math.max(vrect.top + 4, Math.min(vrect.bottom - h - 4, top));
          settings.barPos = {
            nx: (left - vrect.left) / Math.max(1, vrect.width),
            ny: (top - vrect.top) / Math.max(1, vrect.height),
          };
        } else {
          left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
          top = Math.max(8, Math.min(window.innerHeight - h - 8, top));
          settings.barPos = { left, top };
        }
        bar.style.transform = "none";
        bar.style.bottom = "auto";
        bar.style.left = `${left}px`;
        bar.style.top = `${top}px`;
        applyBarBoxSize(bar, vrect, next.scaleW, next.scaleH);
        return;
      }
      if (!dragging) return;
      const vrect = getVideoRect();
      const w = bar.offsetWidth;
      const h = bar.offsetHeight;
      let left = e.clientX - ox;
      let top = e.clientY - oy;
      if (vrect) {
        left = Math.max(vrect.left + 4, Math.min(vrect.right - w - 4, left));
        top = Math.max(vrect.top + 4, Math.min(vrect.bottom - h - 4, top));
        settings.barPos = {
          nx: (left - vrect.left) / Math.max(1, vrect.width),
          ny: (top - vrect.top) / Math.max(1, vrect.height),
        };
      } else {
        left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
        top = Math.max(8, Math.min(window.innerHeight - h - 8, top));
        settings.barPos = { left, top };
      }
      bar.style.transform = "none";
      bar.style.bottom = "auto";
      bar.style.left = `${left}px`;
      bar.style.top = `${top}px`;
    };

    const onPointerUp = async (e) => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      try {
        if (e && e.pointerId != null && bar.hasPointerCapture?.(e.pointerId)) {
          bar.releasePointerCapture(e.pointerId);
        }
      } catch (_) {}
      if (resizing) {
        resizing = false;
        resizeStart = null;
        bar.classList.remove("resizing");
        await saveSettings();
        return;
      }
      if (!dragging) return;
      dragging = false;
      bar.classList.remove("dragging");
      await saveSettings();
    };

    bar.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest(".hardsub-dict")) return;
      const resizeEl = e.target.closest(".bar-resize");
      if (resizeEl) {
        resizing = true;
        resizeDir = resizeEl.dataset.dir || "se";
        const br = bar.getBoundingClientRect();
        const w0 = parseFloat(getComputedStyle(bar).getPropertyValue("--bar-box-w0")) || br.width;
        const h0 = parseFloat(getComputedStyle(bar).getPropertyValue("--bar-box-h0")) || br.height;
        resizeStart = {
          scaleW: userBarScaleW(),
          scaleH: userBarScaleH(),
          left: br.left,
          top: br.top,
          boxW: br.width,
          boxH: br.height,
          w0,
          h0,
        };
        startX = e.clientX;
        startY = e.clientY;
        bar.classList.add("resizing");
        try { bar.setPointerCapture(e.pointerId); } catch (_) {}
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Keep token hover / dict clicks and action buttons from starting a drag.
      if (e.target.closest("ruby, .tok, button, .lr-card-actions, .hardsub-bridge-pill")) return;
      dragging = true;
      bar.classList.add("dragging");
      const rect = bar.getBoundingClientRect();
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      try { bar.setPointerCapture(e.pointerId); } catch (_) {}
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      e.preventDefault();
    });
    bar.addEventListener("dblclick", async (e) => {
      if (e.target.closest("ruby, .tok, .bar-resize")) return;
      settings.barPos = null;
      settings.barScale = 1;
      settings.barScaleW = 1;
      settings.barScaleH = 1;
      await saveSettings();
      applyBarPosition();
      toast("Overlay về kích thước & vị trí mặc định");
    });
  }

  function clearDictHideTimer() {
    if (dictHideTimer) {
      clearTimeout(dictHideTimer);
      dictHideTimer = null;
    }
  }

  function clearDictTokActive() {
    if (activeDictTokEl) {
      activeDictTokEl.classList.remove("tok-dict-active");
      activeDictTokEl = null;
    }
    document
      .querySelectorAll("#hardsub-ocr-bar .tok-dict-active")
      .forEach((el) => el.classList.remove("tok-dict-active"));
  }

  function setDictTokActive(el) {
    if (!el) return;
    if (activeDictTokEl && activeDictTokEl !== el) {
      activeDictTokEl.classList.remove("tok-dict-active");
    }
    activeDictTokEl = el;
    el.classList.add("tok-dict-active");
  }

  function isInsideDictOrToken(node) {
    if (!node || node.nodeType !== 1) return false;
    return !!(
      node.closest?.("#hardsub-ocr-dict") ||
      node.closest?.("#hardsub-ocr-bar ruby, #hardsub-ocr-bar .tok")
    );
  }

  let isInteractingWithPopup = false;
  let dictPinnedState = false;

  function hideDictImmediately() {
    clearDictHideTimer();
    const dictEl = document.getElementById("hardsub-ocr-dict");
    if (!dictEl) return;
    dictPinnedState = false;
    isInteractingWithPopup = false;
    dictEl.hidden = true;
    dictEl.style.setProperty("display", "none", "important");
    dictEl.innerHTML = "";
    dictEl.dataset.dictSource = "";
    clearDictTokActive();
  }

  function scheduleHideDict(ms = 1000) {
    clearDictHideTimer();
    dictHideTimer = setTimeout(() => {
      dictHideTimer = null;
      if (dictPinnedState) return;
      const dictEl = document.getElementById("hardsub-ocr-dict");
      if (!dictEl || dictEl.hidden) return;
      if (
        isInteractingWithPopup ||
        dictEl.matches(":hover") ||
        document.querySelector("#hardsub-ocr-bar .tok:hover, #hardsub-ocr-bar ruby:hover")
      ) {
        return;
      }
      hideDictImmediately();
    }, ms);
  }

  function setupBarDict() {
    const dictEl = document.getElementById("hardsub-ocr-dict");
    if (!dictEl || dictEl.dataset.bound) return;
    dictEl.dataset.bound = "1";
    dictEl.addEventListener("pointerenter", () => {
      isInteractingWithPopup = true;
      clearDictHideTimer();
    });
    dictEl.addEventListener("mouseenter", () => {
      isInteractingWithPopup = true;
      clearDictHideTimer();
    });
    dictEl.addEventListener("mouseleave", () => {
      isInteractingWithPopup = false;
      if (!dictPinnedState) {
        scheduleHideDict(400);
      }
    });
  }

  function isPunctuationSurface(surface) {
    return !surface || /^[\s\u3000。、.!?,！？「」『』（）()\[\]…・〜～]+$/.test(surface);
  }

  function placeDictNear(ev, el) {
    const dictEl = document.getElementById("hardsub-ocr-dict");
    if (!dictEl || !el) return;
    const tokRect = el.getBoundingClientRect();
    const bar = el.closest(".hardsub-bar");
    const barRect = bar ? bar.getBoundingClientRect() : tokRect;
    const pad = 10;
    const gap = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const dw = Math.min(dictEl.offsetWidth || 280, vw - pad * 2);
    const dh = dictEl.offsetHeight || 140;

    // Center horizontally over the token, clamped within viewport bounds
    let x = tokRect.left + (tokRect.width - dw) / 2;
    x = Math.max(pad, Math.min(vw - dw - pad, x));

    // Place ABOVE the subtitle bar if room; otherwise place BELOW
    let y = 0;
    if (barRect.top > dh + gap + pad) {
      y = barRect.top - dh - gap;
    } else {
      y = barRect.bottom + gap;
    }
    y = Math.max(pad, Math.min(vh - dh - pad, y));

    dictEl.style.right = "auto";
    dictEl.style.left = `${Math.round(x)}px`;
    dictEl.style.top = `${Math.round(y)}px`;
  }

  /** Side-panel hover: dock to the right edge of the page viewport (left of panel). */
  function placePageDictAtPanelEdge(screenY) {
    const dictEl = document.getElementById("hardsub-ocr-dict");
    if (!dictEl) return;
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const dw = dictEl.offsetWidth || 420;
    const dh = dictEl.offsetHeight || 160;
    const screenTop = window.screenTop ?? window.screenY ?? 0;
    const chromeUi = Math.max(0, (window.outerHeight || 0) - (window.innerHeight || 0));
    let y = Number(screenY);
    if (Number.isFinite(y)) {
      // Absolute screenY → page clientY (toolbar chrome when outer/inner differ).
      const withChrome = y - screenTop - chromeUi;
      const bare = y - screenTop;
      // Prefer chrome-adjusted unless it lands far above the viewport (shared content top).
      y = withChrome >= -40 ? withChrome : bare;
    } else {
      y = pad;
    }
    y = Math.max(pad, Math.min(vh - dh - pad, y));
    // Visual: just left of the Chrome side panel (page viewport right edge).
    dictEl.style.right = "auto";
    dictEl.style.left = `${Math.max(pad, vw - dw - pad)}px`;
    dictEl.style.top = `${y}px`;
  }

  function stripSentenceCtx(text) {
    return stripStubPrefix(text);
  }

  function sentenceBlockHtml(ctx) {
    const vi = stripSentenceCtx(ctx?.sentenceVi);
    const en = stripSentenceCtx(ctx?.sentenceEn);
    const ja = String(ctx?.sentenceJa || "").trim();
    if (!vi && !en && !ja) return "";
    const parts = [];
    if (vi) parts.push(`<div class="dict-sentence-vi">${escapeHtml(vi)}</div>`);
    else if (en) parts.push(`<div class="dict-sentence-en">${escapeHtml(en)}</div>`);
    else parts.push(`<div class="dict-sentence-ja">${escapeHtml(ja)}</div>`);
    if (vi && en) parts.push(`<div class="dict-sentence-en">${escapeHtml(en)}</div>`);
    return `<div class="dict-sep" aria-hidden="true"></div>
      <div class="dict-sentence">${parts.join("")}</div>`;
  }

  function primaryGlossLine(d) {
    const directVi = Array.isArray(d?.glosses_vi) ? d.glosses_vi : [];
    const senses = d?.senses || [];
    const viParts = [...directVi];
    const enParts = [];
    for (const sense of senses.slice(0, 4)) {
      for (const g of sense.gloss_vi || []) {
        if (g && !viParts.includes(g)) viParts.push(g);
      }
      for (const g of sense.gloss_en || []) {
        if (g && !enParts.includes(g)) enParts.push(g);
      }
    }
    return {
      vi: viParts.slice(0, 4).join(", "),
      en: enParts.slice(0, 4).join("; "),
    };
  }

  function glossBlocksHtml(d) {
    const { vi, en } = primaryGlossLine(d);
    if (!vi && !en) return "";
    const parts = [];
    if (vi) {
      parts.push(
        `<div class="dict-gloss-row dict-gloss-vi"><span class="dict-lang">VI</span><span class="dict-gloss">${escapeHtml(vi)}</span></div>`
      );
    }
    if (en) {
      parts.push(
        `<div class="dict-gloss-row dict-gloss-en"><span class="dict-lang">EN</span><span class="dict-gloss">${escapeHtml(en)}</span></div>`
      );
    }
    return `<div class="dict-gloss-block">${parts.join("")}</div>`;
  }

  function dictSentToggleHtml(hasSentence) {
    if (!hasSentence) return "";
    const on = settings.dictShowSentence !== false;
    return `<button type="button" class="dict-sent-toggle" aria-pressed="${on ? "true" : "false"}" title="Hiện/ẩn phần dịch câu"></button>`;
  }

  function bindDictSentenceToggle(dictEl) {
    const btn = dictEl.querySelector(".dict-sent-toggle");
    if (!btn) return;
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const next = !(settings.dictShowSentence !== false);
      settings.dictShowSentence = next;
      btn.setAttribute("aria-pressed", next ? "true" : "false");
      dictEl.classList.toggle("dict-hide-sentence", !next);
      await saveSettings();
    });
  }

  function hasVietnameseChars(str) {
    if (!str || typeof str !== "string") return false;
    return /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(str);
  }

  function formatPosLabel(pos) {
    if (!pos) return "";
    const p = String(pos).toLowerCase();
    if (p.includes("keiyoushi") || p.includes("i-adjective")) return "Tính từ (-i)";
    if (p.includes("keiyodoushi") || p.includes("na-adjective")) return "Tính từ (-na)";
    if (p.includes("futsuumeishi") || p.includes("noun (common)")) return "Danh từ";
    if (p.includes("noun")) return "Danh từ";
    if (p.includes("verb") || p.includes("ichidan") || p.includes("godan") || p.includes("suru")) return "Động từ";
    if (p.includes("fukushi") || p.includes("adverb")) return "Phó từ";
    if (p.includes("particle") || p.includes("joshi")) return "Trợ từ";
    if (p.includes("conjunction") || p.includes("setsuzokushi")) return "Liên từ";
    if (p.includes("pronoun")) return "Đại từ";
    if (p.includes("expression")) return "Cụm từ";
    if (p.includes("prefix")) return "Tiền tố";
    if (p.includes("suffix")) return "Hậu tố";
    return String(pos).replace(/\s*\([^)]*\)/g, "").trim() || pos;
  }

  function renderDictHtml(dictEl, surface, lemma, d, ctx = {}) {
    const showSent = settings.dictShowSentence !== false;
    dictEl.classList.toggle("dict-hide-sentence", !showSent);
    dictEl.classList.add("upgraded-mazii-dict");
    const sentenceHtml = sentenceBlockHtml(ctx);
    const hasSentence = !!sentenceHtml;

    function bindDictClose(dictEl) {
      const btn = dictEl.querySelector(".dict-close-btn");
      if (!btn) return;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        hideDictImmediately();
      });
    }

    if (!d?.found) {
      dictEl.innerHTML = `<div class="dict-top">
          <div class="dict-head-row">
            <strong class="dict-head">${escapeHtml(surface)}</strong>
            <span class="dict-gloss">${escapeHtml(d?.message || "không có trong từ điển")}</span>
          </div>
          <div class="dict-top-actions">
            ${dictSentToggleHtml(hasSentence)}
            <button type="button" class="dict-close-btn" title="Đóng (Esc)">✕</button>
          </div>
        </div>${sentenceHtml}`;
      bindDictSentenceToggle(dictEl);
      bindDictClose(dictEl);
      return;
    }

    const term = d.matched || surface;
    const reading = d.reading || (d.senses?.[0]?.reading || "");
    const hanviet = d.hanviet || "";
    const jlpt = (d.jlpt || ctx?.tokenJlpt || "").toUpperCase();
    const source = d.source || "Mazii JA-VI";
    const markLemma = d.matched || lemma || surface;
    const isPinned = !!ctx?.pinned || dictPinnedState;

    // Badges HTML
    const badges = [];
    if (reading) {
      badges.push(`<span class="dict-reading-top">[${escapeHtml(reading)}]</span>`);
    }
    if (hanviet) {
      badges.push(`<span class="dict-badge-hanviet">${escapeHtml(hanviet)}</span>`);
    }
    if (jlpt) {
      const jlptCls = `dict-badge-jlpt jlpt-${jlpt.toLowerCase()}`;
      badges.push(`<span class="${jlptCls}">${escapeHtml(jlpt)}</span>`);
    }
    if (isPinned) {
      badges.push(`<span class="dict-badge-pinned" title="Popup đã ghim (click lại từ để bỏ ghim)">📌 Đã ghim</span>`);
    }
    badges.push(`<span class="dict-badge-source">${escapeHtml(source)}</span>`);

    // Senses & Primary Meaning calculation
    const senses = d.senses || [];
    const firstViList = (senses[0]?.gloss_vi || []).filter(Boolean);
    const firstEnList = (senses[0]?.gloss_en || []).filter(Boolean);

    let primaryText = "";
    let isPrimaryVi = false;

    if (firstViList.length > 0) {
      primaryText = firstViList.slice(0, 4).join(", ");
      isPrimaryVi = hasVietnameseChars(primaryText);
    }
    if (!primaryText && firstEnList.length > 0) {
      primaryText = firstEnList.slice(0, 3).join("; ");
      isPrimaryVi = false;
    }
    if (!primaryText) {
      const fallback = primaryGlossLine(d);
      if (fallback.vi && hasVietnameseChars(fallback.vi)) {
        primaryText = fallback.vi;
        isPrimaryVi = true;
      } else if (fallback.en || fallback.vi) {
        primaryText = fallback.en || fallback.vi;
        isPrimaryVi = hasVietnameseChars(primaryText);
      }
    }

    // Primary Meaning Banner
    let primaryBannerHtml = "";
    if (primaryText) {
      const bannerLabel = isPrimaryVi ? "Ý NGHĨA CHÍNH (TIẾNG VIỆT)" : "ĐỊNH NGHĨA";
      primaryBannerHtml = `<div class="dict-primary-banner ${isPrimaryVi ? "is-vi" : "is-en"}">
        <div class="dict-primary-label">${escapeHtml(bannerLabel)}</div>
        <div class="dict-primary-text">${escapeHtml(primaryText)}</div>
      </div>`;
    }

    // Check if gloss_vi is duplicated across all senses
    const allViIdentical = senses.length > 1 && senses.every((s) => {
      const sVi = (s.gloss_vi || []).join("; ");
      const s0Vi = (senses[0].gloss_vi || []).join("; ");
      return sVi === s0Vi;
    });

    // Detailed Senses & Definitions HTML
    let sensesHtml = "";
    if (senses.length > 0) {
      const senseRows = [];
      let senseIdx = 0;
      for (const s of senses.slice(0, 4)) {
        senseIdx++;
        const rawPos = (s.pos || []).filter(Boolean)[0] || "";
        const posLabel = formatPosLabel(rawPos);
        const sViRaw = (s.gloss_vi || []).slice(0, 4).join("; ");
        const sEnRaw = (s.gloss_en || []).slice(0, 3).join("; ");
        const sViIsReal = hasVietnameseChars(sViRaw);

        let viToShow = "";
        let enToShow = "";

        if (allViIdentical) {
          // All senses duplicate identical VI; use distinct EN nuances to differentiate
          enToShow = sEnRaw || (sViIsReal ? "" : sViRaw);
        } else {
          if (sViIsReal) {
            viToShow = sViRaw;
            enToShow = sEnRaw;
          } else {
            enToShow = sEnRaw || sViRaw;
          }
        }

        if (!viToShow && !enToShow) continue;

        senseRows.push(`
          <div class="dict-sense-item">
            <span class="dict-sense-num">${senseIdx}</span>
            ${posLabel ? `<span class="dict-pos-badge">${escapeHtml(posLabel)}</span>` : ""}
            <div class="dict-sense-content">
              ${viToShow ? `<div class="dict-sense-vi">${escapeHtml(viToShow)}</div>` : ""}
              ${enToShow ? `<div class="dict-sense-en">${escapeHtml(enToShow)}</div>` : ""}
            </div>
          </div>
        `);
      }
      if (senseRows.length > 0) {
        sensesHtml = `<div class="dict-senses-list">${senseRows.join("")}</div>`;
      }
    }

    // Example sentences HTML (Mazii real example or contextual example)
    let exampleBoxHtml = "";
    if (d.examples && d.examples.length > 0) {
      const ex = d.examples[0];
      exampleBoxHtml = `
        <div class="dict-example-box">
          <div class="dict-example-label">VÍ DỤ THỰC TẾ:</div>
          <div class="dict-example-ja">${escapeHtml(ex.ja)}</div>
          <div class="dict-example-vi">${escapeHtml(ex.vi)}</div>
        </div>
      `;
    }

    dictEl.innerHTML = `
      <div class="dict-top">
        <div class="dict-head-row">
          <strong class="dict-head">${escapeHtml(term)}</strong>
          ${badges.join(" ")}
        </div>
        <div class="dict-top-actions">
          ${dictSentToggleHtml(hasSentence)}
          <button type="button" class="dict-close-btn" title="Đóng (Esc)">✕</button>
        </div>
      </div>
      ${primaryBannerHtml}
      ${sensesHtml}
      ${exampleBoxHtml}
      ${sentenceHtml}
      ${markButtonsHtml(markLemma)}
    `;

    bindDictMarks(dictEl);
    bindDictSentenceToggle(dictEl);
    bindDictClose(dictEl);
  }

  async function fetchAndFillDict(dictEl, surface, lemma, place, ctx = {}) {
    dictEl.hidden = false;
    dictEl.style.removeProperty("display");
    dictEl.classList.toggle("dict-hide-sentence", settings.dictShowSentence === false);
    dictEl.classList.add("upgraded-mazii-dict");
    const sentenceHtml = sentenceBlockHtml(ctx);
    dictEl.innerHTML = `<div class="dict-top">
        <div class="dict-head-row">
          <strong class="dict-head">${escapeHtml(surface)}</strong>
          <span class="dict-badge-source">Mazii JA-VI</span>
        </div>
        <div class="dict-top-actions">
          ${dictSentToggleHtml(!!sentenceHtml)}
          <button type="button" class="dict-close-btn" title="Đóng (Esc)">✕</button>
        </div>
      </div>
      <div class="dict-loading-shimmer">Đang tra từ điển Mazii...</div>
      ${sentenceHtml}`;
    bindDictSentenceToggle(dictEl);
    const closeBtn = dictEl.querySelector(".dict-close-btn");
    if (closeBtn) {
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        hideDictImmediately();
      });
    }
    place();

    const seq = ++dictReqSeq;
    let res = await bridgeFetch("/dict", {
      method: "POST",
      body: { surface, lemma, sentence_id: "" },
    });
    if (!res?.ok) {
      await sleep(100);
      if (seq !== dictReqSeq) return;
      res = await bridgeFetch("/dict", {
        method: "POST",
        body: { surface, lemma, sentence_id: "" },
      });
    }
    if (seq !== dictReqSeq) return;
    if (!res?.ok) {
      dictEl.innerHTML = `<div class="dict-top">
          <div class="dict-head-row">
            <strong class="dict-head">${escapeHtml(surface)}</strong>
            <span class="dict-gloss">Bridge offline</span>
          </div>
          <div class="dict-top-actions">
            ${dictSentToggleHtml(!!sentenceHtml)}
            <button type="button" class="dict-close-btn" title="Đóng (Esc)">✕</button>
          </div>
        </div>${sentenceHtml}`;
      bindDictSentenceToggle(dictEl);
      const cBtn = dictEl.querySelector(".dict-close-btn");
      if (cBtn) {
        cBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          hideDictImmediately();
        });
      }
      place();
      return;
    }
    renderDictHtml(dictEl, surface, lemma, res.data || {}, ctx);
    place();
  }

  async function showBarDict(ev, el) {
    clearDictHideTimer();
    setDictTokActive(el);
    const dictEl = document.getElementById("hardsub-ocr-dict");
    if (!dictEl) return;
    const isTrans = el.classList.contains("tok-trans");
    const clusterSurface = el.dataset?.clusterSurface;
    const clusterLemma = el.dataset?.clusterLemma;
    const surface = (clusterSurface || el.dataset?.surface || (isTrans ? "" : el.textContent) || "").trim();
    const lemma = (clusterLemma || el.dataset?.lemma || surface).trim();
    if (!surface && !lemma) return;
    if (isPunctuationSurface(surface) && !lemma) return;
    dictEl.dataset.dictSource = "bar";
    const cue = getActiveDisplayCue();
    const ctx = {
      sentenceVi: cue?.vi || "",
      sentenceEn: cue?.en || "",
      sentenceJa: cue?.source || "",
    };
    await fetchAndFillDict(dictEl, surface || lemma, lemma || surface, () => placeDictNear(ev, el), ctx);
  }

  async function showPageDictFromSidePanel(msg) {
    clearDictHideTimer();
    const dictEl = document.getElementById("hardsub-ocr-dict");
    if (!dictEl) return;
    if (msg.unpin) {
      dictPinnedState = false;
      const pinnedBadge = dictEl.querySelector(".dict-badge-pinned");
      if (pinnedBadge) pinnedBadge.remove();
      return;
    }
    if (isInteractingWithPopup && !msg.pinned) {
      return;
    }
    if (dictPinnedState && !msg.pinned && !msg.force) {
      return;
    }
    if (msg.pinned) {
      dictPinnedState = true;
    }
    const surface = String(msg.surface || "").trim();
    const lemma = String(msg.lemma || "").trim();
    if (isPunctuationSurface(surface)) return;
    const screenY = Number(msg.screenY ?? msg.anchorScreenY);
    dictEl.dataset.dictSource = "sidepanel";
    const ctx = {
      sentenceVi: msg.sentenceVi || msg.vi || "",
      sentenceEn: msg.sentenceEn || msg.en || "",
      sentenceJa: msg.sentenceJa || msg.source || msg.ja || "",
      tokenJlpt: msg.tokenJlpt || "",
      pinned: !!msg.pinned || dictPinnedState,
    };
    await fetchAndFillDict(
      dictEl,
      surface,
      lemma,
      () => placePageDictAtPanelEdge(screenY),
      ctx
    );
  }

  let barPlayPopoverEl = null;
  function ensureBarPlayPopover() {
    if (barPlayPopoverEl) return barPlayPopoverEl;
    barPlayPopoverEl = document.createElement("div");
    barPlayPopoverEl.id = "hardsub-bar-play-popover";
    barPlayPopoverEl.className = "hardsub-bar-play-popover";
    barPlayPopoverEl.hidden = true;
    document.body.appendChild(barPlayPopoverEl);
    return barPlayPopoverEl;
  }

  function showBarPlayPopover(btn, cue) {
    if (!cue) return;
    const pop = ensureBarPlayPopover();
    const t0 = formatTime(cue.start_media_time);
    const t1 = formatTime(cue.end_media_time);
    const jaHtml = rubyHtml(cue);
    const viText = stripStubPrefix(cue.vi);
    const enText = stripStubPrefix(cue.en);

    pop.innerHTML = `
      <div class="sp-pop-header">
        <span class="sp-pop-badge">▶ Câu hiện tại</span>
        <span class="sp-pop-time">⏱ ${escapeHtml(t0)} – ${escapeHtml(t1)}</span>
      </div>
      <div class="sp-pop-ja">${jaHtml}</div>
      ${viText ? `<div class="sp-pop-vi"><span class="sp-pop-tag">VI</span> ${escapeHtml(viText)}</div>` : `<div class="sp-pop-vi sp-pop-empty"><span class="sp-pop-tag">VI</span> <em>Chưa có bản dịch</em></div>`}
      ${enText ? `<div class="sp-pop-en"><span class="sp-pop-tag">EN</span> ${escapeHtml(enText)}</div>` : ""}
    `;
    pop.hidden = false;

    const rect = btn.getBoundingClientRect();
    const popWidth = Math.min(340, window.innerWidth - 20);
    let left = rect.left;
    if (left + popWidth > window.innerWidth) {
      left = Math.max(10, window.innerWidth - popWidth - 10);
    }
    let top = rect.top - 12 - (pop.offsetHeight || 120);
    if (top < 10) {
      top = rect.bottom + 10;
    }
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  }

  function hideBarPlayPopover() {
    if (barPlayPopoverEl) barPlayPopoverEl.hidden = true;
  }

  function bindBarTokenDict(bar) {
    bar.querySelectorAll(".tok-cluster-wrapper, ruby, .tok, .tok-trans[data-lemma], .tok-trans").forEach((tok) => {
      tok.addEventListener("mouseenter", (e) => {
        clearDictHideTimer();
        const clusterId = tok.dataset?.clusterId;
        const lemma = (tok.dataset?.clusterLemma || tok.dataset?.lemma || "").trim().toLowerCase();
        const surface = (tok.dataset?.clusterSurface || tok.dataset?.surface || "").trim().toLowerCase();

        if (clusterId) {
          bar.querySelectorAll(`[data-cluster-id="${clusterId}"]`).forEach((node) => {
            node.classList.add("tok-cluster-active", "tok-hover-sync");
          });
        }
        if (lemma || surface) {
          const matchedClusterIds = new Set();
          bar.querySelectorAll(".tok-cluster-wrapper, ruby, .tok, .tok-trans").forEach((node) => {
            const nLemma = (node.dataset?.clusterLemma || node.dataset?.lemma || "").trim().toLowerCase();
            const nSurface = (node.dataset?.clusterSurface || node.dataset?.surface || "").trim().toLowerCase();
            if (
              (lemma && (nLemma === lemma || nSurface === lemma)) ||
              (surface && (nSurface === surface || nLemma === surface))
            ) {
              node.classList.add("tok-cluster-active", "tok-hover-sync");
              if (node.dataset?.clusterId) matchedClusterIds.add(node.dataset.clusterId);
            }
          });
          matchedClusterIds.forEach((cId) => {
            bar.querySelectorAll(`[data-cluster-id="${cId}"]`).forEach((node) => {
              node.classList.add("tok-cluster-active", "tok-hover-sync");
            });
          });
        } else {
          tok.classList.add("tok-cluster-active", "tok-hover-sync");
        }

        if (settings.showMiniDict !== false) {
          showBarDict(e, tok);
        }
      });
      tok.addEventListener("mouseleave", () => {
        bar.querySelectorAll(".tok-cluster-active, .tok-hover-sync").forEach((node) => {
          node.classList.remove("tok-cluster-active", "tok-hover-sync");
        });
        scheduleHideDict(400);
      });
      tok.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        showBarDict(e, tok);
      });
    });
  }

  async function togglePictureInPicture() {
    const video =
      document.querySelector("video.html5-main-video") ||
      document.querySelector("video");
    if (!video) {
      toast("Không tìm thấy video để bật PiP");
      return;
    }
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        toast("Đã thoát Picture-in-Picture");
      } else if (document.pictureInPictureEnabled && !video.disablePictureInPicture) {
        await video.requestPictureInPicture();
        toast("Đã bật Picture-in-Picture");
      } else {
        toast("Trình duyệt không hỗ trợ PiP cho video này");
      }
    } catch (err) {
      toast(`PiP: ${err?.message || err}`);
    }
  }

  // Global listeners: close dict on Esc or clicking outside, plus Alt+H and Alt+P shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const dictEl = document.getElementById("hardsub-ocr-dict");
      if (dictEl && !dictEl.hidden) {
        hideDictImmediately();
      }
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      if (e.code === "KeyH" || e.key === "h" || e.key === "H") {
        e.preventDefault();
        void toggleShowOnVideo();
      } else if (e.code === "KeyP" || e.key === "p" || e.key === "P") {
        e.preventDefault();
        void togglePictureInPicture();
      }
    }
  });

  document.addEventListener("click", (e) => {
    const dictEl = document.getElementById("hardsub-ocr-dict");
    if (!dictEl || dictEl.hidden) return;
    if (e.target.closest("#hardsub-ocr-dict") || e.target.closest(".tok, ruby, .sp-sentence, .sp-ja-wrap")) return;
    hideDictImmediately();
  });

  let lastStatusText = "";
  let contentTabId = null;
  let spPublishSeq = 0;
  const spSessionId = `${Date.now()}-${Math.random()}`;

  async function ensureContentTabId() {
    if (contentTabId != null) return contentTabId;
    try {
      if (!chrome?.runtime?.sendMessage) return null;
      const r = await chrome.runtime.sendMessage({ type: "CONTENT_GET_TAB_ID" });
      if (r?.tabId != null) contentTabId = r.tabId;
    } catch (_) {}
    return contentTabId;
  }

  function publishSidePanelState(extra = {}) {
    const st = cacheStats();
    const status =
      lastStatusText ||
      `${sourceLabel()} · cached ${st.cached}/${st.n}${bridgeReady ? "" : " · bridge?"}`;
    const seq = ++spPublishSeq;
    const forceCues = !!extra.forceList || listDirty;
    // Rebuild the sentence engine only when the cues actually changed — a
    // status-only publish must not re-run buildSentenceGroups over every cue.
    if (forceCues) refreshSentenceProjection(listDirty);
    const payload = {
      videoId: currentVideoId,
      status,
      activeCueId,
      captionMode,
      enhancementAvailable: sentenceEnhancementEnabled(),
      audioListeningActive: !!audioListeningActive,
      showOnVideo: !!settings.showOnVideo,
      showFurigana: !!settings.showFurigana,
      bridgeReady: !!bridgeReady,
      vocabLevel: settings.vocabLevel,
      vocabHighlight: settings.vocabHighlight,
      showKnownGreen: settings.showKnownGreen,
      hideRareWords: settings.hideRareWords,
      vocabColors: settings.vocabColors,
      vocabCats: settings.vocabCats,
      levelHighlightEnabled: settings.levelHighlightEnabled !== false,
      levelColors: settings.levelColors,
      userVocab,
      savedCues: Object.values(savedCues || {}),
      scriptSource,
      ...extra,
      _seq: seq,
      _session: spSessionId,
    };
    if (forceCues) {
      payload.enhancedCues = (enhancedCues || []).map((c) => {
        let cand = sentenceCandidates[c.id] || null;
        let hasUndo = !!sentenceUndoRevisions[c.id];
        if (!cand && c.sourceCueId) cand = sentenceCandidates[c.sourceCueId] || null;
        if (!hasUndo && c.sourceCueId) hasUndo = !!sentenceUndoRevisions[c.sourceCueId];
        if (!cand && Array.isArray(c.sourceRefs)) {
          for (const ref of c.sourceRefs) {
            if (sentenceCandidates[ref.cueId]) {
              cand = sentenceCandidates[ref.cueId];
              break;
            }
          }
        }
        if (!hasUndo && Array.isArray(c.sourceRefs)) {
          for (const ref of c.sourceRefs) {
            if (sentenceUndoRevisions[ref.cueId]) {
              hasUndo = true;
              break;
            }
          }
        }
        return {
          ...c,
          candidate: cand,
          hasUndo,
        };
      });
      payload.cues = cues.map((c) => ({
        id: c.id,
        source: c.source,
        en: c.en,
        vi: c.vi,
        tokens: c.tokens || [],
        translated: !!c.translated,
        start_media_time: c.start_media_time,
        end_media_time: c.end_media_time,
        mt_locked: !!c.mt_locked,
        translation_source: c.translation_source || "",
        candidate: sentenceCandidates[c.id] || null,
        hasUndo: !!sentenceUndoRevisions[c.id],
      }));
      listDirty = false;
    }
    ensureContentTabId().then((tabId) => {
      try {
        if (!chrome?.runtime?.sendMessage) return;
        chrome.runtime
          .sendMessage({ type: "SP_STATE", tabId, forceList: !!forceCues, payload })
          .catch(() => {});
      } catch (_) {}
    });
  }

  /** Status/toast only — omit cues so side panel does not rebuild mid-edit. */
  function publishSidePanelPartial(extra = {}) {
    ensureContentTabId().then((tabId) => {
      try {
        if (!chrome?.runtime?.sendMessage) return;
        chrome.runtime
          .sendMessage({
            type: "SP_STATE",
            tabId,
            payload: {
              status: lastStatusText,
              activeCueId,
              bridgeReady: !!bridgeReady,
              savedCues: Object.values(savedCues || {}),
              ...extra,
            },
          })
          .catch(() => {});
      } catch (_) {}
    });
  }

  function setStatus(text) {
    lastStatusText = text || "";
    publishSidePanelPartial();
  }

  function toast(msg) {
    publishSidePanelPartial({ toast: String(msg || "") });
  }

  function applyBarStyle(bar = document.getElementById("hardsub-ocr-bar")) {
    if (!bar) return;
    const bg = Math.max(0, Math.min(1, Number(settings.barBgOpacity) || DEFAULTS.barBgOpacity));
    const fg = Math.max(0, Math.min(1, Number(settings.barTextOpacity) || DEFAULTS.barTextOpacity));
    bar.style.setProperty("--bar-bg-a", String(bg));
    bar.style.setProperty("--bar-fg-a", String(fg));
    bar.classList.toggle("hide-ja", settings.barShowJa === false);
    bar.classList.toggle("hide-en", settings.barShowEn === false);
    bar.classList.toggle("hide-vi", settings.barShowVi === false);
  }

  function applyBarVisibility() {
    ensureUI();
    const bar = document.getElementById("hardsub-ocr-bar");
    const on = !!settings.showOnVideo && currentSource !== "animevietsub";
    document.body.classList.toggle("lr-hide-native-subs", on);
    const navLeft = document.getElementById("lr-nav-left");
    const ctrlRight = document.getElementById("lr-ctrl-right");
    const showCtrl = on && settings.showSubControls !== false && currentSource !== "animevietsub";
    if (navLeft) {
      navLeft.hidden = !showCtrl;
      navLeft.style.display = showCtrl ? "" : "none";
    }
    if (ctrlRight) {
      ctrlRight.hidden = !showCtrl;
      ctrlRight.style.display = showCtrl ? "" : "none";
    }
    if (bar) {
      applyBarStyle(bar);
      if (!on) {
        bar.hidden = true;
        bar.style.setProperty("display", "none", "important");
      } else {
        bar.hidden = !bar.dataset.hasText;
        if (bar.hidden) {
          bar.style.setProperty("display", "none", "important");
        } else {
          bar.style.removeProperty("display");
        }
      }
    }
    syncPlayerToggle();
  }

  function playerToggleLabel() {
    if (currentSource === "animevietsub") return "PANEL";
    return settings.showOnVideo ? "ON" : "OFF";
  }

  function syncPlayerToggle() {
    const btn = document.getElementById(PLAYER_TOGGLE_ID);
    if (!btn) return;
    const on = !!settings.showOnVideo;
    btn.classList.toggle("hardsub-ytp-toggle--on", on);
    btn.classList.toggle("hardsub-ytp-toggle--off", !on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.title = on
      ? "Language Reactor: BẬT (Bấm để tắt, ⚙ cài đặt)"
      : "Language Reactor: TẮT (Bấm để bật, ⚙ cài đặt)";
    btn.setAttribute(
      "aria-label",
      on ? "Language Reactor ON" : "Language Reactor OFF"
    );
    const label = btn.querySelector(".hardsub-ytp-toggle__label");
    if (label) label.textContent = playerToggleLabel();
  }

  async function setShowOnVideo(on, { persist = true, toastMsg = true } = {}) {
    const next = !!on;
    const changed = settings.showOnVideo !== next;
    if (changed) {
      settings.showOnVideo = next;
      if (persist) await saveSettings();
    }
    applyBarVisibility();
    // ON opens panel; OFF only hides overlay (leave side panel open).
    if (next) await openSidePanel();
    if (toastMsg && changed) toast(next ? "Dịch ON" : "Dịch OFF");
    publishSidePanelState();
    return next;
  }

  async function toggleShowOnVideo() {
    return setShowOnVideo(!settings.showOnVideo);
  }

  function openSidePanel() {
    return chrome.runtime
      .sendMessage({ type: "OPEN_SIDE_PANEL" })
      .then((r) => {
        if (r?.ok) {
          pendingOpenSidePanel = false;
          return true;
        }
        pendingOpenSidePanel = true;
        bindGestureOpenSidePanel();
        return false;
      })
      .catch(() => {
        pendingOpenSidePanel = true;
        bindGestureOpenSidePanel();
        return false;
      });
  }

  function bindGestureOpenSidePanel() {
    if (gestureOpenBound) return;
    gestureOpenBound = true;
    const onGesture = () => {
      if (!pendingOpenSidePanel) return;
      openSidePanel();
    };
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (!pendingOpenSidePanel) return;
        const player =
          e.target?.closest?.("#movie_player, ytd-player, #player-container, video");
        if (!player) return;
        onGesture();
      },
      true
    );
  }

  /**
   * autoOpen: try open side panel once per tab session.
   * Does not force overlay ON — overlay defaults off; user toggles DỊCH / Overlay.
   */
  async function maybeAutoOpenOnNavigate() {
    if (!settings.autoOpen) return;
    if (!currentVideoId) return;
    applyBarVisibility();
    if (autoOpenPanelTried) return;
    autoOpenPanelTried = true;
    const opened = await openSidePanel();
    if (!opened) pendingOpenSidePanel = true;
  }

  function scheduleEnsurePlayerToggle() {
    if (playerToggleEnsureScheduled) return;
    playerToggleEnsureScheduled = true;
    requestAnimationFrame(() => {
      playerToggleEnsureScheduled = false;
      ensurePlayerToggle();
    });
  }

  function createPlayerToggleButton(isFloating = false) {
    const btn = document.createElement("button");
    btn.id = PLAYER_TOGGLE_ID;
    btn.type = "button";
    btn.className = isFloating
      ? "hardsub-generic-toggle hardsub-ytp-toggle"
      : "ytp-button hardsub-ytp-toggle";
    btn.setAttribute("aria-label", "Language Reactor");
    btn.innerHTML =
      '<span class="hardsub-ytp-toggle__pill" aria-hidden="true">' +
      '<span class="hardsub-ytp-toggle__badge">LR</span>' +
      '<span class="hardsub-ytp-toggle__label">' + playerToggleLabel() + '</span>' +
      '<span class="hardsub-ytp-toggle__gear" title="Cài đặt">⚙</span></span>';
    const stopBubble = (e) => e.stopPropagation();
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.target && e.target.closest(".hardsub-ytp-toggle__gear")) {
        openSettingsModal();
        return;
      }
      if (currentSource === "animevietsub") {
        await openSidePanel();
        return;
      }
      await toggleShowOnVideo();
    });
    btn.addEventListener("mousedown", stopBubble);
    btn.addEventListener("mouseup", stopBubble);
    btn.addEventListener("pointerdown", stopBubble);
    return btn;
  }

  let toggleActivityTimer = null;
  function pingToggleActivity() {
    const btn = document.getElementById(PLAYER_TOGGLE_ID);
    if (!btn || !btn.classList.contains("hardsub-generic-toggle")) return;
    btn.classList.add("force-visible");
    if (toggleActivityTimer) clearTimeout(toggleActivityTimer);
    toggleActivityTimer = setTimeout(() => {
      btn.classList.remove("force-visible");
    }, 2800);
  }

  /** Compact DỊCH ON/OFF pill in player controls or floating over video player. */
  function ensurePlayerToggle() {
    let btn = document.getElementById(PLAYER_TOGGLE_ID);

    // 1. YouTube player left controls
    const ytLeft = document.querySelector(
      "#movie_player .ytp-left-controls, ytd-player .ytp-left-controls, .ytp-left-controls"
    );
    if (ytLeft) {
      if (btn && ytLeft.contains(btn) && !btn.classList.contains("hardsub-generic-toggle")) {
        syncPlayerToggle();
        return true;
      }
      if (btn) btn.remove();
      btn = createPlayerToggleButton(false);
      const timeDisplay = ytLeft.querySelector(".ytp-time-display");
      if (timeDisplay) timeDisplay.insertAdjacentElement("afterend", btn);
      else ytLeft.appendChild(btn);
      syncPlayerToggle();
      return true;
    }

    // 2. Non-YouTube: Netflix / ABEMA / AnimeVietSub / generic HTML5 video (Language Reactor style floating left toggle)
    const video =
      document.querySelector("video.html5-main-video") || document.querySelector("video");
    const isAvs = currentSource === "animevietsub";
    if (!video && !isAvs) return false;

    const container =
      (isAvs && (document.querySelector("#media-player-box") || document.querySelector("#media-player") || document.querySelector(".media-player") || document.querySelector(".player-wrapper") || document.querySelector("iframe[src*='stream.googleapiscdn.com']")?.parentElement)) ||
      document.querySelector(".watch-video") ||
      document.querySelector(".NFPlayer") ||
      document.querySelector("[class*='player-container']") ||
      document.querySelector("[class*='com-vod-']") ||
      video?.parentElement ||
      document.body;

    if (!container) return false;

    if (btn && container.contains(btn) && btn.classList.contains("hardsub-generic-toggle")) {
      // Netflix: bám sát nút report mỗi lần đồng bộ (layout có thể thay đổi).
      if (currentSource === "netflix") positionNetflixToggleNextToReport(btn, container);
      syncPlayerToggle();
      return true;
    }
    if (btn) btn.remove();

    btn = createPlayerToggleButton(true); // Always generic floating toggle on non-YouTube
    if (currentSource === "netflix") {
      // Nút DỊCH ở vùng đen phía trên video, cạnh nút report (top-right).
      btn.classList.add("hardsub-generic-toggle--netflix");
      positionNetflixToggleNextToReport(btn, container);
    }
    container.appendChild(btn);
    syncPlayerToggle();
    return true;
  }

  /** Netflix: đặt nút DỊCH cạnh nút report (góc trên phải player). */
  function positionNetflixToggleNextToReport(btn, container) {
    if (!container) return;
    const setPos = (top, right) => {
      // setProperty(..., "important") để thắng CSS !important của base toggle.
      btn.style.setProperty("top", `${top}px`, "important");
      btn.style.setProperty("right", `${right}px`, "important");
      btn.style.setProperty("left", "auto", "important");
    };
    const report = document.querySelector(
      '[data-uia="player-report-modal-button"], [data-uia="report-modal-button"], ' +
        'button[aria-label*="report" i], .button-nfplayerReportAProblem, .button-nfplayerFlag, [class*="nfplayerFlag" i]'
    );
    const h = container.getBoundingClientRect();
    if (!report) {
      // Fallback: góc trên phải player (report chưa mount / selector đổi).
      setPos(12, 64);
      return;
    }
    const r = report.getBoundingClientRect();
    const gap = 10;
    setPos(
      Math.max(8, r.top - h.top + (r.height - (btn.offsetHeight || 32)) / 2),
      Math.max(8, h.right - r.left + gap)
    );
  }

  function ensurePlayerToggleObserver() {
    const target =
      document.querySelector("#movie_player") ||
      document.querySelector("ytd-player") ||
      document.querySelector(".watch-video") ||
      document.querySelector(".NFPlayer") ||
      document.querySelector("#media-player-box") ||
      document.querySelector("#media-player") ||
      document.body;
    if (playerToggleObserver) playerToggleObserver.disconnect();
    playerToggleObserver = new MutationObserver(() => {
      const btn = document.getElementById(PLAYER_TOGGLE_ID);
      const ytLeft = document.querySelector(".ytp-left-controls");
      const video = document.querySelector("video");
      const isAvs = currentSource === "animevietsub";
      if (
        (ytLeft && (!btn || !ytLeft.contains(btn))) ||
        (!ytLeft && (video || isAvs) && (!btn || !btn.classList.contains("hardsub-generic-toggle")))
      ) {
        scheduleEnsurePlayerToggle();
      }
    });
    playerToggleObserver.observe(target, { childList: true, subtree: true });
    ensurePlayerToggle();
  }

  function applyDim() {
    const dim = document.getElementById("hardsub-dim");
    if (!dim) return;
    dim.hidden = !settings.dimHardsub;
  }

  function rubyHtml(cue) {
    if (Vocab && typeof Vocab.renderRubyHtml === "function") {
      return Vocab.renderRubyHtml(cue, {
        showFurigana: settings.showFurigana,
        settings,
        userVocab,
      });
    }
    return escapeHtml(cue?.source || "");
  }

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function escapeAttr(s) {
    return escapeHtml(s);
  }

  function stripStubPrefix(text) {
    return String(text || "")
      .replace(/^\[(vi|en)\]\s*/i, "")
      .trim();
  }

  function formatCopy(cue, format) {
    const furi = (cue.tokens || [])
      .map((t) => (t.reading ? `${t.surface}(${t.reading})` : t.surface))
      .join("");
    const fmt = format || settings.copyFormat;
    const vi = stripStubPrefix(cue.vi);
    const en = stripStubPrefix(cue.en);
    if (fmt === "ja") return cue.source;
    if (fmt === "vi") return vi;
    if (fmt === "ja_vi") return `JA: ${cue.source}\nVI: ${vi}`;
    return `JA: ${cue.source}\n   (${furi || cue.source})\nEN: ${en}\nVI: ${vi}`;
  }

  function formatTime(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  }

  function cacheStats() {
    const n = cues.length;
    let cached = 0;
    for (const c of cues) {
      if (c.translated) cached += 1;
    }
    return { n, cached, pending: 0, translating: translatingIds.size };
  }

  function updateCaptionStatusLine() {
    const st = cacheStats();
    const tag = sourceLabel();
    const capTag =
      captionsStatus === "ok"
        ? `${tag} · ${captionsInfo}`
        : captionsStatus === "loading"
          ? `${tag}…`
          : captionsStatus === "none" || captionsStatus === "error"
            ? `${tag} ${captionsInfo || captionsStatus}`
            : tag;
    const readyTag = bridgeReady ? "" : " · bridge?";
    lastStatusText = `${capTag} · ${st.n} cues${readyTag}`;
    // Keep listDirty — publishSidePanelState includes cues only when dirty.
    publishSidePanelState();
  }

  function swOk(sw) {
    return !!(sw?.ok && Array.isArray(sw.cues) && sw.cues.length);
  }

  function swUsable(sw) {
    return !!(
      sw?.ok &&
      (swOk(sw) ||
        (Array.isArray(sw.enCues) && sw.enCues.length) ||
        (Array.isArray(sw.viCues) && sw.viCues.length))
    );
  }

  /** Intercept body is only JA when timedtext URL lang is ja* — never trust pageLink.lang. */
  function interceptIsJa(pageLink) {
    return !!(pageLink?.cues?.length && isJaLang(langFromTimedtextUrl(pageLink.baseUrl)));
  }

  async function loadAllCaptions(force = false, opts = {}) {
    if (!currentVideoId) {
      currentVideoId = videoIdFromUrl();
    }
    const gen = navigateGen;
    const vid = currentVideoId;
    const stale = () => gen !== navigateGen || currentVideoId !== vid;

    if (!currentVideoId) {
      captionsStatus = "none";
      captionsInfo = "no_video_id";
      cues = [];
      listDirty = true;
      renderList(true);
      updateCaptionStatusLine();
      return;
    }
    // Once-per-videoId: reuse loaded cues unless force (Reload / wipe / navigate).
    if (
      !force &&
      !opts.skipCache &&
      captionsStatus === "ok" &&
      cues.length > 0
    ) {
      updateCaptionStatusLine();
      return;
    }
    // AnimeVietSub: fetch script from Jimaku.cc via Service Worker.
    if (currentSource === "animevietsub") {
      captionsStatus = "loading";
      captionsInfo = "Đang tải script tiếng Nhật...";
      updateCaptionStatusLine();
      await loadAnimeVietsubCues(!!force);
      if (stale()) return;
      if (cues.length) await syncToPlayhead();
      else updateBar(null);
      updateCaptionStatusLine();
      return;
    }
    // Non-YouTube players: read native subtitle cues from the page.
    if (currentSource !== "youtube") {
      captionsStatus = "loading";
      captionsInfo = "";
      updateCaptionStatusLine();
      await loadPageCues(!!force);
      if (stale()) return;
      if (cues.length) await syncToPlayhead();
      else updateBar(null);
      updateCaptionStatusLine();
      return;
    }
    const skipCache = !!opts.skipCache;
    const applyOpts = skipCache ? { skipCache: true } : {};
    const swApplyOpts = (sw) => ({
      ...applyOpts,
      fromSw: true,
      enCues: sw?.enCues,
      viCues: sw?.viCues,
      sourceTrack: sw?.sourceTrack,
    });
    const swLabel = (sw) =>
      swOk(sw)
        ? `${sw.lang || "?"}${sw.asr ? " auto" : ""} · ${sw.count || sw.cues.length} cues`
        : `secondary · en:${sw?.enCues?.length || 0} vi:${sw?.viCues?.length || 0}`;

    captionsStatus = "loading";
    captionsInfo = "";
    updateCaptionStatusLine();

    let pageLink = null;
    // Parallel path 1: Background SW cascade
    const swPromise =
      opts.swPromise ||
      loadCaptionsViaBackground(currentVideoId, settings.sourceLang, {
        baseUrl: "",
        lang: settings.sourceLang,
        force: !!force,
      });
    // The page-world multi-lang fetch is the only path that survives empty WEB
    // timedtext bodies: it falls back to ANDROID Innertube and takes 2.7–10 s
    // (measured live 2026-10-24). The SW cascade can also hang when its worker
    // stops responding, so both await points need a real budget.
    const MULTI_TIMEOUT_MS = 15000;
    const SW_TIMEOUT_MS = 12000;
    const swTimed = () => Promise.race([swPromise, sleep(SW_TIMEOUT_MS).then(() => null)]);

    // Parallel path 2: Direct in-page player 3-track concurrent fetch (JA, EN, VI)
    const multiPromise = (async () => {
      try {
        if (!pageBridgeReady) await waitForPageBridge(200);
        if (pageBridgeReady) {
          return await pageCall("FETCH_MULTI_LANG_CAPTIONS", { videoId: currentVideoId, lang: settings.sourceLang }, MULTI_TIMEOUT_MS);
        }
      } catch (_) {}
      return null;
    })();

    // T1: whichever resolves first with valid cues paints immediately
    const fastPack = await Promise.race([
      multiPromise.then((r) => (r?.ok && r.cues?.length ? { source: "multi", data: r } : new Promise(() => {}))),
      swPromise.then((r) => (swOk(r) ? { source: "sw", data: r } : new Promise(() => {}))),
      sleep(800).then(() => null),
    ]);

    if (stale()) return;

    if (fastPack?.source === "multi") {
      const multi = fastPack.data;
      await applyLoadedCues(multi.cues, multi.via || "page_multi", {
        ...applyOpts,
        enCues: multi.enCues,
        viCues: multi.viCues,
        sourceTrack: multi.sourceTrack,
      });
      if (stale()) return;
      return;
    }

    if (fastPack?.source === "sw") {
      const sw = fastPack.data;
      await applyLoadedCues(sw.cues || [], swLabel(sw), swApplyOpts(sw));
      if (stale()) return;
      kickSecondaryFill(sw);
      return;
    }

    // Fast window only catches warm paths. On YouTube the WEB timedtext URLs
    // return HTTP 200 with an empty body, and the page-world fetch needs
    // seconds to fall back to ANDROID Innertube. Await it for real before
    // falling through to the WEB-only paths that are known-empty.
    if (!fastPack) {
      const late = await Promise.race([
        multiPromise,
        sleep(MULTI_TIMEOUT_MS).then(() => null),
      ]);
      if (stale()) return;
      if (late?.ok && late.cues?.length) {
        await applyLoadedCues(late.cues, late.via || "page_multi", {
          ...applyOpts,
          enCues: late.enCues,
          viCues: late.viCues,
          sourceTrack: late.sourceTrack,
        });
        if (stale()) return;
        return;
      }
    }

    const ready =
      opts.bridgeReady === true
        ? true
        : opts.bridgeReady === false
          ? false
          : await Promise.race([
              waitForPageBridge(1500),
              swPromise.then(
                (r) => (swUsable(r) ? "sw" : new Promise(() => {})),
                () => new Promise(() => {})
              ),
            ]);
    if (stale()) return;

    if (ready === "sw") {
      const sw = await swTimed();
      if (stale()) return;
      if (swOk(sw)) {
        await applyLoadedCues(sw.cues || [], swLabel(sw), swApplyOpts(sw));
        if (stale()) return;
        kickSecondaryFill(sw);
        return;
      }
    }

    if (ready === true) {
      pageLink = await pageCall(
        "GET_TIMEDTEXT_LINK",
        { videoId: currentVideoId, lang: settings.sourceLang },
        800
      );
      if (stale()) return;
      // Early-win only when URL lang is ja* — then kick secondary async.
      if (interceptIsJa(pageLink)) {
        await applyLoadedCues(
          pageLink.cues,
          `ja intercept · ${pageLink.cues.length} cues`,
          applyOpts
        );
        if (stale()) return;
        kickSecondaryFill(await swTimed());
        return;
      }

      let swEarly = null;
      swPromise.then((r) => {
        swEarly = r;
      });
      const raceDeadline = Date.now() + 700;
      while (Date.now() < raceDeadline) {
        if (stale()) return;
        // The page already reported a capture for this video: the push handler
        // owns it, so re-issuing the same RPC cannot add anything.
        if (pageCaptureVideoId && pageCaptureVideoId === currentVideoId) break;
        if (swUsable(swEarly)) {
          // Paint JA ASAP; EN/VI fill async (do not await full pack).
          if (swOk(swEarly)) {
            await applyLoadedCues(
              swEarly.cues || [],
              swLabel(swEarly),
              swApplyOpts(swEarly)
            );
          }
          if (stale()) return;
          kickSecondaryFill(swEarly);
          if (swOk(swEarly)) return;
          break;
        }
        await sleep(120);
        pageLink = await pageCall(
          "GET_TIMEDTEXT_LINK",
          { videoId: currentVideoId, lang: settings.sourceLang },
          400
        );
        if (stale()) return;
        if (interceptIsJa(pageLink)) {
          await applyLoadedCues(
            pageLink.cues,
            `ja intercept · ${pageLink.cues.length} cues`,
            applyOpts
          );
          if (stale()) return;
          kickSecondaryFill(await swTimed());
          return;
        }
      }
    }

    let sw = await swTimed();
    if (stale()) return;
    if (!swUsable(sw) && pageLink?.baseUrl) {
      const urlLang = langFromTimedtextUrl(pageLink.baseUrl);
      sw = await loadCaptionsViaBackground(currentVideoId, settings.sourceLang, {
        baseUrl: pageLink.baseUrl,
        asr: !!pageLink.asr,
        lang: urlLang || pageLink.lang || settings.sourceLang,
      });
      if (stale()) return;
    }
    if (swUsable(sw)) {
      if (swOk(sw)) {
        await applyLoadedCues(sw.cues || [], swLabel(sw), swApplyOpts(sw));
        if (stale()) return;
      }
      kickSecondaryFill(sw);
      if (swOk(sw)) return;
    }

    if (ready === true) {
      // Prefer page multi-fetch (no setOption per lang) before LOAD_CAPTIONS CC path.
      const multi = await pageCall(
        "FETCH_MULTI_LANG",
        { videoId: currentVideoId, lang: settings.sourceLang },
        MULTI_TIMEOUT_MS
      );
      if (stale()) return;
      if (Array.isArray(multi?.cues) && multi.cues.length) {
        await applyLoadedCues(
          multi.cues,
          `ja page · ${multi.cues.length} cues`,
          { ...applyOpts, sourceTrack: multi.sourceTrack }
        );
        if (stale()) return;
        kickSecondaryFill({
          ...(sw || {}),
          enCues: multi.enCues,
          viCues: multi.viCues,
          hasEn: multi.hasEn,
          hasVi: multi.hasVi,
        });
        return;
      }

      const r = await pageCall(
        "LOAD_CAPTIONS",
        { videoId: currentVideoId, lang: settings.sourceLang, force: !!force },
        8000
      );
      if (stale()) return;
      const pageLang = langFromTimedtextUrl(r?.baseUrl) || r?.lang || "";
      if (
        r?.ok &&
        r.status === "ok" &&
        Array.isArray(r.cues) &&
        r.cues.length &&
        isJaLang(pageLang)
      ) {
        await applyLoadedCues(
          r.cues,
          `ja${r.asr ? " auto" : ""} · ${r.count || r.cues.length} cues`,
          { ...applyOpts, sourceTrack: r.sourceTrack }
        );
        if (stale()) return;
        kickSecondaryFill(sw);
        return;
      }
      if (r?.baseUrl && isJaLang(langFromTimedtextUrl(r.baseUrl) || r.lang)) {
        const rescued = await fetchTimedtextInContent(r.baseUrl);
        if (stale()) return;
        if (rescued?.length) {
          await applyLoadedCues(
            rescued,
            `ja rescue · ${rescued.length} cues`,
            applyOpts
          );
          if (stale()) return;
          kickSecondaryFill(sw);
          return;
        }
      }
      if (!cues.length) {
        const swFallback = await swTimed();
        if (swOk(swFallback)) {
          await applyLoadedCues(
            swFallback.cues || [],
            swLabel(swFallback),
            swApplyOpts(swFallback)
          );
          if (stale()) return;
          kickSecondaryFill(swFallback);
          return;
        }
      }
      captionsStatus = r?.status || sw?.status || "none";
      captionsInfo = sw?.reason || r?.reason || r?.message || "empty";
      // Last resort: bridge-cached captions (silent when endpoint misses).
      const bridged = await fetchCaptionsFromBridge(
        currentVideoId,
        settings.sourceLang,
      );
      if (stale()) return;
      if (bridged) {
        await applyLoadedCues(
          bridged,
          `YT·bridge · ${bridged.length} cues`,
          applyOpts,
        );
        if (stale()) return;
        kickSecondaryFill(sw);
        return;
      }
      if (sw?.hasEn || sw?.hasVi) {
        stampSecondaryStatus(
          Array.isArray(sw.enCues) ? sw.enCues.length : 0,
          Array.isArray(sw.viCues) ? sw.viCues.length : 0
        );
        logYtSecondaryMiss(
          { ...sw, bridge: "miss" },
          Array.isArray(sw.enCues) ? sw.enCues.length : 0,
          Array.isArray(sw.viCues) ? sw.viCues.length : 0
        );
        kickSecondaryFill(sw);
      } else {
        logYtSecondaryMiss({ ...sw, bridge: "miss" }, 0, 0);
      }
    } else {
      captionsStatus = "none";
      captionsInfo = sw?.reason || "page_bridge_timeout";
    }

    // Prefer previously saved script over empty session (reload / bridge race).
    // Hard wipe must not resurrect disk/chrome script.
    if (!skipCache && (await tryApplySavedScript("script"))) return;
    if (stale()) return;

    cues = [];
    listDirty = true;
    renderList(true);
    updateCaptionStatusLine();
    toast(
      captionsInfo === "timedtext_empty" || captionsInfo === "empty_or_html"
        ? "Có track nhưng tải caption lỗi — bấm Reload"
        : captionsInfo === "no_tracks"
          ? "Không thấy track caption"
          : `Caption: ${captionsInfo}`
    );
  }

  async function syncHealth() {
    const res = await bridgeFetch("/health");
    if (!res?.ok) {
      bridgeReady = false;
      setStatus("bridge offline");
      return;
    }
    const h = res.data;
    const wasReady = bridgeReady;
    bridgeReady = !!h.ready;
    const boot = h.bootstrap;
    if (boot && !boot.done && boot.stage !== "idle") {
      setStatus(`bootstrap ${Math.round(boot.percent || 0)}%`);
    } else {
      updateCaptionStatusLine();
    }
    // B8: retry tokenize when bridge comes ready after JA already painted.
    if (!wasReady && bridgeReady && cues.some((c) => Vocab.tokensNeedEnrich(c))) {
      void enrichTokensAfterImport();
    }
  }

  function renderList(force = false) {
    if (!force && !listDirty) return;
    // forceList so cues ship even if a prior caller cleared listDirty.
    publishSidePanelState({ forceList: true });
  }

  function patchCueRow(_idx) {
    listDirty = true;
    renderList(true);
    updateCaptionStatusLine();
  }

  const Timing = globalThis.HardsubCueTiming || {
    applyManualTimes: (c, a, b) => {
      c.start_media_time = Number(a) || 0;
      c.end_media_time = Number(b) || c.start_media_time;
      return { start: c.start_media_time, end: c.end_media_time };
    },
    parseTimeInput: (s) => Number(s),
    formatTimeInput: (s) => String(s),
    MIN_DUR: 0.45,
  };

  function neighborCues(idx) {
    return {
      prevCue: idx > 0 ? cues[idx - 1] : null,
      nextCue: idx < cues.length - 1 ? cues[idx + 1] : null,
    };
  }

  /**
   * Cue index for a side-panel command, or -1 when the target does not exist.
   * An out-of-range index must never reach the edit handlers: they would
   * silently do nothing while the panel is told the edit succeeded.
   */
  function resolveCueIndex(msg) {
    if (msg?.id) {
      const i = cues.findIndex((c) => c.id === msg.id);
      if (i >= 0) return i;
    }
    const idx = Number(msg?.idx);
    if (!Number.isInteger(idx) || idx < 0 || idx >= cues.length) return -1;
    return idx;
  }

  /**
   * One text normalization for every write path (manual edit AND import), so
   * the same EN/VI line can never end up as two variants of one `text_source`.
   */
  function normalizeCueText(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function findCueIndexById(id) {
    return cues.findIndex((c) => c.id === id);
  }

  async function onJaEdit(idx, text) {
    const cue = cues[idx];
    if (!cue) return;
    const next = normalizeCueText(text);
    // Allow empty source for draft cues (persist); skip tokenize when empty.
    if (next === cue.source && cue.tokens?.length) {
      publishSidePanelState();
      return;
    }
    cue.source = next;
    cue.text_source = "edit";
    // Timeline stays YouTube / import / manual — do not retime from text length.
    // JA changed: re-tokenize for furigana, but keep user/import EN/VI.
    // (Previously this auto-cleared EN/VI + unlocked translation, which removed
    // the translation when you edited script.)
    cue.tokens = [];
    cue._txGen = (cue._txGen || 0) + 1;
    listDirty = true;
    await markScriptOwned();
    scheduleSaveTranscript();
    publishSidePanelState();
    updateCaptionStatusLine();

    if (!next) {
      patchCueRow(idx);
      return;
    }

    const trackId = cue.id;
    translatingIds.add(trackId);
    try {
      await enrichTokensAfterImport(new Set([cue.id]));
    } finally {
      translatingIds.delete(trackId);
      updateCaptionStatusLine();
      publishSidePanelState({ forceList: true });
      // Re-render overlay furigana/JLPT immediately after tokenization.
      updateBar(getActiveDisplayCue() || cue);
    }
    patchCueRow(idx);
  }

  async function onEnEdit(idx, text) {
    const cue = cues[idx];
    if (!cue) return;
    const next = normalizeCueText(text);
    const prev = String(cue.en || "");
    if (next === prev) {
      publishSidePanelState();
      return;
    }
    cue.en = next;
    cue.text_source = "edit";
    const hasMt = !!(next || String(cue.vi || "").trim());
    cue.translated = hasMt;
    // EN Enter = persist only. Lock so import merge cannot overwrite casually.
    if (hasMt) lockCueTranslation(cue, "user");
    else unlockCueTranslation(cue);
    cue._txGen = (cue._txGen || 0) + 1;
    listDirty = true;
    await markScriptOwned();
    scheduleSaveTranscript();
    patchCueRow(idx);
    updateBar(getActiveDisplayCue() || cue);
  }

  async function onViEdit(idx, text) {
    const cue = cues[idx];
    if (!cue) return;
    const next = normalizeCueText(text);
    const prev = String(cue.vi || "");
    if (next === prev) {
      publishSidePanelState();
      return;
    }
    cue.vi = next;
    cue._txGen = (cue._txGen || 0) + 1;
    cue.text_source = "edit";
    const hasMt = !!(next || String(cue.en || "").trim());
    cue.translated = hasMt;
    // VI Enter = persist only. Lock so import merge cannot overwrite casually.
    if (hasMt) lockCueTranslation(cue, "user");
    else unlockCueTranslation(cue);
    listDirty = true;
    await markScriptOwned();
    scheduleSaveTranscript();
    patchCueRow(idx);
    updateBar(getActiveDisplayCue() || cue);
  }

  async function onTimelineEdit(idx, startRaw, endRaw) {
    const cue = cues[idx];
    if (!cue) return;
    const start =
      typeof startRaw === "number"
        ? startRaw
        : Timing.parseTimeInput(startRaw);
    const end =
      typeof endRaw === "number" ? endRaw : Timing.parseTimeInput(endRaw);
    const { prevCue, nextCue } = neighborCues(idx);
    Timing.applyManualTimes(cue, start, end, { prevCue, nextCue });
    cue.text_source = "edit";
    listDirty = true;
    await markScriptOwned();
    scheduleSaveTranscript();
    patchCueRow(idx);
    updateBar(getActiveDisplayCue() || null);
  }

  async function addCue({ afterId = "", atTime } = {}) {
    let insertAt = cues.length;
    let start = Number(atTime);
    const fromAfter = !!afterId;
    if (afterId) {
      const afterIdx = findCueIndexById(afterId);
      if (afterIdx >= 0) {
        insertAt = afterIdx + 1;
        const prev = cues[afterIdx];
        start = Number(prev.end_media_time) || Number(prev.start_media_time) || 0;
      }
    }
    if (!Number.isFinite(start)) {
      try {
        const mtRes = await pageCall("GET_MEDIA_TIME", {}, 400);
        start = Number(mtRes?.mediaTime);
      } catch (_) {
        start = NaN;
      }
    }
    if (!Number.isFinite(start)) {
      const last = cues[cues.length - 1];
      start = last ? Number(last.end_media_time) || 0 : 0;
    }

    // "+ Cue" at playhead: insert chronologically (not always append at list end).
    if (!fromAfter) {
      insertAt = cues.findIndex((c) => (Number(c.start_media_time) || 0) > start);
      if (insertAt < 0) insertAt = cues.length;
    }

    let prevCue = insertAt > 0 ? cues[insertAt - 1] : null;
    let nextCue = insertAt < cues.length ? cues[insertAt] : null;
    // Playhead inside an existing cue → place after that cue instead.
    if (!fromAfter && prevCue) {
      const pStart = Number(prevCue.start_media_time) || 0;
      const pEnd = Number(prevCue.end_media_time) || pStart;
      if (start >= pStart && start < pEnd) {
        start = pEnd;
        insertAt = cues.indexOf(prevCue) + 1;
        nextCue = insertAt < cues.length ? cues[insertAt] : null;
      }
    }

    const minDur = Timing.MIN_DUR || 0.45;
    const id = newStableCueId();
    const cue = {
      id,
      start_media_time: start,
      end_media_time: start + minDur + 1.2,
      source: "",
      en: "",
      vi: "",
      tokens: [],
      translated: false,
      text_source: "manual",
    };
    Timing.applyManualTimes(cue, cue.start_media_time, cue.end_media_time, {
      prevCue,
      nextCue,
    });
    cues.splice(insertAt, 0, cue);
    activeCueId = id;
    listDirty = true;
    await markScriptOwned();
    scheduleSaveTranscript();
    publishSidePanelState();
    updateCaptionStatusLine();
    updateBar(cue);
    toast("Đã thêm cue");
    return cue;
  }

  async function deleteCueById(id) {
    if (!id) return false;
    const idx = findCueIndexById(id);
    if (idx < 0) return false;
    const cue = cues[idx];
    const stone = tombstoneKey(cue);
    if (stone && !transcriptMeta.tombstones.includes(stone)) {
      transcriptMeta.tombstones.push(stone);
    }
    translatingIds.delete(cue.id);
    cues.splice(idx, 1);
    if (activeCueId === id) {
      const neighbor = cues[idx] || cues[idx - 1] || null;
      activeCueId = neighbor?.id || "";
      updateBar(neighbor);
    }
    listDirty = true;
    await markScriptOwned();
    await saveTranscriptMeta();
    scheduleSaveTranscript();
    publishSidePanelState();
    updateCaptionStatusLine();
    toast("Đã xóa cue");
    return true;
  }

  async function copyCue(idx, format) {
    const cue = cues[idx];
    if (!cue) return false;
    const text = formatCopy(cue, format);
    try {
      await navigator.clipboard.writeText(text);
      toast("Đã sao chép");
      return true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.documentElement.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        toast(ok ? "Đã sao chép" : "Copy thất bại");
        return !!ok;
      } catch {
        toast("Copy thất bại");
        return false;
      }
    }
  }

  function barCueFingerprint(cue) {
    if (!cue) return "";
    const showJa = settings.barShowJa !== false ? "1" : "0";
    const showEn = settings.barShowEn !== false ? "1" : "0";
    const showVi = settings.barShowVi !== false ? "1" : "0";
    const en = stripStubPrefix(cue.en);
    const vi = stripStubPrefix(cue.vi);
    const furigana = settings.showFurigana ? 1 : 0;
    const starred = isCueStarred(cue.id) ? 1 : 0;
    const tokKey = (cue.tokens || [])
      .map((t) => `${t.surface || ""}|${t.reading || ""}|${t.jlpt || ""}|${t.lemma || ""}`)
      .join(",");
    return [
      cue.id,
      cue.source || "",
      JSON.stringify(cue.translationStates || {}),
      en,
      vi,
      tokKey,
      showJa,
      showEn,
      showVi,
      furigana,
      starred,
    ].join("\0");
  }

  function recordSentencePaint(bar, cue) {
    const trace = sentenceBenchmark;
    if (!trace || settings.barShowJa === false || !cue.source || !settings.showOnVideo || document.hidden) return;
    requestAnimationFrame(() => {
      if (trace !== sentenceBenchmark || document.hidden || settings.barShowJa === false || !settings.showOnVideo ||
          !bar.isConnected || getComputedStyle(bar).display === "none") return;
      if (getComputedStyle(bar).visibility === "hidden" || Number(getComputedStyle(bar).opacity) === 0 || settings.barTextOpacity === 0) return;
      const rect = bar.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= window.innerHeight || rect.left >= window.innerWidth) return;
      trace.paint(performance.now(), { width: rect.width, height: rect.height, top: rect.top, left: rect.left });
    });
  }
  function updateBar(cue) {
    if (captionMode === "enhanced" && cue && !cue.enhanced) cue = findActiveCue(currentMediaTime);
    ensureUI();
    const bar = document.getElementById("hardsub-ocr-bar");
    if (!bar) return;
    if (!cue) {
      lastBarFingerprint = "";
      clearDictTokActive();
      bar.dataset.hasText = "";
      bar.hidden = true;
      bar.style.setProperty("display", "none", "important");
      const wrap = bar.querySelector(".lr-overlay-wrap");
      if (wrap) {
        wrap.innerHTML = "";
      } else {
        bar.innerHTML = "";
        ensureBarResizeHandle(bar);
      }
      return;
    }
    const fp = barCueFingerprint(cue);
    // Same cue content: skip innerHTML rebuild so hover dict nodes stay alive.
    if (fp === lastBarFingerprint && bar.dataset.hasText === "1") {
      Vocab.applyHighlightVars(bar, settings);
      applyBarStyle(bar);
      applyBarPosition();
      applyBarVisibility();
      recordSentencePaint(bar, cue);
      return;
    }
    lastBarFingerprint = fp;
    bar.dataset.hasText = "1";
    bar.classList.add("lr-bar-container");
    Vocab.applyHighlightVars(bar, settings);
    applyBarStyle(bar);
    const starred = isCueStarred(cue.id);
    const showJa = settings.barShowJa !== false;
    const showVi = settings.barShowVi !== false;
    const showEn = settings.barShowEn !== false;
    const vi = stripStubPrefix(cue.vi);
    const en = stripStubPrefix(cue.en);
    const viHtml = showVi && vi ? Vocab.renderBilingualHtml(vi, "vi", cue.tokens, settings) : "";
    const enHtml = showEn && en ? Vocab.renderBilingualHtml(en, "en", cue.tokens, settings) : "";
    const translationFailure = cue.enhanced && [showVi && cue.translationStates?.vi === "error" ? "VI" : "",
      showEn && cue.translationStates?.en === "error" ? "EN" : ""].filter(Boolean).join("/");

    bar.innerHTML = `
      <div class="hardsub-bridge-pill ${bridgeReady ? "ready" : "offline"}" title="${bridgeReady ? "Local Bridge: Connected" : "Local Bridge: Offline (Intl.Segmenter fallback)"}"></div>
      <div class="lr-overlay-wrap">
        <div class="lr-card-ja">
          <button type="button" class="lr-replay-btn" title="Phát lại câu này (phím S / Space)">▶</button>
          <div class="lr-card-body">
            <div class="lr-text-ja">${showJa ? rubyHtml(cue) : ""}</div>
            ${viHtml ? `<div class="bar-vi">${viHtml}</div>` : ""}
            ${enHtml ? `<div class="bar-en">${enHtml}</div>` : ""}
            ${translationFailure ? `<div role="status">${translationFailure} · Dịch lỗi, sẽ thử lại</div>` : ""}
          </div>
          <div class="lr-card-actions">
            <button type="button" class="lr-scale-btn lr-scale-down-btn" title="Giảm cỡ chữ phụ đề (phím [)">A-</button>
            <button type="button" class="lr-scale-btn lr-scale-up-btn" title="Tăng cỡ chữ phụ đề (phím ])">A+</button>
            <button type="button" class="lr-star-btn ${starred ? "active" : ""}" title="${starred ? "Bỏ lưu câu này (phím S)" : "Lưu câu này vào mục đã lưu (phím S)"}">${starred ? "★" : "☆"}</button>
            <button type="button" class="lr-more-btn" title="Cài đặt phụ đề & Dịch AI">⋮</button>
          </div>
        </div>
      </div>
    `;
    const pill = bar.querySelector(".hardsub-bridge-pill");
    if (pill) {
      pill.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        syncHealth();
      });
    }
    const scaleDownBtn = bar.querySelector(".lr-scale-down-btn");
    if (scaleDownBtn) {
      scaleDownBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const cur = userBarScale();
        const next = Math.max(0.55, Math.min(2.4, Math.round((cur - 0.1) * 100) / 100));
        settings.barScale = next;
        applyBarPosition();
        void saveSettings();
      });
    }
    const scaleUpBtn = bar.querySelector(".lr-scale-up-btn");
    if (scaleUpBtn) {
      scaleUpBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const cur = userBarScale();
        const next = Math.max(0.55, Math.min(2.4, Math.round((cur + 0.1) * 100) / 100));
        settings.barScale = next;
        applyBarPosition();
        void saveSettings();
      });
    }
    const replayBtn = bar.querySelector(".lr-replay-btn");
    if (replayBtn) {
      replayBtn.addEventListener("mouseenter", () => showBarPlayPopover(replayBtn, cue));
      replayBtn.addEventListener("mouseleave", hideBarPlayPopover);
      replayBtn.addEventListener("click", (e) => {
        hideBarPlayPopover();
        e.stopPropagation();
        e.preventDefault();
        repeatCurrentCue();
      });
    }
    const starBtn = bar.querySelector(".lr-star-btn");
    if (starBtn) {
      starBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        e.preventDefault();
        await toggleStarCue(cue);
        const nowStarred = isCueStarred(cue.id);
        starBtn.classList.toggle("active", nowStarred);
        starBtn.textContent = nowStarred ? "★" : "☆";
      });
    }
    const moreBtn = bar.querySelector(".lr-more-btn");
    if (moreBtn) {
      moreBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        openSettingsModal();
      });
    }

    ensureBarResizeHandle(bar);
    bindBarTokenDict(bar);
    applyBarPosition();
    applyBarVisibility();
    recordSentencePaint(bar, cue);
  }

  /**
   * Playhead match — active strictly within authentic [start, end + grace].
   * Does NOT artificially hold across silence gaps until the next cue.
   */
  let sortedCuesCache = null;
  let lastCuesRef = null;
  function cancelSentencePrefetch() {
    void globalThis.HardsubGeminiTranslate?.cancelPending?.("automatic")?.catch(() => {});
  }
  function sentenceTrackKey(videoId = currentVideoId) {
    return `${currentSource}:${videoId}:${settings.sourceLang || "ja"}`;
  }
  async function sentenceSourceFingerprint(sourceKey, rawCues, track = null) {
    // Signed URLs and mutable translations are not source identity.
    const source = rawCues.map(c => [c.start, c.end, c.text, c.rawText ?? null,
      (c.segmentAnchors || []).map(a => [a.charStart, a.charEnd, a.time, !!a.speakerChange])]);
    const identity = track ? [track.trackId ?? null, track.language ?? null, track.kind ?? null, track.format ?? null] : null;
    const bytes = new TextEncoder().encode(JSON.stringify([sourceKey, identity, source]));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  }
  function sentenceStateStorageKey(videoId = currentVideoId) {
    return `sentenceState:v1:${sentenceTrackKey(videoId)}`;
  }
  function sentenceCueRevision(cue) {
    return JSON.stringify([cue.id, cue.source, cue.start_media_time, cue.end_media_time, cue.rawSource || null,
      cue.text_source || "", !!cue.mt_locked, ["user", "import"].includes(cue.translation_source) ? cue.translation_source : "",
      cue.normalization || null]);
  }
  async function loadSentenceState() {
    if (!currentVideoId || currentSource !== "youtube") return;
    const key = sentenceStateStorageKey(), gen = navigateGen;
    if (sentenceStateLoadedKey === key && sentenceStateLoadedGen === gen) return sentenceStateLoad;
    refreshSentenceProjection(true);
    sentenceStateLoadedKey = key;
    sentenceStateLoadedGen = gen;
    sentenceStateLoad = (async () => {
      try {
        const state = (await chrome.storage.local.get(key))[key];
        if (gen !== navigateGen || key !== sentenceStateStorageKey() || state?.version !== 1 ||
            state.sourceKey !== sentenceTrackKey()) return;
        sentenceUndoRevisions = state.undoRevisions && typeof state.undoRevisions === "object" ? state.undoRevisions : {};
        sentenceUndoAppliedRevisions = state.undoAppliedRevisions && typeof state.undoAppliedRevisions === "object"
          ? state.undoAppliedRevisions : {};
        sentenceTranslations = state.translations && typeof state.translations === "object" ? state.translations : {};
        sentenceTokens = state.tokens && typeof state.tokens === "object" ? state.tokens : {};
        sentenceCandidates = state.candidates && typeof state.candidates === "object" ? state.candidates : {};
        if (sentenceRawTrack?.sourceKey !== sentenceTrackKey() && state.rawTrack?.sourceKey === sentenceTrackKey()) {
          sentenceRawTrack = state.rawTrack;
        }
        refreshSentenceProjection(true);
      } catch (_) { /* Disposable cache missing/unavailable; Original stays authoritative. */ }
    })();
    return sentenceStateLoad;
  }
  function sentenceStateSnapshot() {
    refreshSentenceProjection(true);
    // Rollback must preserve loaded sidecars even before any grouping runs.
    const translations = sentenceEnhancementEnabled() ? {} : sentenceTranslations;
    for (const group of sentenceProjection?.groups || []) {
      const value = sentenceTranslations[group.id];
      if (!group.protected && value?.revision === group.revision) translations[group.id] = value;
    }
    return { version: 1, sourceKey: sentenceTrackKey(), offsetUnit: "utf16", algorithmVersion: globalThis.HardsubSentenceGroups?.VERSION ?? null,
      rawTrack: sentenceRawTrack?.sourceKey === sentenceTrackKey() ? sentenceRawTrack : null,
      sourceCues: cues.filter(c => c.rawSource && c.normalization).map(c => ({ id: c.id, source: c.source,
        start_media_time: c.start_media_time, end_media_time: c.end_media_time, rawSource: c.rawSource, normalization: c.normalization })),
      undoRevisions: sentenceUndoRevisions, undoAppliedRevisions: sentenceUndoAppliedRevisions, translations,
      candidates: sentenceCandidates,
      tokens: !sentenceEnhancementEnabled() ? sentenceTokens : Object.fromEntries((sentenceProjection?.groups || []).filter(g => !g.protected && sentenceTokens[g.id]?.length)
        .map(g => [g.id, sentenceTokens[g.id]])) };
  }
  function sentenceBackupSnapshot() {
    return { format: "caption-studio-sentence-backup", version: 1, videoId: currentVideoId,
      sourceKey: sentenceTrackKey(), exportedAt: new Date().toISOString(),
      cues: structuredClone(cues), transcriptMeta: structuredClone(transcriptMeta),
      enhancement: structuredClone(sentenceStateSnapshot()),
      savedSentences: Object.values(savedCues).filter(c => c.videoId === currentVideoId).map(c => structuredClone(c)) };
  }
  function validateSentenceBackup(backup) {
    const object = value => value && typeof value === "object" && !Array.isArray(value);
    if (currentSource !== "youtube" || backup?.format !== "caption-studio-sentence-backup" || backup.version !== 1 ||
        backup.videoId !== currentVideoId || backup.sourceKey !== sentenceTrackKey() ||
        JSON.stringify(backup).length > 10 * 1024 * 1024) throw new Error("Backup version, video or source does not match");
    const meta = backup.transcriptMeta, state = backup.enhancement;
    if (!object(meta) || typeof meta.owned !== "boolean" || !Array.isArray(meta.tombstones) ||
        !meta.tombstones.every(s => typeof s === "string") || !Number.isFinite(meta.rev) || meta.rev < 0 ||
        !object(state) || state.version !== 1 || state.sourceKey !== backup.sourceKey || state.offsetUnit !== "utf16" ||
        ![state.undoRevisions, state.translations, state.tokens].every(object) ||
        (state.undoAppliedRevisions != null && !object(state.undoAppliedRevisions)) ||
        !Array.isArray(backup.savedSentences) || !backup.savedSentences.every(c => object(c) && typeof c.id === "string" &&
          c.id.length && c.videoId === currentVideoId && typeof c.source === "string")) throw new Error("Invalid backup metadata");
    if (!Array.isArray(backup.cues) || backup.cues.length > 20000) throw new Error("Invalid backup cues");
    const ids = new Set();
    for (const cue of backup.cues) {
      if (!object(cue) || typeof cue.id !== "string" || !cue.id || ids.has(cue.id) || typeof cue.source !== "string" ||
          !Number.isFinite(cue.start_media_time) || cue.start_media_time < 0 || !Number.isFinite(cue.end_media_time) ||
          cue.end_media_time < cue.start_media_time || [cue.en, cue.vi].some(v => v != null && typeof v !== "string") ||
          (cue.tokens != null && !Array.isArray(cue.tokens))) throw new Error("Invalid or duplicate backup cue");
      ids.add(cue.id);
    }
    if (state.rawTrack && (!object(state.rawTrack) || state.rawTrack.version !== 1 ||
        state.rawTrack.sourceKey !== backup.sourceKey || !Array.isArray(state.rawTrack.cues))) throw new Error("Invalid raw source track");
  }
  async function saveSentenceState() {
    if (currentSource !== "youtube" || !currentVideoId || sentenceStateLoadedKey !== sentenceStateStorageKey()) return;
    const key = sentenceStateStorageKey(), gen = navigateGen, meta = structuredClone(transcriptMeta);
    await sentenceStateLoad;
    if (gen !== navigateGen || key !== sentenceStateStorageKey()) return;
    try {
      const result = await chrome.runtime.sendMessage({ type: "SAVED_CUES_MUTATE", op: "save_sentence_state",
        videoId: currentVideoId, sourceKey: sentenceTrackKey(), meta, state: sentenceStateSnapshot() });
      if (!result?.ok) throw new Error(result?.error || "Sentence state save failed");
    } catch (_) { console.warn("[jpcap] Sentence cache unavailable; Original script save continues"); }
  }
  function getActiveDisplayCue() {
    return findActiveCue(currentMediaTime);
  }
  function sentenceEnhancementEnabled() {
    return currentSource === "youtube" && !!globalThis.HardsubSentenceGroups &&
      settings.enhanced_subtitles_enabled !== false && settings.sentence_grouping_enabled !== false;
  }
  function refreshSentenceProjection(force = false) {
    const key = sentenceTrackKey();
    if (key !== sentenceSourceKey) {
      sentenceSourceKey = key;
      sentenceCandidates = {};
      sentenceUndoIds = new Set();
      sentenceUndoRevisions = {};
      sentenceUndoAppliedRevisions = {};
      sentenceTranslations = {};
      sentenceTokens = {};
      sentenceProjection = null;
      const trackKind = typeof sentenceTrackKind !== "undefined" ? sentenceTrackKind : "asr";
      if (trackKind === "asr") {
        captionMode = "enhanced";
        if (typeof toggleAudioListening === "function") {
          void toggleAudioListening(true, { auto: true });
        }
        if (typeof audioListeningAutoStarted !== "undefined") {
          audioListeningAutoStarted = true;
        }
      } else {
        captionMode = "original";
        if (typeof audioListeningAutoStarted !== "undefined" && audioListeningAutoStarted) {
          if (typeof toggleAudioListening === "function") {
            void toggleAudioListening(false, { auto: true });
          }
          audioListeningAutoStarted = false;
        }
      }
    }
    const engine = globalThis.HardsubSentenceGroups;
    if (!sentenceEnhancementEnabled()) {
      captionMode = "original";
      enhancedCues = [];
      // Keep revision-bound metadata for backup; rebuild display when reenabled.
      sentenceProjectionCues = null;
      return;
    }
    if (!force && sentenceProjection && sentenceProjectionCues === cues && !listDirty) return;
    sentenceUndoIds = new Set(cues.filter(c => sentenceUndoRevisions[c.id] === sentenceCueRevision(c)).map(c => c.id));
    try {
      sentenceProjection = engine.buildSentenceGroups(cues, { sourceKey: key,
        sourceRevision: sentenceRawTrack?.sourceKey === key ? sentenceRawTrack.fingerprint || "" : "",
        blockedCueIds: [...sentenceUndoIds] });
      sentenceTokens = Object.fromEntries(sentenceProjection.groups.filter(g => engine.validGroupTokens(g.text, sentenceTokens[g.id]))
        .map(g => [g.id, sentenceTokens[g.id]]));
      enhancedCues = engine.projectDisplayCues(cues, sentenceProjection, sentenceTranslations, sentenceTokens);
      sentenceProjectionCues = cues;
      sentenceBenchmark?.groupsPrepared?.(sentenceProjection.groups, performance.now());
    } catch (err) {
      captionMode = "original";
      sentenceProjection = null;
      enhancedCues = [];
      console.warn("[jpcap] Sentence projection rejected; keeping Original", err);
    }
    // Same-array manual timeline edits must also invalidate sorted playhead lookup.
    lastCuesRef = null;
  }

  function getSortedCues() {
    refreshSentenceProjection();
    if (captionMode === "enhanced") return enhancedCues;
    if (cues === lastCuesRef && sortedCuesCache && sortedCuesCache.length === (cues?.length || 0)) {
      return sortedCuesCache;
    }
    lastCuesRef = cues;
    sortedCuesCache = (cues || []).slice().sort(
      (a, b) => (Number(a.start_media_time) || 0) - (Number(b.start_media_time) || 0)
    );
    return sortedCuesCache;
  }

  function findActiveCue(mediaTime) {
    const t = Number(mediaTime) || 0;
    const grace = 0.15;
    const live = getSortedCues();
    let hit = null;
    for (let i = 0; i < live.length; i++) {
      const c = live[i];
      const start = Number(c.start_media_time) || 0;
      const end = Number(c.end_media_time) || start;
      if (t >= start && t <= end + grace) {
        hit = c;
      }
    }
    return hit;
  }

  /**
   * Token enrich via /tokenize_batch. Keeps en/vi/mt_locked intact.
   * Used after import and JA Enter. Retries later via syncHealth if bridge offline.
   */
  async function enrichTokensAfterImport(cueIds = null) {
    const idSet = cueIds
      ? new Set(Array.from(cueIds).map((x) => String(x)))
      : null;
    const targets = cues.filter((c) => {
      if (!c || !String(c.source || "").trim()) return false;
      if (idSet && !idSet.has(c.id)) return false;
      return Vocab.tokensNeedEnrich(c);
    });
    if (!targets.length) return 0;

    const snapById = new Map(
      targets.map((c) => [
        c.id,
        {
          source: c.source,
          gen: c._txGen || 0,
          en: c.en,
          vi: c.vi,
          mt_locked: !!c.mt_locked,
          translation_source: c.translation_source,
        },
      ])
    );

    let results = null;
    try {
      const res = await bridgeFetch("/tokenize_batch", {
        method: "POST",
        body: {
          cues: targets.map((c) => ({ id: c.id, text: c.source })),
        },
      });
      if (res?.ok && Array.isArray(res.data?.results)) {
        results = res.data.results;
      }
    } catch (_) {
      results = null;
    }

    // Fallback: single /tokenize per cue (older bridge without batch), or offline segmentFallback.
    if (!results) {
      results = [];
      for (const c of targets) {
        let gotTokens = false;
        try {
          const one = await bridgeFetch("/tokenize", {
            method: "POST",
            body: { text: c.source },
          });
          if (one?.ok && one.data && Array.isArray(one.data.tokens) && one.data.tokens.length) {
            results.push({
              id: c.id,
              source: c.source,
              tokens: one.data.tokens,
            });
            gotTokens = true;
          }
        } catch (_) {
          /* skip */
        }
        if (!gotTokens && typeof Vocab.segmentFallback === "function") {
          const fallbackToks = Vocab.segmentFallback(c.source);
          if (fallbackToks.length) {
            results.push({
              id: c.id,
              source: c.source,
              tokens: fallbackToks,
            });
          }
        }
      }
    }

    let wrote = 0;
    const cacheMap = {};
    for (const d of results) {
      if (!d) continue;
      const target = cues.find((c) => c.id === d.id) || null;
      if (!target) continue;
      const snap = snapById.get(target.id);
      if (!snap) continue;
      if ((target._txGen || 0) !== snap.gen || target.source !== snap.source) {
        continue;
      }
      const toks = Array.isArray(d.tokens) ? d.tokens : [];
      if (!toks.length) continue;
      target.tokens = toks;
      cacheMap[target.id] = toks;
      // Hard-guarantee: never let enrich touch EN/VI or lock.
      target.en = snap.en;
      target.vi = snap.vi;
      target.mt_locked = snap.mt_locked;
      target.translation_source = snap.translation_source;
      wrote += 1;
    }

    if (wrote > 0) {
      // T3: slim {cueId: tokens} cache — reloads skip the bridge tokens RTT.
      void chrome.storage.local.set({ [`tokens:${tabPrefix()}${currentVideoId}`]: cacheMap }).catch(() => {});
      scheduleSaveTranscript();
      listDirty = true;
      const active = getActiveDisplayCue();
      updateBar(active || null);
      updateCaptionStatusLine();
      publishSidePanelState({ forceList: true });
      markFuriganaPainted();
    }
    return wrote;
  }

  async function clearTranslations() {
    for (const c of cues) {
      c.en = "";
      c.vi = "";
      c.tokens = [];
      c.translated = false;
      unlockCueTranslation(c);
      c._txGen = (c._txGen || 0) + 1;
    }
    translatingIds.clear();
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    // force: the ownership score must not block the wipe, and the disk must
    // not keep the old EN/VI. The result reports whether the disk was written.
    const res = await saveTranscript({ force: true });
    listDirty = true;
    const active = getActiveDisplayCue();
    updateBar(active || null);
    updateCaptionStatusLine();
    publishSidePanelState();
    // The write can be skipped (another tab holds a newer script) or the disk
    // copy can fail (bridge offline) - in both cases the disk still holds the
    // old EN/VI, so do not claim success.
    if (res && res.skipped) return;
    if (res && res.diskWritten === false) {
      toast("Đã xóa bản dịch trong trình duyệt, nhưng chưa ghi được xuống bridge");
      return;
    }
    toast("Đã xóa bản dịch");
  }

  /**
   * Wipe chrome.storage + disk script for this video, then re-fetch YouTube
   * timedtext from scratch (no cache merge / no owned-script restore).
   */
  async function wipeSavedScriptAndReload() {
    if (!currentVideoId) {
      toast("Không có video");
      return;
    }
    translatingIds.clear();
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const key = `transcript:${tabPrefix()}${currentVideoId}`;
    const metaKey = metaStorageKey(currentVideoId);
    try {
      await chrome.storage.local.remove([key, metaKey]);
    } catch (_) {}
    transcriptMeta = emptyMeta();
    try {
      await bridgeFetch(`/scripts/${encodeURIComponent(currentVideoId)}`, {
        method: "DELETE",
      });
    } catch (_) {
      /* bridge offline — chrome.storage already cleared */
    }
    try {
      await pageCall("RESET_CAPTIONS", {}, 500);
    } catch (_) {}
    cues = [];
    activeCueId = "";
    listDirty = true;
    updateBar(null);
    publishSidePanelState();
    updateCaptionStatusLine();
    toast("Đang tải lại caption từ đầu…");
    await loadAllCaptions(true, { skipCache: true });
    if (cues.length) toast(`Đã tải lại ${cues.length} câu`);
    else toast(`Không có caption (${captionsInfo || captionsStatus})`);
  }

  /** Match import row → live cue by id, else start±tol + source (cache-merge spirit). */
  function findLiveCueForImport(row, usedIds) {
    const id = String(row?.id || "").trim();
    if (id) {
      const byId = cues.find((c) => c.id === id && !usedIds.has(c.id));
      if (byId) return byId;
    }
    const start = Number(row?.start_media_time ?? row?.start);
    const source = String(row?.source || row?.text || "").trim();
    if (!Number.isFinite(start)) return null;
    const compact = compactSource(source);
    let best = null;
    let bestDt = Infinity;
    for (const c of cues) {
      if (usedIds.has(c.id)) continue;
      const dt = Math.abs((Number(c.start_media_time) || 0) - start);
      if (dt > CACHE_MATCH_TOL) continue;
      const prevSrc = String(c.source || "");
      const srcOk =
        !source ||
        prevSrc === source ||
        compactSource(prevSrc) === compact;
      if (!srcOk) continue;
      if (dt < bestDt) {
        best = c;
        bestDt = dt;
      }
    }
    return best;
  }

  function normalizeImportRow(raw) {
    if (!raw || typeof raw !== "object") return null;
    const start = Number(raw.start_media_time ?? raw.start ?? raw.media_time);
    // Missing end stays NaN — repairImportCueEnds fills only when needed.
    const endRaw = raw.end_media_time ?? raw.end;
    const end = endRaw == null || endRaw === "" ? NaN : Number(endRaw);
    return {
      id: String(raw.id || "").trim(),
      start_media_time: Number.isFinite(start) ? start : NaN,
      end_media_time: Number.isFinite(end) ? end : NaN,
      // Same normalization as the manual edit path — one text, one variant.
      source: normalizeCueText(raw.source || raw.text || raw.ja),
      en: raw.en != null ? normalizeCueText(raw.en) : null,
      vi: raw.vi != null ? normalizeCueText(raw.vi) : null,
      tokens: Array.isArray(raw.tokens) ? raw.tokens : null,
      translated: raw.translated,
      mt_locked: raw.mt_locked,
      translation_source: raw.translation_source,
    };
  }

  /**
   * Only fix missing / non-positive ends. When file already has end > start,
   * keep exact times (no CPS retime, no clamp-to-next). Prefer next cue start
   * as end over inventing start+2.
   */
  function repairImportCueEnds(list) {
    const EPS = 0.05;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const start = Number(c.start_media_time) || 0;
      let end = Number(c.end_media_time);
      if (Number.isFinite(end) && end > start) {
        c.start_media_time = start;
        c.end_media_time = end;
        continue;
      }
      const next = list[i + 1];
      const nextStart = next ? Number(next.start_media_time) || 0 : NaN;
      if (Number.isFinite(nextStart) && nextStart > start + EPS) {
        end = nextStart;
      } else {
        end = start + 2;
      }
      c.start_media_time = start;
      c.end_media_time = end;
    }
  }

  /**
   * Full replace: swap in-memory cues with the imported file (JA + EN/VI + timeline),
   * clear tombstones, mark owned, overwrite chrome.storage + disk script.
   * Preserves file start/end exactly when both present and end > start.
   */
  async function importCuesReplace(rows) {
    const next = [];
    let skipped = 0;
    for (const row of rows) {
      const hasTiming =
        Number.isFinite(row.start_media_time) || Number.isFinite(row.end_media_time);
      const hasText = !!(row.source || (row.en != null && String(row.en).trim()) ||
        (row.vi != null && String(row.vi).trim()));
      if (!hasTiming && !hasText) {
        skipped += 1;
        continue;
      }
      const start = Number.isFinite(row.start_media_time) ? row.start_media_time : 0;
      // Keep NaN when end missing — repairImportCueEnds prefers next.start.
      const end = Number.isFinite(row.end_media_time) ? row.end_media_time : NaN;
      const source = row.source || "";
      const en = row.en != null ? String(row.en) : "";
      const vi = row.vi != null ? String(row.vi) : "";
      const hasMt = !!(en.trim() || vi.trim());
      const tokens = Array.isArray(row.tokens) ? row.tokens : [];
      const cue = {
        id: row.id || cueId(start, source || "empty"),
        start_media_time: start,
        end_media_time: end,
        source,
        en: hasMt ? en : "",
        vi: hasMt ? vi : "",
        tokens: hasMt ? tokens : [],
        translated: !!(hasMt && row.translated !== false),
        text_source: "script",
        _txGen: 1,
      };
      if (hasMt) lockCueTranslation(cue, "import");
      next.push(cue);
    }
    next.sort((a, b) => {
      const ds =
        (Number(a.start_media_time) || 0) - (Number(b.start_media_time) || 0);
      if (ds !== 0) return ds;
      return (Number(a.end_media_time) || 0) - (Number(b.end_media_time) || 0);
    });
    repairImportCueEnds(next);
    if (!next.length) {
      toast("Import: không có cue hợp lệ để thay thế");
      return {
        updated: 0,
        skipped,
        unmatched: 0,
        replaced: 0,
        mode: "replace",
        includeJa: true,
      };
    }

    translatingIds.clear();
    cues = next;
    activeCueId = null;
    transcriptMeta.tombstones = [];
    await markScriptOwned();

    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    // Atomic overwrite — do not remove-then-write (Reload race empty cache → YT).
    await saveTranscript();

    listDirty = true;
    captionsStatus = "ok";
    captionsInfo = `import · ${next.length} cues`;
    await syncToPlayhead();
    updateCaptionStatusLine();
    publishSidePanelState();
    // Tokens (furigana + JLPT) without regenerating locked EN/VI.
    const enriched = await enrichTokensAfterImport();
    toast(
      enriched > 0
        ? `Import: đã thay thế ${next.length} cue · enrich ${enriched}`
        : `Import: đã thay thế ${next.length} cue`
    );
    return {
      updated: next.length,
      skipped,
      unmatched: 0,
      replaced: next.length,
      mode: "replace",
      includeJa: true,
      enriched,
    };
  }

  /**
   * Apply imported cue translations onto the current video list.
   * mode=merge: only write non-empty EN/VI from file; leave other cues alone.
   * mode=replace: fully replace cues (JA + EN/VI + timeline); clear old saved script.
   * includeJa (merge only): also apply source + timeline (marks script owned).
   * Full/replace always includes JA + timeline (includeJa forced true).
   */
  async function importCues(rawList, opts = {}) {
    const mode = opts.mode === "replace" ? "replace" : "merge";
    const includeJa = mode === "replace" ? true : !!opts.includeJa;
    const rows = (Array.isArray(rawList) ? rawList : [])
      .map(normalizeImportRow)
      .filter(Boolean);

    if (mode === "replace") {
      return importCuesReplace(rows);
    }

    let updated = 0;
    let skipped = 0;
    let unmatched = 0;
    const usedIds = new Set();

    for (const row of rows) {
      const hasEn = row.en != null;
      const hasVi = row.vi != null;
      const hasJa =
        includeJa &&
        (row.source ||
          Number.isFinite(row.start_media_time) ||
          Number.isFinite(row.end_media_time));
      if (!hasEn && !hasVi && !hasJa) {
        skipped += 1;
        continue;
      }
      const cue = findLiveCueForImport(row, usedIds);
      if (!cue) {
        unmatched += 1;
        continue;
      }
      usedIds.add(cue.id);

      let changed = false;
      let gotImportMt = false;
      if (hasEn && String(row.en).trim()) {
        if (cue.en !== row.en) {
          cue.en = row.en;
          changed = true;
        }
        gotImportMt = true;
      }
      if (hasVi && String(row.vi).trim()) {
        if (cue.vi !== row.vi) {
          cue.vi = row.vi;
          changed = true;
        }
        gotImportMt = true;
      }
      // Any cue that receives EN/VI from import is translation-locked.
      if (
        gotImportMt ||
        (row.mt_locked &&
          (String(cue.en || "").trim() || String(cue.vi || "").trim()))
      ) {
        if (!isMtLocked(cue) || cue.translation_source !== "import") {
          changed = true;
        }
        lockCueTranslation(cue, "import");
      }

      if (includeJa) {
        if (row.source && cue.source !== row.source) {
          cue.source = row.source;
          cue.tokens = [];
          cue.text_source = "edit";
          changed = true;
        }
        if (Number.isFinite(row.start_media_time) || Number.isFinite(row.end_media_time)) {
          const s = Number.isFinite(row.start_media_time)
            ? row.start_media_time
            : cue.start_media_time;
          let e = Number.isFinite(row.end_media_time)
            ? row.end_media_time
            : cue.end_media_time;
          // Preserve exact file end when valid; else leave for repairImportCueEnds.
          if (!Number.isFinite(e) || e <= s) e = NaN;
          if (cue.start_media_time !== s || cue.end_media_time !== e) {
            cue.start_media_time = s;
            cue.end_media_time = e;
            cue.text_source = cue.text_source === "yt" ? "edit" : cue.text_source || "edit";
            changed = true;
          }
        }
        if (row.tokens && Array.isArray(row.tokens)) {
          cue.tokens = row.tokens;
          changed = true;
        }
      }

      const hasMt = !!(String(cue.en || "").trim() || String(cue.vi || "").trim());
      const nextTranslated = hasMt;
      if (cue.translated !== nextTranslated) {
        cue.translated = nextTranslated;
        changed = true;
      }

      if (changed) {
        cue._txGen = (cue._txGen || 0) + 1;
        updated += 1;
      } else {
        skipped += 1;
      }
    }

    let enriched = 0;
    if (updated > 0) {
      if (includeJa) await markScriptOwned();
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      if (includeJa) {
        cues.sort((a, b) => {
          const ds =
            (Number(a.start_media_time) || 0) - (Number(b.start_media_time) || 0);
          if (ds !== 0) return ds;
          return (Number(a.end_media_time) || 0) - (Number(b.end_media_time) || 0);
        });
        // Only fills missing/invalid ends (keeps exact file times otherwise).
        repairImportCueEnds(cues);
      }
      await saveTranscript();
      listDirty = true;
      const active = getActiveDisplayCue();
      updateBar(active || null);
      updateCaptionStatusLine();
      publishSidePanelState();
    }

    // Merge may lock EN/VI without tokens; even when file doesn't change EN/VI
    // (updated == 0), we still need to enrich tokens for furigana/JLPT coloring.
    if (usedIds.size > 0) {
      enriched = await enrichTokensAfterImport(usedIds);
    }

    toast(
      enriched > 0
        ? `Import: cập nhật ${updated} · enrich ${enriched} · bỏ qua ${skipped} · không khớp ${unmatched}`
        : `Import: cập nhật ${updated} · bỏ qua ${skipped} · không khớp ${unmatched}`
    );
    return { updated, skipped, unmatched, mode, includeJa, enriched };
  }

  function exportTxt() {
    const lines = [];
    // Prefer "# ---…" over bare ===== lines — IDEs treat ======= as conflict markers.
    // Keep 10+ dashes so import_parse.split(/-{10,}/) still works.
    lines.push("# ----------------------------------------");
    lines.push("# Caption Session");
    lines.push(`URL: ${location.href}`);
    lines.push(`Exported: ${new Date().toISOString().replace("T", " ").slice(0, 16)}`);
    lines.push("# ----------------------------------------");
    lines.push("");
    cues.forEach((cue, i) => {
      const n = i + 1;
      const furi = (cue.tokens || [])
        .map((t) => (t.reading ? `${t.surface}(${t.reading})` : t.surface))
        .join("");
      lines.push(
        `[${String(n).padStart(3, "0")}] ${formatTime(cue.start_media_time)} → ${formatTime(cue.end_media_time)}`
      );
      if (settings.exportFormat !== "vi") {
        lines.push(`JA: ${cue.source}`);
        if (furi) lines.push(`    (${furi})`);
      }
      if (settings.exportFormat === "ja_en_vi") {
        lines.push(`EN: ${stripStubPrefix(cue.en)}`);
      }
      lines.push(`VI: ${stripStubPrefix(cue.vi)}`);
      lines.push("");
      lines.push("# ----------------------------------------");
      lines.push("");
    });
    downloadCaptionFile(lines.join("\n"), `yt-caption-${currentVideoId || "session"}.txt`, "text/plain;charset=utf-8");
    toast("Đã export TXT");
  }

  function downloadCaptionFile(text, fileName, mimeType) {
    const blob = new Blob([text], { type: mimeType });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function triggerPredictivePrefetch(currentActiveCue) {
    if (currentActiveCue) { void enrichSentenceGroups(); void triggerGeminiTranslationIfNeeded(); }
  }

  async function enrichSentenceGroups() {
    if (captionMode !== "enhanced" || !sentenceEnhancementEnabled() || !bridgeReady) return;
    refreshSentenceProjection();
    const gen = navigateGen, input = cues, engine = globalThis.HardsubSentenceGroups;
    const tokenJobKey = group => `${gen}:${group.id}`;
    const ahead = Math.min(60, Math.max(20, 30 * (Number(findVideo()?.playbackRate) || 1)));
    const wanted = new Set(enhancedCues.filter(c => c.end_media_time >= currentMediaTime &&
      c.start_media_time <= currentMediaTime + ahead).flatMap(c => c.groupIds));
    const targets = (sentenceProjection?.groups || []).filter(g => !g.protected && wanted.has(g.id) &&
      !sentenceTokens[g.id]?.length && !sentenceTokenPending.has(tokenJobKey(g)) &&
      (sentenceTokenRetryAt.get(tokenJobKey(g)) || 0) <= Date.now()).slice(0, 30);
    if (!targets.length) return;
    targets.forEach(g => sentenceTokenPending.add(tokenJobKey(g)));
    try {
      const response = await bridgeFetch("/tokenize_batch", { method: "POST",
        body: { cues: targets.map((g, i) => ({ id: `sentence-${i}`, text: g.text })) } });
      if (!response?.ok || !Array.isArray(response.data?.results)) throw new Error("Sentence tokenize unavailable");
      if (gen !== navigateGen || input !== cues || !sentenceEnhancementEnabled()) return;
      refreshSentenceProjection(true);
      const seen = new Set();
      for (const row of response.data.results) {
        const i = targets.findIndex((g, i) => row?.id === `sentence-${i}`), snap = targets[i];
        if (!snap || seen.has(row.id)) continue;
        seen.add(row.id);
        const current = sentenceProjection.groups.find(g => g.id === snap.id && g.text === snap.text && !g.protected);
        if (!current) continue;
        sentenceTokens[current.id] = engine.tokensFromCodePoints(current.text, row.source, row.tokens);
      }
      refreshSentenceProjection(true);
      scheduleTranslationPaint(gen);
    } catch (_) { /* Keep unverified tokens neutral; retry later through the same lookahead. */ }
    finally {
      for (const group of targets) {
        sentenceTokenPending.delete(tokenJobKey(group));
        if (gen === navigateGen && !sentenceTokens[group.id]?.length) sentenceTokenRetryAt.set(tokenJobKey(group), Date.now() + 30000);
      }
    }
  }

  function syncCueAtMediaTime(mediaTime) {
    if (!Number.isFinite(mediaTime)) return;
    currentMediaTime = mediaTime;
    const active = findActiveCue(mediaTime);
    const video = findVideo();
    if (video) sentenceBenchmark?.sample({ time: video.currentTime, rate: video.playbackRate, paused: video.paused, seeking: video.seeking,
      hidden: document.hidden, mode: captionMode,
      languages: [
        (settings.barShowVi !== false || settings.sidepanelShowVi !== false) ? "vi" : "",
        (settings.barShowEn !== false || settings.sidepanelShowEn === true) ? "en" : "",
      ].filter(Boolean),
      units: getSortedCues() }, performance.now());
    const nextId = active?.id || "";
    if (nextId !== activeCueId) {
      activeCueId = nextId;
      updateBar(active);
      publishSidePanelPartial({ activeCueId, currentTime: mediaTime });
      triggerPredictivePrefetch(active);
    }

    if (settings.autoPause && active) {
      const end = Number(active.end_media_time) || 0;
      if (end > 0 && mediaTime >= end - 0.08 && apLastPausedCueId !== active.id) {
        apLastPausedCueId = active.id;
        const video = findVideo();
        if (video && !video.paused) {
          video.pause();
        }
      }
    }
  }

  async function tick() {
    if (!settings.enabled || !isCurrentPlatformEnabled()) return;
    checkPageWatch();
    bindVideoEvents();

    const v = findVideo();
    let mediaTime = v ? v.currentTime : Number((await pageCall("GET_MEDIA_TIME", {}, 300))?.mediaTime);
    if (!Number.isFinite(mediaTime) && currentSource === "animevietsub" && Number.isFinite(iframePlayerTime)) {
      mediaTime = iframePlayerTime;
    }
    if (Number.isFinite(mediaTime)) {
      syncCueAtMediaTime(mediaTime);
    }

    if (listDirty) renderList(true);
  }

  let boundVideoEl = null;
  let boundVideoCleanup = null;
  function bindVideoEvents() {
    const v = findVideo();
    if (v && v !== boundVideoEl) {
      boundVideoCleanup?.();
      boundVideoCleanup = null;
      boundVideoEl = v;
      const cleanups = [bindAudioAnchorEvents(v)];

      const onFrame = (now, metadata) => {
        if (!boundVideoEl || boundVideoEl !== v) return;
        const mt = metadata && Number.isFinite(metadata.mediaTime) ? metadata.mediaTime : v.currentTime;
        syncCueAtMediaTime(mt);
        if ("requestVideoFrameCallback" in v && !v.paused) {
          v.requestVideoFrameCallback(onFrame);
        }
      };

      if ("requestVideoFrameCallback" in v) {
        const onPlay = () => {
          v.requestVideoFrameCallback(onFrame);
        };
        v.addEventListener("play", onPlay, { passive: true });
        cleanups.push(() => v.removeEventListener("play", onPlay));
        if (!v.paused) {
          v.requestVideoFrameCallback(onFrame);
        }
      }

      const onTimeUpdate = () => {
        syncCueAtMediaTime(v.currentTime);
      };
      v.addEventListener("timeupdate", onTimeUpdate, { passive: true });
      cleanups.push(() => v.removeEventListener("timeupdate", onTimeUpdate));

      const onSeeked = () => {
        sentenceBenchmark?.resetPlayback(performance.now(), "seek");
        cancelSentencePrefetch();
        syncCueAtMediaTime(v.currentTime);
        void triggerGeminiTranslationIfNeeded();
      };
      v.addEventListener("seeked", onSeeked, { passive: true });
      cleanups.push(() => v.removeEventListener("seeked", onSeeked));
      boundVideoCleanup = () => {
        for (const cleanup of cleanups) cleanup();
      };
    }
  }

  function startLoop() {
    stopLoop();
    loopTimer = setInterval(tick, 250);
    healthTimer = setInterval(syncHealth, 5000);
    // No immediate syncHealth here: every startLoop caller navigates right
    // after, and onNavigate already syncs once (healthTimer covers the rest).
  }

  function stopLoop() {
    if (loopTimer) clearInterval(loopTimer);
    if (healthTimer) clearInterval(healthTimer);
    loopTimer = null;
    healthTimer = null;
  }

  async function onNavigate() {
    const newWatchKey = canonicalPageWatchKey();
    const prevVideoId = currentVideoId;
    currentSource = sourceFromHost();
    const newVideoId = videoIdFromUrl();

    // Guard: If it's the exact same video and cues are already loaded,
    // do not teardown UI or wipe cues on redundant navigation or query changes (e.g. &t= on pause/scrub)
    if (newVideoId && newVideoId === prevVideoId && cues.length > 0 && newWatchKey === pageWatchKey) {
      return;
    }
    if (audioListeningActive) {
      audioListeningActive = false;
      try {
        void chrome.runtime.sendMessage({ type: "AUDIO_STOP_CAPTURE" }).catch(() => {});
      } catch (_) {}
    }
    pageWatchKey = newWatchKey;
    currentVideoId = newVideoId;

    cancelSentencePrefetch();
    sentenceTokenRetryAt.clear();
    const gen = ++navigateGen;
    sentenceBenchmark = currentSource === "youtube" ? globalThis.HardsubSentenceBenchmark?.createTrace({
      traceId: crypto.randomUUID(), openedAt: gen === 1 ? 0 : performance.now() }) || null : null;

    if (!isCurrentPlatformEnabled()) {
      teardownUI();
      return;
    }

    cues = [];
    activeCueId = "";
    translatingIds.clear();
    transcriptMeta = emptyMeta();
    updateBar(null);
    // Immediately clear Sidepanel cue list so old video subs vanish instantly
    publishSidePanelState({ forceList: true, videoId: currentVideoId, cues: [] });
    // Force reload status when video ID changes (fix for new video not loading script)
    if (currentVideoId && currentVideoId !== prevVideoId) {
      captionsStatus = "idle";
      captionsInfo = "";
    }
    // RESET_CAPTIONS wipes the page world's captured timedtext state. Send it
    // only for the video we are LEAVING and only after the new id settled
    // (currentVideoId above), so a capture that already belongs to the NEW
    // video is never wiped.
    if (pageBridgeReady && prevVideoId && newVideoId !== prevVideoId) {
      void pageCall("RESET_CAPTIONS", { videoId: prevVideoId }, 200).catch(() => {});
    }
    // YouTube: kick background SW ASAP in parallel with storage/disk/bridge setup
    const swPromise =
      currentVideoId && currentSource === "youtube"
        ? loadCaptionsViaBackground(currentVideoId, settings.sourceLang, {
            baseUrl: "",
            lang: settings.sourceLang,
            force: true,
          })
        : null;

    if (currentVideoId) {
      transcriptMeta = await loadTranscriptMeta(currentVideoId);
    }
    if (gen !== navigateGen) return;

    // iPad parity: restore saved script immediately (<50ms); owned import skips YT replace.
    listDirty = true;
    const restored =
      !!currentVideoId &&
      (await tryApplySavedScript("navigate", { quiet: true }));
    if (gen !== navigateGen) return;
    if (!restored) renderList(true);

    ensureUI();
    ensurePlayerToggleObserver();
    ensurePlayerToggle();
    void maybeAutoOpenOnNavigate();
    void checkDriveFresh(currentVideoId);

    if (restored && transcriptMeta.owned) {
      void saveTranscript({ force: true });
      if (cues.length) await syncToPlayhead();
      else updateBar(null);
      renderList(true);
      publishSidePanelState({ forceList: true });
      syncHealth();
      return;
    }

    if (currentSource === "animevietsub") {
      await loadAnimeVietsubCues(true);
      if (gen !== navigateGen) return;
      if (cues.length) await syncToPlayhead();
      else updateBar(null);
      renderList(true);
      publishSidePanelState({ forceList: true });
      syncHealth();
      return;
    }
    if (currentSource !== "youtube") {
      await loadPageCues(true);
      if (gen !== navigateGen) return;
      if (cues.length) await syncToPlayhead();
      else updateBar(null);
      renderList(true);
      publishSidePanelState({ forceList: true });
      syncHealth();
      return;
    }

    await loadAllCaptions(true, { swPromise });
    if (gen !== navigateGen) return;

    // Auto-retry pipeline for YouTube SPA navigation if captions weren't immediately ready
    if (!cues.length && currentSource === "youtube" && currentVideoId) {
      const retryDelays = [500, 1200, 2500];
      for (const delay of retryDelays) {
        if (gen !== navigateGen || cues.length) break;
        await sleep(delay);
        if (gen !== navigateGen || cues.length) break;
        await loadAllCaptions(true, { skipCache: false });
        if (cues.length) {
          listDirty = true;
          publishSidePanelState({ forceList: true });
          break;
        }
      }
    }

    if (gen !== navigateGen) return;
    if (cues.length) await syncToPlayhead();
    else updateBar(null);
    renderList(true);
    publishSidePanelState({ forceList: true });
    syncHealth();
  }

  async function init() {
    currentSource = sourceFromHost();
    currentVideoId = videoIdFromUrl();
    await loadSettings();
    // Get tab ID for tab-scoped storage (fix cross-tab overwrites)
    await ensureContentTabId();
    // Mặc định tắt overlay khi mở trang — không khôi phục trạng thái ON đã lưu.
    if (settings.showOnVideo) {
      settings.showOnVideo = false;
      void saveSettings();
    }
    // Prove which unpacked build is live after chrome://extensions Reload.
    try {
      void bridgeFetch("/log", {
        method: "POST",
        body: {
          level: "INFO",
          message: `ext content boot v=${chrome?.runtime?.getManifest?.()?.version || "?"} api=${PAGE_API_VER} tabId=${contentTabId}`,
        },
      }).catch(() => {});
    } catch (_) {}
    ensureUI();
    if (currentSource !== "animevietsub") {
      injectPageScript();
    }
    applyDim();
    applyBarVisibility();
    applyBarPosition();
    ensurePlayerToggleObserver();
    ensurePlayerToggle();
    bindGestureOpenSidePanel();
    window.addEventListener("mousemove", pingToggleActivity, { passive: true });
    window.addEventListener("message", (e) => {
      if (e.data?.type === "AVS_DEBUG_PING") {
        const btn = document.getElementById(PLAYER_TOGGLE_ID);
        const activeCue = findActiveCue(iframePlayerTime || 0);
        globalThis.HardsubGeminiTranslate?.getStoredApiKey?.().then(gKey => {
          const lines = String(gKey || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          const lineStats = lines.map(l => ({ len: l.length, startsAIza: l.startsWith("AIza"), snippet: `${l.slice(0, 6)}...${l.slice(-4)}` }));
          window.postMessage({
            type: "AVS_DEBUG_PONG",
            currentSource,
            currentVideoId,
            captionsStatus,
            captionsInfo,
            cuesCount: cues.length,
            hasBtn: !!btn,
            btnParentTag: btn?.parentElement?.tagName,
            btnParentId: btn?.parentElement?.id,
            btnParentClass: btn?.parentElement?.className,
            hasOcrRoot: !!document.getElementById("hardsub-ocr-root"),
            iframePlayerTime,
            hasGeminiKey: !!gKey,
            geminiKeyLen: gKey ? gKey.length : 0,
            linesCount: lines.length,
            lineStats,
            activeCue: activeCue ? { start: activeCue.start_media_time, end: activeCue.end_media_time, text: activeCue.text } : null,
            firstCue: cues[0] ? { start: cues[0].start_media_time, end: cues[0].end_media_time, text: cues[0].text, vi: cues[0].vi, en: cues[0].en } : null,
            tenthCue: cues[9] ? { start: cues[9].start_media_time, end: cues[9].end_media_time, text: cues[9].text, vi: cues[9].vi, en: cues[9].en } : null
          }, "*");
        }).catch(() => {});
        return;
      }
      if (e.data?.type === "AVS_TEST_TRANSLATE") {
        (async () => {
          try {
            const translator = globalThis.HardsubGeminiTranslate;
            const apiKey = await translator?.getStoredApiKey?.();
            const targetCues = cues.slice(0, 3);
            const repVi = await translator?.translateCues(targetCues, apiKey, null, { force: true, language: "vi" });
            const repEn = await translator?.translateCues(targetCues, apiKey, null, { force: true, language: "en" });
            publishSidePanelState({ forceList: true });
            window.postMessage({
              type: "AVS_TRANSLATE_PONG",
              ok: true,
              repVi,
              repEn,
              firstCueVi: cues[0]?.vi,
              firstCueEn: cues[0]?.en
            }, "*");
          } catch (err) {
            window.postMessage({
              type: "AVS_TRANSLATE_PONG",
              ok: false,
              error: String(err?.message || err)
            }, "*");
          }
        })();
        return;
      }
      if (e.data?.type === "AVS_SET_JIMAKU_KEY" && typeof e.data.key === "string") {
        const key = e.data.key.trim();
        chrome.storage.local.set({ jimakuApiKey: key });
        return;
      }
      if (e.data?.type === "AVS_SET_GEMINI_KEY" && typeof e.data.key === "string") {
        const key = e.data.key.trim();
        globalThis.HardsubGeminiTranslate?.saveApiKey(key).then(() => {
          window.postMessage({ type: "AVS_SET_GEMINI_KEY_DONE", ok: true }, "*");
        });
        return;
      }
      if (e.data?.type === "AVS_PLAYER_TIMEUPDATE") {
        const t = Number(e.data.currentTime);
        if (Number.isFinite(t)) {
          iframePlayerTime = t;
          if (!findVideo()) {
            syncCueAtMediaTime(t);
          }
        }
        return;
      }
      // Same capability gate as the pageCall reply path — no unverified
      // MAIN-world message may trigger caption reloads.
      if (e.source !== window) return;
      if (e.data?.type !== "__HARDSUB_TIMEDTEXT_CAPTURED__") return;
      if (!capAcceptsReply(pageCapToken, e.data.cap)) return;

      const payloadCues = e.data.cues;
      if (Array.isArray(payloadCues) && payloadCues.length) {
        const url = e.data.url || "";
        const detectedLang = e.data.lang || langFromTimedtextUrl(url);

        if (isViLang(detectedLang)) {
          // Route intercepted Vietnamese timedtext to secondary fill, NEVER to JA source!
          if (!cues.length) {
            void loadAllCaptions(true).then(() => {
              applyYtSecondaryFill({ viCues: payloadCues });
              listDirty = true;
              renderList(true);
              publishSidePanelState({ forceList: true });
            });
          } else {
            applyYtSecondaryFill({ viCues: payloadCues });
            stampSecondaryStatus(
              cues.filter((c) => String(c.en || "").trim()).length,
              cues.filter((c) => String(c.vi || "").trim()).length
            );
            listDirty = true;
            renderList(true);
            publishSidePanelState({ forceList: true });
            const curTime = Number(findVideo()?.currentTime) || 0;
            updateBar(findActiveCue(curTime));
          }
          return;
        }

        if (isEnLang(detectedLang)) {
          // Route intercepted English timedtext to secondary fill
          applyYtSecondaryFill({ enCues: payloadCues });
          stampSecondaryStatus(
            cues.filter((c) => String(c.en || "").trim()).length,
            cues.filter((c) => String(c.vi || "").trim()).length
          );
          listDirty = true;
          renderList(true);
          publishSidePanelState({ forceList: true });
          const curTime = Number(findVideo()?.currentTime) || 0;
          updateBar(findActiveCue(curTime));
          return;
        }

        const isJaIntercept =
          isJaLang(detectedLang) ||
          (!detectedLang &&
            !String(url).includes("tlang=") &&
            detectCuesLanguage(payloadCues) === "ja");
        if (isJaIntercept) {
          // Direct payload from intercept: apply immediately without refetching
          void applyLoadedCues(payloadCues, `ja intercept · ${payloadCues.length} cues`);
        }
      } else if (!cues.length || captionsStatus !== "ok") {
        void loadAllCaptions(true);
      }
    });
    document.addEventListener("yt-navigate-finish", () => onNavigate());
    document.addEventListener("yt-page-data-updated", () => onNavigate());
    window.addEventListener("popstate", () => {
      pageWatchKey = "";
      void onNavigate();
    });
    window.addEventListener("pagehide", () => {
      if (!audioListeningActive) return;
      audioListeningActive = false;
      try {
        void chrome.runtime.sendMessage({ type: "AUDIO_STOP_CAPTURE" }).catch(() => {});
      } catch (_) {}
    }, { once: true });
    await onNavigate();
    bridgeFetch("/bootstrap", { method: "POST" }).catch(() => {});
    startLoop();
  }

  // The Node harness (extension/content/content_test.js) opts in through the
  // seam below and only exercises the pure helpers - it must not boot the
  // browser UI.
  if (!globalThis.__JP_CAP_CONTENT_TEST__) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    let dirty = false;
    if (changes.savedCues) {
      const value = changes.savedCues.newValue;
      savedCues = value && typeof value === "object"
        ? Object.fromEntries((Array.isArray(value) ? value : Object.values(value)).filter(c => c?.id).map(c => [c.id, c])) : {};
      const active = getActiveDisplayCue();
      if (active) updateBar(active);
      publishSidePanelState();
    }
    if (changes.hardsubSettings) {
      const prevPlatEnabled = isCurrentPlatformEnabled();
      const flagsChanged = ["enhanced_subtitles_enabled", "sentence_grouping_enabled", "sentence_translation_prefetch_enabled"]
        .some(key => settings[key] !== (changes.hardsubSettings.newValue?.[key] ?? DEFAULTS[key]));
      settings = normalizeSettings(changes.hardsubSettings.newValue);
      if (flagsChanged) cancelSentencePrefetch();
      const nextPlatEnabled = isCurrentPlatformEnabled();

      if (prevPlatEnabled && !nextPlatEnabled) {
        teardownUI();
        return;
      }
      if (!prevPlatEnabled && nextPlatEnabled) {
        ensureUI();
        startLoop();
        void onNavigate();
        return;
      }
      if (!nextPlatEnabled) return;

      applyDim();
      applyBarVisibility();
      applyBarPosition();
      applyBarStyle();
      ensurePlayerToggle();
      dirty = true;
    }
    if (changes.userVocab) {
      userVocab =
        changes.userVocab.newValue && typeof changes.userVocab.newValue === "object"
          ? changes.userVocab.newValue
          : {};
      dirty = true;
    }
    if (!dirty) return;
    listDirty = true;
    const active = getActiveDisplayCue();
    if (active) updateBar(active);
    renderList(true);
    publishSidePanelState();
  });

  // Dictionary debug hook — opt in with ?jpcap_debug=1 in the page URL.
  if (typeof window !== "undefined" && /[?&]jpcap_debug=1(&|$)/.test(location.search || "")) {
    window.__contentDictDebug = {
      renderDictHtml,
      formatPosLabel,
      hasVietnameseChars,
      isInteractingWithPopup: () => isInteractingWithPopup,
      dictPinnedState: () => dictPinnedState,
    };
  }

  /**
   * Regression-test seam. The Node harness (extension/content/content_test.js)
   * loads this file inside a vm sandbox and opts in through this flag, so the
   * helpers below can be exercised without a browser. Nothing is exported in a
   * real page session.
   */
  if (globalThis.__JP_CAP_CONTENT_TEST__) {
    globalThis.__JP_CAP_CONTENT_TEST__.content = {
      sourceFromHost,
      videoIdFromUrl,
      sourceLabel,
      normalizeSettings,
      normalizeCueText,
      pageTitle,
      savedCueSnapshot,
      savedCueMatches,
      findSavedCueForCue,
      isCueStarred,
      setSavedCuesForTest: (value) => {
        savedCues = value && typeof value === "object" ? value : {};
      },
      capAcceptsReply,
      resolveCueIndex,
      onNavigate,
      bindAudioAnchorEvents,
      sendAudioPlayheadAnchor,
      asrSegmentBounds,
      handleSidePanelCmdForTest: (msg) => handleSidePanelCmd(msg),
      handleAsrCandidateReceivedForTest: (msg) => handleAsrCandidateReceived(msg),
      seedSentenceStateForTest: ({ videoId, cues: seededCues }) => {
        currentSource = "youtube";
        currentVideoId = String(videoId || "");
        cues = Array.isArray(seededCues) ? structuredClone(seededCues) : [];
        sentenceSourceKey = sentenceTrackKey();
        sentenceStateLoadedKey = sentenceStateStorageKey();
        sentenceStateLoadedGen = navigateGen;
        sentenceStateLoad = Promise.resolve();
        sentenceUndoRevisions = {};
        sentenceUndoAppliedRevisions = {};
        sentenceUndoIds = new Set();
        sentenceCandidates = {};
        sentenceTranslations = {};
        sentenceTokens = {};
        listDirty = true;
        refreshSentenceProjection(true);
      },
      seedSentenceCandidatesForTest: (value) => {
        sentenceCandidates = value && typeof value === "object" ? structuredClone(value) : {};
        refreshSentenceProjection(true);
      },
      getSentenceStateForTest: () => ({
        candidates: sentenceCandidates,
        undoRevisions: sentenceUndoRevisions,
        undoAppliedRevisions: sentenceUndoAppliedRevisions,
      }),
      setAudioListeningForTest: (value) => { audioListeningActive = !!value; },
      getCues: () => cues,
      setCuesForTest: (newCues) => { cues = newCues; },
      setCurrentSourceForTest: (src) => { currentSource = src; },
      triggerGeminiTranslationIfNeededForTest: (force) => triggerGeminiTranslationIfNeeded(force),
      getSettings: () => settings,
      getCaptionMode: () => captionMode,
    };
  }
})();
