/**
 * Pure helpers for the side panel — no DOM, no chrome.* access — so the row
 * ordering, the saved-word markup and the re-render gating can be unit-tested
 * in Node (see sidepanel_pure_test.js).
 */
(function (root) {
  /** True when the rendered row order drifted from the cue order. */
  function rowsNeedReorder(domIds, cueIds) {
    if (!Array.isArray(domIds) || !Array.isArray(cueIds)) return false;
    if (domIds.length !== cueIds.length) return true;
    for (let i = 0; i < domIds.length; i++) {
      if (domIds[i] !== cueIds[i]) return true;
    }
    return false;
  }

  /** Word table of a cue list: lemma → {surface, reading, jlpt, freq_rank, count}. */
  function collectWords(cues, isSkipPos) {
    const skip = typeof isSkipPos === "function" ? isSkipPos : () => false;
    const wordMap = new Map();
    for (const c of cues || []) {
      if (!c || !c.tokens) continue;
      for (const t of c.tokens) {
        if (!t || !t.surface || skip(t.pos)) continue;
        const key = t.lemma || t.surface;
        if (!wordMap.has(key)) {
          wordMap.set(key, {
            lemma: key,
            surface: t.surface,
            reading: t.reading || "",
            jlpt: t.jlpt || "",
            freq_rank: t.freq_rank != null ? Number(t.freq_rank) : null,
            count: 0,
          });
        }
        wordMap.get(key).count++;
      }
    }
    return wordMap;
  }

  /** Signature of the Words tab data — only changes when the data changes. */
  function wordsSignature(words, userVocab) {
    const vocab = userVocab || {};
    return JSON.stringify(
      (words || []).map((w) => [
        w.lemma,
        w.surface,
        w.reading,
        w.jlpt,
        w.freq_rank,
        w.count,
        vocab[w.lemma] ? 1 : 0,
      ])
    );
  }

  /** Signature of the Saved tab data — only changes when the data changes. */
  function savedSignature(model) {
    const m = model || {};
    return JSON.stringify({
      showContext: !!m.showContext,
      practice: !!m.practice,
      words: (m.words || []).map((w) => [w.lemma, w.context || ""]),
      cues: (m.cues || []).map((c) => [
        c.id,
        c.source || "",
        c.vi || "",
        c.en || "",
        c.start_media_time ?? "",
        c.end_media_time ?? "",
      ]),
    });
  }

  /**
   * Saved-word markup: the lemma boxed inside its context sentence.
   * The match is located in the RAW text, so a lemma that only occurs inside an
   * HTML entity (&amp; → "amp") can never be boxed inside that entity.
   */
  function buildSavedWordHtml(lemma, context, escape) {
    const esc = typeof escape === "function" ? escape : (s) => String(s == null ? "" : s);
    const box = `<span class="lr-saved-word-box">${esc(lemma)}</span>`;
    const ctx = context == null ? "" : String(context);
    if (!ctx) return box;
    const at = ctx.indexOf(lemma);
    if (at < 0) return `${box} · ${esc(ctx)}`;
    return `${esc(ctx.slice(0, at))}${box}${esc(ctx.slice(at + String(lemma).length))}`;
  }

  /**
   * The content script answers `set_caption_mode` with the mode it really
   * applied. When the panel asked for "enhanced" but the sentence engine is
   * off, the content script downgrades to "original" — the panel has to say
   * so instead of showing a switch that did nothing.
   * @returns {string} message to show, or "" when nothing was downgraded
   */
  function captionModeDowngrade(requested, response) {
    if (!response || response.ok === false) return "";
    if (requested !== "enhanced") return "";
    if (response.captionMode !== "original") return "";
    return "Enhanced chưa bật (cần bật trong Cài đặt) — đang dùng Original";
  }

  const api = {
    rowsNeedReorder,
    collectWords,
    wordsSignature,
    savedSignature,
    buildSavedWordHtml,
    captionModeDowngrade,
  };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.HardsubSidepanelPure = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
