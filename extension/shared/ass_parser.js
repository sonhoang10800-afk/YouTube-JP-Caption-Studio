/**
 * ASS / SSA / SRT Subtitle Parser.
 * Converts .ass or .srt subtitle content into an array of { start, end, text } cues.
 * Browser and Node.js compatible.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.HardsubAssParser = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function parseTimestamp(str) {
    if (!str) return NaN;
    const clean = String(str).trim().replace(",", ".");
    const parts = clean.split(":");
    if (parts.length === 3) {
      const h = parseFloat(parts[0]) || 0;
      const m = parseFloat(parts[1]) || 0;
      const s = parseFloat(parts[2]) || 0;
      return h * 3600 + m * 60 + s;
    }
    if (parts.length === 2) {
      const m = parseFloat(parts[0]) || 0;
      const s = parseFloat(parts[1]) || 0;
      return m * 60 + s;
    }
    const num = parseFloat(clean);
    return Number.isFinite(num) ? num : NaN;
  }

  function cleanAssText(rawText) {
    if (!rawText) return "";
    return rawText
      .replace(/\{[^}]*\}/g, "") // remove override tags like {\k50}, {\pos(...)}
      .replace(/\\N/g, "\n")    // ASS hard newline
      .replace(/\\n/g, "\n")    // ASS soft newline
      .replace(/\\h/g, " ")     // ASS non-breaking space
      .trim();
  }

  function cleanSrtText(rawText) {
    if (!rawText) return "";
    return rawText
      .replace(/<[^>]+>/g, "") // remove HTML tags like <i>, <b>, <font...>
      .trim();
  }

  function parseSrt(content) {
    if (!content || typeof content !== "string") return [];
    const text = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const blocks = text.split(/\n\s*\n/);
    const cues = [];

    for (const block of blocks) {
      const lines = block.trim().split("\n");
      if (lines.length < 2) continue;

      let timeLineIdx = 0;
      if (/^\d+$/.test(lines[0].trim()) && lines.length >= 2) {
        timeLineIdx = 1;
      }

      const timeLine = lines[timeLineIdx] || "";
      const match = timeLine.match(/(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})/);
      if (!match) continue;

      const start = parseTimestamp(match[1]);
      const end = parseTimestamp(match[2]);
      if (isNaN(start) || isNaN(end) || end <= start) continue;

      const rawSubLines = lines.slice(timeLineIdx + 1).join("\n");
      const cleaned = cleanSrtText(rawSubLines);
      if (!cleaned) continue;

      cues.push({ start, end, text: cleaned });
    }

    return cues.sort((a, b) => a.start - b.start);
  }

  function parseAss(content) {
    if (!content || typeof content !== "string") return [];
    const text = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = text.split("\n");
    const cues = [];

    let inEvents = false;
    let formatFields = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith("[") && line.endsWith("]")) {
        inEvents = line.toLowerCase() === "[events]";
        continue;
      }

      if (!inEvents) {
        // Headerless dumps are only Dialogue lines. The Format fallback below
        // already parses those once Events mode is on.
        if (line.toLowerCase().startsWith("dialogue:")) inEvents = true;
        else continue;
      }

      if (line.toLowerCase().startsWith("format:")) {
        const parts = line.slice(7).split(",").map(p => p.trim().toLowerCase());
        formatFields = parts;
        continue;
      }

      if (line.toLowerCase().startsWith("dialogue:")) {
        const rawValues = line.slice(9);
        const startIdx = formatFields.indexOf("start");
        const endIdx = formatFields.indexOf("end");
        const textIdx = formatFields.indexOf("text");

        if (startIdx !== -1 && endIdx !== -1 && textIdx !== -1) {
          // In ASS, Text is the last field and can contain commas
          const limit = formatFields.length - 1;
          const tokens = [];
          let current = "";
          let count = 0;

          for (let c = 0; c < rawValues.length; c++) {
            if (rawValues[c] === "," && count < limit) {
              tokens.push(current.trim());
              current = "";
              count++;
            } else {
              current += rawValues[c];
            }
          }
          tokens.push(current);

          const start = parseTimestamp(tokens[startIdx]);
          const end = parseTimestamp(tokens[endIdx]);
          const rawText = tokens[textIdx] || "";
          const cleaned = cleanAssText(rawText);

          if (!isNaN(start) && !isNaN(end) && end > start && cleaned) {
            cues.push({ start, end, text: cleaned });
          }
        } else {
          // Fallback if no Format line: Standard ASS Dialogue: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
          const commaSplit = rawValues.split(",");
          if (commaSplit.length >= 10) {
            const start = parseTimestamp(commaSplit[1]);
            const end = parseTimestamp(commaSplit[2]);
            const rawText = commaSplit.slice(9).join(",");
            const cleaned = cleanAssText(rawText);
            if (!isNaN(start) && !isNaN(end) && end > start && cleaned) {
              cues.push({ start, end, text: cleaned });
            }
          }
        }
      }
    }

    return cues.sort((a, b) => a.start - b.start);
  }

  function parseAssOrSrt(content) {
    if (!content || typeof content !== "string") return [];
    const head = content.replace(/^\uFEFF/, "");
    // Line-start only: a cue that merely mentions "dialogue:" must stay SRT.
    if (/(?:^|\n)\s*\[events\]/i.test(head) || /(?:^|\n)\s*\[script info\]/i.test(head) || /(?:^|\n)\s*dialogue:/i.test(head)) {
      return parseAss(content);
    }
    return parseSrt(content);
  }

  return {
    parseTimestamp,
    cleanAssText,
    cleanSrtText,
    parseSrt,
    parseAss,
    parseAssOrSrt
  };
});
