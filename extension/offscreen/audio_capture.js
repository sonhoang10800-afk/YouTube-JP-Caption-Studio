/**
 * Offscreen tab-audio capture for ASR.
 *
 * An AudioWorklet forwards real PCM. The page keeps a true 8-second rolling
 * window and drops 6.5 seconds after each dispatch, leaving a 1.5-second audio
 * overlap. Timestamps are anchored to the video playhead, never advanced by
 * the overlap amount, so pause/seek/rate events cannot make them drift.
 */

const BRIDGE_ASR_URL = "http://127.0.0.1:8765/asr/transcribe?word_timestamps=true";
const CAPTURE_SAMPLE_RATE = 16000;
const SLICE_DURATION_MS = 8000;
const OVERLAP_MS = 1500;
const SLICE_SAMPLES = (CAPTURE_SAMPLE_RATE * SLICE_DURATION_MS) / 1000;
const HOP_SAMPLES = SLICE_SAMPLES - (CAPTURE_SAMPLE_RATE * OVERLAP_MS) / 1000;
const ASR_TIMEOUT_MS = 60_000;

let currentStream = null;
let currentAudioCtx = null;
let workletNode = null;
let isCapturing = false;
let activeTabId = null;
let activeVideoId = null;
let captureEpoch = 0;
let paused = false;
let playbackRate = 1;
let anchorPlayhead = 0;
let bufferStartPlayhead = 0;
let pcmWindow = new Float32Array(0);
const inFlight = new Set();

function resetWindow(playhead) {
  captureEpoch += 1;
  anchorPlayhead = Math.max(0, Number(playhead) || 0);
  bufferStartPlayhead = anchorPlayhead;
  pcmWindow = new Float32Array(0);
  for (const controller of inFlight) controller.abort();
  inFlight.clear();
}

function encodeWav16(samples, sampleRate = CAPTURE_SAMPLE_RATE) {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeText = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, Number(samples[i]) || 0));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function appendPcm(samples) {
  if (!isCapturing || paused || !samples?.length) return;
  const merged = new Float32Array(pcmWindow.length + samples.length);
  merged.set(pcmWindow);
  merged.set(samples, pcmWindow.length);
  pcmWindow = merged;

  while (pcmWindow.length >= SLICE_SAMPLES) {
    const slice = pcmWindow.slice(0, SLICE_SAMPLES);
    const startSec = bufferStartPlayhead;
    const endSec = startSec + (SLICE_DURATION_MS / 1000) * playbackRate;
    const epoch = captureEpoch;
    const slicePlaybackRate = playbackRate;
    void dispatchSliceToBridge(encodeWav16(slice), startSec, endSec, epoch, slicePlaybackRate);

    pcmWindow = pcmWindow.slice(HOP_SAMPLES);
    bufferStartPlayhead += (HOP_SAMPLES / CAPTURE_SAMPLE_RATE) * playbackRate;
  }
}

async function startCapture(streamId, tabId, videoId, initial = {}) {
  if (isCapturing) await stopCapture();

  activeTabId = tabId;
  activeVideoId = videoId;
  playbackRate = Number(initial.playbackRate) > 0 ? Number(initial.playbackRate) : 1;
  paused = !!initial.paused;
  resetWindow(initial.playhead);
  isCapturing = true;

  try {
    currentStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    });

    currentAudioCtx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: CAPTURE_SAMPLE_RATE,
    });
    if (currentAudioCtx.state === "suspended") await currentAudioCtx.resume();
    const sourceNode = currentAudioCtx.createMediaStreamSource(currentStream);
    sourceNode.connect(currentAudioCtx.destination);

    if (!currentAudioCtx.audioWorklet || typeof AudioWorkletNode === "undefined") {
      throw new Error("AudioWorklet unavailable");
    }
    await currentAudioCtx.audioWorklet.addModule(
      chrome.runtime.getURL("offscreen/pcm_capture_worklet.js"),
    );
    workletNode = new AudioWorkletNode(currentAudioCtx, "pcm-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { chunkSize: 2048 },
    });
    sourceNode.connect(workletNode);
    const silentOutput = currentAudioCtx.createGain();
    silentOutput.gain.value = 0;
    workletNode.connect(silentOutput);
    silentOutput.connect(currentAudioCtx.destination);
    workletNode.port.onmessage = (event) => {
      if (event.data?.type === "pcm") appendPcm(event.data.samples);
    };
  } catch (err) {
    isCapturing = false;
    const message = String(err?.message || err);
    const failedTabId = activeTabId;
    await stopCapture();
    chrome.runtime.sendMessage({
      type: "ASR_CAPTURE_ERROR",
      tabId: failedTabId,
      error: message,
    }).catch(() => {});
    throw new Error(message);
  }
}

