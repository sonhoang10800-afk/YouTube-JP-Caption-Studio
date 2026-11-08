/**
 * Anime metadata extraction, AniList resolution, and Jimaku.cc subtitle fetching.
 * Browser and Node.js compatible.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.HardsubAnimeResolver = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const DEFAULT_FETCH = typeof fetch !== "undefined" ? fetch.bind(globalThis) : null;

  function parseAnimeMetadata(url, domInfo) {
    domInfo = domInfo || {};
    let slug = "";
    let episode = 1;

    try {
      const u = new URL(url || "");
      const path = u.pathname;
      const phimMatch = path.match(/\/phim\/([^\/]+)/);
      if (phimMatch) {
        slug = phimMatch[1];
      }
      const tapMatch = path.match(/tap-(\d+)/);
      if (tapMatch) {
        episode = parseInt(tapMatch[1], 10);
      }
    } catch (_) {}

    if (domInfo.activeEpisodeUrl) {
      const match = String(domInfo.activeEpisodeUrl).match(/tap-(\d+)/);
      if (match) {
        episode = parseInt(match[1], 10);
      }
    } else if (domInfo.activeEpisode) {
      const epNum = parseInt(String(domInfo.activeEpisode).replace(/\D+/g, ""), 10);
      if (!isNaN(epNum) && epNum > 0) {
        episode = epNum;
      }
    } else if (domInfo.title) {
      const titleEp = String(domInfo.title).match(/Tập\s*(\d+)/i);
      if (titleEp) {
        episode = parseInt(titleEp[1], 10);
      }
    }

    let romajiTitle = (domInfo.h1 || "").trim();
    let englishTitle = "";

    if (domInfo.h2) {
      // Often "English Title, Alias" or "English Title"
      const parts = domInfo.h2.split(",").map(p => p.trim());
      englishTitle = parts[0] || "";
    } else if (domInfo.title) {
      const parenMatch = domInfo.title.match(/\(([^)]+)\)/);
      if (parenMatch) {
        const parts = parenMatch[1].split(",").map(p => p.trim());
        englishTitle = parts[0] || "";
      }
    }

    return {
      slug,
      episode,
      romajiTitle,
      englishTitle,
      rawTitle: domInfo.title || ""
    };
  }

  function makeCacheKey(slug, episode) {
    const s = String(slug || "anime").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
    const ep = String(episode || 1).padStart(2, "0");
    const key = `avs__${s}__ep${ep}`;
    return key.slice(0, 64);
  }

  function findMatchingFileForEpisode(files, episode) {
    if (!Array.isArray(files) || files.length === 0) return null;
    const epNum = parseInt(episode, 10);
    const epPad = String(epNum).padStart(2, "0");

    // Common episode patterns: S01E01, E01, EP01, .01., - 01, [01]
    const patterns = [
      new RegExp(`[sS]\\d+[eE]0*${epNum}\\b`, "i"),
      new RegExp(`[eE][pP]?0*${epNum}\\b`, "i"),
      new RegExp(`[\\[\\(_\\-\\.\\s]0*${epNum}[\\]\\)_\\-\\.\\s]`),
      new RegExp(`\\b0*${epNum}\\b`)
    ];

    for (const pat of patterns) {
      const match = files.find(f => {
        const name = f.name || f.url || "";
        return pat.test(name) && (name.endsWith(".srt") || name.endsWith(".ass"));
      });
      if (match) return match;
    }

    return null;
  }

  async function searchAniList(titleQuery, fetchFn) {
    fetchFn = fetchFn || DEFAULT_FETCH;
    if (!fetchFn || !titleQuery) return [];

    const query = `query ($search: String) {
      Page(page: 1, perPage: 5) {
        media(search: $search, type: ANIME) {
          id
          title {
            romaji
            english
            native
          }
          episodes
          format
        }
      }
    }`;

    try {
      const res = await fetchFn("https://graphql.anilist.co", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({ query, variables: { search: titleQuery } })
      });
      if (!res.ok) return [];
      const json = await res.json();
      return json?.data?.Page?.media || [];
    } catch (_) {
      return [];
    }
  }

  async function resolveAniList(metadata, fetchFn) {
    fetchFn = fetchFn || DEFAULT_FETCH;
    if (!metadata) return null;

    // 1. Try English title first if available (often clean match)
    if (metadata.englishTitle) {
      const results = await searchAniList(metadata.englishTitle, fetchFn);
      if (results.length > 0) return results[0];
    }

    // 2. Try Romaji title
    if (metadata.romajiTitle) {
      const results = await searchAniList(metadata.romajiTitle, fetchFn);
      if (results.length > 0) return results[0];

      // 3. Try normalized Romaji (strip punctuation, extra words)
      const cleanRomaji = metadata.romajiTitle
        .replace(/[,\.!\?]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (cleanRomaji !== metadata.romajiTitle) {
        const cleanResults = await searchAniList(cleanRomaji, fetchFn);
        if (cleanResults.length > 0) return cleanResults[0];
      }
    }

    return null;
  }

  async function searchJimaku(anilistId, apiKey, fetchFn) {
    fetchFn = fetchFn || DEFAULT_FETCH;
    if (!fetchFn || !anilistId) return [];

    const headers = {};
    if (apiKey) {
      headers["Authorization"] = apiKey;
    }

    try {
      const res = await fetchFn(`https://jimaku.cc/api/entries/search?anilist_id=${encodeURIComponent(anilistId)}`, {
        headers
      });
      if (!res.ok) {
        return [];
      }
      return await res.json();
    } catch (_) {
      return [];
    }
  }

  async function fetchJimakuFiles(entryId, apiKey, fetchFn) {
    fetchFn = fetchFn || DEFAULT_FETCH;
    if (!fetchFn || !entryId) return [];

    const headers = {};
    if (apiKey) {
      headers["Authorization"] = apiKey;
    }

    try {
      const res = await fetchFn(`https://jimaku.cc/api/entries/${encodeURIComponent(entryId)}/files`, {
        headers
      });
      if (!res.ok) return [];
      return await res.json();
    } catch (_) {
      return [];
    }
  }

  return {
    parseAnimeMetadata,
    makeCacheKey,
    findMatchingFileForEpisode,
    searchAniList,
    resolveAniList,
    searchJimaku,
    fetchJimakuFiles
  };
});
