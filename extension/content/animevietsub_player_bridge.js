/**
 * Lightweight player bridge injected into iframe streaming players (e.g. stream.googleapiscdn.com).
 * Communicates with the top window via window.postMessage to sync playback time and seek commands.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.HardsubAvsPlayerBridge = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function attachPlayerBridge(options) {
    options = options || {};
    const video = options.video;
    const topWindow = options.topWindow || (typeof window !== "undefined" ? window.top : null);

    if (!video || !topWindow) {
      return null;
    }

    function broadcastTimeupdate() {
      try {
        topWindow.postMessage({
          type: "AVS_PLAYER_TIMEUPDATE",
          currentTime: video.currentTime || 0,
          duration: video.duration || 0,
          paused: !!video.paused
        }, "*");
      } catch (_) {}
    }

    function handleIncomingMessage(event) {
      if (!event || !event.data) return;
      const data = event.data;
      if (data.type === "AVS_PLAYER_SEEK") {
        const t = Number(data.time);
        if (Number.isFinite(t) && t >= 0) {
          video.currentTime = t;
        }
      } else if (data.type === "AVS_PLAYER_PLAY") {
        if (typeof video.play === "function") {
          video.play().catch(() => {});
        }
      } else if (data.type === "AVS_PLAYER_PAUSE") {
        if (typeof video.pause === "function") {
          video.pause();
        }
      }
    }

    if (typeof video.addEventListener === "function") {
      video.addEventListener("timeupdate", broadcastTimeupdate);
      video.addEventListener("play", broadcastTimeupdate);
      video.addEventListener("pause", broadcastTimeupdate);
      video.addEventListener("seeked", broadcastTimeupdate);
    }

    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("message", handleIncomingMessage);
    }

    // Broadcast ready signal
    try {
      topWindow.postMessage({
        type: "AVS_PLAYER_READY",
        currentTime: video.currentTime || 0,
        duration: video.duration || 0
      }, "*");
    } catch (_) {}

    return {
      broadcastTimeupdate,
      handleIncomingMessage
    };
  }

  function initAutoAttach() {
    if (typeof window === "undefined" || window === window.top) {
      return;
    }

    function tryFindVideo() {
      const v = document.querySelector("video");
      if (v) {
        attachPlayerBridge({ video: v, topWindow: window.top });
        return true;
      }
      return false;
    }

    if (!tryFindVideo()) {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (tryFindVideo() || attempts >= 30) {
          clearInterval(interval);
        }
      }, 500);
    }
  }

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initAutoAttach);
    } else {
      initAutoAttach();
    }
  }

  return {
    attachPlayerBridge,
    initAutoAttach
  };
});
