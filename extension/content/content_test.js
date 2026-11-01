/**
 * Unit tests for the content-script helpers that the side panel drives.
 *
 * The helpers live inside the content-script IIFE, so the test loads the real
 * file in a vm sandbox and opts in through the __JP_CAP_CONTENT_TEST__ seam
 * (nothing is exported in a real page session).
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const CONTENT_JS = path.join(__dirname, "content.js");

/** Minimal browser surface so the IIFE can be evaluated in Node. */
function createContext() {
  const seam = {};
  const storage = {};
  const messages = [];
  const windowMessageListeners = [];
  const noop = () => {};
  const pageWindow = {
    addEventListener(type, fn) {
      if (type === "message") windowMessageListeners.push(fn);
    },
    removeEventListener(type, fn) {
      if (type !== "message") return;
      const index = windowMessageListeners.indexOf(fn);
      if (index >= 0) windowMessageListeners.splice(index, 1);
    },
    postMessage(msg) {
      if (msg?.source !== "hardsub-ocr-ext") return;
      // Handler tests do not render the player bar; an absent mediaTime makes
      // syncToPlayhead exit at its real guard before touching the DOM.
      const result = { ok: true };
      const event = { source: pageWindow,
        data: { source: "hardsub-ocr-page", requestId: msg.requestId, result, cap: "fixture" } };
      for (const listener of windowMessageListeners) listener(event);
    },
    location: { href: "https://www.youtube.com/watch?v=fixture" },
  };
  const context = {
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: noop,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    performance: { now: () => 0 },
    structuredClone,
    crypto: { randomUUID: () => "fixture-uuid" },
    TextEncoder,
    TextDecoder,
    URL,
    AbortController,
    AbortSignal,
    // The content script wires browser observers on init; the sandbox only
    // needs them to exist.
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    ResizeObserver: class { observe() {} disconnect() {} unobserve() {} },
    IntersectionObserver: class { observe() {} disconnect() {} unobserve() {} },
    HardsubTimedtextParse: { parseTimedtextBody: () => [], decodeEntities: (s) => s, sourceTrackInfo: () => ({}) },
    HardsubSentenceGroups: { VERSION: 1, buildSentenceGroups: () => ({ groups: [], version: 1, sourceKey: "" }),
      projectDisplayCues: () => [], validGroupTokens: () => false, isProtected: () => false },
    __JP_CAP_CONTENT_TEST__: seam,
    chrome: {
      runtime: {
        id: "fixture",
        getURL: (p) => `chrome-extension://fixture/${p}`,
        getManifest: () => ({ version: "fixture" }),
        sendMessage: async (msg) => { messages.push(msg); return { ok: true }; },
        onMessage: { addListener: noop },
        onInstalled: { addListener: noop },
        onStartup: { addListener: noop },
      },
      storage: {
        local: {
          get: async (keys) => {
            const list = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(list.map((k) => [k, storage[k]]));
          },
          set: async (patch) => Object.assign(storage, structuredClone(patch)),
          remove: async (keys) => {
            for (const k of Array.isArray(keys) ? keys : [keys]) delete storage[k];
          },
        },
        session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
        onChanged: { addListener: noop },
      },
      tabs: { onUpdated: { addListener: noop }, onActivated: { addListener: noop }, sendMessage: async () => ({}) },
    },
    document: {
      readyState: "complete",
      hidden: false,
      title: "Fixture 動画タイトル - YouTube",
      documentElement: { style: { setProperty: noop } },
      body: { appendChild: noop, removeChild: noop, classList: { add: noop, remove: noop, toggle: noop, contains: () => false } },
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
      createElement: () => ({ style: {}, setAttribute: noop, appendChild: noop, classList: { add: noop, remove: noop } }),
      addEventListener: noop,
      removeEventListener: noop,
    },
    window: pageWindow,
    location: { href: "https://www.youtube.com/watch?v=fixture", origin: "https://www.youtube.com" },
    navigator: { userAgent: "fixture", language: "ja" },
    fetch: async () => ({ ok: false, status: 0, json: async () => ({}) }),
  };
  context.globalThis = context;
  context.self = context;
  return { context, seam, messages };
}

