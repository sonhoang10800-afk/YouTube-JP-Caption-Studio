/**
 * Unit tests for ASS / SRT Subtitle Parser.
 * Run with: node extension/shared/ass_parser_test.js
 */
const assert = require("assert");
const { parseAssOrSrt, parseSrt, parseAss, parseTimestamp } = require("./ass_parser.js");

function testSrtParsing() {
  const srtContent = `\uFEFF1
00:00:07,173 --> 00:00:09,642
敵宙賊 2隻沈黙です

2
00:00:09,976 --> 00:00:12,612
<i>残りは……3隻です!</i>

3
00:01:12,000 --> 00:01:15,500
Line 1
Line 2
`;

  const cues = parseAssOrSrt(srtContent);
  assert.strictEqual(cues.length, 3, "Should parse 3 cues from SRT");
  assert.strictEqual(Math.abs(cues[0].start - 7.173) < 0.001, true, "Cue 0 start should be 7.173s");
  assert.strictEqual(Math.abs(cues[0].end - 9.642) < 0.001, true, "Cue 0 end should be 9.642s");
  assert.strictEqual(cues[0].text, "敵宙賊 2隻沈黙です");

  assert.strictEqual(cues[1].text, "残りは……3隻です!", "HTML tags like <i> should be stripped");
  assert.strictEqual(cues[2].text, "Line 1\nLine 2");
}

function testAssParsing() {
  const assContent = `[Script Info]
Title: Sample ASS
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Comment: 0,0:00:01.00,0:00:05.00,Default,,0,0,0,,This is a comment and should be ignored
Dialogue: 0,0:01:23.45,0:01:26.78,Default,,0,0,0,,{\\k50}お疲れ様{\\k20}でした\\Nヒロ様
Dialogue: 0,0:00:07.17,0:00:09.64,Default,,0,0,0,,{\\pos(192,200)\\fad(200,200)}敵宙賊 2隻沈黙です
`;

  const cues = parseAssOrSrt(assContent);
  assert.strictEqual(cues.length, 2, "Should parse 2 dialogues and ignore comment");
  // Should be sorted by start time
  assert.strictEqual(Math.abs(cues[0].start - 7.17) < 0.001, true, "Cue 0 start should be 7.17s");
  assert.strictEqual(cues[0].text, "敵宙賊 2隻沈黙です", "Override tags should be stripped");

  assert.strictEqual(Math.abs(cues[1].start - 83.45) < 0.001, true, "Cue 1 start should be 83.45s (1m23.45s)");
  assert.strictEqual(Math.abs(cues[1].end - 86.78) < 0.001, true, "Cue 1 end should be 86.78s");
  assert.strictEqual(cues[1].text, "お疲れ様でした\nヒロ様", "\\N should be converted to newline");
}

function testEmptyAndCorruptInput() {
  assert.deepStrictEqual(parseAssOrSrt(""), []);
  assert.deepStrictEqual(parseAssOrSrt(null), []);
  assert.deepStrictEqual(parseAssOrSrt(undefined), []);
  assert.deepStrictEqual(parseAssOrSrt("random text with no subtitles"), []);
}

function runAll() {
  testSrtParsing();
  testAssParsing();
  testEmptyAndCorruptInput();
  console.log("PASS: ass_parser_test.js");
}

runAll();