async function dispatchSliceToBridge(blob, startSec, endSec, epoch, playbackRateAtDispatch) {
  const controller = new AbortController();
  inFlight.add(controller);
  const timer = setTimeout(() => controller.abort(), ASR_TIMEOUT_MS);
  try {
    const res = await fetch(BRIDGE_ASR_URL, {
      method: "POST",
      body: blob,
      headers: { "Content-Type": blob.type || "audio/wav" },
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn("[AudioCapture] ASR transcribe returned non-200:", res.status, errText);
      return;
    }
    const data = await res.json();
    if (!data?.text || !isCapturing || epoch !== captureEpoch) return;
    chrome.runtime.sendMessage({
      type: "ASR_CANDIDATE_RECEIVED",
      tabId: activeTabId,
      videoId: activeVideoId,
      startSec,
      endSec,
      playbackRate: playbackRateAtDispatch,
      result: data,
    });
  } catch (err) {
    if (err?.name !== "AbortError") {
      console.warn("[AudioCapture] Bridge ASR dispatch error:", err);
    }
  } finally {
    clearTimeout(timer);
    inFlight.delete(controller);
  }
}

function updatePlayhead(msg) {
  if (!isCapturing) return;
  if (msg.tabId != null && activeTabId != null && Number(msg.tabId) !== activeTabId) return;
  const nextPlayhead = Math.max(0, Number(msg.playhead) || 0);
  const nextRate = Number(msg.playbackRate) > 0 ? Number(msg.playbackRate) : playbackRate;
  const nextPaused = msg.paused != null ? !!msg.paused : paused;
  const reset = msg.event === "pause" || msg.event === "seeking" ||
    msg.event === "seeked" || msg.event === "ratechange" || msg.event === "ended";
  playbackRate = nextRate;
  paused = nextPaused;
  if (reset) {
    resetWindow(nextPlayhead);
  } else if (nextPaused) {
    resetWindow(nextPlayhead);
  } else if (Math.abs(nextPlayhead - (bufferStartPlayhead + (pcmWindow.length / CAPTURE_SAMPLE_RATE) * playbackRate)) > 0.75) {
    resetWindow(nextPlayhead);
  } else {
    // A start/play anchor corrects wall-clock drift without discarding the
    // current usable overlap.
    const consumedSec = (pcmWindow.length / CAPTURE_SAMPLE_RATE) * playbackRate;
    bufferStartPlayhead = Math.max(0, nextPlayhead - consumedSec);
    anchorPlayhead = nextPlayhead;
  }
}

async function stopCapture() {
  isCapturing = false;
  activeTabId = null;
  activeVideoId = null;
  captureEpoch += 1;
  paused = true;
  pcmWindow = new Float32Array(0);
  for (const controller of inFlight) controller.abort();
  inFlight.clear();
  if (workletNode) {
    try { workletNode.disconnect(); } catch (_) {}
    workletNode.port.onmessage = null;
    workletNode = null;
  }
  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
    currentStream = null;
  }
  if (currentAudioCtx) {
    try { await currentAudioCtx.close(); } catch (_) {}
    currentAudioCtx = null;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== "offscreen") return;
  if (msg.type === "START_CAPTURE") {
    startCapture(msg.streamId, msg.tabId, msg.videoId, msg)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }
  if (msg.type === "UPDATE_PLAYHEAD") {
    updatePlayhead(msg);
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === "STOP_CAPTURE") {
    stopCapture()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
});