const { context, seam, messages } = createContext();
const source = fs.readFileSync(CONTENT_JS, "utf8");
vm.createContext(context);
// The content script reads its shared defaults from these two, exactly like the
// manifest does; loading them keeps the sandbox a faithful page.
for (const shared of ["shared/vocab_style.js", "shared/hardsub_defaults.js"]) {
  const file = path.join(__dirname, "..", shared);
  vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: shared });
}
vm.runInContext(source, context, { filename: "content.js" });

assert.ok(seam.content, "the content script must expose its helpers to the test seam");
const content = seam.content;

// -------------------------------------------------------------------------
// resolveCueIndex: an out-of-range index must never reach an edit handler
// -------------------------------------------------------------------------
const cues = content.getCues();
assert.ok(Array.isArray(cues), "the content script must expose its cue list");

// A real id resolves; a negative / out-of-range / NaN index does not.
const resolveCueIndex = (msg) => content.resolveCueIndex(msg);
assert.strictEqual(resolveCueIndex({ idx: 0 }), cues.length ? 0 : -1,
  "index 0 must resolve when a cue exists");
assert.strictEqual(resolveCueIndex({ idx: -1 }), -1, "a negative index must be rejected");
assert.strictEqual(resolveCueIndex({ idx: 9999 }), -1, "an out-of-range index must be rejected");
assert.strictEqual(resolveCueIndex({ idx: NaN }), -1, "NaN must be rejected");
assert.strictEqual(resolveCueIndex({ idx: "x" }), -1, "a non-numeric index must be rejected");
assert.strictEqual(resolveCueIndex({ id: "no-such-id", idx: 0 }), -1,
  "an unknown id must not fall back to a numeric index");

// -------------------------------------------------------------------------
// normalizeCueText: one normalization for the edit AND the import path
// -------------------------------------------------------------------------
assert.strictEqual(content.normalizeCueText("a  b c "), "a b c",
  "cue text must be trimmed and whitespace-collapsed");
assert.strictEqual(content.normalizeCueText("  "), "", "blank cue text normalizes to empty");

// -------------------------------------------------------------------------
// normalizeSettings: the defaults are filled in and the stored shape survives
// -------------------------------------------------------------------------
const settings = content.getSettings();
assert.ok(settings && typeof settings === "object", "settings must be an object");
assert.strictEqual(typeof settings.sourceLang, "string", "the default source language must be set");
assert.strictEqual(content.normalizeSettings({ sourceLang: "en" }).sourceLang, "en",
  "a stored value must win over the default");
assert.strictEqual(content.normalizeSettings({}).sourceLang, settings.sourceLang,
  "a missing value must fall back to the default");
assert.strictEqual(content.normalizeSettings({}).levelHighlightEnabled, true,
  "the level highlight default must be filled in");

// -------------------------------------------------------------------------
// capAcceptsReply: a reply that OMITS the capability token must be rejected
// -------------------------------------------------------------------------
// The gate used to be `expected && provided && provided !== expected`, which
// let a forged MAIN-world reply through simply by leaving `cap` out. Omitting
// the token is the cheapest thing an attacker can do, so it must fail closed.
const capAcceptsReply = content.capAcceptsReply;
assert.strictEqual(typeof capAcceptsReply, "function", "the capability gate must be exposed");

assert.strictEqual(capAcceptsReply("secret", undefined), false,
  "a reply with no capability token must be rejected");
assert.strictEqual(capAcceptsReply("secret", ""), false,
  "an empty capability token must be rejected");
assert.strictEqual(capAcceptsReply("secret", null), false,
  "a null capability token must be rejected");
assert.strictEqual(capAcceptsReply("secret", "wrong"), false,
  "a wrong capability token must be rejected");
assert.strictEqual(capAcceptsReply("secret", "secret"), true,
  "the correct capability token must be accepted");
