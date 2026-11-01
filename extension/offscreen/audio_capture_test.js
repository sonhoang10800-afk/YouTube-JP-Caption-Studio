/** Runtime tests for the real offscreen AudioWorklet capture path. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE = path.join(__dirname, "audio_capture.js");
const SAMPLE_RATE = 16000;

function loadOffscreen({ getUserMedia, responseText = "hello" } = {}) {
  const sent = [];
  const fetches = [];
  const nodes = [];
  const closed = [];
  const state = { trackStopped: false };
  let listener = null;

  class FakeAudioWorkletNode {
    constructor(context, name, options) {
      this.context = context;
      this.name = name;
      this.options = options;
      this.port = { onmessage: null };
      this.connected = [];
      nodes.push(this);
    }
    connect(node) { this.connected.push(node); }
    disconnect() { this.connected.length = 0; }
  }

  class FakeGain {
    constructor() { this.gain = { value: 0 }; }
    connect() {}
  }

  class FakeAudioContext {
    constructor(options) {
      this.sampleRate = options?.sampleRate || 48000;
      this.state = "running";
      this.destination = { kind: "destination" };
      this.audioWorklet = { addModule: async (url) => { this.workletUrl = url; } };
    }
    async resume() { this.state = "running"; }
    createMediaStreamSource() { return { connect() {} }; }
    createGain() { return new FakeGain(); }
    async close() { closed.push(this); }
  }

  const sandbox = {
    console,
    Blob,
    ArrayBuffer,
    DataView,
    Float32Array,
    Math,
    Number,
    String,
    JSON,
    Promise,
    Object,
    Array,
    Set,
    AbortSignal,
    AbortController,
    AudioWorkletNode: FakeAudioWorkletNode,
    fetch: async (url, options) => {
      const body = Buffer.from(await options.body.arrayBuffer());
      fetches.push({ url, options, body });
      return { ok: true, json: async () => ({ text: responseText, segments: [] }) };
    },
    navigator: { mediaDevices: { getUserMedia } },
    window: { AudioContext: FakeAudioContext },
    chrome: {
      runtime: {
        getURL: (resource) => `chrome-extension://test/${resource}`,
        onMessage: { addListener: (fn) => { listener = fn; } },
        sendMessage: async (msg) => { sent.push(msg); },
      },
    },
  };
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SOURCE, "utf8"), context, { filename: SOURCE });

  return {
    closed,
    fetches,
    nodes,
    sent,
    state,
    async pushPcm(seconds, fill = 0.1) {
      const total = Math.round(seconds * SAMPLE_RATE);
      let offset = 0;
      while (offset < total) {
        const count = Math.min(2048, total - offset);
        const samples = new Float32Array(count);
        samples.fill(fill);
        nodes[0].port.onmessage({ data: { type: "pcm", samples } });
        offset += count;
        await new Promise((resolve) => setImmediate(resolve));
      }
    },
    send: (msg) => new Promise((resolve) => {
      assert.ok(listener, "offscreen document registered no message listener");
      listener(msg, {}, resolve);
    }),
  };
}

function fakeStream(env) {
  return {
    getTracks: () => [{ stop() { env.state.trackStopped = true; } }],
  };
}

function wavInfo(buffer) {
  assert.equal(buffer.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(buffer.subarray(8, 12).toString("ascii"), "WAVE");
  assert.equal(buffer.readUInt16LE(20), 1, "PCM format");
  assert.equal(buffer.readUInt16LE(22), 1, "mono");
  assert.equal(buffer.readUInt32LE(24), SAMPLE_RATE);
  assert.equal(buffer.readUInt16LE(34), 16);
  assert.equal(buffer.readUInt32LE(40), buffer.length - 44);
  return { samples: (buffer.length - 44) / 2, peak: buffer.readInt16LE(44) };
}

async function start(env, extra = {}) {
  return env.send({
    target: "offscreen",
    type: "START_CAPTURE",
    streamId: "stream-1",
    tabId: 7,
    videoId: "vid1",
    playhead: 100,
    playbackRate: 1,
    paused: false,
    ...extra,
  });
}

(async () => {
  console.log("Running Offscreen Audio Capture Tests...");

  {
    const env = loadOffscreen({ getUserMedia: async () => { throw new Error("Permission denied"); } });
    const res = await start(env);
    assert.equal(res.ok, false);
    assert.match(res.error, /Permission denied/);
    assert.ok(env.sent.some((msg) => msg.type === "ASR_CAPTURE_ERROR"));
    console.log("PASS: capture failure rejects START_CAPTURE");
  }

  {
    const env = loadOffscreen({ getUserMedia: async () => fakeStream(env) });
    const res = await start(env);
    assert.equal(res.ok, true);
    assert.equal(env.nodes.length, 1);
    assert.equal(env.nodes[0].name, "pcm-capture");
    assert.equal(env.nodes[0].options.processorOptions.chunkSize, 2048);

    await env.pushPcm(8);
    assert.equal(env.fetches.length, 1, "a full 8-second PCM window is dispatched");
    assert.match(
      env.fetches[0].url,
      /[?&]word_timestamps=true(?:&|$)/,
      "the ASR request must opt into optional word timestamps",
    );
    assert.equal(env.fetches[0].options.headers["Content-Type"], "audio/wav");
    const info = wavInfo(env.fetches[0].body);
    assert.equal(info.samples, SAMPLE_RATE * 8, "the WAV must contain exactly 8 seconds");
    assert.ok(info.peak > 3000 && info.peak < 4000, "PCM must be signed 16-bit");
    await new Promise((resolve) => setImmediate(resolve));
    const first = env.sent.find((msg) => msg.type === "ASR_CANDIDATE_RECEIVED");
    assert.equal(first.startSec, 100);
    assert.equal(first.endSec, 108);

    // 1.5 s remains buffered; another 6.5 s completes the next true 8 s window.
    await env.pushPcm(6.5);
    assert.equal(env.fetches.length, 2);
    await new Promise((resolve) => setImmediate(resolve));
    const candidates = env.sent.filter((msg) => msg.type === "ASR_CANDIDATE_RECEIVED");
    assert.equal(candidates[1].startSec, 106.5);
    assert.equal(candidates[1].endSec, 114.5);
    console.log("PASS: true 8-second window, 6.5-second hop and WAV 16 kHz mono");
  }

  {
    const env = loadOffscreen({ getUserMedia: async () => fakeStream(env), responseText: "" });
    await start(env);
    await env.pushPcm(15, 0);
    assert.equal(env.fetches.length, 2, "silence may still be sent to the server gate");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(env.sent.filter((msg) => msg.type === "ASR_CANDIDATE_RECEIVED").length, 0);
    console.log("PASS: 15 seconds of silence yields zero candidates");
  }

  {
    const env = loadOffscreen({ getUserMedia: async () => fakeStream(env) });
    await start(env);
    await env.pushPcm(4);
    await env.send({ target: "offscreen", type: "UPDATE_PLAYHEAD", event: "pause", playhead: 104, playbackRate: 1, paused: true });
    await env.pushPcm(15);
    assert.equal(env.fetches.length, 0, "pause must discard the partial window");

    await env.send({ target: "offscreen", type: "UPDATE_PLAYHEAD", event: "play", playhead: 200, playbackRate: 1, paused: false });
    await env.pushPcm(8);
    await new Promise((resolve) => setImmediate(resolve));
    const candidate = env.sent.find((msg) => msg.type === "ASR_CANDIDATE_RECEIVED");
    assert.ok(candidate, "the resumed window must dispatch");
    assert.deepEqual([candidate.startSec, candidate.endSec], [200, 208]);
    console.log("PASS: pause clears a partial window and resume re-anchors the next one");
  }

  {
    const env = loadOffscreen({ getUserMedia: async () => fakeStream(env) });
    await start(env);
    await env.pushPcm(3);
    await env.send({ target: "offscreen", type: "UPDATE_PLAYHEAD", event: "seeked", playhead: 500.25, playbackRate: 1, paused: false });
    await env.pushPcm(8);
    await new Promise((resolve) => setImmediate(resolve));
    const candidate = env.sent.find((msg) => msg.type === "ASR_CANDIDATE_RECEIVED");
    assert.deepEqual([candidate.startSec, candidate.endSec], [500.25, 508.25]);

    await env.send({ target: "offscreen", type: "UPDATE_PLAYHEAD", event: "ratechange", playhead: 508.25, playbackRate: 2, paused: false });
    await env.pushPcm(8);
    await new Promise((resolve) => setImmediate(resolve));
    const candidates = env.sent.filter((msg) => msg.type === "ASR_CANDIDATE_RECEIVED");
    assert.deepEqual([candidates[1].startSec, candidates[1].endSec], [508.25, 524.25]);
    assert.equal(candidates[1].playbackRate, 2, "the candidate must carry its media-time scale");
    console.log("PASS: seek and playback rate re-anchor without overlap drift");
  }

  {
    const env = loadOffscreen({ getUserMedia: async () => fakeStream(env) });
    await start(env);
    const res = await env.send({ target: "offscreen", type: "STOP_CAPTURE" });
    assert.equal(res.ok, true);
    assert.equal(env.state.trackStopped, true);
    assert.equal(env.closed.length, 1);
    console.log("PASS: STOP_CAPTURE releases the worklet and tab stream");
  }

  console.log("ALL OFFSCREEN AUDIO CAPTURE TESTS PASSED!");
})().catch((err) => {
  console.error("OFFSCREEN AUDIO CAPTURE TESTS FAILED:", err);
  process.exit(1);
});
