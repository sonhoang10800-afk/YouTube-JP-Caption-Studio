/**
 * Unit tests for ASR candidate lifecycle and data protection invariants.
 *
 * The production helpers live inside the content-script IIFE
 * (extension/content/content.js). This test executes that real source — it
 * does NOT keep a copy of the logic, so production drift cannot leave this
 * suite green (same technique as scripts/sentence_provenance_sanity.js).
 *
 * Verifies:
 * 1. Strict protection invariant: locked, user-edited, user-owned, or deleted cues NEVER receive candidates.
 * 2. Non-destructive candidate storage: candidate attachment never automatically mutates cue text.
 * 3. Candidate Accept applies text, updates text_source to asr:whisper-large-v3-turbo, and creates an Undo revision.
 * 4. Undo restoration recovers exact original cue text and text_source.
 * 5. Revert dismisses candidate without mutating cue text.
 * 6. Temporal interval matching connects ASR segments to the correct cue boundaries.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const CONTENT_JS = path.resolve(__dirname, "../content/content.js");
const REAL_WEATHER_CUES = path.resolve(
  __dirname,
  "../../testdata/youtube/weathernews_FfUjmyCeK7s.ja.json",
);

/** Slice one function out of the content script source. */
function sliceFunction(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${name} must exist in content.js`);
  let depth = 0;
  let seenBody = false;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      depth++;
      seenBody = true;
    } else if (ch === "}") {
      depth--;
      if (seenBody && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`could not slice ${name} out of content.js`);
}

// Execute the REAL production helpers.
const contentSource = fs.readFileSync(CONTENT_JS, "utf8");
const production = vm.runInNewContext(
  `(() => {
    const isOwnedCue = ${sliceFunction(contentSource, "isOwnedCue")};
    const canReceiveAsrCandidate = ${sliceFunction(contentSource, "canReceiveAsrCandidate")};
    const asrCueBounds = ${sliceFunction(contentSource, "asrCueBounds")};
    const matchCuesForSegment = ${sliceFunction(contentSource, "matchCuesForSegment")};
    const asrNormalizeMatchText = ${sliceFunction(contentSource, "asrNormalizeMatchText")};
    const asrTextSimilarity = ${sliceFunction(contentSource, "asrTextSimilarity")};
    const findBestCueForSegmentByIoU = ${sliceFunction(contentSource, "findBestCueForSegmentByIoU")};
    const asrCandidateCoverage = ${sliceFunction(contentSource, "asrCandidateCoverage")};
    const shouldReplaceAsrCandidate = ${sliceFunction(contentSource, "shouldReplaceAsrCandidate")};
    const sentenceCueRevision = ${sliceFunction(contentSource, "sentenceCueRevision")};
    return { isOwnedCue, canReceiveAsrCandidate, asrCueBounds, matchCuesForSegment, asrNormalizeMatchText, asrTextSimilarity, findBestCueForSegmentByIoU, asrCandidateCoverage, shouldReplaceAsrCandidate, sentenceCueRevision };
  })()`,
  { console },
);
const { isOwnedCue, canReceiveAsrCandidate, asrCueBounds, matchCuesForSegment, asrNormalizeMatchText, asrTextSimilarity, findBestCueForSegmentByIoU, shouldReplaceAsrCandidate, sentenceCueRevision } = production;

// -------------------------------------------------------------------------
// Test 1: Invariant - Locked and User-Owned cues REJECT candidates
// -------------------------------------------------------------------------
console.log("Running Test 1: Data protection invariants...");
const lockedCue = { id: "c1", source: "おはよう", mt_locked: true, text_source: "yt" };
assert.strictEqual(canReceiveAsrCandidate(lockedCue), false, "mt_locked must reject ASR candidate");

const editedCue = { id: "c2", source: "こんにちは", text_source: "edit" };
assert.strictEqual(canReceiveAsrCandidate(editedCue), false, "text_source: edit must reject ASR candidate");

const manualCue = { id: "c3", source: "こんばんは", text_source: "manual" };
assert.strictEqual(canReceiveAsrCandidate(manualCue), false, "text_source: manual must reject ASR candidate");

const scriptCue = { id: "c4", source: "さようなら", text_source: "script" };
assert.strictEqual(canReceiveAsrCandidate(scriptCue), false, "text_source: script must reject ASR candidate");

const importCue = { id: "c5", source: "ありがとう", text_source: "import" };
assert.strictEqual(canReceiveAsrCandidate(importCue), false, "text_source: import must reject ASR candidate");

const userTransCue = { id: "c6", source: "はい", text_source: "yt", translation_source: "user" };
assert.strictEqual(canReceiveAsrCandidate(userTransCue), false, "translation_source: user must reject ASR candidate");

const ownedCue = { id: "c7", source: "いいえ", text_source: "yt", user_owned: true };
assert.strictEqual(canReceiveAsrCandidate(ownedCue), false, "user_owned: true must reject ASR candidate");

const deletedCue = { id: "c8", source: "どうも", text_source: "yt", deleted: true };
assert.strictEqual(canReceiveAsrCandidate(deletedCue), false, "deleted: true must reject ASR candidate");

const cleanAsrCue = { id: "c9", source: "勘無料だよ", text_source: "yt", mt_locked: false };
assert.strictEqual(canReceiveAsrCandidate(cleanAsrCue), true, "Clean YouTube ASR cue should accept ASR candidate");

// isOwnedCue is the production ownership predicate
assert.strictEqual(isOwnedCue({ text_source: "edit" }), true, "edit is an owned cue");
assert.strictEqual(isOwnedCue({ text_source: "yt" }), false, "yt is not an owned cue");

// -------------------------------------------------------------------------
// Test 2: Invariant - Candidates NEVER automatically mutate cue text
// -------------------------------------------------------------------------
console.log("Running Test 2: Candidate non-destructive storage...");
const cue = { id: "c19", source: "どんな理由だよ。ああ、勘無料だよ。", text_source: "yt", start_media_time: 55.96, end_media_time: 65.04 };
const sentenceCandidates = {};

// When candidate is recorded in sidecar:
sentenceCandidates[cue.id] = {
  text: "どんな理由だよ。ああ、感無量だよ。",
  provenance: "asr:whisper-large-v3-turbo",
  start: 55.96,
  end: 65.04,
  createdAt: 1728720000000,
};

assert.strictEqual(cue.source, "どんな理由だよ。ああ、勘無料だよ。", "Cue source must NOT be modified by receiving candidate");
assert.strictEqual(cue.text_source, "yt", "Cue text_source must NOT be modified by receiving candidate");
assert.strictEqual(sentenceCandidates[cue.id].text, "どんな理由だよ。ああ、感無量だよ。");
assert.strictEqual(sentenceCandidates[cue.id].provenance, "asr:whisper-large-v3-turbo");

// -------------------------------------------------------------------------
// Test 3: Candidate Accept applies candidate, updates text_source, and creates Undo
// -------------------------------------------------------------------------
console.log("Running Test 3: Candidate Accept lifecycle...");
const sentenceUndoRevisions = {};
const candidate = sentenceCandidates[cue.id];

// User clicks Accept (mirrors handleSidePanelCmd "accept_asr_candidate"):
assert.ok(canReceiveAsrCandidate(cue), "Must re-verify invariant before accept");
sentenceUndoRevisions[cue.id] = sentenceCueRevision(cue);
cue.source = candidate.text;
cue.text_source = candidate.provenance;
delete sentenceCandidates[cue.id];

assert.strictEqual(cue.source, "どんな理由だよ。ああ、感無量だよ。", "Cue source must be updated to candidate text");
assert.strictEqual(cue.text_source, "asr:whisper-large-v3-turbo", "Cue text_source must be updated to provenance");
assert.strictEqual(sentenceCandidates[cue.id], undefined, "Accepted candidate must be removed from pending list");
assert.ok(sentenceUndoRevisions[cue.id], "Undo revision must be created");

// -------------------------------------------------------------------------
// Test 4: Undo restores exact original text and source
// -------------------------------------------------------------------------
console.log("Running Test 4: Undo restoration...");
const parsedRevision = JSON.parse(sentenceUndoRevisions[cue.id]);
cue.source = parsedRevision[1];
cue.start_media_time = parsedRevision[2];
cue.end_media_time = parsedRevision[3];
cue.rawSource = parsedRevision[4];
cue.text_source = parsedRevision[5];
delete sentenceUndoRevisions[cue.id];

assert.strictEqual(cue.source, "どんな理由だよ。ああ、勘無料だよ。", "Undo must restore exact original text");
assert.strictEqual(cue.text_source, "yt", "Undo must restore exact original text_source");
assert.strictEqual(sentenceUndoRevisions[cue.id], undefined, "Undo revision must be consumed");

// -------------------------------------------------------------------------
// Test 5: Revert removes candidate without touching text
// -------------------------------------------------------------------------
console.log("Running Test 5: Revert lifecycle...");
const cueRevert = { id: "c20", source: "元のテキスト", text_source: "yt" };
sentenceCandidates[cueRevert.id] = { text: "候補テキスト", provenance: "asr:whisper-large-v3-turbo" };

// User clicks Revert (Bỏ qua):
delete sentenceCandidates[cueRevert.id];
assert.strictEqual(cueRevert.source, "元のテキスト", "Cue source must remain unchanged on revert");
assert.strictEqual(sentenceCandidates[cueRevert.id], undefined, "Candidate must be removed on revert");

// -------------------------------------------------------------------------
// Test 6: Temporal window matching
// -------------------------------------------------------------------------
console.log("Running Test 6: Temporal interval matching...");
const timelineCues = [
  { id: "c1", start_media_time: 10.0, end_media_time: 14.0, source: "今日はいい天気ですね" },
  { id: "c2", start_media_time: 14.5, end_media_time: 18.0, source: "明日は雨が降るでしょう" },
  { id: "c3", start_media_time: 20.0, end_media_time: 25.0, source: "また来週お会いしましょう" },
];

const matches1 = matchCuesForSegment(timelineCues, 11.0, 13.0);
assert.strictEqual(matches1.length, 1);
assert.strictEqual(matches1[0].id, "c1");

const matchesSpan = matchCuesForSegment(timelineCues, 13.5, 15.0);
assert.strictEqual(matchesSpan.length, 2, "Segment spanning across two cues should match both");
assert.strictEqual(matchesSpan[0].id, "c1");
assert.strictEqual(matchesSpan[1].id, "c2");

// A segment that meaningfully spans two cues must not be written into either:
// an 8-second ASR window often straddles a cue boundary, and its text cannot
// represent only one side.
const bestMatch = findBestCueForSegmentByIoU(timelineCues, 13.5, 15.0, "天気ですね明日は雨");
assert.strictEqual(bestMatch, null, "a segment spanning two cues must be rejected");

const containedMatch = findBestCueForSegmentByIoU(
  timelineCues,
  14.5,
  17.9,
  "明日は雨が降るでしょう",
);
assert.ok(containedMatch, "a segment contained by one cue must still match");
assert.strictEqual(containedMatch.id, "c2");

const truncatedMatch = findBestCueForSegmentByIoU(timelineCues, 13.4, 14.2, "天気");
assert.strictEqual(truncatedMatch, null, "a mostly-outside fragment must not claim a cue");

const dominantTimeline = [
  { id: "long", start_media_time: 2.0, end_media_time: 7.0, source: "長い字幕です" },
  { id: "next", start_media_time: 7.0, end_media_time: 8.5, source: "次の字幕です" },
];
assert.strictEqual(
  findBestCueForSegmentByIoU(dominantTimeline, 0.0, 8.0, "長い字幕です次の字幕です"),
  null,
  "mixed segment-only text must be rejected even when one cue dominates",
);

const matchesGap = matchCuesForSegment(timelineCues, 18.5, 19.5);
assert.strictEqual(matchesGap.length, 0, "Segment in gap should match nothing");
const bestGap = findBestCueForSegmentByIoU(timelineCues, 18.5, 19.5, "間に合わない");
assert.strictEqual(bestGap, null, "Segment in gap should yield null best cue");

// -------------------------------------------------------------------------
// Test 7: Enhanced sentence groups format ({ id, start, end }) matching
// -------------------------------------------------------------------------
console.log("Running Test 7: Sentence projection groups format matching...");
const sentenceGroups = [
  { id: "sg:1", text: "みなさん、こんにちは。", start: 10.0, end: 14.0 },
  { id: "sg:2", text: "今日はいい天気ですね。", start: 14.5, end: 18.0 },
];
const sgMatch = findBestCueForSegmentByIoU(sentenceGroups, 10.5, 13.5, "みなさん、こんにちは。");
assert.ok(sgMatch, "Must match sentence group");
assert.strictEqual(sgMatch.id, "sg:1", "Must match sg:1 correctly based on start and end properties");

const sgBestSpan = findBestCueForSegmentByIoU(
  sentenceGroups,
  13.5,
  15.0,
  "こんにちは今日はいい天気ですね",
);
assert.strictEqual(sgBestSpan, null, "a spanning segment must not be accepted for sentence groups either");

// -------------------------------------------------------------------------
// Test 7b: Rolling cues use temporal overlap plus text evidence
// -------------------------------------------------------------------------
console.log("Running Test 7b: Rolling overlap and word-timestamp matching...");
const weather = JSON.parse(fs.readFileSync(REAL_WEATHER_CUES, "utf8"));
const rollingCues = weather.cues
  .map((cue) => ({
    id: cue.id,
    start_media_time: cue.start / 1000,
    end_media_time: (cue.start + cue.duration) / 1000,
    source: cue.text,
  }))
  .filter((cue) => cue.start_media_time >= 171 && cue.start_media_time <= 205);

assert.deepStrictEqual(
  rollingCues.slice(1, 4).map((cue) => [cue.start_media_time, cue.end_media_time]),
  [[171.64, 177.879], [174.92, 180.2], [177.879, 181.959]],
  "the regression must use the real FfUjmyCeK7s rolling cue timings",
);

const rollingMatch = findBestCueForSegmentByIoU(
  rollingCues,
  177.879,
  181.959,
  "けども、海の中にどれだけ熱",
);
assert.strictEqual(rollingMatch?.id, "177879-67", "the text must disambiguate rolling overlaps");

const rollingWords = [
  { text: "ですね、", start: 174.92, end: 175.5 },
  { text: "え、", start: 175.5, end: 176.0 },
  { text: "海洋熱量", start: 176.0, end: 177.4 },
  { text: "というものなんです", start: 177.4, end: 179.8 },
];
const wordMatch = findBestCueForSegmentByIoU(
  rollingCues,
  174.92,
  180.2,
  "ですね、え、海洋熱量というものなんです",
  rollingWords,
);
assert.strictEqual(wordMatch?.id, "174920-66", "word timestamps must anchor an overlapping segment");

const mixedWords = [
  { text: "状況でした", start: 171.64, end: 173.5 },
  { text: "最後にこちら", start: 173.5, end: 175.8 },
  { text: "海洋熱量", start: 176.0, end: 178.5 },
  { text: "というものなんです", start: 178.5, end: 180.2 },
];
assert.strictEqual(
  findBestCueForSegmentByIoU(
    rollingCues,
    171.64,
    180.2,
    "状況でした最後にこちら海洋熱量というものなんです",
    mixedWords,
  ),
  null,
  "words split across cues must not attach mixed text to one row",
);

const equalOverlap = [
  { id: "equal-a", start_media_time: 10.0, end_media_time: 14.0, source: "同じ字幕です" },
  { id: "equal-b", start_media_time: 10.0, end_media_time: 14.0, source: "同じ字幕です" },
];
assert.strictEqual(
  findBestCueForSegmentByIoU(equalOverlap, 11.0, 13.0, "同じ字幕です"),
  null,
  "equal temporal and text evidence is ambiguous",
);
assert.strictEqual(
  findBestCueForSegmentByIoU(
    [
      { id: "empty", start_media_time: 10.0, end_media_time: 14.0, source: "" },
    ],
    11.0,
    13.0,
    "空の字幕",
  ),
  null,
  "an empty cue must never receive a candidate",
);

// -------------------------------------------------------------------------
// Test 8: Overlap windows cannot replace a fuller candidate with a fragment
// -------------------------------------------------------------------------
console.log("Running Test 8: Candidate completeness replacement...");
const overlapCue = { id: "c30", start_media_time: 10.0, end_media_time: 14.0 };
const fullCandidate = { text: "最初から最後まで", start: 10.0, end: 14.0 };
const fragmentCandidate = { text: "最後まで", start: 12.5, end: 14.0 };
const laterFullCandidate = { text: "最初から最後までです", start: 9.8, end: 14.1 };

assert.strictEqual(
  shouldReplaceAsrCandidate(fullCandidate, fragmentCandidate, overlapCue),
  false,
  "a truncated overlap candidate must not overwrite a candidate covering the cue",
);
assert.strictEqual(
  shouldReplaceAsrCandidate(fragmentCandidate, fullCandidate, overlapCue),
  true,
  "a fuller candidate may replace a truncated one",
);
assert.strictEqual(
  shouldReplaceAsrCandidate(fullCandidate, laterFullCandidate, overlapCue),
  true,
  "equal coverage with more text is an improvement",
);
assert.strictEqual(
  shouldReplaceAsrCandidate(null, fragmentCandidate, overlapCue),
  true,
  "the first candidate is accepted",
);

console.log("PASS: all candidate lifecycle and data protection invariant tests passed!");