// Documented, deliberate escape: before the first inject the expected token is
// "" and a token-bearing reply is still accepted. Closing it needs the token
// minted before injectPageScript() early-returns.
assert.strictEqual(capAcceptsReply("", "anything"), true,
  "the pre-inject window still accepts a token-bearing reply");

// C-7: a starred cue carries the page title so the Saved Items "Video" column
// (and the Anki export built from it) is not blank.
assert.strictEqual(typeof content.pageTitle, "function", "pageTitle must be exposed");
assert.strictEqual(content.pageTitle(), "Fixture 動画タイトル",
  "pageTitle must strip the YouTube suffix");
assert.strictEqual(typeof content.savedCueSnapshot, "function", "savedCueSnapshot must be exposed");
const snap = content.savedCueSnapshot(
  { id: "c1", source: "日本語", vi: "tiếng Nhật", en: "Japanese",
    start_media_time: 1.25, end_media_time: 3.5 }, "c1");
assert.strictEqual(snap.id, "c1");
assert.strictEqual(snap.source, "日本語");
assert.strictEqual(snap.vi, "tiếng Nhật");
assert.strictEqual(snap.start_media_time, 1.25);
assert.strictEqual(snap.videoTitle, "Fixture 動画タイトル",
  "the snapshot must carry the page title for the Saved Items Video column");

// Re-keyed cues (intercept vs ANDROID segmentation) must still read the saved
// star: match on video + start + source when the direct saved id is gone.
assert.strictEqual(typeof content.savedCueMatches, "function", "savedCueMatches must be exposed");
assert.strictEqual(typeof content.findSavedCueForCue, "function", "findSavedCueForCue must be exposed");
assert.strictEqual(typeof content.isCueStarred, "function", "isCueStarred must be exposed");
const savedOld = { id: "old-id", source: "日本語 の 文", start_media_time: 1.25, videoId: "vid1" };
assert.strictEqual(content.savedCueMatches({ source: "日本語 の 文", start_media_time: 1.25 },
  { ...savedOld, videoId: "" }, "vid1"), true, "same video/start/source must match");
assert.strictEqual(content.savedCueMatches({ source: "日本語 の 文", start_media_time: 1.25 },
  savedOld, "vid2"), false, "a saved cue from another video must not match");
assert.strictEqual(content.savedCueMatches({ source: "日本語 の 文", start_media_time: 4 },
  savedOld, "vid1"), false, "a different start time must not match");
assert.strictEqual(content.savedCueMatches({ source: "別の文", start_media_time: 1.25 },
  savedOld, "vid1"), false, "different source text must not match");
content.setSavedCuesForTest({ "old-id": savedOld });
assert.strictEqual(content.isCueStarred("old-id"), true, "direct saved id still wins");
assert.strictEqual(content.isCueStarred({ id: "new-id", source: "日本語  の 文", start_media_time: 1.25 }),
  true, "a re-keyed cue must inherit the saved star via matcher");
assert.strictEqual(content.isCueStarred({ id: "new-id", source: "日本語 の 文", start_media_time: 9 }),
  false, "a cue at another time must stay unstarred");
assert.strictEqual(content.findSavedCueForCue({ id: "new-id", source: "日本語 の 文", start_media_time: 1.25 })?.id,
  "old-id", "findSavedCueForCue must return the re-keyed saved row by normalized source");
content.setSavedCuesForTest({});

// -------------------------------------------------------------------------
// Audio anchors: every playhead-changing media event must reach the capture
// pipeline, not only the initial start message.
// -------------------------------------------------------------------------
assert.strictEqual(typeof content.bindAudioAnchorEvents, "function",
  "the content script must expose the real video-event binder");
assert.strictEqual(typeof content.sendAudioPlayheadAnchor, "function",
  "the content script must expose the playhead relay");
content.setAudioListeningForTest(true);
const listeners = new Map();
const video = {
  currentTime: 42.5,
  playbackRate: 1.5,
  paused: false,
  addEventListener(type, fn) { listeners.set(type, fn); },
  removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
};
const beforeAnchors = messages.length;
const unbindAnchors = content.bindAudioAnchorEvents(video);
assert.deepStrictEqual([...listeners.keys()].sort(),
  ["ended", "pause", "play", "ratechange", "seeked", "seeking"],
  "play, pause, seek and rate changes must all be anchored");
