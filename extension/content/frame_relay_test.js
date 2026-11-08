#!/usr/bin/env node
/**
 * frame_relay_test.js
 * First-Class Project Unit Test Suite for extension/content/frame_relay.js.
 * 
 * Verifies the 14-point adversarial specification:
 * - Child iframe isolation guard (1.1)
 * - Track collection and deduplication (2.1)
 * - Language classification matrix & false-positive substring rejection (3.1, 3.2, 3.3)
 * - Strict Zero Video Overlay enforcement & periodic suppression (4.1, 4.2, 4.3)
 * - Sanitization, HTML entity decoding, timestamp rounding, and duration clamping (5.1, 5.2, 5.3)
 * - Cross-origin postMessage relay to parent/top, signature dedup, and parent commands (6.1, 6.2, 6.3)
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

console.log("===================================================================");
console.log("  FRAME_RELAY TEST SUITE (14 ADVERSARIAL POINTS)");
console.log("===================================================================\n");

const FRAME_RELAY_SRC = fs.readFileSync(
  path.join(__dirname, "frame_relay.js"),
  "utf8"
);

function createFrameRelayEnvironment() {
  const parentMessages = [];
  const topMessages = [];
  const chromeRuntimeMessages = [];
  const windowListeners = {};
  const intervals = [];

  const topWindow = {
    postMessage: (msg, targetOrigin) => {
      topMessages.push({ msg, targetOrigin });
    },
  };

  const parentWindow = {
    postMessage: (msg, targetOrigin) => {
      parentMessages.push({ msg, targetOrigin });
    },
  };

  const win = {
    top: topWindow,
    parent: parentWindow,
    addEventListener: (type, fn, opts) => {
      if (!windowListeners[type]) windowListeners[type] = [];
      windowListeners[type].push(fn);
    },
    removeEventListener: (type, fn) => {
      if (windowListeners[type]) {
        windowListeners[type] = windowListeners[type].filter((f) => f !== fn);
      }
    },
    setInterval: (fn, ms) => {
      const id = intervals.length + 1;
      intervals.push({ id, fn, ms });
      return id;
    },
    clearInterval: (id) => {
      const idx = intervals.findIndex((item) => item.id === id);
      if (idx !== -1) intervals.splice(idx, 1);
    },
  };

  // win !== win.top (child iframe)
  assert.notStrictEqual(win, win.top, "must simulate child iframe");

  const docListeners = {};
  const registeredElements = [];

  const doc = {
    readyState: "complete",
    documentElement: {},
    addEventListener: (type, fn) => {
      if (!docListeners[type]) docListeners[type] = [];
      docListeners[type].push(fn);
    },
    querySelector: (selector) => {
      if (selector === "video") {
        return registeredElements.find((el) => el.tagName === "video") || null;
      }
      return null;
    },
    querySelectorAll: (selector) => {
      if (selector === "video") {
        return registeredElements.filter((el) => el.tagName === "video");
      }
      if (selector === "iframe") {
        return registeredElements.filter((el) => el.tagName === "iframe");
      }
      return [];
    },
  };

  class MockMutationObserver {
    constructor(cb) {
      this.cb = cb;
    }
    observe() {}
    disconnect() {}
  }

  const chromeMock = {
    runtime: {
      sendMessage: async (msg) => {
        chromeRuntimeMessages.push(msg);
        return { status: "ok" };
      },
    },
  };

  const sandbox = {
    window: win,
    document: doc,
    MutationObserver: MockMutationObserver,
    setInterval: win.setInterval,
    clearInterval: win.clearInterval,
    chrome: chromeMock,
    console,
    Math,
    Number,
    String,
    Set,
    Array,
    Object,
  };

  sandbox.window.window = win;
  sandbox.window.document = doc;

  const context = vm.createContext(sandbox);

  return {
    context,
    win,
    doc,
    registeredElements,
    parentMessages,
    topMessages,
    chromeRuntimeMessages,
    windowListeners,
    intervals,
  };
}

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.stack || err.message}`);
    failed++;
  }
}

// -----------------------------------------------------------------------------
// [Category 1] Child Iframe Isolation Guard
// -----------------------------------------------------------------------------
console.log("[Category 1] Child Iframe Isolation Guard");

runTest("1.1 frame_relay exits immediately when window === window.top", () => {
  const env = createFrameRelayEnvironment();
  // Simulate top-level window
  env.win.top = env.win;
  env.win.parent = env.win;

  let videoAttached = false;
  env.registeredElements.push({
    tagName: "video",
    currentTime: 10,
    duration: 100,
    paused: false,
    addEventListener: () => {
      videoAttached = true;
    },
  });

  vm.runInContext(FRAME_RELAY_SRC, env.context);

  assert.strictEqual(videoAttached, false, "Must not attach to video when window === window.top");
  assert.strictEqual(env.parentMessages.length, 0, "Must not send messages from top window");
  assert.strictEqual(env.intervals.length, 0, "Must not start intervals from top window");
});

// -----------------------------------------------------------------------------
// [Category 2] Track Collection & Deduplication
// -----------------------------------------------------------------------------
console.log("\n[Category 2] Track Collection & Deduplication");

runTest("2.1 Collects both <track> DOM elements and video.textTracks, deduplicating shared tracks", () => {
  const env = createFrameRelayEnvironment();

  const sharedTextTrack = {
    kind: "subtitles",
    language: "vi",
    label: "Vietnamese Softsub",
    mode: "disabled",
    cues: [
      { startTime: 1.0, endTime: 4.0, text: "Xin chào thế giới" },
      { startTime: 5.0, endTime: 8.0, text: "Tập phim bắt đầu" },
    ],
    addEventListener: () => {},
  };

  const trackEl = {
    tagName: "track",
    kind: "subtitles",
    srclang: "vi",
    label: "Vietnamese Softsub",
    track: sharedTextTrack,
    addEventListener: () => {},
  };

  const uniqueAddTextTrack = {
    kind: "captions",
    language: "en",
    label: "English SDH",
    mode: "disabled",
    cues: [
      { startTime: 1.0, endTime: 4.0, text: "Hello world" },
    ],
    addEventListener: () => {},
  };

  const videoListeners = {};
  const mockVideo = {
    tagName: "video",
    currentTime: 0,
    duration: 120,
    paused: true,
    addEventListener: (type, fn) => {
      videoListeners[type] = fn;
    },
    querySelectorAll: (sel) => {
      if (sel === "track") return [trackEl];
      return [];
    },
    textTracks: [sharedTextTrack, uniqueAddTextTrack],
  };

  mockVideo.textTracks.addEventListener = () => {};
  env.registeredElements.push(mockVideo);

  vm.runInContext(FRAME_RELAY_SRC, env.context);

  // Check relayed soft sub message
  const softSubMsg = env.parentMessages.find((m) => m.msg?.type === "ANIMEVIETSUB_SOFT_SUBS");
  assert.ok(softSubMsg, "ANIMEVIETSUB_SOFT_SUBS message must be dispatched");
  assert.strictEqual(softSubMsg.msg.viCues.length, 2, "Must extract 2 VI cues from shared track");
  assert.strictEqual(softSubMsg.msg.enCues.length, 1, "Must extract 1 EN cue from unique textTrack");
  assert.strictEqual(softSubMsg.msg.viCues[0].text, "Xin chào thế giới");
  assert.strictEqual(softSubMsg.msg.enCues[0].text, "Hello world");
});

// -----------------------------------------------------------------------------
// [Category 3] Language Classification (detectTrackLanguage)
// -----------------------------------------------------------------------------
console.log("\n[Category 3] Language Classification Matrix");

runTest("3.1 Vietnamese language matching & label detection", () => {
  const viTestCases = [
    { lang: "vi", label: "" },
    { lang: "vie", label: "" },
    { lang: "vi-VN", label: "" },
    { lang: "vi_VN", label: "" },
    { lang: "vietnamese", label: "" },
    { lang: "", label: "Vietsub" },
    { lang: "", label: "Anime Vietsub" },
    { lang: "", label: "Tiếng Việt" },
    { lang: "", label: "Bản dịch tiếng việt chuẩn" },
    { lang: "", label: "Tieng Viet" },
    { lang: "vi", label: "Phụ đề" },
  ];

  for (const tc of viTestCases) {
    const env = createFrameRelayEnvironment();
    const track = {
      kind: "subtitles",
      language: tc.lang,
      label: tc.label,
      mode: "disabled",
      cues: [{ startTime: 1, endTime: 3, text: "VI test" }],
      addEventListener: () => {},
    };
    const video = {
      tagName: "video",
      currentTime: 0,
      duration: 100,
      paused: true,
      addEventListener: () => {},
      querySelectorAll: () => [],
      textTracks: [track],
    };
    video.textTracks.addEventListener = () => {};
    env.registeredElements.push(video);

    vm.runInContext(FRAME_RELAY_SRC, env.context);

    const msg = env.parentMessages.find((m) => m.msg?.type === "ANIMEVIETSUB_SOFT_SUBS");
    assert.ok(msg, `Should dispatch soft subs for VI case: lang="${tc.lang}", label="${tc.label}"`);
    assert.strictEqual(msg.msg.viCues.length, 1, `VI cues must be 1 for lang="${tc.lang}", label="${tc.label}"`);
    assert.strictEqual(msg.msg.enCues.length, 0, "EN cues must be 0");
  }
});

runTest("3.2 English language matching & label detection", () => {
  const enTestCases = [
    { lang: "en", label: "" },
    { lang: "eng", label: "" },
    { lang: "en-US", label: "" },
    { lang: "en-GB", label: "" },
    { lang: "english", label: "" },
    { lang: "", label: "English" },
    { lang: "", label: "English [CC]" },
    { lang: "", label: "English SDH" },
    { lang: "en", label: "Subtitles" },
  ];

  for (const tc of enTestCases) {
    const env = createFrameRelayEnvironment();
    const track = {
      kind: "subtitles",
      language: tc.lang,
      label: tc.label,
      mode: "disabled",
      cues: [{ startTime: 1, endTime: 3, text: "EN test" }],
      addEventListener: () => {},
    };
    const video = {
      tagName: "video",
      currentTime: 0,
      duration: 100,
      paused: true,
      addEventListener: () => {},
      querySelectorAll: () => [],
      textTracks: [track],
    };
    video.textTracks.addEventListener = () => {};
    env.registeredElements.push(video);

    vm.runInContext(FRAME_RELAY_SRC, env.context);

    const msg = env.parentMessages.find((m) => m.msg?.type === "ANIMEVIETSUB_SOFT_SUBS");
    assert.ok(msg, `Should dispatch soft subs for EN case: lang="${tc.lang}", label="${tc.label}"`);
    assert.strictEqual(msg.msg.enCues.length, 1, `EN cues must be 1 for lang="${tc.lang}", label="${tc.label}"`);
    assert.strictEqual(msg.msg.viCues.length, 0, "VI cues must be 0");
  }
});

runTest("3.3 Adversarial rejection of non-VI/EN languages and false-positive substring traps", () => {
  const rejectedCases = [
    { lang: "ja", label: "Japanese" },
    { lang: "ko", label: "Korean" },
    { lang: "zh", label: "Chinese" },
    { lang: "fr", label: "Français" },
    { lang: "de", label: "Deutsch" },
    { lang: "es", label: "Español" },
    { lang: "ru", label: "Russian" },
    // False-positive substring traps
    { lang: "xx", label: "Device Audio" },
    { lang: "xx", label: "Soviet Documentary" },
    { lang: "xx", label: "Vienna Philharmonic" },
    { lang: "xx", label: "Green Screen Capture" },
    { lang: "xx", label: "Open Captions" },
    { lang: "xx", label: "Children Choir" },
    { lang: "xx", label: "Token Stream" },
  ];

  for (const tc of rejectedCases) {
    const env = createFrameRelayEnvironment();
    const track = {
      kind: "subtitles",
      language: tc.lang,
      label: tc.label,
      mode: "disabled",
      cues: [{ startTime: 1, endTime: 3, text: "Trap text" }],
      addEventListener: () => {},
    };
    const video = {
      tagName: "video",
      currentTime: 0,
      duration: 100,
      paused: true,
      addEventListener: () => {},
      querySelectorAll: () => [],
      textTracks: [track],
    };
    video.textTracks.addEventListener = () => {};
    env.registeredElements.push(video);

    vm.runInContext(FRAME_RELAY_SRC, env.context);

    const msg = env.parentMessages.find((m) => m.msg?.type === "ANIMEVIETSUB_SOFT_SUBS");
    assert.strictEqual(msg, undefined, `Should NOT dispatch soft subs for rejected case: lang="${tc.lang}", label="${tc.label}"`);
  }
});

// -----------------------------------------------------------------------------
// [Category 4] Strict Zero Video Overlay Enforcement
// -----------------------------------------------------------------------------
console.log("\n[Category 4] Strict Zero Video Overlay Enforcement");

runTest("4.1 Actively suppresses track.mode = 'showing' to 'hidden'", () => {
  const env = createFrameRelayEnvironment();

  const showingTrack = {
    kind: "subtitles",
    language: "vi",
    label: "Vietsub",
    mode: "showing", // Active player overlay attempt!
    cues: [{ startTime: 2.0, endTime: 5.0, text: "Lời thoại nhân vật" }],
    addEventListener: () => {},
  };

  const video = {
    tagName: "video",
    currentTime: 0,
    duration: 100,
    paused: true,
    addEventListener: () => {},
    querySelectorAll: () => [],
    textTracks: [showingTrack],
  };
  video.textTracks.addEventListener = () => {};
  env.registeredElements.push(video);

  vm.runInContext(FRAME_RELAY_SRC, env.context);

  assert.strictEqual(
    showingTrack.mode,
    "hidden",
    "Must immediately convert track.mode from 'showing' to 'hidden' (Strict Zero Video Overlay)"
  );
});

runTest("4.2 Converts track.mode = 'disabled' to 'hidden' for memory cue decoding", () => {
  const env = createFrameRelayEnvironment();

  const disabledTrack = {
    kind: "subtitles",
    language: "en",
    label: "English",
    mode: "disabled",
    cues: [{ startTime: 1.0, endTime: 3.0, text: "Decoded in memory" }],
    addEventListener: () => {},
  };

  const video = {
    tagName: "video",
    currentTime: 0,
    duration: 100,
    paused: true,
    addEventListener: () => {},
    querySelectorAll: () => [],
    textTracks: [disabledTrack],
  };
  video.textTracks.addEventListener = () => {};
  env.registeredElements.push(video);

  vm.runInContext(FRAME_RELAY_SRC, env.context);

  assert.strictEqual(
    disabledTrack.mode,
    "hidden",
    "Must convert 'disabled' to 'hidden' so cues decode in memory without video overlay"
  );
});

runTest("4.3 Periodic heartbeat continuously suppresses player re-enabling track.mode = 'showing'", () => {
  const env = createFrameRelayEnvironment();

  const track = {
    kind: "subtitles",
    language: "vi",
    label: "Vietsub",
    mode: "disabled",
    cues: [{ startTime: 1.0, endTime: 3.0, text: "Lặp lại" }],
    addEventListener: () => {},
  };

  const video = {
    tagName: "video",
    currentTime: 10,
    duration: 100,
    paused: false,
    addEventListener: () => {},
    querySelectorAll: () => [],
    textTracks: [track],
  };
  video.textTracks.addEventListener = () => {};
  env.registeredElements.push(video);

  vm.runInContext(FRAME_RELAY_SRC, env.context);

  assert.strictEqual(track.mode, "hidden");

  // Player script or user natively turns captions on during playback
  track.mode = "showing";

  // Simulate 1000ms periodic heartbeat tick
  const heartbeat = env.intervals.find((i) => i.ms === 1000);
  assert.ok(heartbeat, "Heartbeat interval must be scheduled at 1000ms");
  heartbeat.fn();

  assert.strictEqual(
    track.mode,
    "hidden",
    "Heartbeat tick must suppress re-enabled 'showing' track back to 'hidden'"
  );
});

// -----------------------------------------------------------------------------
// [Category 5] Sanitization & Cue Clamping
// -----------------------------------------------------------------------------
console.log("\n[Category 5] Sanitization & Cue Clamping");

runTest("5.1 Strips HTML formatting, decodes entities, and cleans whitespace in cue text", () => {
  const env = createFrameRelayEnvironment();

  const dirtyCues = [
    {
      startTime: 1.0,
      endTime: 3.0,
      text: "Line 1<br>Line 2<br />Line 3",
    },
    {
      startTime: 5.0,
      endTime: 8.0,
      text: "<i>Italic</i> <b>Bold</b> <c.yellow>Color</c> <v Narrator>Speech</v>",
    },
    {
      startTime: 10.0,
      endTime: 12.0,
      text: "&quot;Hello&quot; &amp; &lt;World&gt; &#39;Single&#39; &apos;Apos&apos; &#x27;Hex&#x27; &nbsp; Spaced",
    },
    {
      startTime: 15.0,
      endTime: 18.0,
      text: "   Multiple    spaces    and   \t  tabs   ",
    },
  ];

  const track = {
    kind: "subtitles",
    language: "vi",
    label: "Vietsub",
    mode: "disabled",
    cues: dirtyCues,
    addEventListener: () => {},
  };

  const video = {
    tagName: "video",
    currentTime: 0,
    duration: 100,
    paused: true,
    addEventListener: () => {},
    querySelectorAll: () => [],
    textTracks: [track],
  };
  video.textTracks.addEventListener = () => {};
  env.registeredElements.push(video);

  vm.runInContext(FRAME_RELAY_SRC, env.context);

  const msg = env.parentMessages.find((m) => m.msg?.type === "ANIMEVIETSUB_SOFT_SUBS");
  assert.ok(msg);
  const cues = msg.msg.viCues;

  assert.strictEqual(cues[0].text, "Line 1 Line 2 Line 3");
  assert.strictEqual(cues[1].text, "Italic Bold Color Speech");
  assert.strictEqual(cues[2].text, '"Hello" & <World> \'Single\' \'Apos\' \'Hex\' Spaced');
  assert.strictEqual(cues[3].text, "Multiple spaces and tabs");
});

runTest("5.2 Clamps invalid or non-positive durations to start + 2 and rounds timestamps", () => {
  const env = createFrameRelayEnvironment();

  const pathologicalCues = [
    { startTime: 1.123456, endTime: 4.987654, text: "Normal cue" },
    { startTime: 10.0, endTime: 10.0, text: "Zero duration cue" },
    { startTime: 20.0, endTime: 15.0, text: "Inverted duration cue" },
    { startTime: 30.0, endTime: NaN, text: "NaN end cue" },
  ];

  const track = {
    kind: "subtitles",
    language: "en",
    label: "English",
    mode: "disabled",
    cues: pathologicalCues,
    addEventListener: () => {},
  };

  const video = {
    tagName: "video",
    currentTime: 0,
    duration: 100,
    paused: true,
    addEventListener: () => {},
    querySelectorAll: () => [],
    textTracks: [track],
  };
  video.textTracks.addEventListener = () => {};
  env.registeredElements.push(video);

  vm.runInContext(FRAME_RELAY_SRC, env.context);

  const msg = env.parentMessages.find((m) => m.msg?.type === "ANIMEVIETSUB_SOFT_SUBS");
  assert.ok(msg);
  const cues = msg.msg.enCues;

  assert.strictEqual(cues[0].start, 1.123, "Rounded to 3 decimal places");
  assert.strictEqual(cues[0].end, 4.988, "Rounded to 3 decimal places");

  assert.strictEqual(cues[1].start, 10.0);
  assert.strictEqual(cues[1].end, 12.0, "Zero duration clamped to start + 2");

  assert.strictEqual(cues[2].start, 20.0);
  assert.strictEqual(cues[2].end, 22.0, "Inverted duration clamped to start + 2");

  assert.strictEqual(cues[3].start, 30.0);
  assert.strictEqual(cues[3].end, 32.0, "NaN duration clamped to start + 2");
});

runTest("5.3 Signature deduplication prevents flooding postMessage with duplicate cue sets", () => {
  const env = createFrameRelayEnvironment();

  const track = {
    kind: "subtitles",
    language: "vi",
    label: "Vietsub",
    mode: "disabled",
    cues: [{ startTime: 1.0, endTime: 3.0, text: "Deduplication test" }],
    addEventListener: () => {},
  };

  const video = {
    tagName: "video",
    currentTime: 0,
    duration: 100,
    paused: false,
    addEventListener: () => {},
    querySelectorAll: () => [],
    textTracks: [track],
  };
  video.textTracks.addEventListener = () => {};
  env.registeredElements.push(video);

  vm.runInContext(FRAME_RELAY_SRC, env.context);

  assert.strictEqual(env.parentMessages.filter((m) => m.msg?.type === "ANIMEVIETSUB_SOFT_SUBS").length, 1);

  // Trigger heartbeat tick 10 times with identical cues
  const heartbeat = env.intervals.find((i) => i.ms === 1000);
  for (let i = 0; i < 10; i++) {
    heartbeat.fn();
  }

  assert.strictEqual(
    env.parentMessages.filter((m) => m.msg?.type === "ANIMEVIETSUB_SOFT_SUBS").length,
    1,
    "Should NOT dispatch duplicate ANIMEVIETSUB_SOFT_SUBS messages when cue signature has not changed"
  );
});

// -----------------------------------------------------------------------------
// [Category 6] Cross-Origin Relay & Parent IPC
// -----------------------------------------------------------------------------
console.log("\n[Category 6] Cross-Origin Relay & Parent IPC");

runTest("6.1 Relays to both window.parent and window.top", () => {
  const env = createFrameRelayEnvironment();

  const track = {
    kind: "subtitles",
    language: "vi",
    label: "Vietsub",
    mode: "disabled",
    cues: [{ startTime: 1.0, endTime: 3.0, text: "Dual relay" }],
    addEventListener: () => {},
  };

  const video = {
    tagName: "video",
    currentTime: 5.5,
    duration: 120,
    paused: false,
    addEventListener: () => {},
    querySelectorAll: () => [],
    textTracks: [track],
  };
  video.textTracks.addEventListener = () => {};
  env.registeredElements.push(video);

  vm.runInContext(FRAME_RELAY_SRC, env.context);

  assert.ok(env.parentMessages.some((m) => m.msg?.type === "ANIMEVIETSUB_SOFT_SUBS"));
  assert.ok(env.topMessages.some((m) => m.msg?.type === "ANIMEVIETSUB_SOFT_SUBS"));
  assert.ok(env.parentMessages.some((m) => m.msg?.type === "ANIMEVIETSUB_TIMEUPDATE" && m.msg.currentTime === 5.5));
  assert.ok(env.topMessages.some((m) => m.msg?.type === "ANIMEVIETSUB_TIMEUPDATE" && m.msg.currentTime === 5.5));
});

runTest("6.2 Responds to GET_ANIMEVIETSUB_SOFT_SUBS by resetting signature and re-dispatching", () => {
  const env = createFrameRelayEnvironment();

  const track = {
    kind: "subtitles",
    language: "vi",
    label: "Vietsub",
    mode: "disabled",
    cues: [{ startTime: 1.0, endTime: 3.0, text: "Force refresh" }],
    addEventListener: () => {},
  };

  const video = {
    tagName: "video",
    currentTime: 0,
    duration: 100,
    paused: true,
    addEventListener: () => {},
    querySelectorAll: () => [],
    textTracks: [track],
  };
  video.textTracks.addEventListener = () => {};
  env.registeredElements.push(video);

  vm.runInContext(FRAME_RELAY_SRC, env.context);

  const initialCount = env.parentMessages.filter((m) => m.msg?.type === "ANIMEVIETSUB_SOFT_SUBS").length;
  assert.strictEqual(initialCount, 1);

  // Send GET_ANIMEVIETSUB_SOFT_SUBS message from parent
  const messageListeners = env.windowListeners["message"] || [];
  for (const fn of messageListeners) {
    fn({ data: { type: "GET_ANIMEVIETSUB_SOFT_SUBS" } });
  }

  const refreshedCount = env.parentMessages.filter((m) => m.msg?.type === "ANIMEVIETSUB_SOFT_SUBS").length;
  assert.strictEqual(refreshedCount, 2, "Parent request must trigger immediate re-dispatch of soft subtitles");
});

runTest("6.3 Handles SEEK_TO command from parent frame and updates video currentTime", () => {
  const env = createFrameRelayEnvironment();

  let playCalled = false;
  const video = {
    tagName: "video",
    currentTime: 0,
    duration: 100,
    paused: true,
    play: () => {
      playCalled = true;
      return Promise.resolve();
    },
    addEventListener: () => {},
    querySelectorAll: () => [],
    textTracks: [],
  };
  video.textTracks.addEventListener = () => {};
  env.registeredElements.push(video);

  vm.runInContext(FRAME_RELAY_SRC, env.context);

  const messageListeners = env.windowListeners["message"] || [];
  for (const fn of messageListeners) {
    fn({ data: { type: "SEEK_TO", mediaTime: 42.5 } });
  }

  assert.strictEqual(video.currentTime, 42.5, "Video currentTime must be updated by SEEK_TO command");
  assert.strictEqual(playCalled, true, "Video play() must be triggered on seek");
});

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------
console.log("\n===================================================================");
console.log(`  RESULTS: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
console.log("===================================================================");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("frame_relay_test: all assertions passed");
  process.exit(0);
}
