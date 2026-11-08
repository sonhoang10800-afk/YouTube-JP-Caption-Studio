/**
 * frame_relay.js — Cross-origin video player relay.
 * Runs in child iframes (e.g. streaming player embeds).
 * Relays video playhead (timeupdate, seeking, play, pause) to the parent frame,
 * receives seek commands from the parent frame, relays user gesture to open side panel,
 * and extracts native soft subtitles (WebVTT/SRT) with zero video overlay.
 */
(() => {
  "use strict";

  // Only run in child iframes
  if (window === window.top) return;

  function reportTime(v) {
    if (!v) return;
    const msg = {
      type: "ANIMEVIETSUB_TIMEUPDATE",
      currentTime: v.currentTime,
      duration: v.duration,
      paused: v.paused,
    };
    try {
      if (window.parent) window.parent.postMessage(msg, "*");
      if (window.top && window.top !== window.parent) window.top.postMessage(msg, "*");
    } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Native Soft Subtitle Extraction (Zero Video Overlay)
  // ---------------------------------------------------------------------------

  let lastRelayedSig = "";

  function isEligibleTrackKind(kind) {
    const k = String(kind || "").trim().toLowerCase();
    return !k || k === "subtitles" || k === "captions";
  }

  function detectTrackLanguage(tr, trackEl) {
    const lang = String(tr?.language || trackEl?.srclang || "").trim().toLowerCase();
    const label = String(tr?.label || trackEl?.label || "").trim().toLowerCase();
    const combined = `${lang} ${label}`;

    // Vietnamese matching (vi, vie, vi-VN, vi_VN, vietnamese, vietsub, tiếng việt)
    if (
      lang === "vi" ||
      lang.startsWith("vi-") ||
      lang.startsWith("vi_") ||
      lang === "vie" ||
      /\b(vi|vie|viet|vietnamese|vietsub)\b/i.test(combined) ||
      combined.includes("tiếng việt") ||
      combined.includes("tieng viet") ||
      combined.includes("vietnamese") ||
      combined.includes("vietsub")
    ) {
      return "vi";
    }

    // English matching (en, eng, en-US, en-GB, english)
    if (
      lang === "en" ||
      lang.startsWith("en-") ||
      lang.startsWith("en_") ||
      lang === "eng" ||
      /\b(en|eng|english)\b/i.test(combined) ||
      combined.includes("english")
    ) {
      return "en";
    }

    return "";
  }

  function sanitizeCueText(raw) {
    if (typeof raw !== "string") return "";
    return raw
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&(?:apos|#39|#x27);/gi, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractCuesFromTrack(track) {
    if (!track) return [];
    let trCues = null;
    try {
      trCues = track.cues;
    } catch (_) {
      return [];
    }
    if (!trCues || !trCues.length) return [];

    const out = [];
    for (let i = 0; i < trCues.length; i++) {
      const c = trCues[i];
      if (!c) continue;
      const start = Number(c.startTime);
      if (!Number.isFinite(start) || start < 0) continue;
      let end = Number(c.endTime);
      if (!Number.isFinite(end) || end <= start) {
        end = start + 2;
      }
      const rawText = c.text != null ? String(c.text) : (c.getCueAsHTML ? c.getCueAsHTML().textContent : "");
      const text = sanitizeCueText(rawText);
      if (!text) continue;
      out.push({
        start: Math.round(start * 1000) / 1000,
        end: Math.round(Math.max(start + 0.1, end) * 1000) / 1000,
        text,
      });
    }

    out.sort((a, b) => a.start - b.start);

    // Deduplicate adjacent cues with identical text & start
    const deduped = [];
    for (const cue of out) {
      const prev = deduped[deduped.length - 1];
      if (prev && Math.abs(prev.start - cue.start) < 0.05 && prev.text === cue.text) {
        prev.end = Math.max(prev.end, cue.end);
      } else {
        deduped.push(cue);
      }
    }
    return deduped;
  }

  function collectTracks(v) {
    const tracks = [];
    const seenTracks = new Set();

    // 1. Scan <track> DOM elements inside <video>
    try {
      const trackEls = v.querySelectorAll("track");
      for (const el of trackEls) {
        if (el.track && !seenTracks.has(el.track)) {
          seenTracks.add(el.track);
          tracks.push({ track: el.track, el });
        }
      }
    } catch (_) {}

    // 2. Scan video.textTracks (covers tracks added via addTextTrack or hls.js)
    try {
      if (v.textTracks) {
        for (let i = 0; i < v.textTracks.length; i++) {
          const tr = v.textTracks[i];
          if (tr && !seenTracks.has(tr)) {
            seenTracks.add(tr);
            tracks.push({ track: tr, el: null });
          }
        }
      }
    } catch (_) {}

    return tracks;
  }

  function extractAndRelaySoftSubs(v) {
    if (!v) return;
    const trackEntries = collectTracks(v);
    if (!trackEntries.length) return;

    let viCues = [];
    let enCues = [];

    for (const { track, el } of trackEntries) {
      if (!isEligibleTrackKind(track?.kind || el?.kind)) continue;
      const lang = detectTrackLanguage(track, el);

      // Strict Zero Video Overlay: Suppress native captions if player turned them on
      if (track.mode === "showing") {
        try {
          track.mode = "hidden";
        } catch (_) {}
      }

      if (lang === "vi" || lang === "en") {
        // Mode hidden triggers browser decoding into track.cues without overlay
        if (track.mode !== "hidden") {
          try {
            track.mode = "hidden";
          } catch (_) {}
        }

        // Wire async loading listeners
        if (el && !el.__relayListened) {
          el.__relayListened = true;
          el.addEventListener("load", () => extractAndRelaySoftSubs(v), { passive: true });
        }
        if (!track.__relayListened) {
          track.__relayListened = true;
          try {
            track.addEventListener("cuechange", () => extractAndRelaySoftSubs(v), { passive: true });
          } catch (_) {}
        }

        const cues = extractCuesFromTrack(track);
        if (cues.length) {
          if (lang === "vi" && cues.length > viCues.length) {
            viCues = cues;
          } else if (lang === "en" && cues.length > enCues.length) {
            enCues = cues;
          }
        }
      }
    }

    if (!viCues.length && !enCues.length) return;

    // Signature prevents flooding postMessage with identical cue sets
    const sig = `${viCues.length}:${viCues[0]?.start || 0}-${viCues[viCues.length - 1]?.end || 0}|${enCues.length}:${enCues[0]?.start || 0}-${enCues[enCues.length - 1]?.end || 0}`;
    if (sig === lastRelayedSig) return;
    lastRelayedSig = sig;

    const msg = {
      type: "ANIMEVIETSUB_SOFT_SUBS",
      viCues,
      enCues,
    };
    try {
      if (window.parent) window.parent.postMessage(msg, "*");
      if (window.top && window.top !== window.parent) window.top.postMessage(msg, "*");
    } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Video Player Attachment & Lifecycle
  // ---------------------------------------------------------------------------

  function attachVideo(v) {
    if (!v || v.__relayAttached) return;
    v.__relayAttached = true;

    const onUpdate = () => reportTime(v);

    v.addEventListener("timeupdate", onUpdate, { passive: true });
    v.addEventListener("seeking", onUpdate, { passive: true });
    v.addEventListener("seeked", onUpdate, { passive: true });
    v.addEventListener("play", onUpdate, { passive: true });
    v.addEventListener("pause", onUpdate, { passive: true });

    v.addEventListener("loadedmetadata", () => extractAndRelaySoftSubs(v), { passive: true });
    v.addEventListener("canplay", () => extractAndRelaySoftSubs(v), { passive: true });

    if (v.textTracks && !v.__relayTextTracksListened) {
      v.__relayTextTracksListened = true;
      try {
        v.textTracks.addEventListener("addtrack", () => extractAndRelaySoftSubs(v), { passive: true });
        v.textTracks.addEventListener("change", () => extractAndRelaySoftSubs(v), { passive: true });
      } catch (_) {}
    }

    // Initial announcement
    reportTime(v);
    extractAndRelaySoftSubs(v);
  }

  function scan() {
    const videos = document.querySelectorAll("video");
    for (const v of videos) {
      attachVideo(v);
    }
  }

  scan();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scan, { once: true });
  }

  const observer = new MutationObserver(() => scan());
  if (document.documentElement) {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  // Periodic heartbeat when playing + soft subtitle poll
  setInterval(() => {
    const v = document.querySelector("video");
    if (v) {
      if (!v.paused) {
        reportTime(v);
      }
      extractAndRelaySoftSubs(v);
    }
  }, 1000);

  // User gesture inside iframe: trigger side panel open directly with trusted gesture
  const onUserGesture = () => {
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" }).catch(() => {});
      }
    } catch (_) {}
  };
  window.addEventListener("pointerdown", onUserGesture, { capture: true, passive: true });
  window.addEventListener("click", onUserGesture, { capture: true, passive: true });

  // Handle incoming commands from parent frame
  window.addEventListener("message", (e) => {
    if (e.data?.type === "SEEK_TO") {
      const targetTime = Number(e.data.mediaTime != null ? e.data.mediaTime : e.data.currentTime);
      if (Number.isFinite(targetTime) && targetTime >= 0) {
        const v = document.querySelector("video");
        if (v) {
          v.currentTime = targetTime;
          const p = v.play();
          if (p && typeof p.catch === "function") p.catch(() => {});
          reportTime(v);
        }
        // Also relay to child iframes if any
        try {
          const childIframes = document.querySelectorAll("iframe");
          for (const ifr of childIframes) {
            ifr.contentWindow?.postMessage(e.data, "*");
          }
        } catch (_) {}
      }
    } else if (e.data?.type === "GET_ANIMEVIETSUB_SOFT_SUBS" || e.data?.type === "REQUEST_SOFT_SUBS") {
      lastRelayedSig = "";
      const v = document.querySelector("video");
      if (v) extractAndRelaySoftSubs(v);
    }
  });
})();