for (const [event, mutation] of [
  ["play", () => { video.paused = false; video.currentTime = 43; }],
  ["pause", () => { video.paused = true; video.currentTime = 43.5; }],
  ["seeking", () => { video.paused = false; video.currentTime = 90; }],
  ["seeked", () => { video.currentTime = 91; }],
  ["ratechange", () => { video.playbackRate = 2; video.currentTime = 92; }],
  ["ended", () => { video.paused = true; video.currentTime = 100; }],
]) {
  mutation();
  listeners.get(event)?.();
}
const anchors = messages.slice(beforeAnchors).filter((msg) => msg?.type === "AUDIO_UPDATE_PLAYHEAD");
assert.strictEqual(anchors.length, 6, "one anchor per real media event");
assert.deepStrictEqual(anchors.map((msg) => msg.event), ["play", "pause", "seeking", "seeked", "ratechange", "ended"]);
assert.deepStrictEqual(
  anchors.map((msg) => [msg.playhead, msg.playbackRate, msg.paused]),
  [[43, 1.5, false], [43.5, 1.5, true], [90, 1.5, false], [91, 1.5, false], [92, 2, false], [100, 2, true]],
  "each anchor must carry the media state at that event",
);
unbindAnchors();
content.setAudioListeningForTest(false);
const afterUnbind = messages.length;
listeners.get("play")?.();
assert.strictEqual(messages.length, afterUnbind, "removed video listeners must not keep sending anchors");

// ASR segment clocks are in captured-audio seconds. At 2x playback eight real
// seconds cover sixteen media seconds, so segment timestamps must be scaled.
assert.strictEqual(typeof content.asrSegmentBounds, "function",
  "the content script must expose its ASR segment clock mapper");
const scaledBounds = content.asrSegmentBounds(
  { startSec: 508.25, playbackRate: 2 },
  { start: 0.5, end: 2.0 },
);
assert.deepStrictEqual(
  [scaledBounds.start, scaledBounds.end],
  [509.25, 512.25],
  "ASR segment offsets must scale by the capture playback rate",
);
const unscaledBounds = content.asrSegmentBounds(
  { startSec: 100, playbackRate: 0 },
  { start: 1, end: 2 },
);
assert.deepStrictEqual(
  [unscaledBounds.start, unscaledBounds.end],
  [101, 102],
  "invalid rate metadata must fall back to real time",
);

