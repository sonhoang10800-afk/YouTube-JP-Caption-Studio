#!/usr/bin/env node
"use strict";

const assert = require("assert");
const {
  parseAss,
  parseSrt,
  parseAssOrSrt: parseSubtitles,
  cleanAssText: stripAssTags,
  cleanSrtText,
  parseTimestamp: parseSrtTimestamp,
} = require("./ass_parser.js");

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failureDetails = [];

function challenge(title, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  [PASS] ${title}`);
  } catch (err) {
    failedTests++;
    console.error(`  [FAIL] ${title}`);
    console.error(`         ${err.message}`);
    failureDetails.push({ title, message: err.message, stack: err.stack });
  }
}

console.log("=== EMPIRICAL CHALLENGER: ASS & SRT PARSER ADVERSARIAL TEST SUITE ===\n");

// =========================================================================
// SECTION 1: DOWNSTREAM TOKENIZATION COMPATIBILITY & MORPHEME INTEGRITY
// =========================================================================
console.log("--- Section 1: Downstream Tokenization & Morpheme Preservation ---");

challenge("1.1 Real-world fansub karaoke tags (\\k, \\K, \\kf, \\ko, \\kt) leave Japanese morphemes contiguous", function () {
  // Standard \k
  const k1 = stripAssTags("{\\k10}あ{\\k15}な{\\k20}た");
  assert.strictEqual(k1, "あなた");

  // Smooth karaoke \K, outline \ko, fill \kf, karaoke time \kt
  const k2 = stripAssTags("{\\kf25}き{\\K30}み{\\ko45}の{\\kt20}な{\\k50}は");
  assert.strictEqual(k2, "きみのなは");

  // Morpheme with okurigana: 食べる should not be broken
  const k3 = stripAssTags("{\\k10}食{\\k15}べ{\\k20}る");
  assert.strictEqual(k3, "食べる");

  // Verb inflection: 行ってしまった
  const k4 = stripAssTags("{\\k5}行{\\k10}っ{\\k10}て{\\k10}し{\\k10}ま{\\k10}っ{\\k10}た");
  assert.strictEqual(k4, "行ってしまった");

  // Ensure NO invisible or zero-width or ASCII whitespace was inserted
  assert.strictEqual(/[\s\u200B\uFEFF]/.test(k1), false);
  assert.strictEqual(/[\s\u200B\uFEFF]/.test(k2), false);
  assert.strictEqual(/[\s\u200B\uFEFF]/.test(k3), false);
  assert.strictEqual(/[\s\u200B\uFEFF]/.test(k4), false);
});

challenge("1.2 Karaoke tags with spaces inside tag braces", function () {
  // Typesetters sometimes put spaces inside tags: {\k 20} or {\k10 \c&HFFFFFF&}
  const kWithSpace = stripAssTags("{\\k 20}お{\\kf 30}は{\\k10 \\c&HFFFFFF&}よ{\\k5}う");
  assert.strictEqual(kWithSpace, "おはよう");
});

challenge("1.3 Mixed Japanese, Furigana, Romaji, and English dialogue lines", function () {
  // Mixed English and Japanese
  const mixed1 = stripAssTags("{\\b1}Hello{\\b0}、これは{\\i1}Test{\\i0}です！");
  assert.strictEqual(mixed1, "Hello、これはTestです！");

  // Romaji with macrons and Japanese in parentheses
  const mixed2 = stripAssTags("Tōkyō (とうきょう) へ行こう！");
  assert.strictEqual(mixed2, "Tōkyō (とうきょう) へ行こう！");

  // Multiple dialogue styles in ASS: English translation cue vs Japanese cue
  const assMixed = [
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    "Dialogue: 0,0:01:00.00,0:01:04.00,Japanese,,0,0,0,,俺は海賊王になる男だ！",
    "Dialogue: 1,0:01:00.00,0:01:04.00,English,,0,0,0,,I'm the man who will become Pirate King!",
  ].join("\n");
  const cues = parseAss(assMixed);
  assert.strictEqual(cues.length, 2);
  assert.strictEqual(cues[0].text, "俺は海賊王になる男だ！");
  assert.strictEqual(cues[1].text, "I'm the man who will become Pirate King!");
});

challenge("1.4 Complex linebreaks (\\N, \\n, \\h) keep hard breaks and turn \\h into spaces", function () {
  const res1 = stripAssTags("Line 1\\NLine 2\\nLine 3\\hLine 4");
  assert.strictEqual(res1, "Line 1\nLine 2\nLine 3 Line 4");

  const res2 = stripAssTags("First\\N\\N\\h\\n   Second\\h\\hThird");
  assert.strictEqual(res2, "First\n\n \n   Second  Third");

  const res3 = stripAssTags("\\N\\hLeading and trailing\\n\\h");
  assert.strictEqual(res3, "Leading and trailing");

  const res4 = stripAssTags("吾輩は猫である。\\N名前はまだ無い。");
  assert.strictEqual(res4, "吾輩は猫である。\n名前はまだ無い。");
});

// =========================================================================
// SECTION 2: SRT BOUNDARY CONDITIONS
// =========================================================================
console.log("\n--- Section 2: SRT Boundary Conditions ---");

challenge("2.1 Broken numbering and missing index headers in SRT", function () {
  // Out of order and duplicate numbers
  const srtBrokenNumbers = [
    "99",
    "00:00:01,000 --> 00:00:03,000",
    "First cue with index 99",
    "",
    "1",
    "00:00:04,000 --> 00:00:06,000",
    "Second cue with index 1",
    "",
    "1",
    "00:00:07,000 --> 00:00:09,000",
    "Third cue with duplicate index 1",
  ].join("\n");

  const cuesBroken = parseSrt(srtBrokenNumbers);
  assert.strictEqual(cuesBroken.length, 3);
  assert.strictEqual(cuesBroken[0].text, "First cue with index 99");
  assert.strictEqual(cuesBroken[1].text, "Second cue with index 1");
  assert.strictEqual(cuesBroken[2].text, "Third cue with duplicate index 1");

  // Completely missing sequence numbers (starts directly with timing)
  const srtNoNumbers = [
    "00:00:01,000 --> 00:00:03,000",
    "Cue without number 1",
    "",
    "00:00:04,000 --> 00:00:06,000",
    "Cue without number 2",
  ].join("\n");

  const cuesNoNum = parseSrt(srtNoNumbers);
  assert.strictEqual(cuesNoNum.length, 2);
  assert.strictEqual(cuesNoNum[0].text, "Cue without number 1");
  assert.strictEqual(cuesNoNum[1].text, "Cue without number 2");
});

challenge("2.2 SRT blocks require a blank line; a missing break stays one cue", function () {
  const srtMissingBlank = [
    "1",
    "00:00:01,000 --> 00:00:03,000",
    "First subtitle line",
    "2",
    "00:00:04,000 --> 00:00:06,000",
    "Second subtitle line",
  ].join("\n");

  const cues = parseSrt(srtMissingBlank);
  assert.strictEqual(cues.length, 1);
  assert.strictEqual(cues[0].start, 1.0);
  assert.strictEqual(
    cues[0].text,
    "First subtitle line\n2\n00:00:04,000 --> 00:00:06,000\nSecond subtitle line",
  );
});

challenge("2.3 Multi-line subtitle blocks in SRT", function () {
  const srtMultiLine = [
    "1",
    "00:00:01,000 --> 00:00:04,000",
    "Line 1 of speech",
    "Line 2 of speech",
    "Line 3 of speech",
    "",
    "2",
    "00:00:05,000 --> 00:00:08,000",
    "Second block line 1",
    "Second block line 2",
  ].join("\n");

  const cues = parseSrt(srtMultiLine);
  assert.strictEqual(cues.length, 2);
  assert.strictEqual(cues[0].text, "Line 1 of speech\nLine 2 of speech\nLine 3 of speech");
  assert.strictEqual(cues[1].text, "Second block line 1\nSecond block line 2");
});

challenge("2.4 HTML entities are preserved by ASS text cleaning", function () {
  const ent1 = stripAssTags("&quot;Hello&quot; &amp; &apos;Goodbye&apos; &lt;World&gt; &nbsp;");
  assert.strictEqual(ent1, "&quot;Hello&quot; &amp; &apos;Goodbye&apos; &lt;World&gt; &nbsp;");

  const ent2 = stripAssTags("Wait&#8230; it&#39;s me!");
  assert.strictEqual(ent2, "Wait&#8230; it&#39;s me!");

  const ent3 = stripAssTags("Unicode: &#x3042;&#x3044;&#x3046; &#x2605;");
  assert.strictEqual(ent3, "Unicode: &#x3042;&#x3044;&#x3046; &#x2605;");

  const ent4 = stripAssTags("Unrecognized: &custom_entity; &test;");
  assert.strictEqual(ent4, "Unrecognized: &custom_entity; &test;");

  const ent5 = stripAssTags("Malformed: &#; &#x; &#99999999999; &;");
  assert.strictEqual(ent5, "Malformed: &#; &#x; &#99999999999; &;");
});

challenge("2.5 Nested and unclosed HTML tags in dialogue", function () {
  // Deeply nested HTML tags
  const tags1 = cleanSrtText("<i><b><font color=\"#ff0000\"><u>Styled text</u></font></b></i>");
  assert.strictEqual(tags1, "Styled text");

  const tags2 = cleanSrtText("<i>Italic text without closing tag");
  assert.strictEqual(tags2, "Italic text without closing tag");

  const tags3 = cleanSrtText("<font size=+2 >Large text</font > normal");
  assert.strictEqual(tags3, "Large text normal");
});

challenge("2.6 SRT Timestamps: 1-digit hours vs 2-digit, comma vs dot decimals", function () {
  // 1-digit hour with comma
  assert.strictEqual(parseSrtTimestamp("1:02:03,456"), 3723.456);

  // 2-digit hour with comma
  assert.strictEqual(parseSrtTimestamp("01:02:03,456"), 3723.456);

  // 1-digit hour with dot
  assert.strictEqual(parseSrtTimestamp("1:02:03.456"), 3723.456);

  // 2-digit hour with dot
  assert.strictEqual(parseSrtTimestamp("01:02:03.456"), 3723.456);

  // Sub-second precision with 1 digit (0.4s) and 2 digits (0.45s)
  assert.strictEqual(parseSrtTimestamp("00:01:23,4"), 83.4);
  assert.strictEqual(parseSrtTimestamp("00:01:23,45"), 83.45);
  assert.strictEqual(parseSrtTimestamp("00:01:23,450"), 83.45);

  // Timing line with coordinate metadata
  const srtWithCoords = [
    "1",
    "01:02:03,456 --> 01:02:06,789 X1:100 Y1:200 X2:300 Y2:400",
    "Positioned subtitle",
  ].join("\n");
  const cuesCoords = parseSrt(srtWithCoords);
  assert.strictEqual(cuesCoords.length, 1);
  assert.strictEqual(cuesCoords[0].start, 3723.456);
  assert.strictEqual(cuesCoords[0].end, 3726.789);
  assert.strictEqual(cuesCoords[0].text, "Positioned subtitle");
});

// =========================================================================
// SECTION 3: UNIVERSAL SNIFFER RESILIENCE (parseSubtitles)
// =========================================================================
console.log("\n--- Section 3: Universal Sniffer Resilience ---");

challenge("3.1 UTF-8 BOM handling on both ASS and SRT files", function () {
  const assBom = "\uFEFF[Script Info]\nTitle: Test\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,BOM ASS cue";
  const srtBom = "\uFEFF1\n00:00:01,000 --> 00:00:03,000\nBOM SRT cue\n";

  const cuesAss = parseSubtitles(assBom);
  assert.strictEqual(cuesAss.length, 1);
  assert.strictEqual(cuesAss[0].text, "BOM ASS cue");

  const cuesSrt = parseSubtitles(srtBom);
  assert.strictEqual(cuesSrt.length, 1);
  assert.strictEqual(cuesSrt[0].text, "BOM SRT cue");
});

challenge("3.2 Leading blank lines and preamble whitespace before headers", function () {
  const assPreamble = "\r\n\r\n   \n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Preamble ASS cue";
  const srtPreamble = "\r\n\r\n   \n\n1\n00:00:01,000 --> 00:00:03,000\nPreamble SRT cue\n";

  const cuesAss = parseSubtitles(assPreamble);
  assert.strictEqual(cuesAss.length, 1);
  assert.strictEqual(cuesAss[0].text, "Preamble ASS cue");

  const cuesSrt = parseSubtitles(srtPreamble);
  assert.strictEqual(cuesSrt.length, 1);
  assert.strictEqual(cuesSrt[0].text, "Preamble SRT cue");
});

challenge("3.3 Lowercase section headers ([events], [script info])", function () {
  const assLowercase = "[script info]\ntitle: lower\n\n[events]\nformat: layer, start, end, style, name, marginl, marginr, marginv, effect, text\ndialogue: 0,0:00:02.00,0:00:05.00,default,,0,0,0,,Lowercase events cue";
  const cues = parseSubtitles(assLowercase);
  assert.strictEqual(cues.length, 1);
  assert.strictEqual(cues[0].start, 2.0);
  assert.strictEqual(cues[0].end, 5.0);
  assert.strictEqual(cues[0].text, "Lowercase events cue");
});

challenge("3.4 Headerless ASS file (only Dialogue lines)", function () {
  // Some raw subtitle dumps omit [Script Info] and [Events] headers completely
  const assHeaderless = [
    "Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,First line without headers",
    "Dialogue: 0,0:00:04.00,0:00:07.00,Default,,0,0,0,,Second line without headers",
  ].join("\n");

  const cues = parseSubtitles(assHeaderless);
  assert.strictEqual(cues.length, 2);
  assert.strictEqual(cues[0].text, "First line without headers");
  assert.strictEqual(cues[1].text, "Second line without headers");
});

challenge("3.5 Content containing '-->' inside ASS dialogue text", function () {
  // Dialogue containing an arrow symbol should not be mis-detected as SRT
  const assWithArrow = [
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    "Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,A --> B is an implication",
  ].join("\n");

  const cues = parseSubtitles(assWithArrow);
  assert.strictEqual(cues.length, 1);
  assert.strictEqual(cues[0].start, 1.0);
  assert.strictEqual(cues[0].end, 4.0);
  assert.strictEqual(cues[0].text, "A --> B is an implication");
});

challenge("3.6 Non-subtitle / garbage inputs (JSON, HTML, random strings)", function () {
  assert.deepStrictEqual(parseSubtitles('{"status": "error", "message": "not found"}'), []);
  assert.deepStrictEqual(parseSubtitles("<!DOCTYPE html><html><body>Error 404</body></html>"), []);
  assert.deepStrictEqual(parseSubtitles("Just some random text without timestamps or formatting."), []);
  assert.deepStrictEqual(parseSubtitles(""), []);
  assert.deepStrictEqual(parseSubtitles(null), []);
  assert.deepStrictEqual(parseSubtitles(undefined), []);
});

// =========================================================================
// SUMMARY
// =========================================================================
console.log("\n=======================================================");
console.log(`TOTAL CHALLENGES: ${totalTests}`);
console.log(`PASSED:           ${passedTests}`);
console.log(`FAILED:           ${failedTests}`);
console.log("=======================================================\n");

if (failedTests > 0) {
  console.error("FAILURES ENCOUNTERED:");
  for (const f of failureDetails) {
    console.error(`- ${f.title}`);
    console.error(`  ${f.message}`);
  }
  process.exit(1);
} else {
  console.log("ALL ADVERSARIAL CHALLENGES PASSED.");
  process.exit(0);
}
