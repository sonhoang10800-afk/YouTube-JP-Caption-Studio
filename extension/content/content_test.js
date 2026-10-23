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
  const noop = () => {};
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
        sendMessage: async () => ({ ok: true }),
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
    window: { addEventListener: noop, removeEventListener: noop, location: { href: "https://www.youtube.com/watch?v=fixture" } },
    location: { href: "https://www.youtube.com/watch?v=fixture", origin: "https://www.youtube.com" },
    navigator: { userAgent: "fixture", language: "ja" },
    fetch: async () => ({ ok: false, status: 0, json: async () => ({}) }),
  };
  context.globalThis = context;
  context.self = context;
  return { context, seam };
}

const { context, seam } = createContext();
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

console.log("content_test: all assertions passed");