// -------------------------------------------------------------------------
// Apply/Skip/Undo through the real side-panel command handler.
// -------------------------------------------------------------------------
(async () => {
assert.strictEqual(typeof content.handleSidePanelCmdForTest, "function",
  "the test seam must expose the real command handler");
assert.strictEqual(typeof content.handleAsrCandidateReceivedForTest, "function",
  "the test seam must expose the real ASR candidate receiver");

function seedHandlerCue(id = "handler-cue") {
  const cue = {
    id,
    source: "元の字幕",
    start_media_time: 10,
    end_media_time: 12,
    start: 10,
    end: 12,
    text_source: "asr",
    rawSource: "元の生字幕",
    normalization: { sentinel: "keep" },
    en: "",
    vi: "",
  };
  content.seedSentenceStateForTest({ videoId: "fixture", cues: [cue] });
  return cue;
}

function seedHandlerCues(seededCues) {
  content.seedSentenceStateForTest({ videoId: "fixture", cues: seededCues });
}

seedHandlerCue();
await content.handleAsrCandidateReceivedForTest({
  videoId: "fixture",
  startSec: 10,
  playbackRate: 1,
  result: { model: "fixture-asr", segments: [{ start: 0, end: 2, text: "完全な候補文" }] },
});
assert.strictEqual(content.getSentenceStateForTest().candidates["handler-cue"].text, "完全な候補文",
  "a segment covering exactly one cue must produce a candidate");

await content.handleAsrCandidateReceivedForTest({
  videoId: "fixture",
  startSec: 9.7,
  playbackRate: 1,
  result: { model: "fixture-asr", segments: [{ start: 0.3, end: 2.3, text: "断片" }] },
});
assert.strictEqual(content.getSentenceStateForTest().candidates["handler-cue"].text, "完全な候補文",
  "a shorter boundary fragment at equal coverage must not overwrite the candidate");

const savesBeforeSilence = messages.filter((msg) => msg?.type === "SAVED_CUES_MUTATE").length;
await content.handleAsrCandidateReceivedForTest({
  videoId: "fixture",
  startSec: 30,
  result: { model: "fixture-asr", text: "", segments: [] },
});
assert.strictEqual(messages.filter((msg) => msg?.type === "SAVED_CUES_MUTATE").length, savesBeforeSilence,
  "silence without a candidate must not write sentence state");

const applyResult = await content.handleSidePanelCmdForTest({ cmd: "accept_asr_candidate", id: "handler-cue" });
assert.strictEqual(applyResult.ok, true, "Apply must succeed through the real handler");
assert.strictEqual(content.getCues()[0].source, "完全な候補文", "Apply must replace the cue source");
assert.strictEqual(content.getCues()[0].text_source, "asr:fixture-asr",
  "Apply must preserve the candidate model provenance");
assert.strictEqual(content.getSentenceStateForTest().candidates["handler-cue"], undefined,
  "Apply must clear the applied candidate");
assert.ok(content.getSentenceStateForTest().undoRevisions["handler-cue"],
  "Apply must record the pre-apply revision for Undo");

const undoResult = await content.handleSidePanelCmdForTest({ cmd: "undo_sentence", id: "handler-cue" });
assert.strictEqual(undoResult.ok, true, "Undo must succeed before any later edit");
assert.strictEqual(content.getCues()[0].source, "元の字幕", "Undo must restore the exact pre-apply source");
assert.strictEqual(content.getCues()[0].rawSource, "元の生字幕",
  "Undo must restore the exact raw source");
assert.strictEqual(JSON.stringify(content.getCues()[0].normalization), JSON.stringify({ sentinel: "keep" }),
  "Undo must restore pre-apply normalization metadata");
assert.strictEqual(content.getCues()[0].text_source, "asr",
  "Undo must restore the pre-apply text source");

seedHandlerCue("skip-cue");
content.seedSentenceCandidatesForTest({
  "skip-cue": { text: "捨てる候補", provenance: "asr:fixture", model: "fixture-asr", start: 10, end: 12 },
});
const skipResult = await content.handleSidePanelCmdForTest({ cmd: "revert_asr_candidate", id: "skip-cue" });
assert.strictEqual(skipResult.ok, true, "Skip must succeed through the real handler");
assert.strictEqual(content.getSentenceStateForTest().candidates["skip-cue"], undefined,
  "Skip must clear the candidate");
assert.strictEqual(content.getCues()[0].source, "元の字幕", "Skip must not edit the cue");

seedHandlerCue("stale-undo-cue");
content.seedSentenceCandidatesForTest({
  "stale-undo-cue": { text: "適用する候補", provenance: "asr:fixture", model: "fixture-asr", start: 10, end: 12 },
});
await content.handleSidePanelCmdForTest({ cmd: "accept_asr_candidate", id: "stale-undo-cue" });
content.getCues()[0].source = "その後の手編集";
const staleUndo = await content.handleSidePanelCmdForTest({ cmd: "undo_sentence", id: "stale-undo-cue" });
assert.strictEqual(staleUndo.ok, false, "Undo must reject a cue changed after Apply");
assert.match(staleUndo.error, /Sentence changed/, "stale Undo must explain the revision mismatch");
assert.strictEqual(content.getCues()[0].source, "その後の手編集", "stale Undo must preserve the later edit");

seedHandlerCues([
  {
    id: "rolling-a",
    source: "状況でした。で、最後にこちら。こちらが",
    start_media_time: 171.64,
    end_media_time: 177.879,
    start: 171.64,
    end: 177.879,
    text_source: "yt",
  },
  {
    id: "rolling-b",
    source: "ですね、え、海洋熱量というものなんです",
    start_media_time: 174.92,
    end_media_time: 180.2,
    start: 174.92,
    end: 180.2,
    text_source: "yt",
  },
  {
    id: "rolling-c",
    source: "けども、海の中にどれだけ熱",
    start_media_time: 177.879,
    end_media_time: 181.959,
    start: 177.879,
    end: 181.959,
    text_source: "yt",
  },
]);
await content.handleAsrCandidateReceivedForTest({
  videoId: "fixture",
  startSec: 174.92,
  playbackRate: 1,
  result: {
    model: "fixture-asr",
    segments: [{
      start: 0,
      end: 5.28,
      text: "ですね、え、海洋熱量というものなんです",
      words: [
        { text: "ですね、", start: 0, end: 0.58 },
        { text: "え、", start: 0.58, end: 1.08 },
        { text: "海洋熱量", start: 1.08, end: 2.48 },
        { text: "というものなんです", start: 2.48, end: 4.88 },
      ],
    }],
  },
});
assert.strictEqual(
  content.getSentenceStateForTest().candidates["rolling-b"]?.text,
  "ですね、え、海洋熱量というものなんです",
  "word timestamps must bind an overlapping ASR segment to its real cue",
);
assert.strictEqual(
  content.getSentenceStateForTest().candidates["rolling-a"],
  undefined,
  "an overlapping neighbor must not receive the same candidate",
);

await content.handleAsrCandidateReceivedForTest({
  videoId: "fixture",
  startSec: 171.64,
  playbackRate: 1,
  result: {
    model: "fixture-asr",
    segments: [{
      start: 0,
      end: 8.56,
      text: "状況でした。で、最後にこちら。こちらが ですね、え、海洋熱量というものなんです",
      words: [
        { text: "状況でした。", start: 0, end: 1.86 },
        { text: "最後にこちら。", start: 1.86, end: 4.16 },
        { text: "海洋熱量", start: 4.36, end: 6.86 },
        { text: "というものなんです", start: 6.86, end: 8.56 },
      ],
    }],
  },
});
assert.strictEqual(
  content.getSentenceStateForTest().candidates["rolling-a"]?.text,
  undefined,
  "a mixed ASR window must not create a candidate for either overlapping cue",
);
assert.strictEqual(
  content.getSentenceStateForTest().candidates["rolling-b"]?.text,
  "ですね、え、海洋熱量というものなんです",
  "a mixed neighboring window must not overwrite the correct cue candidate",
);

seedHandlerCues([
  {
    id: "mixed-a",
    source: "ああああああああああ",
    start_media_time: 10,
    end_media_time: 20,
    start: 10,
    end: 20,
    text_source: "yt",
  },
  {
    id: "mixed-b",
    source: "いいいいいいいいいい",
    start_media_time: 20,
    end_media_time: 25,
    start: 20,
    end: 25,
    text_source: "yt",
  },
]);
const mixedWords = [];
for (let t = 10; t < 18.5; t += 0.5) mixedWords.push({ text: "ああ", start: t, end: t + 0.5 });
for (let t = 20; t < 21.5; t += 0.5) mixedWords.push({ text: "いい", start: t, end: t + 0.5 });
await content.handleAsrCandidateReceivedForTest({
  videoId: "fixture",
  startSec: 0,
  playbackRate: 1,
  result: {
    model: "fixture-asr",
    segments: [{ start: 10, end: 21.5, text: mixedWords.map((word) => word.text).join(""), words: mixedWords }],
  },
});
assert.strictEqual(
  content.getSentenceStateForTest().candidates["mixed-a"],
  undefined,
  "an 85/15 mixed ASR window must not create a candidate for the majority cue",
);
assert.strictEqual(
  content.getSentenceStateForTest().candidates["mixed-b"],
  undefined,
  "an 85/15 mixed ASR window must not create a candidate for the minority cue",
);

console.log("content_test: all assertions passed");
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
