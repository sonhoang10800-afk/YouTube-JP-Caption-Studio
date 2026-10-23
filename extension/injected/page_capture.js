/**
 * Page-world helpers: media time, seek/play, YouTube timedtext cues.
 * ROI capture retained for debug only — product path is caption-only.
 */
(function () {
  // Bump when message API changes so content can reinject after extension reload
  // without a full YouTube document reload (SPA keeps old MAIN-world listeners).
  const API_VER = 7;
  if (window.__HARDSubOCRCapture?.apiVer === API_VER) return;
  // Capability token from the content script's inject element (data-cap; older
  // builds used ?cap= in the URL — still parsed as fallback). Echoed in every
  // reply so the content script can reject forged page-world messages.
  let CAP_TOKEN = "";
  try {
    const el = document.currentScript || document.getElementById("hardsub-ocr-page-script");
    CAP_TOKEN = String(el?.dataset?.cap || "");
    if (!CAP_TOKEN) {
      CAP_TOKEN =
        String(el?.src || "")
          .split("?")[1]
          ?.match(/(?:^|&)cap=([^&]+)/)?.[1] || "";
      if (CAP_TOKEN) CAP_TOKEN = decodeURIComponent(CAP_TOKEN);
    }
  } catch (_) {
    CAP_TOKEN = "";
  }
  // The content script mints a fresh token per inject and rewrites the marker.
  // A reinject can race this script's startup (marker absent or replaced), which
  // used to freeze an empty token at load time and made the content script
  // reject every reply. Resolve the token at send time; cached value is fallback.
  function currentCap() {
    try {
      const el = document.getElementById("hardsub-ocr-page-script");
      const cap = String(el?.dataset?.cap || "");
      if (cap) {
        CAP_TOKEN = cap;
        return cap;
      }
    } catch (_) {}
    return CAP_TOKEN;
  }
  if (typeof window.__hardsubPageMsgHandler === "function") {
    try {
      window.removeEventListener("message", window.__hardsubPageMsgHandler);
    } catch (_) {}
  }
  // Reply to this page only — a "*" target would hand the payload to whatever
  // document the window hosts next. Opaque origins ("null") have no matching
  // targetOrigin; the extension never runs on them, so they keep "*".
  const PAGE_TARGET_ORIGIN = location.origin === "null" ? "*" : location.origin;

  const state = {
    video: null,
    roi: { top: 0.72, left: 0.05, width: 0.9, height: 0.22 },
    targetHeight: 200,
    captions: {
      videoId: "",
      cues: [], // { start, end, text }
      track: null,
      status: "idle", // idle|loading|ok|none|error
      error: "",
    },
    // Like YSD SUBS_LINK: capture timedtext URL/body when the player fetches it.
    timedtext: {
      url: "",
      videoId: "",
      body: "",
      cues: [],
    },
  };

  /** videoId for which we already tried player.setOption captions (once per video). */
  let ccTriggerVideoId = "";

  function findVideo() {
    return document.querySelector("video.html5-main-video") || document.querySelector("video");
  }

  function bindVideo() {
    state.video = findVideo();
    return !!state.video;
  }

  function captureRoi() {
    const video = state.video || findVideo();
    if (!video || video.readyState < 2 || !video.videoWidth) {
      return { ok: false, reason: "no_video", paused: !!(video && video.paused) };
    }
    if (video.paused) {
      return {
        ok: true,
        paused: true,
        mediaTime: video.currentTime || 0,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
      };
    }
    state.video = video;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const sx = Math.floor(vw * state.roi.left);
    const sy = Math.floor(vh * state.roi.top);
    const sw = Math.max(1, Math.floor(vw * state.roi.width));
    const sh = Math.max(1, Math.floor(vh * state.roi.height));

    const scale = state.targetHeight / sh;
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = state.targetHeight;

    const canvas = document.createElement("canvas");
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    try {
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);
    } catch (err) {
      return { ok: false, reason: "taint_or_draw", message: String(err) };
    }

    let dataUrl;
    try {
      dataUrl = canvas.toDataURL("image/webp", 0.85);
      if (!dataUrl || dataUrl.length < 32) {
        dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      }
    } catch (err) {
      return { ok: false, reason: "taint", message: String(err) };
    }

    return {
      ok: true,
      paused: false,
      dataUrl,
      mediaTime: video.currentTime || 0,
      videoWidth: vw,
      videoHeight: vh,
    };
  }

  function getMediaTime() {
    const video = state.video || findVideo();
    if (!video) return { ok: false, reason: "no_video", mediaTime: 0, paused: true };
    state.video = video;
    return {
      ok: true,
      mediaTime: video.currentTime || 0,
      paused: !!video.paused,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
    };
  }

  function seekTo(t) {
    const sec = Math.max(0, Number(t) || 0);
    const nflx = getNetflixPlayer();
    if (nflx && typeof nflx.seek === "function") {
      try {
        nflx.seek(Math.round(sec * 1000));
        return true;
      } catch (_) {}
    }
    const video = state.video || findVideo();
    if (!video) return false;
    video.currentTime = sec;
    return true;
  }

  function playAt(t) {
    const sec = Math.max(0, Number(t) || 0);
    const nflx = getNetflixPlayer();
    if (nflx && typeof nflx.seek === "function") {
      try {
        nflx.seek(Math.round(sec * 1000));
        if (typeof nflx.play === "function") nflx.play();
        return { ok: true };
      } catch (_) {}
    }
    const video = state.video || findVideo();
    if (!video) return { ok: false, reason: "no_video" };
    video.currentTime = sec;
    const playResult = video.play();
    if (playResult && typeof playResult.then === "function") {
      playResult.catch(() => {});
    }
    return { ok: true };
  }

  function videoIdFromLocation() {
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

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Race a promise against a timeout — settles with the first to finish. */
  function withTimeout(promise, ms) {
    let timer = null;
    return Promise.race([
      promise,
      new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error(`timeout_${ms}`)), ms);
      }),
    ]).finally(() => clearTimeout(timer));
  }

  function prVideoId(pr) {
    return pr?.videoDetails?.videoId || pr?.videoDetails?.id || "";
  }

  function tracksFromPr(pr) {
    return pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  }

  function parseJsonObjectAt(text, start) {
    let i = start;
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (text[i] !== "{") return null;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < text.length; j += 1) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") depth += 1;
      else if (c === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(i, j + 1));
          } catch (_) {
            return null;
          }
        }
      }
    }
    return null;
  }

  function scrapePlayerResponseFromDom(wantId) {
    const scripts = document.getElementsByTagName("script");
    for (let i = 0; i < scripts.length; i += 1) {
      const text = scripts[i].textContent || "";
      if (!text.includes("ytInitialPlayerResponse")) continue;
      const marker = text.indexOf("ytInitialPlayerResponse");
      const eq = text.indexOf("=", marker);
      if (eq < 0) continue;
      const pr = parseJsonObjectAt(text, eq + 1);
      if (!pr || typeof pr !== "object") continue;
      const id = prVideoId(pr);
      if (wantId && id && id !== wantId) continue;
      if (tracksFromPr(pr).length) return pr;
      if (!wantId || !id || id === wantId) {
        // keep scanning for a PR that has captions
      }
    }
    return null;
  }

  function getPlayerResponse(wantId) {
    const candidates = [];
    try {
      const player =
        document.getElementById("movie_player") ||
        document.querySelector(".html5-video-player");
      if (player && typeof player.getPlayerResponse === "function") {
        const pr = player.getPlayerResponse();
        if (pr) candidates.push(pr);
      }
    } catch (_) {}
    try {
      if (window.ytInitialPlayerResponse) candidates.push(window.ytInitialPlayerResponse);
    } catch (_) {}
    try {
      const raw = window.ytplayer?.config?.args?.player_response;
      if (typeof raw === "string" && raw) candidates.push(JSON.parse(raw));
      else if (raw && typeof raw === "object") candidates.push(raw);
    } catch (_) {}

    let best = null;
    for (const pr of candidates) {
      if (!pr) continue;
      const id = prVideoId(pr);
      if (wantId && id && id !== wantId) continue;
      if (tracksFromPr(pr).length) return pr;
      if (!best) best = pr;
    }
    if (best) return best;
    return scrapePlayerResponseFromDom(wantId);
  }

  function ytcfgGet(key) {
    try {
      if (window.ytcfg && typeof window.ytcfg.get === "function") {
        const v = window.ytcfg.get(key);
        if (v != null) return v;
      }
    } catch (_) {}
    try {
      const data = window.ytcfg?.data_;
      if (data && data[key] != null) return data[key];
    } catch (_) {}
    return null;
  }

  async function fetchPlayerViaInnertube(videoId) {
    const attempts = [];
    // ANDROID / IOS clients return usable timedtext URLs without POT; anonymous omit credentials.
    attempts.push({
      clientName: "ANDROID",
      clientVersion: "20.10.38",
      androidSdkVersion: 30,
      credentials: "omit",
    });
    attempts.push({
      clientName: "IOS",
      clientVersion: "19.45.4",
      deviceModel: "iPhone14,5",
      credentials: "omit",
    });
    const apiKey =
      ytcfgGet("INNERTUBE_API_KEY") || "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
    let clientName = ytcfgGet("INNERTUBE_CLIENT_NAME") || "WEB";
    if (typeof clientName === "number") clientName = "WEB";
    const clientVersion = ytcfgGet("INNERTUBE_CLIENT_VERSION") || "2.20240701.00.00";
    attempts.push({
      clientName: String(clientName),
      clientVersion: String(clientVersion),
      useKey: true,
      credentials: "same-origin",
    });

    for (const client of attempts) {
      try {
        const url = client.useKey
          ? `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}`
          : "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
        const bodyClient = {
          clientName: client.clientName,
          clientVersion: client.clientVersion,
          hl: document.documentElement.lang || "ja",
        };
        if (client.androidSdkVersion) bodyClient.androidSdkVersion = client.androidSdkVersion;
        if (client.deviceModel) bodyClient.deviceModel = client.deviceModel;
        const res = await fetch(url, {
          method: "POST",
          credentials: client.credentials || "omit",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context: { client: bodyClient },
            videoId,
            contentCheckOk: true,
            racyCheckOk: true,
          }),
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (tracksFromPr(data).length) return data;
      } catch (_) {
        /* next client */
      }
    }
    return null;
  }

  function decodeEntities(s) {
    return String(s || "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  }

  function parseTimedtextXml(xml) {
    // YSD parseYouTubeSubtitles: <text start="" dur="">
    const textCues = [];
    const textNodes = [];
    const textRe = /<text\s+([^>]*)>([\s\S]*?)<\/text>/gi;
    let m;
    while ((m = textRe.exec(xml))) {
      const attrs = m[1] || "";
      const start = Number((attrs.match(/\bstart="([\d.]+)"/) || [])[1] || 0);
      const dur = Number((attrs.match(/\bdur="([\d.]+)"/) || [])[1] || 0);
      const text = decodeEntities(
        (m[2] || "")
          .replace(/<br\s*\/?>/gi, " ")
          .replace(/<[^>]+>/g, "")
          .replace(/\n+/g, " ")
          .replace(/\s+/g, " ")
          .trim()
      );
      textNodes.push({ start, dur, text });
    }
    for (let i = 0; i < textNodes.length; i += 1) {
      const n = textNodes[i];
      if (!n.text) continue;
      const next = textNodes[i + 1];
      const hasDur = n.dur != null && Number.isFinite(n.dur) && n.dur > 0;
      let end = hasDur
        ? Math.round((n.start + n.dur) * 1000) / 1000
        : (next ? next.start : n.start + 2);
      if (end <= n.start) {
        end = n.start + 0.2;
      }
      textCues.push({ start: n.start, end: end, text: n.text });
    }
    if (textCues.length) return textCues;

    const cues = [];
    const pNodes = [];
    const pRe = /<p\s+([^>]*)>([\s\S]*?)<\/p>/gi;
    while ((m = pRe.exec(xml))) {
      const attrs = m[1] || "";
      const inner = m[2] || "";
      const tMatch = attrs.match(/\bt="(\d+)"/);
      const beginMatch = attrs.match(/\bbegin="([^"]+)"/);
      let t = 0;
      if (tMatch) {
        t = Number(tMatch[1]) / 1000;
      } else if (beginMatch) {
        let val = String(beginMatch[1]).trim();
        if (val.endsWith("s")) val = val.slice(0, -1);
        if (val.includes(":")) {
          const parts = val.split(":").map(Number);
          t = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
        } else {
          t = Number(val) || 0;
        }
      }

      const dRaw = (attrs.match(/\bd="(\d+)"/) || [])[1];
      const endMatch = attrs.match(/\bend="([^"]+)"/);
      let durMs = dRaw != null ? Number(dRaw) : null;
      if (durMs == null && endMatch) {
        let val = String(endMatch[1]).trim();
        if (val.endsWith("s")) val = val.slice(0, -1);
        let endSec = 0;
        if (val.includes(":")) {
          const parts = val.split(":").map(Number);
          endSec = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
        } else {
          endSec = Number(val) || 0;
        }
        if (endSec > t) {
          durMs = Math.round((endSec - t) * 1000);
        }
      }
      const text = decodeEntities(
        inner
          .replace(/<br\s*\/?>/gi, " ")
          .replace(/<[^>]+>/g, "")
          .replace(/\n+/g, " ")
          .replace(/\s+/g, " ")
          .trim()
      );
      if (!text) continue;
      pNodes.push({
        start: t,
        durMs: durMs,
        text,
      });
    }
    for (let i = 0; i < pNodes.length; i += 1) {
      const n = pNodes[i];
      const next = pNodes[i + 1];
      const hasDur = n.durMs != null && Number.isFinite(n.durMs) && n.durMs > 0;
      let end = hasDur
        ? Math.round((n.start + n.durMs / 1000) * 1000) / 1000
        : (next ? next.start : n.start + 2);
      if (end <= n.start) {
        end = n.start + 0.2;
      }
      cues.push({ start: n.start, end: end, text: n.text });
    }
    return cues;
  }

  function parseTimedtextBody(body) {
    const trimmed = String(body || "").trim();
    if (!trimmed) return [];
    if (trimmed[0] === "{") {
      try {
        return parseJson3(JSON.parse(trimmed));
      } catch {
        return [];
      }
    }
    if (trimmed[0] === "<") return parseTimedtextXml(trimmed);
    return [];
  }

  function normalizeTimedtextUrl(url) {
    let u = String(url || "").trim();
    if (u.startsWith("//")) u = `https:${u}`;
    return u;
  }

  function buildTimedtextUrlVariants(baseUrl) {
    const raw = normalizeTimedtextUrl(baseUrl);
    if (!raw) return [];
    const variants = [];
    const add = (u) => {
      if (u && !variants.includes(u)) variants.push(u);
    };
    const isTlang = raw.includes("tlang=");
    const json3 = raw.includes("fmt=json3")
      ? raw
      : raw.includes("fmt=")
        ? raw.replace(/([?&])fmt=[^&]+/, "$1fmt=json3")
        : `${raw}${raw.includes("?") ? "&" : "?"}fmt=json3`;

    if (isTlang) {
      add(json3);
      return variants;
    }
    add(raw);
    if (!raw.includes("fmt=srv3")) {
      const srv3 = raw.includes("fmt=")
        ? raw.replace(/([?&])fmt=[^&]+/, "$1fmt=srv3")
        : `${raw}${raw.includes("?") ? "&" : "?"}fmt=srv3`;
      add(srv3);
    }
    add(json3);
    if (raw.includes("fmt=")) {
      const stripped = raw.replace(/([?&])fmt=[^&]+(&|$)/, (m, p1, p2) => (p2 === "&" ? p1 : "")).replace(/\?$/, "");
      add(stripped);
    }
    return variants;
  }

  async function fetchJson3Cues(url) {
    if (!url) return { cues: [], error: "no_url" };
    const urls = buildTimedtextUrlVariants(url);
    let lastError = "empty_or_html";
    for (const cred of ["omit", "same-origin"]) {
      for (const u of urls) {
        try {
          const res = await fetch(u, {
            credentials: cred,
            cache: "no-store",
            headers: { Accept: "*/*" }
          });
          if (!res.ok) {
            lastError = `http_${res.status}_${cred}`;
            continue;
          }
          const body = await res.text();
          if (!body || !body.trim()) {
            lastError = `empty_${cred}`;
            continue;
          }
          const cues = parseTimedtextBody(body);
          if (cues.length) return { cues, error: "", format: body.trim()[0] === "{" ? "json3" : "xml" };
          lastError = "no_events";
        } catch (err) {
          lastError = String(err);
        }
      }
    }
    return { cues: [], error: lastError };
  }

  /** Lang family aliases: normalized base code → 2-letter family. */
  const LANG_FAMILY_ALIASES = {
    ja: ["ja", "jpn", "jp"],
    en: ["en", "eng"],
    vi: ["vi", "vie", "viet", "vn"],
  };

  /**
   * Match a track lang code (vi, vi-VN, vie, VI, vi_vn, en-US…) to a family
   * (ja / en / vi). Normalizes case + separators; falls back to 3-letter aliases.
   */
  function matchLangFamily(lang, family) {
    const raw = String(lang || "")
      .toLowerCase()
      .replace(/_/g, "-")
      .trim();
    if (!raw) return false;
    const base = raw.split("-")[0];
    const aliases = LANG_FAMILY_ALIASES[family] || [];
    if (aliases.includes(raw) || aliases.includes(base)) return true;
    return raw.startsWith(family + "-");
  }

  function pickBestTrackByPrefix(tracks, prefix) {
    const pref = String(prefix || "").toLowerCase();
    const ranked = (tracks || [])
      .filter(
        (t) =>
          t?.baseUrl &&
          matchLangFamily(t.languageCode, pref)
      )
      .sort((a, b) => (a.kind === "asr" ? 1 : 0) - (b.kind === "asr" ? 1 : 0));
    return ranked[0] || null;
  }

  /**
   * Fetch best ja/en/vi. WEB captionTracks baseUrls often 200+empty (no pot);
   * ANDROID innertube track URLs return real timedtext — rescue when web miss.
   * No setOption per lang. JA only in cues; en/vi stay in secondary packs.
   */
  async function fetchMultiLangCaptions(payload) {
    const videoId = (payload && payload.videoId) || videoIdFromLocation();
    const preferLang = (payload && payload.lang) || "ja";
    if (!videoId) {
      return {
        ok: false,
        reason: "no_video_id",
        cues: [],
        enCues: [],
        viCues: [],
        hasEn: false,
        hasVi: false,
      };
    }

    function toTlangUrl(baseUrl, tlang) {
      if (!baseUrl) return null;
      let base = baseUrl.includes("fmt=")
        ? baseUrl.replace(/([?&])fmt=[^&]+/, "$1fmt=json3")
        : `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}fmt=json3`;
      if (base.includes("tlang=")) {
        base = base.replace(/([?&])tlang=[^&]+/, `$1tlang=${encodeURIComponent(tlang)}`);
      } else {
        base = `${base}&tlang=${encodeURIComponent(tlang)}`;
      }
      return base;
    }

    async function packsFromTracks(tracks) {
      const ja = pickBestTrackByPrefix(tracks, "ja");
      const en = pickBestTrackByPrefix(tracks, "en");
      const vi = pickBestTrackByPrefix(tracks, "vi");
      const enUrl = en?.baseUrl || toTlangUrl(ja?.baseUrl, "en");
      const viUrl = vi?.baseUrl || toTlangUrl(ja?.baseUrl, "vi");
      const [jaGot, enGot, viGot] = await Promise.all([
        ja?.baseUrl ? fetchJson3Cues(ja.baseUrl) : Promise.resolve({ cues: [] }),
        enUrl ? fetchJson3Cues(enUrl) : Promise.resolve({ cues: [] }),
        viUrl ? fetchJson3Cues(viUrl) : Promise.resolve({ cues: [] }),
      ]);
      return { ja, en, vi, jaGot, enGot, viGot };
    }

    let tracks = tracksFromPr(getPlayerResponse(videoId));
    if (!tracks.length) {
      try {
        const waited = await waitForCaptionTracks(videoId, preferLang, 4000);
        tracks = waited?.tracks || tracks;
      } catch (_) {}
    }
    let got = await packsFromTracks(tracks);
    const webMiss =
      !(got.jaGot.cues.length && got.enGot.cues.length && got.viGot.cues.length);
    // WEB listed en/vi but bodies empty → ANDROID URLs (proven non-empty).
    if (webMiss) {
      try {
        const androidPr = await fetchPlayerViaInnertube(videoId);
        const androidTracks = tracksFromPr(androidPr);
        if (androidTracks.length) {
          const a = await packsFromTracks(androidTracks);
          if (!got.jaGot.cues.length && a.jaGot.cues.length) {
            got.ja = a.ja;
            got.jaGot = a.jaGot;
          }
          if (!got.enGot.cues.length && a.enGot.cues.length) {
            got.en = a.en;
            got.enGot = a.enGot;
          }
          if (!got.viGot.cues.length && a.viGot.cues.length) {
            got.vi = a.vi;
            got.viGot = a.viGot;
          }
          if (!tracks.length) tracks = androidTracks;
        }
      } catch (_) {}
    }
    return {
      ok: !!(got.jaGot.cues.length || got.enGot.cues.length || got.viGot.cues.length),
      status: "ok",
      via: webMiss ? "page_multi_android" : "page_multi",
      count: got.jaGot.cues.length,
      cues: got.jaGot.cues,
      enCues: got.enGot.cues,
      viCues: got.viGot.cues,
      hasEn: !!got.en || got.enGot.cues.length > 0,
      hasVi: !!got.vi || got.viGot.cues.length > 0,
      lang: got.ja?.languageCode || "ja",
      asr: got.ja?.kind === "asr",
      sourceTrack: { ...globalThis.HardsubTimedtextParse.sourceTrackInfo(got.ja), format: got.jaGot.format || null },
    };
  }

  function noteTimedtext(url, body) {
    if (!url || !String(url).includes("/api/timedtext")) return;
    let vid = "";
    let lang = "";
    let tlang = "";
    try {
      const u = new URL(String(url), location.origin);
      vid = u.searchParams.get("v") || "";
      lang = u.searchParams.get("lang") || "";
      tlang = u.searchParams.get("tlang") || "";
    } catch (_) {}
    const isJaTrack =
      matchLangFamily(tlang || lang, "ja") ||
      (!tlang && !lang && /[\u3040-\u30ff\u4e00-\u9faf]/.test(body || ""));
    if (isJaTrack) {
      state.timedtext.url = String(url);
      state.timedtext.videoId = vid || videoIdFromLocation();
    }
    if (body && String(body).trim().length > 10) {
      const cues = parseTimedtextBody(body);
      if (cues.length) {
        if (isJaTrack) {
          state.timedtext.body = String(body);
          state.timedtext.cues = cues;
        }
        try {
          window.postMessage(
            {
              type: "__HARDSUB_TIMEDTEXT_CAPTURED__",
              source: "youtube",
              videoId: vid || state.timedtext.videoId,
              count: cues.length,
              url: String(url),
              lang: tlang || lang,
              sourceLang: lang,
              tlang: tlang,
              cues,
              cap: currentCap(),
            },
            PAGE_TARGET_ORIGIN
          );
        } catch (_) {}
      }
    }
  }

  const netflixState = {
    cues: [],
    enCues: [],
    viCues: [],
    tracks: new Map(),
    /** Lang family → the last timedtext URL captured for it (URL-inference base). */
    urlByLang: new Map(),
    /** If extension is actively switching track to probe a specific lang, set here. */
    probingLang: null,
  };

  /** Best guess: is this track a caption/subtitle track (vs audio/dub)? */
  function isTextTrack(t) {
    const type = String(t?.mediaType || t?.type || t?.kind || t?.trackType || t?.rawTrackType || "").toLowerCase();
    return (
      type === "text" ||
      type === "subtitle" ||
      type === "subtitles" ||
      type === "captions" ||
      type === "primary" ||
      type === "assistive" ||
      type.includes("subtitle")
    );
  }

  /** Prefer caption tracks over audible/dub entries when a lang has both. */
  function textPrefer(list) {
    const textOne = (list || []).find(isTextTrack);
    return textOne || (list || [])[0] || null;
  }

  /** If a VI text track exists but we could not pull cues, tell the UI why. */
  let viProbeFailed = false;

  function parseVtt(text) {
    const cues = [];
    const src = String(text || "").replace(/\r\n/g, "\n").trim();
    if (!src) return cues;
    const timeRe = /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/;
    const toSec = (m) =>
      Number(m[1]) * 3600 +
      Number(m[2]) * 60 +
      Number(m[3]) +
      Number(m[4]) / Math.pow(10, String(m[4]).length);
    for (const block of src.split(/\n{2,}/)) {
      const lines = block.split("\n").map((l) => l.trim());
      if (!lines.length || !lines[0]) continue;
      if (/^(WEBVTT|NOTE|STYLE|REGION)\b/i.test(lines[0])) continue;
      let ti = -1;
      for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].includes("-->")) {
          ti = i;
          break;
        }
      }
      if (ti < 0) continue;
      const timing = lines[ti].split("-->");
      const sm = String(timing[0] || "").trim().match(timeRe);
      if (!sm) continue;
      const start = toSec(sm);
      const em = String(timing[1] || "").trim().match(timeRe);
      let end = em ? toSec(em) : start + 2;
      if (!Number.isFinite(end) || end < start) end = start + 2;
      const text = lines
        .slice(ti + 1)
        .join(" ")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!text) continue;
      cues.push({ start, end, text });
    }
    return cues;
  }

  function parseDfxpTime(timeStr, tickRate = 10000000, frameRate = 24) {
    if (!timeStr) return NaN;
    const s = String(timeStr).trim();
    if (!s) return NaN;
    if (s.endsWith("t")) {
      const ticks = Number(s.slice(0, -1));
      return Number.isFinite(ticks) ? ticks / tickRate : NaN;
    }
    if (s.endsWith("ms")) {
      const ms = Number(s.slice(0, -2));
      return Number.isFinite(ms) ? ms / 1000 : NaN;
    }
    if (s.endsWith("s")) {
      const sec = Number(s.slice(0, -1));
      return Number.isFinite(sec) ? sec : NaN;
    }
    if (s.endsWith("f")) {
      const frames = Number(s.slice(0, -1));
      return Number.isFinite(frames) ? frames / frameRate : NaN;
    }
    if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s);
    const parts = s.split(":");
    if (parts.length === 3) {
      const h = Number(parts[0]) || 0;
      const m = Number(parts[1]) || 0;
      let secPart = parts[2];
      let sec = 0;
      let frames = 0;
      if (secPart.includes(".")) {
        sec = Number(secPart) || 0;
      } else if (secPart.includes(":")) {
        const sub = secPart.split(":");
        sec = Number(sub[0]) || 0;
        frames = Number(sub[1]) || 0;
      } else {
        sec = Number(secPart) || 0;
      }
      return h * 3600 + m * 60 + sec + (frames > 0 ? frames / frameRate : 0);
    } else if (parts.length === 2) {
      const m = Number(parts[0]) || 0;
      const sec = Number(parts[1]) || 0;
      return m * 60 + sec;
    }
    return NaN;
  }

  function parseDfxpText(xmlString) {
    if (!xmlString || typeof xmlString !== "string") return [];
    let tickRate = 10000000;
    let frameRate = 24;
    const tickRateMatch = xmlString.match(/ttp:tickRate=["']?(\d+)["']?/i) || xmlString.match(/tickRate=["']?(\d+)["']?/i);
    if (tickRateMatch && Number(tickRateMatch[1]) > 0) tickRate = Number(tickRateMatch[1]);
    const frameRateMatch = xmlString.match(/ttp:frameRate=["']?(\d+)["']?/i) || xmlString.match(/frameRate=["']?(\d+)["']?/i);
    if (frameRateMatch && Number(frameRateMatch[1]) > 0) frameRate = Number(frameRateMatch[1]);

    function cleanText(inner) {
      if (!inner) return "";
      return inner
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .join("\n")
        .trim();
    }

    function extractTiming(attrs, parentStart = NaN, parentEnd = NaN) {
      if (!attrs) return { start: parentStart, end: parentEnd };
      const beginMatch = attrs.match(/\bbegin=["']([^"']+)["']/i);
      const endMatch = attrs.match(/\bend=["']([^"']+)["']/i);
      const durMatch = attrs.match(/\bdur=["']([^"']+)["']/i);

      let start = beginMatch ? parseDfxpTime(beginMatch[1], tickRate, frameRate) : parentStart;
      let end = endMatch ? parseDfxpTime(endMatch[1], tickRate, frameRate) : parentEnd;
      if (!Number.isFinite(end) && durMatch && Number.isFinite(start)) {
        const dur = parseDfxpTime(durMatch[1], tickRate, frameRate);
        if (Number.isFinite(dur)) end = start + dur;
      }
      return { start, end };
    }

    const cues = [];

    // Pass 1: Parse <div> blocks with timing
    const divRegex = /<div\b([^>]*)>([\s\S]*?)<\/div>/gi;
    let divMatch;
    while ((divMatch = divRegex.exec(xmlString)) !== null) {
      const divAttrs = divMatch[1];
      const divContent = divMatch[2];
      const divTiming = extractTiming(divAttrs);

      const pRegex = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
      let pMatch;
      let divHasP = false;
      while ((pMatch = pRegex.exec(divContent)) !== null) {
        divHasP = true;
        const pAttrs = pMatch[1];
        const pContent = pMatch[2];
        const pTiming = extractTiming(pAttrs, divTiming.start, divTiming.end);

        // Check if spans inside p have their own timing
        const spanRegex = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi;
        let spanMatch;
        let spanCount = 0;
        while ((spanMatch = spanRegex.exec(pContent)) !== null) {
          const sAttrs = spanMatch[1];
          const sContent = spanMatch[2];
          if (/\bbegin=["']/i.test(sAttrs)) {
            const sTiming = extractTiming(sAttrs, pTiming.start, pTiming.end);
            const text = cleanText(sContent);
            if (Number.isFinite(sTiming.start) && text) {
              let end = Number.isFinite(sTiming.end) && sTiming.end > sTiming.start ? sTiming.end : sTiming.start + 2.0;
              cues.push({
                start: Math.round(sTiming.start * 1000) / 1000,
                end: Math.round(end * 1000) / 1000,
                text,
              });
              spanCount++;
            }
          }
        }

        if (spanCount === 0) {
          const text = cleanText(pContent);
          let start = pTiming.start;
          let end = pTiming.end;
          if (Number.isFinite(start) && text) {
            if (!Number.isFinite(end) || end <= start) end = start + 2.0;
            cues.push({
              start: Math.round(start * 1000) / 1000,
              end: Math.round(end * 1000) / 1000,
              text,
            });
          }
        }
      }

      if (!divHasP && Number.isFinite(divTiming.start)) {
        const text = cleanText(divContent);
        if (text) {
          let end = Number.isFinite(divTiming.end) && divTiming.end > divTiming.start ? divTiming.end : divTiming.start + 2.0;
          cues.push({
            start: Math.round(divTiming.start * 1000) / 1000,
            end: Math.round(end * 1000) / 1000,
            text,
          });
        }
      }
    }

    // Fallback: If no cues found via div-tree, parse all <p> and <span> globally
    if (!cues.length) {
      const pTagRegex = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
      let match;
      while ((match = pTagRegex.exec(xmlString)) !== null) {
        const attrs = match[1];
        const innerContent = match[2];
        const timing = extractTiming(attrs);
        const text = cleanText(innerContent);
        if (Number.isFinite(timing.start) && text) {
          let end = Number.isFinite(timing.end) && timing.end > timing.start ? timing.end : timing.start + 2.0;
          cues.push({
            start: Math.round(timing.start * 1000) / 1000,
            end: Math.round(end * 1000) / 1000,
            text,
          });
        }
      }
    }

    // Dedup and sort
    const seen = new Set();
    const result = [];
    cues.sort((a, b) => a.start - b.start || a.end - b.end);
    for (const c of cues) {
      const key = `${c.start.toFixed(3)}_${c.end.toFixed(3)}_${c.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(c);
    }
    return result;
  }

  function parseSubtitlePayload(text) {
    if (!text || typeof text !== "string") return [];
    const t = text.trim();
    if (t.startsWith("WEBVTT") || t.includes("-->")) {
      const vtt = parseVtt(t);
      if (vtt.length) return vtt;
    }
    if (t.includes("<tt") || t.includes("<p") || t.includes("<div") || t.startsWith("<?xml")) {
      const dfxp = parseDfxpText(t);
      if (dfxp.length) return dfxp;
    }
    const dfxp = parseDfxpText(t);
    if (dfxp.length) return dfxp;
    return parseVtt(t);
  }

  function detectSubtitleLang(text, cues, url) {
    if (netflixState.probingLang) {
      return netflixState.probingLang;
    }
    const langMatch =
      String(text || "").match(/xml:lang=["']([^"']+)["']/i) ||
      String(text || "").match(/Language:\s*([a-zA-Z-]+)/i) ||
      String(url || "").match(/[?&](?:lang|language|bcp47|l)=([a-zA-Z-]+)/i);
    if (langMatch) {
      const l = langMatch[1].toLowerCase();
      if (matchLangFamily(l, "ja")) return "ja";
      if (matchLangFamily(l, "vi")) return "vi";
      if (matchLangFamily(l, "en")) return "en";
      return l;
    }
    // Scan up to 100 cues for accurate character classification
    const sample = (cues || []).slice(0, 100).map((c) => c.text).join(" ");
    if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(sample)) {
      return "ja";
    }
    if (/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđĐ]/.test(sample)) {
      return "vi";
    }
    if (/[a-zA-Z]/.test(sample)) {
      return "en";
    }
    return "";
  }

  function noteNetflixTimedtext(url, text) {
    if (!text || typeof text !== "string") return;
    const cues = parseSubtitlePayload(text);
    if (!cues.length) return;

    const lang = detectSubtitleLang(text, cues, String(url || ""));
    if (lang) netflixState.urlByLang.set(lang, String(url));

    if (matchLangFamily(lang, "ja")) {
      netflixState.cues = cues;
      netflixState.tracks.set("ja", cues);
    } else if (matchLangFamily(lang, "en")) {
      netflixState.enCues = cues;
      netflixState.tracks.set("en", cues);
    } else if (matchLangFamily(lang, "vi")) {
      netflixState.viCues = cues;
      netflixState.tracks.set("vi", cues);
    } else {
      netflixState.tracks.set(lang || "unknown", cues);
      if (!netflixState.cues.length) {
        netflixState.cues = cues;
      }
    }
    try {
      window.postMessage(
        {
          type: "__HARDSUB_TIMEDTEXT_CAPTURED__",
          source: "netflix",
          lang,
          count: cues.length,
          cap: currentCap(),
        },
        PAGE_TARGET_ORIGIN
      );
    } catch (_) {}
  }

  const NETFLIX_URL_RE = /nflxvideo\.(net|com)|nflxext\.com|nflxso\.net|nflximg\.net|netflix\.com|oca\.nflx|\.dfxp|\.vtt|timedtext|subtitles/i;
  function isNetflixUrl(u) {
    return NETFLIX_URL_RE.test(String(u || ""));
  }

  function installTimedtextHooks() {
    if (window.__hardsubTimedtextHooks) return;
    window.__hardsubTimedtextHooks = true;
    const origFetch = window.fetch;
    window.fetch = async function (...args) {
      const res = await origFetch.apply(this, args);
      try {
        const req = args[0];
        const url = typeof req === "string" ? req : req && req.url ? req.url : "";
        if (url) {
          const uStr = String(url);
          if (uStr.includes("/api/timedtext")) {
            res
              .clone()
              .text()
              .then((t) => noteTimedtext(url, t))
              .catch(() => noteTimedtext(url, ""));
          } else if (isNetflixUrl(uStr)) {
            res
              .clone()
              .text()
              .then((t) => noteNetflixTimedtext(url, t))
              .catch(() => {});
          }
        }
      } catch (_) {}
      return res;
    };

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__hardsubTtUrl = url;
      return origOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener("load", function () {
        try {
          if (this.__hardsubTtUrl) {
            const uStr = String(this.__hardsubTtUrl);
            if (uStr.includes("/api/timedtext")) {
              noteTimedtext(this.__hardsubTtUrl, this.responseText || "");
            } else if (isNetflixUrl(uStr)) {
              noteNetflixTimedtext(this.__hardsubTtUrl, this.responseText || "");
            }
          }
        } catch (_) {}
      });
      return origSend.apply(this, args);
    };
  }

  function hasInterceptForVideo(videoId) {
    if (!videoId) return false;
    const tt = state.timedtext;
    if (tt.videoId && tt.videoId !== videoId) return false;
    return !!(tt.cues?.length || (tt.body && String(tt.body).trim().length > 10) || tt.url);
  }

  /**
   * Last-resort: enable JA player CC so timedtext intercept can fire.
   * Once per videoId — never spam setOption; never flip player to en/vi.
   */
  function tryEnablePlayerCaptions(videoId, _preferLang) {
    const vid = String(videoId || "").trim();
    if (!vid) return false;
    if (ccTriggerVideoId === vid) return false;
    if (hasInterceptForVideo(vid)) {
      ccTriggerVideoId = vid;
      return false;
    }
    try {
      const player =
        document.getElementById("movie_player") ||
        document.querySelector(".html5-video-player");
      if (!player) return false;
      if (typeof player.loadModule === "function") {
        try {
          player.loadModule("captions");
        } catch (_) {}
      }
      // JA-only hygiene — never setOption to en/vi for secondary fill.
      const list =
        (typeof player.getOption === "function" &&
          player.getOption("captions", "tracklist")) ||
        [];
      const cur =
        typeof player.getOption === "function"
          ? player.getOption("captions", "track")
          : null;
      const curLang = String(
        cur?.languageCode || cur?.translationLanguage || ""
      ).toLowerCase();
      if (curLang.startsWith("ja")) {
        ccTriggerVideoId = vid;
        return false;
      }
      if (Array.isArray(list) && list.length && typeof player.setOption === "function") {
        let best = null;
        for (const t of list) {
          const lang = String(t.languageCode || t.translationLanguage || "").toLowerCase();
          if (lang.startsWith("ja")) {
            best = t;
            break;
          }
        }
        if (!best) {
          ccTriggerVideoId = vid;
          return false;
        }
        player.setOption("captions", "track", best);
        ccTriggerVideoId = vid;
        return true;
      }
      ccTriggerVideoId = vid;
      return false;
    } catch (_) {
      ccTriggerVideoId = vid;
      return false;
    }
  }

  async function waitForInterceptedCues(videoId, maxMs = 2500) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      if (
        state.timedtext.cues?.length &&
        (!state.timedtext.videoId || state.timedtext.videoId === videoId)
      ) {
        return state.timedtext.cues;
      }
      await sleep(200);
    }
    return null;
  }

  async function waitForCaptionTracks(videoId, preferLang, maxMs = 8000) {
    const t0 = Date.now();
    let lastPr = null;
    let innertubeTried = false;
    while (Date.now() - t0 < maxMs) {
      let pr = getPlayerResponse(videoId);
      if ((!pr || !tracksFromPr(pr).length) && !innertubeTried && Date.now() - t0 > 400) {
        innertubeTried = true;
        try {
          const fromApi = await fetchPlayerViaInnertube(videoId);
          if (fromApi) pr = fromApi;
        } catch (_) {}
      }
      lastPr = pr || lastPr;
      const tracks = tracksFromPr(pr);
      if (tracks.length) {
        const track = pickCaptionTrack(tracks, preferLang);
        if (track?.baseUrl) return { pr, track, tracks };
      }
      await sleep(250);
    }
    if (!innertubeTried) {
      try {
        const fromApi = await fetchPlayerViaInnertube(videoId);
        if (fromApi) lastPr = fromApi;
      } catch (_) {}
    }
    const tracks = tracksFromPr(lastPr);
    return { pr: lastPr, track: pickCaptionTrack(tracks, preferLang), tracks };
  }

  async function fetchTimedtextFallback(videoId, preferLang) {
    const langs =
      preferLang === "en"
        ? ["en", "ja", "ja-orig"]
        : preferLang === "auto"
          ? ["ja", "ja-orig", "en"]
          : [preferLang, "ja", "ja-orig", "en"];
    const seen = new Set();
    for (const lang of langs) {
      if (!lang || seen.has(lang)) continue;
      seen.add(lang);
      for (const kind of ["asr", ""]) {
        const params = new URLSearchParams({
          v: videoId,
          lang,
          fmt: "json3",
        });
        if (kind) params.set("kind", "asr");
        try {
          const got = await fetchJson3Cues(
            `https://www.youtube.com/api/timedtext?${params.toString()}`
          );
          if (got.cues.length) {
            return { cues: got.cues, lang, asr: kind === "asr" || lang.includes("orig") };
          }
        } catch (_) {}
      }
    }
    return null;
  }

  function okCaptionResult(cues, trackMeta, extra = {}) {
    state.captions.track = trackMeta;
    state.captions.sourceTrack = extra.sourceTrack || null;
    state.captions.cues = cues;
    state.captions.status = "ok";
    state.captions.error = "";
    return {
      ok: true,
      status: "ok",
      count: cues.length,
      cues: cues.map((c) => ({ ...c })),
      lang: trackMeta.languageCode || "",
      asr: trackMeta.kind === "asr",
      ...extra,
    };
  }

  async function loadCaptions(payload) {
    const videoId = (payload && payload.videoId) || videoIdFromLocation();
    const preferLang = (payload && payload.lang) || "ja";
    if (!videoId) {
      state.captions = { videoId: "", cues: [], track: null, status: "none", error: "no_video_id" };
      return { ok: false, reason: "no_video_id", status: "none", count: 0, cues: [] };
    }
    if (
      !(payload && payload.force) &&
      state.captions.videoId === videoId &&
      state.captions.status === "ok" &&
      state.captions.cues.length
    ) {
      return okCaptionResult(state.captions.cues, state.captions.track || {},
        { sourceTrack: state.captions.sourceTrack || null });
    }
    // force Reload may need another CC trigger for this video.
    if (payload && payload.force && ccTriggerVideoId === videoId) {
      ccTriggerVideoId = "";
    }
    state.captions = { videoId, cues: [], track: null, status: "loading", error: "" };
    try {
      // Last-resort once-per-videoId: enable CC only if intercept has nothing yet.
      tryEnablePlayerCaptions(videoId, preferLang);
      const intercepted = await waitForInterceptedCues(videoId, 900);
      if (intercepted?.length) {
        const detected = detectSubtitleLang(state.timedtext.body, intercepted, state.timedtext.url) || "";
        if (matchLangFamily(detected, preferLang) || (!detected && preferLang === "ja")) {
          return okCaptionResult(
            intercepted,
            {
              languageCode: detected || preferLang,
              kind: "asr",
              name: "intercept",
            },
            { via: "intercept", baseUrl: state.timedtext.url || "" }
          );
        }
      }

      const { track, tracks } = await waitForCaptionTracks(videoId, preferLang, 8000);
      let lastFetchError = "";

      const tryTracks = [];
      if (state.timedtext.url && (!state.timedtext.videoId || state.timedtext.videoId === videoId)) {
        const ttLang = detectSubtitleLang(state.timedtext.body, state.timedtext.cues, state.timedtext.url);
        if (matchLangFamily(ttLang, preferLang)) {
          tryTracks.push({
            baseUrl: state.timedtext.url,
            languageCode: ttLang,
            kind: "asr",
            name: { simpleText: "intercept-url" },
            trackKnown: false,
          });
        }
      }
      if (track?.baseUrl && matchLangFamily(track.languageCode, preferLang)) tryTracks.push(track);
      for (const t of tracks || []) {
        if (t?.baseUrl && t !== track && matchLangFamily(t.languageCode, preferLang)) tryTracks.push(t);
      }

      for (const t of tryTracks) {
        const got = await fetchJson3Cues(t.baseUrl);
        if (got.cues.length) {
          return okCaptionResult(got.cues, {
            languageCode: t.languageCode || "",
            kind: t.kind || "",
            name: t.name?.simpleText || "",
          }, { sourceTrack: { ...globalThis.HardsubTimedtextParse.sourceTrackInfo(t.trackKnown === false ? null : t), format: got.format || null } });
        }
        lastFetchError = got.error || lastFetchError;
      }

      // Fresh Innertube tracks if player PR URLs returned empty HTML.
      try {
        const fromApi = await fetchPlayerViaInnertube(videoId);
        const apiTracks = tracksFromPr(fromApi);
        const t = pickCaptionTrack(apiTracks, preferLang);
        if (t?.baseUrl) {
          const got = await fetchJson3Cues(t.baseUrl);
          if (got.cues.length) {
            return okCaptionResult(
              got.cues,
              {
                languageCode: t.languageCode || "",
                kind: t.kind || "",
                name: t.name?.simpleText || "innertube",
              },
              { via: "innertube", sourceTrack: { ...globalThis.HardsubTimedtextParse.sourceTrackInfo(t), format: got.format || null } }
            );
          }
          lastFetchError = got.error || lastFetchError;
        }
      } catch (_) {}

      const fb = await fetchTimedtextFallback(videoId, preferLang);
      if (fb?.cues?.length) {
        return okCaptionResult(
          fb.cues,
          {
            languageCode: fb.lang || "",
            kind: fb.asr ? "asr" : "",
            name: "timedtext-fallback",
          },
          { fallback: true }
        );
      }

      // Native TextTracks fallback: if the player already decoded cues onto <video>
      const nativeFallback = fetchNativeTextTrackCues();
      if (nativeFallback?.ok && nativeFallback.cues.length) {
        return okCaptionResult(
          nativeFallback.cues,
          {
            languageCode: preferLang || "ja",
            kind: "asr",
            name: "video-texttracks",
          },
          { via: "text_tracks" }
        );
      }

      const reason =
        (tracks && tracks.length) || tryTracks.length
          ? lastFetchError || "timedtext_empty"
          : "no_tracks";
      state.captions.status = "none";
      state.captions.error = reason;
      return {
        ok: false,
        reason,
        status: "none",
        count: 0,
        cues: [],
        trackCount: (tracks && tracks.length) || 0,
        baseUrl: tryTracks[0]?.baseUrl || track?.baseUrl || state.timedtext.url || "",
        lang: tryTracks[0]?.languageCode || track?.languageCode || "",
        asr: (tryTracks[0] || track)?.kind === "asr",
      };
    } catch (err) {
      state.captions.status = "error";
      state.captions.error = String(err);
      return {
        ok: false,
        reason: "exception",
        message: String(err),
        status: "error",
        count: 0,
        cues: [],
      };
    }
  }

  /** Read-only: never call tryEnablePlayerCaptions (poll path must not stutter player). */
  function getTimedtextLink(payload) {
    const videoId = (payload && payload.videoId) || videoIdFromLocation();
    const preferLang = (payload && payload.lang) || "ja";
    const pr = getPlayerResponse(videoId);
    const tracks = tracksFromPr(pr);
    const track = pickCaptionTrack(tracks, preferLang);
    let ttLang = "";
    try {
      ttLang = new URL(state.timedtext.url, location.href).searchParams.get("lang") || "";
    } catch (_) {}
    const preferIsJa = matchLangFamily(preferLang, "ja");
    const ttMatches = preferIsJa ? (!ttLang || matchLangFamily(ttLang, "ja")) : true;
    const url = normalizeTimedtextUrl(
      track?.baseUrl ||
        (ttMatches && state.timedtext.videoId === videoId && state.timedtext.url) ||
        (ttMatches && state.timedtext.url) ||
        ""
    );
    const cuesForVid =
      ttMatches &&
      state.timedtext.cues?.length &&
      (!state.timedtext.videoId || state.timedtext.videoId === videoId)
        ? state.timedtext.cues
        : [];
    // JA-only: mark ccTrigger when intercept lang is ja (not en/vi).
    let urlLang = "";
    try {
      urlLang = new URL(url, location.href).searchParams.get("lang") || "";
    } catch (_) {}
    if (cuesForVid.length && String(urlLang).toLowerCase().startsWith("ja")) {
      ccTriggerVideoId = videoId;
    }
    return {
      ok: !!url || !!cuesForVid.length,
      baseUrl: url,
      videoId,
      lang: track?.languageCode || (ttMatches ? urlLang : "") || "",
      asr: track?.kind === "asr",
      intercepted: !!cuesForVid.length,
      cues: cuesForVid,
    };
  }

  function scoreTrack(track, preferLang) {
    const lang = String(track.languageCode || "").toLowerCase();
    const prefer = String(preferLang || "ja").toLowerCase();
    const asr = track.kind === "asr";
    let s = 0;
    if (prefer === "auto") {
      if (matchLangFamily(lang, "ja")) s += 90;
      else if (matchLangFamily(lang, "en")) s += 40;
    } else if (matchLangFamily(lang, prefer)) {
      s += 100;
    } else if (matchLangFamily(lang, "ja")) {
      s += 70;
    }
    if (!asr && s > 0) s += 25;
    return s;
  }

  /** All <track> subtitle sources across every <video> on the page (dedup). */
  function collectTrackSources() {
    const out = [];
    const seen = new Set();
    for (const v of document.querySelectorAll("video")) {
      for (const tr of v.querySelectorAll("track")) {
        const src = tr.src || tr.getAttribute("src") || "";
        if (!src || seen.has(src)) continue;
        seen.add(src);
        out.push({ src, lang: tr.srclang || tr.label || "" });
      }
    }
    return out;
  }

  /** Which site family this tab belongs to — content maps to a scrubbed storage key. */
  function pageInfo() {
    let source = "web";
    try {
      const h = location.hostname;
      if (h === "www.youtube.com" || h === "youtube.com" || h.endsWith("youtube-nocookie.com")) {
        source = "youtube";
      } else if (h === "abema.tv" || h.endsWith(".abema.tv")) {
        source = "abema";
      } else if (h === "netflix.com" || h.endsWith(".netflix.com")) {
        source = "netflix";
      }
    } catch (_) {}
    let id = "";
    if (source === "netflix") {
      const nm = String(location.pathname || "").match(/\/(?:watch|title)\/(\d+)/);
      if (nm && nm[1]) id = nm[1];
    }
    if (!id) {
      const rawPath = String(location.pathname || "").replace(/\/+$/, "");
      id = rawPath.split("/").filter(Boolean).pop() || "";
    }
    let title = "";
    try {
      title = String(document.title || "")
        .replace(/\s*-\s*([^|-]+)$/i, "")
        .trim();
    } catch (_) {}
    return {
      ok: true,
      source,
      id,
      url: location.href,
      title,
      host: location.hostname,
    };
  }

  function getNetflixPlayer() {
    try {
      const vp = window.netflix?.appContext?.state?.playerApp?.getAPI()?.videoPlayer;
      if (!vp) return null;
      const sessionIds = vp.getAllPlayerSessionIds ? vp.getAllPlayerSessionIds() : [];
      const id = sessionIds[0];
      return id ? vp.getVideoPlayerBySessionId(id) : null;
    } catch (_) {
      return null;
    }
  }

  async function fetchNetflixCaptions() {
    const player = getNetflixPlayer();
    if (player && typeof player.getTimedTextTrackList === "function") {
      const tracks = player.getTimedTextTrackList() || [];
      const bcp47 = (t) => String(t?.bcp47 || "").toLowerCase();
      const jaTrack = textPrefer(
        tracks.filter(
          (t) =>
            !t.isNone &&
            (matchLangFamily(bcp47(t), "ja") || /japanese|日本語/i.test(t.displayName || ""))
        )
      );
      const enTrack = textPrefer(
        tracks.filter(
          (t) =>
            !t.isNone &&
            (matchLangFamily(bcp47(t), "en") || /english/i.test(t.displayName || ""))
        )
      );
      const viTrack = textPrefer(
        tracks.filter(
          (t) =>
            !t.isNone &&
            (matchLangFamily(bcp47(t), "vi") ||
              /vietnamese|tiếng việt|tieng viet|vi\b/i.test(t.displayName || ""))
        )
      );

      // Helper to fetch direct track URLs if exposed on track objects.
      // Each URL fetch is timeout-capped so one hung track never blocks the rest.
      async function tryFetchTrackDirect(track, langKey) {
        if (!track) return false;
        const urls = [];
        // Deep-scan the whole track object — Netflix hides subtitle URLs under
        // arbitrary keys (downloadBaseUrl, trackId, timedtext…), so take every
        // http(s) string plus any explicitly URL-ish key at every depth.
        function scanUrls(obj, depth = 0) {
          if (!obj || depth > 8) return;
          if (typeof obj === "string") {
            if (/^https?:\/\//.test(obj)) urls.push(obj);
          } else if (typeof obj === "object") {
            try {
              for (const k of Object.keys(obj)) {
                const v = obj[k];
                if (
                  /\b(url|href|src|baseUrl|downloadUrl|manifest|timedtext|subtitle)\b/i.test(k) &&
                  typeof v === "string" &&
                  /^https?:\/\//.test(v)
                ) {
                  urls.push(v);
                }
                scanUrls(v, depth + 1);
              }
            } catch (_) {}
          }
        }
        scanUrls(track);
        for (const u of urls) {
          try {
            const res = await withTimeout(fetch(u, { credentials: "omit" }), 600);
            if (res.ok) {
              const xml = await res.text();
              const parsed = parseSubtitlePayload(xml);
              if (parsed && parsed.length) {
                if (langKey === "ja") netflixState.cues = parsed;
                else if (langKey === "en") netflixState.enCues = parsed;
                else if (langKey === "vi") netflixState.viCues = parsed;
                netflixState.tracks.set(langKey, parsed);
                return true;
              }
            }
          } catch (_) {}
        }
        return false;
      }

      // Look at direct track URLs in parallel — lang fetches are independent.
      await Promise.all([
        jaTrack && !netflixState.cues.length
          ? tryFetchTrackDirect(jaTrack, "ja")
          : Promise.resolve(false),
        enTrack && !netflixState.enCues.length
          ? tryFetchTrackDirect(enTrack, "en")
          : Promise.resolve(false),
        viTrack && !netflixState.viCues.length
          ? tryFetchTrackDirect(viTrack, "vi")
          : Promise.resolve(false),
      ]);

      /**
       * Netflix track objects rarely expose the subtitle URL directly, but the
       * JA/EN manifests we already captured usually let us infer the same movie's
       * VI/EN URL (swap trackId / lang query param). Tries plain URL candidates.
       */
      async function tryBuildUrlForTrack(track, langKey) {
        if (!track) return false;
        const rawId = String(track?.trackId ?? track?.subtitleId ?? track?.id ?? "");
        const candidates = [];
        const add = (s) => {
          if (s && !candidates.includes(s)) candidates.push(s);
        };
        // Fall back to any captured Netflix URL (JA usually; EN/others also help).
        const factories = [
          netflixState.urlByLang.get("ja"),
          netflixState.urlByLang.get("en"),
          ...Array.from(netflixState.urlByLang.values()),
        ].filter(Boolean);
        const langMap = {
          ja: langKey,
          en: langKey,
          vi: langKey,
          jpn: langKey,
          vie: langKey,
          "vi-vn": langKey,
        };
        for (const base of factories) {
          // Global replace of every language token (query + path) → requested lang.
          add(
            base.replace(
              /([?&](?:l|lang|dl)=)([^&]+)/,
              (m, p, v) => `${p}${langMap[String(v).toLowerCase()] || langKey}`
            )
          );
          add(
            base.replace(
              /(?:ja|en|vi|jpn|vie|vi-vn)(?=[/_.?-]|$)/gi,
              (m) => String(langMap[m.toLowerCase()] || langKey)
            )
          );
          if (rawId && /[?&](trackId|subtitleId|id)=/.test(base)) {
            add(base.replace(/([?&]trackId=)([^&]+)/, `$1${encodeURIComponent(rawId)}`));
            add(base.replace(/([?&]subtitleId=)([^&]+)/, `$1${encodeURIComponent(rawId)}`));
            add(base.replace(/([?&]id=)([^&]+)/, `$1${encodeURIComponent(rawId)}`));
          }
          // Bare manifest: drop the lang param so the default (account language) is used.
          add(base.replace(/([?&])(l|lang|dl)=[^&]+/, (_, pre) => pre));
        }
        const seen = new Set();
        for (const u of candidates) {
          if (seen.has(u)) continue;
          seen.add(u);
          try {
            const res = await withTimeout(fetch(u, { credentials: "include" }), 600);
            if (!res.ok) continue;
            const xml = await res.text();
            const parsed = parseSubtitlePayload(xml);
            if (parsed && parsed.length) {
              if (langKey === "ja") netflixState.cues = parsed;
              else if (langKey === "en") netflixState.enCues = parsed;
              else if (langKey === "vi") netflixState.viCues = parsed;
              netflixState.tracks.set(langKey, parsed);
              return true;
            }
          } catch (_) {}
        }
        return false;
      }

      // Direct URLs missing → try infer from the captured manifests.
      if (!netflixState.enCues.length && enTrack) await tryBuildUrlForTrack(enTrack, "en");
      if (!netflixState.viCues.length && viTrack) await tryBuildUrlForTrack(viTrack, "vi");
      if (viTrack && !netflixState.viCues.length) viProbeFailed = true;

      // Seamless track switcher fallback for any tracks not yet fetched directly.
      try {
        if (typeof player.setSubtitleEnabled === "function") player.setSubtitleEnabled(true);
        if (typeof player.setOption === "function") player.setOption("subtitle", "enabled", "on");
      } catch (_) {}

      // Seamless track switcher fallback: probe missing EN and VI tracks.
      if (typeof player.setTimedTextTrack === "function") {
        const got = (langKey) =>
          langKey === "ja"
            ? netflixState.cues.length
            : langKey === "en"
              ? netflixState.enCues.length
              : netflixState.viCues.length;
        const switchTrackAndWait = async (track, langKey, force = false) => {
          if (!track) return;
          if (!force && got(langKey)) return;
          try {
            netflixState.probingLang = langKey;
            player.setTimedTextTrack(track);
            const deadline = Date.now() + 800;
            while (Date.now() < deadline && !got(langKey)) {
              await new Promise((r) => setTimeout(r, 60));
            }
          } catch (_) {
          } finally {
            netflixState.probingLang = null;
          }
        };
        if (enTrack && !netflixState.enCues.length) {
          await switchTrackAndWait(enTrack, "en");
        }
        if (viTrack && !netflixState.viCues.length) {
          await switchTrackAndWait(viTrack, "vi");
        }
        if (jaTrack) {
          await switchTrackAndWait(jaTrack, "ja", true);
        }
      }
    }

    const video = findVideo();
    if (video && video.textTracks) {
      for (const tr of video.textTracks) {
        const trCues = tr.cues;
        if (!trCues || !trCues.length) continue;
        const trLang = String(tr.language || tr.label || "").toLowerCase();
        const native = [];
        for (const c of trCues) {
          let st = Number(c.startTime);
          if (!Number.isFinite(st)) continue;
          let en = Number(c.endTime);
          if (!Number.isFinite(en)) en = st + 2;
          const text = String(c.text || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
          if (text) native.push({ start: st, end: Math.max(st + 0.2, en), text });
        }
        if (native.length) {
          if (matchLangFamily(trLang, "ja") && !netflixState.cues.length) {
            netflixState.cues = native;
          } else if (matchLangFamily(trLang, "en") && !netflixState.enCues.length) {
            netflixState.enCues = native;
          } else if (matchLangFamily(trLang, "vi") && !netflixState.viCues.length) {
            netflixState.viCues = native;
          } else if (!netflixState.cues.length) {
            netflixState.cues = native;
          }
        }
      }
    }

    if (netflixState.cues.length) {
      return {
        ok: true,
        via: "netflix_timedtext",
        count: netflixState.cues.length,
        cues: netflixState.cues,
        enCues: netflixState.enCues,
        viCues: netflixState.viCues,
        viUnavailable: viProbeFailed && !netflixState.viCues.length,
      };
    }

    return {
      ok: false,
      reason: "no_netflix_cues",
      count: 0,
      cues: [],
      enCues: netflixState.enCues,
      viCues: netflixState.viCues,
      viUnavailable: viProbeFailed && !netflixState.viCues.length,
    };
  }

  /**
   * Generic caption fetch for non-YouTube players (ABEMA / Netflix / hls.js / shaka / …):
   */
  async function fetchPageCaptions() {
    const info = pageInfo();
    if (info.source === "netflix") {
      return await fetchNetflixCaptions();
    }

    const cues = [];
    const tried = new Set();
    for (const t of collectTrackSources()) {
      if (tried.has(t.src)) continue;
      tried.add(t.src);
      try {
        const res = await fetch(t.src, { credentials: "include", cache: "no-store" });
        if (res.ok) {
          const got = parseVtt(await res.text());
          if (got.length && !cues.length) cues.push(...got);
        }
      } catch (_) {
        /* try next */
      }
    }
    if (cues.length) return { ok: true, via: "track_elements", count: cues.length, cues };
    return fetchNativeTextTrackCues();
  }

  function fetchNativeTextTrackCues() {
    const native = [];
    const video = findVideo();
    if (video && video.textTracks) {
      const list = video.textTracks;
      for (const tr of list) {
        let cueList = null;
        try {
          cueList = tr.cues;
        } catch (_) {}
        if (!cueList) continue;
        for (const c of cueList) {
          let st = Number(c.startTime);
          if (!Number.isFinite(st)) continue;
          let en = Number(c.endTime);
          if (!Number.isFinite(en)) en = st + 2;
          const text = String(c.text || "").replace(/\s+/g, " ").trim();
          if (!text) continue;
          native.push({ start: st, end: Math.max(st + 0.2, en), text });
        }
      }
    }
    if (native.length) return { ok: true, via: "text_tracks", count: native.length, cues: native };
    return { ok: false, reason: "no_cues", count: 0, cues: [] };
  }

  function pickCaptionTrack(tracks, preferLang) {
    if (!tracks?.length) return null;
    let best = null;
    let bestScore = -1;
    for (const t of tracks) {
      if (!t?.baseUrl) continue;
      const sc = scoreTrack(t, preferLang);
      if (sc > bestScore) {
        bestScore = sc;
        best = t;
      }
    }
    return best;
  }

  function parseJson3(data) {
    if (globalThis.HardsubTimedtextParse) {
      return globalThis.HardsubTimedtextParse.parseJson3Cues(data, { includeSource: true });
    }
    const events = data?.events || [];
    const nodes = [];
    for (const ev of events) {
      if (!ev || ev.tStartMs == null) continue;
      const segs = ev.segs || [];
      const text = segs
        .map((s) => (s && s.utf8 != null ? String(s.utf8) : ""))
        .join("")
        .replace(/\n+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!text) continue;
      nodes.push({
        start: Number(ev.tStartMs) / 1000,
        durMs: ev.dDurationMs != null ? Number(ev.dDurationMs) : null,
        text,
      });
    }
    const cues = [];
    for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i];
    const next = nodes[i + 1];
    let end;
    if (n.durMs != null && Number.isFinite(n.durMs) && n.durMs > 0) {
      end = n.start + n.durMs / 1000;
    } else if (n.dur != null && Number.isFinite(n.dur) && n.dur > 0) {
      end = n.start + n.dur;
    } else {
      end = next ? next.start : n.start + 2;
    }
    cues.push({ start: n.start, end: Math.max(n.start + 0.2, end), text: n.text });
  }
    return cues;
  }

  function captionAt(mediaTime) {
    const t = Number(mediaTime) || 0;
    const cues = state.captions.cues || [];
    if (!cues.length) {
      return { ok: false, text: "", status: state.captions.status || "idle" };
    }
    let active = null;
    for (const c of cues) {
      const start = Number(c.start) || 0;
      const end = Number(c.end) || 0;
      if (t >= start && t < end) active = c;
    }
    if (!active) return { ok: false, text: "", status: "miss" };
    return { ok: true, text: active.text, start: active.start, end: active.end, status: "ok" };
  }

  window.__HARDSubOCRCapture = {
    apiVer: API_VER,
    bindVideo,
    captureRoi,
    getMediaTime,
    seekTo,
    playAt,
    loadCaptions,
    fetchMultiLangCaptions,
    fetchPageCaptions,
    getPageInfo: pageInfo,
    captionAt,
    getTimedtextLink,
    setRoi(roi) {
      state.roi = { ...state.roi, ...roi };
    },
    getRoi() {
      return { ...state.roi };
    },
  };

  window.__hardsubPageMsgHandler = (ev) => {
    // Commands may only come from the extension's own content script (same window).
    if (ev.source !== window) return;
    if (!ev.data || ev.data.source !== "hardsub-ocr-ext") return;
    const { type, requestId, payload } = ev.data;

    const reply = (result) => {
      window.postMessage(
        { source: "hardsub-ocr-page", requestId, result, cap: currentCap() },
        PAGE_TARGET_ORIGIN
      );
    };

    try {
      if (type === "PING") reply({ ok: true, ready: true, apiVer: API_VER });
      else if (type === "BIND") reply({ ok: bindVideo() });
      else if (type === "CAPTURE") reply(captureRoi());
      else if (type === "GET_MEDIA_TIME") reply(getMediaTime());
      else if (type === "SET_ROI") {
        window.__HARDSubOCRCapture.setRoi(payload || {});
        reply({ ok: true, roi: window.__HARDSubOCRCapture.getRoi() });
      } else if (type === "SEEK") reply({ ok: seekTo(payload && payload.mediaTime) });
      else if (type === "PLAY_AT") reply(playAt(payload && payload.mediaTime));
      else if (type === "LOAD_CAPTIONS") {
        loadCaptions(payload || {})
          .then(reply)
          .catch((err) =>
            reply({ ok: false, reason: "exception", message: String(err), cues: [] })
          );
      } else if (type === "FETCH_MULTI_LANG") {
        // FETCH_MULTI_LANG and FETCH_MULTI_LANG_CAPTIONS are the same handler
        // under two names. Both are kept because the call sites live in
        // content/content.js — renaming one side alone would break the bridge.
        fetchMultiLangCaptions(payload || {})
          .then(reply)
          .catch((err) =>
            reply({
              ok: false,
              reason: "exception",
              message: String(err),
              cues: [],
              enCues: [],
              viCues: [],
              hasEn: false,
              hasVi: false,
            })
          );
      } else if (type === "GET_PAGE_INFO") reply(pageInfo());
      else if (type === "FETCH_CAPTIONS") {
        fetchPageCaptions(payload || {})
          .then(reply)
          .catch((err) =>
            reply({ ok: false, reason: "exception", message: String(err), count: 0, cues: [] })
          );
      } else if (type === "RESET_CAPTIONS") {
        bindVideo();
        ccTriggerVideoId = "";
        state.captions = { videoId: "", cues: [], track: null, status: "idle", error: "" };
        state.timedtext = { url: "", videoId: "", body: "", cues: [] };
        netflixState.cues = [];
        netflixState.enCues = [];
        netflixState.viCues = [];
        netflixState.tracks.clear();
        netflixState.urlByLang.clear();
        netflixState.probingLang = null;
        viProbeFailed = false;
        reply({ ok: true });
      } else if (type === "GET_TIMEDTEXT_LINK") reply(getTimedtextLink(payload || {}));
      else if (type === "FETCH_MULTI_LANG_CAPTIONS") {
        fetchMultiLangCaptions(payload || {}).then(reply).catch((e) => reply({ ok: false, reason: "exception", message: String(e) }));
      } else if (type === "CAPTION_AT") reply(captionAt(payload && payload.mediaTime));
      else reply({ ok: false, reason: "unknown" });
    } catch (err) {
      reply({ ok: false, reason: "exception", message: String(err) });
    }
  };
  window.addEventListener("message", window.__hardsubPageMsgHandler);

  document.addEventListener("yt-navigate-finish", () => {
    bindVideo();
    ccTriggerVideoId = "";
    state.captions = { videoId: "", cues: [], track: null, status: "idle", error: "" };
    state.timedtext = { url: "", videoId: "", body: "", cues: [] };
  });
  installTimedtextHooks();
  bindVideo();
})();
