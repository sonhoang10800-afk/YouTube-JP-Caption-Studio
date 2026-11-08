/**
 * URL canonicalization, video ID extraction, SHA-256 hashing, and Drive folder ID parsing.
 * Generates safe file identifiers [A-Za-z0-9_-]{6,64} for atomic Google Drive sync.
 */

(function () {
  /**
   * Fast synchronous hash fallback for non-async contexts / Node tests.
   */
  function simpleHash(str) {
    let h1 = 0xdeadbeef ^ 0, h2 = 0x41c6ce57 ^ 0;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(16, "0");
  }

  /**
   * Parses Google Drive folder ID from full Drive URL or bare ID.
   * e.g. https://drive.google.com/drive/folders/1aBcDeFgHiJkLmNoPqRsTuVwXyZ -> 1aBcDeFgHiJkLmNoPqRsTuVwXyZ
   * e.g. https://drive.google.com/drive/u/0/folders/1aBcDeFgHiJkLmNoPqRsTuVwXyZ -> 1aBcDeFgHiJkLmNoPqRsTuVwXyZ
   */
  function parseDriveFolderId(input) {
    const raw = String(input || "").trim();
    if (!raw) return "";
    const m = raw.match(/folders\/([A-Za-z0-9_-]{10,})/);
    if (m && m[1]) return m[1];
    const bareMatch = raw.match(/^[A-Za-z0-9_-]{10,}$/);
    if (bareMatch) return raw;
    return "";
  }

  /**
   * Normalizes video URL by stripping ephemeral query parameters
   * (e.g. &t=..., &si=..., utm_*, ab_channel, feature, list, index).
   */
  function canonicalizeVideoUrl(rawUrl) {
    const urlStr = String(rawUrl || "").trim();
    if (!urlStr) return "";

    try {
      const parsed = new URL(urlStr);
      const host = parsed.hostname.toLowerCase();

      // YouTube
      if (host === "youtu.be") {
        const id = parsed.pathname.replace(/^\/+/, "").split("/")[0];
        return `https://www.youtube.com/watch?v=${id}`;
      }
      if (host.includes("youtube.com")) {
        const path = parsed.pathname;
        const shortsMatch = path.match(/\/(?:shorts|live|embed|v)\/([A-Za-z0-9_-]{11})/);
        if (shortsMatch && shortsMatch[1]) {
          return `https://www.youtube.com/watch?v=${shortsMatch[1]}`;
        }
        const v = parsed.searchParams.get("v");
        if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) {
          return `https://www.youtube.com/watch?v=${v}`;
        }
      }

      // Netflix
      if (host.includes("netflix.com")) {
        const m = parsed.pathname.match(/\/(?:watch|title)\/(\d+)/);
        if (m && m[1]) {
          return `https://www.netflix.com/watch/${m[1]}`;
        }
      }

      // Generic: Remove tracking & ephemeral query params
      const cleanParams = new URLSearchParams();
      const dropKeys = new Set(["t", "si", "feature", "ab_channel", "fbclid", "gclid"]);
      for (const [k, val] of parsed.searchParams.entries()) {
        const lk = k.toLowerCase();
        if (dropKeys.has(lk) || lk.startsWith("utm_")) continue;
        cleanParams.append(k, val);
      }
      const qs = cleanParams.toString();
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}${qs ? "?" + qs : ""}`;
    } catch {
      return urlStr;
    }
  }

  /**
   * Generates a unique, safe string identifier [A-Za-z0-9_-]{6,64} for a video URL.
   * Format:
   * - YouTube: "yt_<11char_id>"
   * - Netflix: "netflix_<id>"
   * - Other: "<source>_<hash>"
   */
  function canonicalVideoId(rawUrl) {
    const canonical = canonicalizeVideoUrl(rawUrl);
    if (!canonical) return "";

    try {
      const parsed = new URL(canonical);
      const host = parsed.hostname.toLowerCase();

      if (host.includes("youtube.com")) {
        const v = parsed.searchParams.get("v");
        if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return `yt_${v}`;
      }
      if (host.includes("netflix.com")) {
        const m = parsed.pathname.match(/\/watch\/(\d+)/);
        if (m && m[1]) return `netflix_${m[1]}`;
      }
      if (host.includes("abema.tv")) {
        const parts = parsed.pathname.split("/").filter(Boolean);
        const lastPart = parts[parts.length - 1] || "top";
        const clean = lastPart.replace(/[^A-Za-z0-9_-]/g, "_");
        return `abema_${clean}`.slice(0, 64);
      }
      if (host.includes("animevietsub")) {
        const phimMatch = parsed.pathname.match(/\/phim\/([^\/]+)/);
        const tapMatch = parsed.pathname.match(/tap-(\d+)/);
        const slug = phimMatch ? phimMatch[1] : "anime";
        const ep = tapMatch ? tapMatch[1].padStart(2, "0") : "01";
        const cleanSlug = slug.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48);
        return `avs__${cleanSlug}__ep${ep}`.slice(0, 64);
      }

      // Fallback
      const src = host.replace(/[^a-z0-9]/g, "").slice(0, 12) || "web";
      const hash = simpleHash(canonical);
      return `${src}_${hash}`.slice(0, 64);
    } catch {
      const hash = simpleHash(canonical);
      return `vid_${hash}`.slice(0, 64);
    }
  }

  const api = {
    canonicalizeVideoUrl,
    canonicalVideoId,
    parseDriveFolderId,
    simpleHash,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof globalThis !== "undefined") {
    globalThis.HardsubUrlHash = api;
  }
})();
