importScripts("../shared/timedtext_parse.js");
importScripts("../shared/gemini_translate.js");
importScripts("../shared/ass_parser.js");
importScripts("../shared/anime_resolver.js");

const BRIDGE = "http://127.0.0.1:8765";
/** Optional Native Messaging fallback only — primary IME path is bridge POST /ime/switch. */
const IME_NATIVE_HOST = "com.ytcaption.ime_switch";
/** Every bridge/IME call must end — a hung request would block the service worker. */
const IME_FETCH_TIMEOUT_MS = 5000;

const POLL_BRIDGE_ALARM = "poll_bridge_state";
const DRIVE_UPLOAD_ALARM = "drive_upload_retry";
const DRIVE_PENDING_MIRROR_KEY = "drivePendingMirror";

let savedStateWritePending = Promise.resolve();
function withSavedStateWrite(write) {
  const result = savedStateWritePending.then(write);
  savedStateWritePending = result.catch(() => {});
  return result;
}
async function handleSavedCueMutation(msg, sender) {
  const ownPage = String(sender?.url || "").startsWith(chrome.runtime.getURL(""));
  if (sender?.id !== chrome.runtime.id || (!ownPage && !isSupportedUrl(sender.url || sender.tab?.url)) ||
      JSON.stringify(msg).length > 10 * 1024 * 1024) throw new Error("Saved mutation rejected");
  return withSavedStateWrite(async () => {
    if (["save_script", "save_meta", "save_sentence_state"].includes(msg.op)) {
      const { videoId, meta } = msg;
      if (typeof videoId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(videoId) || !meta ||
          !Number.isFinite(meta.rev) || meta.rev < 0 || typeof meta.owned !== "boolean" || !Array.isArray(meta.tombstones)) {
        throw new Error("Invalid script commit");
      }
      const key = `transcriptMeta:${videoId}`;
      const current = (await chrome.storage.local.get(key))[key];
      if (meta.rev < (Number(current?.rev) || 0)) return { ok: true, skipped: "stale_revision" };
      const patch = {};
      if (msg.op === "save_sentence_state") {
        if (typeof msg.sourceKey !== "string" || !msg.sourceKey.startsWith(`youtube:${videoId}:`) ||
            msg.state?.version !== 1 || msg.state.sourceKey !== msg.sourceKey) throw new Error("Invalid sentence state commit");
        patch[`sentenceState:v1:${msg.sourceKey}`] = msg.state;
      } else patch[key] = meta;
      if (msg.op === "save_script") {
        if (!Array.isArray(msg.cues)) throw new Error("Invalid script cues");
        patch[`transcript:${videoId}`] = msg.cues;
      }
      await chrome.storage.local.set(patch);
      return { ok: true };
    }
    const raw = (await chrome.storage.local.get("savedCues")).savedCues;
    let saved = Object.fromEntries((Array.isArray(raw) ? raw : Object.values(raw || {})).filter(c => c?.id).map(c => [c.id, c]));
    if (msg.op === "restore_video") {
      const { videoId, sourceKey, entries, patch } = msg;
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(videoId) || typeof sourceKey !== "string" ||
          !sourceKey.startsWith(`youtube:${videoId}:`) || !Array.isArray(entries) || !patch || typeof patch !== "object") {
        throw new Error("Invalid saved restore");
      }
      const keys = [`transcript:${videoId}`, `transcriptMeta:${videoId}`, `tokens:${videoId}`,
        `sentenceState:v1:${sourceKey}`, `sentenceRecovery:v1:${sourceKey}`];
      if (Object.keys(patch).length !== keys.length || !keys.every(k => Object.hasOwn(patch, k))) throw new Error("Invalid restore keys");
      if (entries.some(c => !c || typeof c.id !== "string" || !c.id || c.videoId !== videoId || typeof c.source !== "string" ||
          (Object.hasOwn(saved, c.id) && saved[c.id].videoId !== videoId))) throw new Error("Invalid or conflicting saved sentence");
      const recovery = patch[`sentenceRecovery:v1:${sourceKey}`];
      if (!recovery || typeof recovery !== "object") throw new Error("Missing restore recovery");
      recovery.savedSentences = Object.values(saved).filter(c => c.videoId === videoId);
      for (const [id, cue] of Object.entries(saved)) if (cue.videoId === videoId) delete saved[id];
      saved = { ...saved, ...Object.fromEntries(entries.map(c => [c.id, c])) };
      await chrome.storage.local.set({ ...patch, savedCues: saved });
    } else {
      const id = msg.id;
      if (typeof id !== "string" || !id || id.length > 200000) throw new Error("Invalid saved ID");
      if (msg.op === "delete" || (msg.op === "toggle" && Object.hasOwn(saved, id))) delete saved[id];
      else if (msg.op === "toggle" && msg.cue?.id === id && typeof msg.cue.source === "string" && typeof msg.cue.videoId === "string") {
        saved = { ...saved, [id]: msg.cue };
      } else throw new Error("Invalid saved operation");
      await chrome.storage.local.set({ savedCues: saved });
    }
    return { ok: true, savedCues: saved };
  });
}

async function ensureBridgePollAlarm() {
  try {
    if (!chrome.alarms?.create) return;
    const existing = await chrome.alarms.get(POLL_BRIDGE_ALARM);
    if (!existing) {
      await chrome.alarms.create(POLL_BRIDGE_ALARM, { periodInMinutes: 1 });
    }
  } catch (_) {}
}

async function ensureDriveUploadAlarm() {
  try {
    if (!chrome.alarms?.create) return;
    const existing = await chrome.alarms.get(DRIVE_UPLOAD_ALARM);
    if (!existing) {
      await chrome.alarms.create(DRIVE_UPLOAD_ALARM, { periodInMinutes: 1 });
    }
  } catch (_) {}
}

async function ensureSidePanelReady() {
  try {
    if (chrome.sidePanel?.setOptions) {
      await chrome.sidePanel.setOptions({
        path: "sidepanel/sidepanel.html",
        enabled: false,
      });
    }
  } catch (_) {}
  try {
    if (chrome.sidePanel?.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
    }
  } catch (_) {}
}

/** Icon click opens dedicated options/saved page in a tab; Sidepanel opened via player toggle. */
chrome.runtime.onInstalled.addListener(async () => {
  await ensureSidePanelReady();
  await ensureBridgePollAlarm();
  await ensureDriveUploadAlarm();
});

chrome.runtime.onStartup?.addListener?.(async () => {
  await ensureSidePanelReady();
  await ensureBridgePollAlarm();
  await ensureDriveUploadAlarm();
});

// Immediate top-level initialization so side panel is ready on SW wake.
void ensureSidePanelReady();

// Extension toolbar icon click: opens side panel on video sites, or Saved Items page on other sites.
if (chrome.action?.onClicked) {
  chrome.action.onClicked.addListener(async (tab) => {
    try {
      if (tab?.id && isSupportedUrl(tab.url)) {
        await chrome.sidePanel.open({ tabId: tab.id });
      } else {
        const url = chrome.runtime.getURL("popup/index.html");
        await chrome.tabs.create({ url });
      }
    } catch (_) {
      try {
        const url = chrome.runtime.getURL("popup/index.html");
        await chrome.tabs.create({ url });
      } catch (_) {}
    }
  });
}

// Keyboard shortcuts (manifest commands)
if (chrome.commands?.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      if (command === "toggle_overlay") {
        chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_OVERLAY" }).catch(() => {});
      } else if (command === "toggle_pip") {
        chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_PIP" }).catch(() => {});
      }
    } catch (_) {}
  });
}

/** Site families the extension supports (content scripts + side panel gate). */
function platformFromUrl(url) {
  try {
    const u = new URL(url || "");
    const h = u.hostname;
    if (h === "www.youtube.com" || h === "youtube.com") return "youtube";
    if (h === "abema.tv" || h.endsWith(".abema.tv")) return "abema";
    if (h === "www.netflix.com" || h === "netflix.com" || h.endsWith(".netflix.com")) return "netflix";
    if (h === "animevietsub.best" || h.includes("animevietsub")) return "animevietsub";
    if (u.protocol === "http:" || u.protocol === "https:") return "web";
    return null;
  } catch (_) {
    return null;
  }
}

function isSupportedUrl(url) {
  const p = platformFromUrl(url);
  return p === "youtube" || p === "abema" || p === "netflix" || p === "animevietsub";
}

async function isPlatformEnabledForUrl(url) {
  const plat = platformFromUrl(url);
  if (!plat) return false;
  try {
    const data = await chrome.storage.local.get("hardsubSettings");
    const ep = data?.hardsubSettings?.enabledPlatforms || {
      youtube: true,
      netflix: true,
      abema: true,
      animevietsub: true,
      web: true,
    };
    return ep[plat] !== false;
  } catch (_) {
    return true;
  }
}

/** Last side-panel state applied per tab — onUpdated fires many times per load. */
const _sidePanelApplied = new Map();

/** Ensure side panel is only enabled for supported video sites. */
async function syncSidePanelForTab(tabId, url) {
  if (tabId == null) return;
  try {
    const supported = isSupportedUrl(url);
    const enabled = supported && (await isPlatformEnabledForUrl(url));
    // Same tab+url+state: a loading/title/favicon event has nothing to change.
    // The storage read above still runs, so a settings change is picked up on the
    // next event; only the per-event setOptions IPC is skipped.
    const applied = `${url}|${enabled}`;
    if (_sidePanelApplied.get(tabId) === applied) return;
    await chrome.sidePanel.setOptions({
      tabId,
      path: "sidepanel/sidepanel.html",
      enabled: !!enabled,
    });
    _sidePanelApplied.set(tabId, applied);
  } catch (_) {}
}

chrome.tabs.onUpdated.addListener(async (tabId, _info, tab) => {
  if (!tab.url) return;
  await syncSidePanelForTab(tabId, tab.url);
});

chrome.tabs.onRemoved?.addListener?.((tabId) => {
  _sidePanelApplied.delete(tabId);
  if (tabId === _audioCaptureTabId) void handleAudioStopCapture().catch(() => {});
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await syncSidePanelForTab(tabId, tab?.url);
  } catch (_) {}
});

/** Set while the offscreen document is closing — a start must wait for it. */
let _offscreenClosing = null;
let _audioCaptureTabId = null;

async function ensureOffscreenDocument() {
  if (!chrome.offscreen?.createDocument) return;
  // A stop closes the document; wait for that close so createDocument cannot
  // race the teardown.
  if (_offscreenClosing) await _offscreenClosing;
  const offscreenUrl = chrome.runtime.getURL("offscreen/audio_capture.html");
  if (chrome.runtime.getContexts) {
    const existing = (await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl],
    })) || [];
    if (existing.length > 0) return;
  }
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen/audio_capture.html",
      reasons: ["USER_MEDIA"],
      justification: "Capture tab audio for local speech recognition",
    });
  } catch (err) {
    const msg = String(err);
    if (!msg.includes("already exists") && !msg.includes("single offscreen document")) {
      throw err;
    }
  }
}

/** Release the offscreen document: it holds the AudioContext and the tab stream. */
async function closeOffscreenDocument() {
  if (!chrome.offscreen?.closeDocument) return;
  const closing = chrome.offscreen.closeDocument().catch(() => {});
  _offscreenClosing = closing;
  await closing;
  if (_offscreenClosing === closing) _offscreenClosing = null;
}

async function handleAudioStartCapture(msg, sender) {
  const tabId = msg.tabId || sender?.tab?.id;
  if (!tabId) throw new Error("No target tab for audio capture");
  await ensureOffscreenDocument();
  if (!chrome.tabCapture?.getMediaStreamId) {
    throw new Error("chrome.tabCapture.getMediaStreamId not available");
  }
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  const res = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "START_CAPTURE",
    streamId,
    tabId,
    videoId: msg.videoId,
    playhead: Number(msg.playhead) || 0,
    playbackRate: Number(msg.playbackRate) > 0 ? Number(msg.playbackRate) : 1,
    paused: !!msg.paused,
  });
  // The offscreen document reports its own failures (getUserMedia denied, …):
  // a silent {ok:true} left the overlay "listening" with no recorder.
  if (!res?.ok) {
    throw new Error(res?.error || "Audio capture failed to start");
  }
  _audioCaptureTabId = tabId;
  return { ok: true };
}

async function handleAudioUpdatePlayhead(msg, sender) {
  const tabId = msg.tabId || sender?.tab?.id;
  if (!Number.isInteger(tabId) || tabId !== _audioCaptureTabId) {
    return { ok: false, error: "not_capturing" };
  }
  const res = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "UPDATE_PLAYHEAD",
    tabId,
    event: String(msg.event || ""),
    playhead: Math.max(0, Number(msg.playhead) || 0),
    playbackRate: Number(msg.playbackRate) > 0 ? Number(msg.playbackRate) : 1,
    paused: !!msg.paused,
  });
  return res?.ok === false ? res : { ok: true };
}

async function handleAudioStopCapture() {
  const captureTabId = _audioCaptureTabId;
  _audioCaptureTabId = null;
  try {
    await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "STOP_CAPTURE",
    });
  } catch (_) {}
  // Only after the stop is acknowledged — otherwise the recorder would keep
  // running inside a document that is about to disappear.
  await closeOffscreenDocument();
  return { ok: true, tabId: captureTabId };
}

/**
 * Commands the side panel may drive in a page. Kept in sync with the
 * `cmd === "…"` branches of handleSidePanelCmd (content/content.js).
 */
const SP_CMD_ALLOWLIST = new Set([
  "ping", "get_state", "set_caption_mode", "toggle_audio_listening",
  "accept_asr_candidate", "revert_asr_candidate", "dismiss_asr_candidate",
  "undo_sentence", "reload", "refresh_script", "add_cue", "delete_cue",
  "edit_ja", "edit_en", "edit_vi", "edit_timeline", "copy", "export",
  "export_json", "export_benchmark", "import_cues", "clear_translations",
  "show_dict", "hide_dict", "schedule_hide_dict", "open_settings",
  "restore_previous_backup", "restore_sentence_backup", "wipe_saved_and_reload",
  "play", "toggle_overlay", "toggle_pip", "toggle_star_cue",
  "set_user_vocab", "trigger_gemini_translate",
]);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "SAVED_CUES_MUTATE") {
    handleSavedCueMutation(msg, sender).then(sendResponse).catch(err => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }
  if (["GEMINI_TRANSLATE_GROUPS", "GEMINI_TRANSLATE_CANCEL", "GEMINI_KEY_CHECK"].includes(msg?.type)) {
    HardsubGeminiTranslate.handleTranslationMessage(msg, sender,
      !!sender.tab && isSupportedUrl(sender.url || sender.tab.url)).then(sendResponse).catch(() =>
      sendResponse({ ok: false, error: "Translation message rejected or worker failed" })
    );
    return true;
  }
  if (msg?.type === "BRIDGE_FETCH") {
    const request = msg.path === "/scripts/save" && msg.method === "POST" ? withSavedStateWrite(async () => {
      const key = `transcriptMeta:${msg.body?.video_id}`;
      const meta = (await chrome.storage.local.get(key))[key];
      if ((Number(msg.body?.rev) || 0) < (Number(meta?.rev) || 0)) return { ok: false, skipped: "stale_revision" };
      return handleBridgeFetch(msg, sender);
    }) : handleBridgeFetch(msg, sender);
    request.then(sendResponse).catch((err) =>
      sendResponse({ ok: false, error: String(err) })
    );
    return true;
  }
  if (msg?.type === "YT_FETCH") {
    handleYtFetch(msg).then(sendResponse).catch((err) =>
      sendResponse({ ok: false, error: String(err) })
    );
    return true;
  }
  if (msg?.type === "YT_LOAD_CAPTIONS") {
    handleYtLoadCaptions(msg).then(sendResponse).catch((err) =>
      sendResponse({ ok: false, reason: "exception", error: String(err), cues: [] })
    );
    return true;
  }
  if (msg?.type === "FETCH_ANIME_SCRIPT") {
    handleFetchAnimeScript(msg).then(sendResponse).catch((err) =>
      sendResponse({ ok: false, error: String(err?.message || err) })
    );
    return true;
  }
  if (msg?.type === "SET_JIMAKU_KEY") {
    const key = String(msg.key || "").trim();
    chrome.storage.local.set({ jimakuApiKey: key }).then(() => sendResponse({ ok: true })).catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg?.type === "IME_SWITCH") {
    handleImeSwitch(msg)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg?.type === "SP_CMD_PROXY") {
    const tabId = msg.tabId;
    const cmd = String(msg.cmd || "");
    // The proxy forwards to a caller-supplied tab id, so the SW — not only the
    // content script — must refuse commands outside the side panel's contract.
    if (!SP_CMD_ALLOWLIST.has(cmd) || !Number.isInteger(tabId) || tabId < 0) {
      sendResponse({ ok: false, error: "sp_cmd_denied" });
      return false;
    }
    chrome.tabs
      .sendMessage(tabId, { type: "SP_CMD", cmd, ...(msg.payload || {}) })
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg?.type === "AUDIO_START_CAPTURE") {
    handleAudioStartCapture(msg, sender)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }
  if (msg?.type === "AUDIO_STOP_CAPTURE") {
    handleAudioStopCapture(msg, sender)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg?.type === "AUDIO_UPDATE_PLAYHEAD") {
    handleAudioUpdatePlayhead(msg, sender)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }
  if (msg?.type === "ASR_CANDIDATE_RECEIVED") {
    if (msg.tabId) {
      chrome.tabs.sendMessage(msg.tabId, msg).catch(() => {});
    }
    return false;
  }
  if (msg?.type === "ASR_CAPTURE_ERROR") {
    // Offscreen capture failed — forward it to the tab that asked for capture.
    if (msg.tabId) {
      chrome.tabs.sendMessage(msg.tabId, msg).catch(() => {});
    }
    return false;
  }
  if (msg?.type === "CONTENT_GET_TAB_ID") {
    sendResponse({ tabId: sender?.tab?.id ?? null });
    return false;
  }
  if (msg?.type === "OPEN_SIDE_PANEL") {
    const tabId = sender?.tab?.id;
    const windowId = sender?.tab?.windowId;
    if (tabId == null && windowId == null) {
      sendResponse({ ok: false, error: "no_tab" });
      return false;
    }
    const openPromise = tabId != null
      ? chrome.sidePanel.open({ tabId })
      : chrome.sidePanel.open({ windowId });
    openPromise
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        if (windowId != null && tabId != null) {
          chrome.sidePanel
            .open({ windowId })
            .then(() => sendResponse({ ok: true }))
            .catch((e2) => sendResponse({ ok: false, error: String(e2) }));
          return;
        }
        sendResponse({ ok: false, error: String(err) });
      });
    return true;
  }
  if (msg?.type === "CLOSE_SIDE_PANEL") {
    const tabId = sender?.tab?.id ?? msg.tabId;
    closeSidePanel(tabId)
      .then((r) => sendResponse(r))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg?.type === "DRIVE_CONNECT") {
    connectDrive()
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }
  if (msg?.type === "DRIVE_PULL") {
    pullDriveIfNewer()
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }
  if (msg?.type === "DRIVE_UPLOAD_SCHEDULE") {
    scheduleDriveUpload(msg.videoId);
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === "DRIVE_MIRROR_DOWN") {
    driveQueued(() => mirrorFromDrive(msg.videoIds, { maxAgeMs: msg.maxAgeMs }))
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }
  if (msg?.type === "DRIVE_UPLOAD_NOW") {
    uploadDriveNow()
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }
  if (msg?.type === "DRIVE_STATUS") {
    getDriveStatus()
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }
  if (msg?.type === "DRIVE_DISCONNECT") {
    disconnectDrive()
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }
  if (msg?.type === "SET_DRIVE_FOLDER_ID") {
    setDriveFolderId(msg.folderId)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }
});

/**
 * Close extension side panel for a tab.
 * Prefer chrome.sidePanel.close (Chrome 141+); fallback: ask panel to window.close().
 */
async function closeSidePanel(tabId) {
  if (tabId == null) return { ok: false, error: "no_tab" };
  if (typeof chrome.sidePanel?.close === "function") {
    try {
      await chrome.sidePanel.close({ tabId });
      return { ok: true, via: "api" };
    } catch (_) {
      /* fall through */
    }
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.windowId != null) {
        await chrome.sidePanel.close({ windowId: tab.windowId });
        return { ok: true, via: "api_window" };
      }
    } catch (_) {
      /* fall through */
    }
  }
  try {
    await chrome.runtime.sendMessage({ type: "SP_CLOSE" });
    return { ok: true, via: "message" };
  } catch (_) {
    return { ok: false, error: "close_failed" };
  }
}

/**
 * Best-effort OS IME: local bridge first (no install.sh), then optional native host.
 * Bridge offline / missing helper → { ok:false } (side panel keeps web lang=ja-JP only).
 * @param {{ cmd?: string }} msg
 */
async function handleImeSwitch(msg) {
  const cmd = String(msg?.cmd || "").trim().toLowerCase();
  if (cmd !== "activate" && cmd !== "deactivate" && cmd !== "status") {
    return { ok: false, error: "bad_cmd" };
  }

  const bridge = await imeViaBridge(cmd);
  if (bridge?.ok) return bridge;

  return imeViaNative(cmd);
}

/** @param {string} cmd */
async function imeViaBridge(cmd) {
  try {
    if (cmd === "status") {
      const res = await fetch(`${BRIDGE}/ime/status`, { signal: AbortSignal.timeout(IME_FETCH_TIMEOUT_MS) });
      if (!res.ok) return { ok: false, error: `http_${res.status}`, missing: true };
      const data = await res.json();
      return data && typeof data === "object" ? data : { ok: false, error: "bad_json" };
    }
    const to = cmd === "activate" ? "ja" : "restore";
    const res = await fetch(`${BRIDGE}/ime/switch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to }),
      signal: AbortSignal.timeout(IME_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, error: `http_${res.status}`, missing: true };
    const data = await res.json();
    return data && typeof data === "object" ? data : { ok: false, error: "bad_json" };
  } catch (_) {
    return { ok: false, error: "bridge_offline", missing: true };
  }
}

/** @param {string} cmd */
async function imeViaNative(cmd) {
  if (typeof chrome.runtime.sendNativeMessage !== "function") {
    return { ok: false, error: "no_native_messaging", missing: true };
  }
  try {
    const res = await chrome.runtime.sendNativeMessage(IME_NATIVE_HOST, { cmd });
    if (res && typeof res === "object") return res;
    return { ok: false, error: "empty_native_response", missing: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), missing: true };
  }
}

/** Mirror chrome.storage → bridge so localhost:3000 Saved Items can poll. */
let _applyingBridgeState = false;
let _pushTimer = null;
let _lastPushedJson = "";
let _lastBridgeUpdatedAt = 0;

async function loadSwState() {
  try {
    const storage = chrome.storage.session || chrome.storage.local;
    const res = await storage.get(["_lastBridgeUpdatedAt", "_lastPushedJson"]);
    if (res._lastBridgeUpdatedAt) _lastBridgeUpdatedAt = Number(res._lastBridgeUpdatedAt) || 0;
    if (res._lastPushedJson) _lastPushedJson = String(res._lastPushedJson) || "";
  } catch (_) {}
}

async function saveSwState() {
  try {
    const storage = chrome.storage.session || chrome.storage.local;
    await storage.set({
      _lastBridgeUpdatedAt,
      _lastPushedJson,
    });
  } catch (_) {}
}

function schedulePushExtensionState() {
  if (_applyingBridgeState) return;
  if (_pushTimer) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => {
    _pushTimer = null;
    void pushExtensionStateToBridge();
  }, 200);
}

async function pushExtensionStateToBridge() {
  if (_applyingBridgeState) return;
  try {
    const data = await chrome.storage.local.get(["userVocab", "hardsubSettings", "savedCues"]);
    const body = {};
    // Never push a missing key over a non-empty bridge — an empty/fresh local
    // store must not wipe the bridge's vocab copy (see pull-first at startup).
    if (data.userVocab && typeof data.userVocab === "object") {
      body.userVocab = data.userVocab;
    }
    if (data.hardsubSettings && typeof data.hardsubSettings === "object") {
      body.hardsubSettings = data.hardsubSettings;
    }
    if (data.savedCues && typeof data.savedCues === "object") {
      body.savedCues = data.savedCues;
    }
    body.source = "extension";
    const j = JSON.stringify(body);
    if (j === _lastPushedJson) return;
    const res = await fetch(`${BRIDGE}/extension_state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(BRIDGE_FETCH_TIMEOUT_MS),
    });
    if (res.ok) {
      _lastPushedJson = j;
      try {
        const out = await res.json();
        if (out?.updatedAt) _lastBridgeUpdatedAt = Number(out.updatedAt) || _lastBridgeUpdatedAt;
      } catch (_) {}
      await saveSwState();
    }
  } catch (_) {
    /* bridge offline */
  }
}

async function pullExtensionStateFromBridge() {
  try {
    const res = await fetch(`${BRIDGE}/extension_state`, { signal: AbortSignal.timeout(BRIDGE_FETCH_TIMEOUT_MS) });
    if (!res.ok) return;
    const remote = await res.json();
    const updatedAt = Number(remote?.updatedAt) || 0;
    if (!updatedAt || updatedAt <= _lastBridgeUpdatedAt) return;
    // Only apply writes that originated outside this extension push loop.
    if (remote.source === "extension" && updatedAt <= _lastBridgeUpdatedAt + 0.05) {
      _lastBridgeUpdatedAt = updatedAt;
      await saveSwState();
      return;
    }
    const patch = {};
    if (remote.userVocab && typeof remote.userVocab === "object") {
      patch.userVocab = remote.userVocab;
    }
    if (remote.hardsubSettings && typeof remote.hardsubSettings === "object") {
      patch.hardsubSettings = remote.hardsubSettings;
    }
    if (remote.savedCues && typeof remote.savedCues === "object") {
      patch.savedCues = remote.savedCues;
    }
    if (!Object.keys(patch).length) {
      _lastBridgeUpdatedAt = updatedAt;
      await saveSwState();
      return;
    }
    const local = await chrome.storage.local.get(["userVocab", "hardsubSettings", "savedCues"]);
    const sameVocab =
      JSON.stringify(local.userVocab || {}) === JSON.stringify(patch.userVocab || local.userVocab || {});
    const sameSettings =
      !patch.hardsubSettings ||
      JSON.stringify(local.hardsubSettings || {}) === JSON.stringify(patch.hardsubSettings);
    const sameSaved =
      !patch.savedCues ||
      JSON.stringify(local.savedCues || {}) === JSON.stringify(patch.savedCues);
    if (sameVocab && sameSettings && sameSaved) {
      _lastBridgeUpdatedAt = updatedAt;
      await saveSwState();
      return;
    }
    _applyingBridgeState = true;
    try {
      await withSavedStateWrite(() => chrome.storage.local.set(patch));
      _lastPushedJson = JSON.stringify({
        ...patch,
        source: "extension",
      });
      _lastBridgeUpdatedAt = updatedAt;
      await saveSwState();
    } finally {
      _applyingBridgeState = false;
    }
  } catch (_) {
    /* bridge offline */
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.userVocab || changes.hardsubSettings) {
    schedulePushExtensionState();
  }
  if (changes.userVocab && !_applyingBridgeState) {
    scheduleVocabDrivePush();
  }
  if (
    !_applyingSettings &&
    (changes.hardsubSettings ||
      changes.followTimeline ||
      changes.isDarkTheme ||
      changes.sidePanelFontScale)
  ) {
    scheduleSettingsDrivePush();
  }
  if (changes.hardsubSettings) {
    chrome.tabs?.query?.({}).then((tabs) => {
      for (const tab of tabs || []) {
        if (tab.id != null && tab.url) {
          void syncSidePanelForTab(tab.id, tab.url);
        }
      }
    }).catch(() => {});
  }
});

// Top-level alarm listener (MV3: must register synchronously so SW wakes on alarm).
if (chrome.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name === POLL_BRIDGE_ALARM) {
      void pullExtensionStateFromBridge();
    } else if (alarm?.name === DRIVE_UPLOAD_ALARM) {
      // Crash-recovery path: SW was killed before the setTimeout fired.
      // Read pending IDs from session storage (in-memory Set was lost).
      const storage = chrome.storage.session || chrome.storage.local;
      storage.get([DRIVE_PENDING_MIRROR_KEY]).then(async (r) => {
        const ids = r[DRIVE_PENDING_MIRROR_KEY] || [];
        if (!ids.length) return;
        try {
          const res = await driveQueued(() => mirrorToDrive(ids));
          // Only a real mirror clears the queue — "not_connected" is not an upload.
          if (res && res.ok && !res.skipped) {
            for (const id of ids) _pendingMirror.delete(id);
            void clearPendingMirror(ids);
          }
        } catch (e) {
          void logDriveFailure("alarm", e);
        }
      }).catch(() => {});
    }
  });
}

void ensureBridgePollAlarm();

void loadSwState().then(() => {
  // Pull before push: if local storage is empty/stale, the bridge copy (or the
  // one the popup/other devices pushed) restores it — a fresh SW must never
  // overwrite non-empty bridge state with an empty local map.
  void pullExtensionStateFromBridge().finally(() => {
    void pushExtensionStateToBridge();
  });
});

// Only endpoints the extension actually calls may go through this proxy — a
// content-script bug must never reach delete/import/IME/backup routes.
const BRIDGE_ALLOWLIST = [
  { re: /^\/health$/, methods: ["GET"] },
  { re: /^\/log$/, methods: ["POST"] },
  { re: /^\/bootstrap$/, methods: ["POST"] },
  { re: /^\/tokenize$/, methods: ["POST"] },
  { re: /^\/tokenize_batch$/, methods: ["POST"] },
  { re: /^\/dict$/, methods: ["POST"] },
  { re: /^\/scripts\/save$/, methods: ["POST"] },
  { re: /^\/scripts\/[A-Za-z0-9_-]{4,64}\/(meta|tokens)$/, methods: ["GET"] },
  { re: /^\/scripts\/[A-Za-z0-9_-]{4,64}$/, methods: ["GET", "DELETE"] },
  // Caption fallback tier; path arrives with its query string attached.
  { re: /^\/captions\/[A-Za-z0-9_-]{4,64}(\?[A-Za-z0-9_=&-]*)?$/, methods: ["GET"] },
];

// DoS guards for BRIDGE_FETCH — per-tab rate limit + body size cap.
const BRIDGE_FETCH_BODY_CAP = 256 * 1024; // 256 KB
const BRIDGE_FETCH_RATE_LIMIT = 50; // max requests per tab per second
const BRIDGE_FETCH_TIMEOUT_MS = 20000; // a hung bridge must not block the SW
const BRIDGE_RATE_BUCKET_MAX = 64; // keep the per-tab map bounded in a long session
const _bridgeRateBuckets = new Map(); // tabId → { count, resetAt }
function _bridgeRateCheck(tabId) {
  const now = Date.now();
  const key = tabId || 0;
  // Evict expired buckets — one entry per tab would leak for the whole session.
  if (_bridgeRateBuckets.size > BRIDGE_RATE_BUCKET_MAX) {
    for (const [id, expired] of _bridgeRateBuckets) {
      if (now > expired.resetAt) _bridgeRateBuckets.delete(id);
    }
  }
  let bucket = _bridgeRateBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + 1000 };
    _bridgeRateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > BRIDGE_FETCH_RATE_LIMIT) {
    console.debug("bridge.fetch rate limited", { tabId: key, count: bucket.count });
    return false;
  }
  return true;
}

async function handleBridgeFetch(msg, sender) {
  const { path, method = "GET", body, isForm } = msg;
  const rule = BRIDGE_ALLOWLIST.find(
    (r) => r.re.test(path) && r.methods.includes(method),
  );
  if (!rule) return { ok: false, error: "bridge_path_denied" };
  // Per-tab rate limit.
  const tabId = sender?.tab?.id || 0;
  if (!_bridgeRateCheck(tabId)) {
    return { ok: false, error: "bridge_rate_limited" };
  }
  const url = `${BRIDGE}${path}`;
  const opts = { method };
  // Every bridge call must end: a hung request would keep the saved-state
  // queue (script writes) blocked until the service worker dies.
  opts.signal = AbortSignal.timeout(BRIDGE_FETCH_TIMEOUT_MS);
  if (isForm && body) {
    const blob = dataUrlToBlob(body.imageBase64);
    const fd = new FormData();
    fd.append("image", blob, "roi.webp");
    fd.append("meta", body.meta);
    opts.body = fd;
  } else if (body) {
    const serialized = JSON.stringify(body);
    if (new TextEncoder().encode(serialized).length > BRIDGE_FETCH_BODY_CAP) {
      return { ok: false, error: "bridge_body_too_large" };
    }
    opts.headers = { "Content-Type": "application/json" };
    opts.body = serialized;
  }
  try {
    const res = await fetch(url, opts);
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    console.debug("bridge.fetch error", { path, error: String(err) });
    return { ok: false, error: "bridge_fetch_error" };
  }
}

async function handleYtFetch(msg) {
  let url = normalizeTimedtextUrl(msg.url || "");
  if (!url.startsWith("https://www.youtube.com/api/timedtext")) {
    return { ok: false, error: "bad_url" };
  }
  const lastError = { reason: "", status: 0 };
  const text = await fetchTimedtextBody(url, lastError);
  // Real HTTP status — a throttled 429 must not read like an empty 200.
  return { ok: !!text, status: text ? 200 : (lastError.status || 0), text: text || "" };
}

function normalizeTimedtextUrl(url) {
  let u = String(url || "").trim();
  if (u.startsWith("//")) u = `https:${u}`;
  return u;
}

function buildTimedtextUrlVariants(baseUrl) {
  const raw = normalizeTimedtextUrl(baseUrl);
  if (!raw) return [];
  const variants = [];
  const add = (u) => {
    if (u && !variants.includes(u)) variants.push(u);
  };
  const isTlang = raw.includes("tlang=");
  const json3 = raw.includes("fmt=json3")
    ? raw
    : raw.includes("fmt=")
      ? raw.replace(/([?&])fmt=[^&]+/, "$1fmt=json3")
      : `${raw}${raw.includes("?") ? "&" : "?"}fmt=json3`;

  if (isTlang) {
    add(json3);
  } else {
    add(raw);
    add(json3);
  }
  return variants;
}

/**
 * Cookie header once per load (not per timedtext URL). Only the cookies that
 * decide login/consent state travel with the request — the whole .youtube.com
 * jar also carries ad/tracking cookies the watch page never needs.
 */
const YT_COOKIE_PREFIXES = ["SAPISID", "__Secure-1PAPISID", "__Secure-3PAPISID", "CONSENT", "VISITOR_INFO"];
function isNeededYtCookie(name) {
  const n = String(name || "");
  return YT_COOKIE_PREFIXES.some((prefix) => n === prefix || n.startsWith(prefix));
}
async function getYtCookieHeader() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: ".youtube.com" });
    const keep = (cookies || []).filter((c) => c && isNeededYtCookie(c.name));
    if (keep.length) {
      return keep.map((c) => `${c.name}=${c.value}`).join("; ");
    }
  } catch (_) {}
  return "";
}

/**
 * Caption load cascade (adapted from YSD side-panel pattern):
 * 1) page-provided timedtext baseUrl (content intercepted / player track)
 * 2) scrape watch HTML → ytInitialPlayerResponse.captionTracks
 * 3) ANDROID Innertube player → captionTracks
 * Prefer fmt=json3; parse XML text/p or json3.
 * Source timeline = ja track only; en and vi packs go to enCues/viCues — never into cues.
 */
/** Negative cache: a just-throttled video returns quickly without long lockouts. */
const TT_MISS_TTL_MS = 5_000;
async function getTtMiss(videoId) {
  try {
    const storage = chrome.storage.session || chrome.storage.local;
    const r = await storage.get([`ttMiss:${videoId}`]);
    const at = Number(r[`ttMiss:${videoId}`]) || 0;
    return at && Date.now() - at < TT_MISS_TTL_MS ? at : 0;
  } catch (_) {
    return 0;
  }
}
/** Keys whose 5s window is over — they can never be hit again, so drop them. */
function staleTtMissKeys(all, now = Date.now(), keep = "") {
  return Object.keys(all || {}).filter(
    (k) => k.startsWith("ttMiss:") && k !== keep && now - Number(all[k] || 0) >= TT_MISS_TTL_MS
  );
}

async function setTtMiss(videoId) {
  try {
    const storage = chrome.storage.session || chrome.storage.local;
    const key = `ttMiss:${videoId}`;
    await storage.set({ [key]: Date.now() });
    // Session storage never expires a key on its own; without this the negative
    // cache grows one entry per throttled video for the life of the session.
    const stale = staleTtMissKeys(await storage.get(null), Date.now(), key);
    if (stale.length) await storage.remove(stale);
  } catch (_) {}
}

async function handleFetchAnimeScript(msg) {
  const { url, domInfo } = msg || {};
  try {
    const keyData = await chrome.storage.local.get("jimakuApiKey");
    const jimakuKey = keyData?.jimakuApiKey || "";
    const resolver = globalThis.HardsubAnimeResolver;
    const parser = globalThis.HardsubAssParser;
    if (!resolver || !parser) {
      return { ok: false, error: "modules_not_loaded", message: "Anime resolver/parser modules not loaded." };
    }
    const meta = resolver.parseAnimeMetadata(url, domInfo);
    const anime = await resolver.resolveAniList(meta);
    if (!anime) {
      return { ok: false, error: "anime_not_found", message: "Không tìm thấy anime trên AniList." };
    }
    if (!jimakuKey) {
      return { ok: false, error: "missing_jimaku_key", message: "Chưa cấu hình Jimaku API Key trong Cài đặt." };
    }
    const entries = await resolver.searchJimaku(anime.id, jimakuKey);
    if (!entries?.length) {
      return { ok: false, error: "no_jimaku_entries", message: "Không tìm thấy script tiếng Nhật trên Jimaku.cc." };
    }
    const files = await resolver.fetchJimakuFiles(entries[0].id, jimakuKey);
    const matchedFile = resolver.findMatchingFileForEpisode(files, meta.episode);
    if (!matchedFile) {
      return { ok: false, error: "no_matching_episode_file", message: `Không tìm thấy file sub cho tập ${meta.episode} trên Jimaku.cc.` };
    }
    const subRes = await fetch(matchedFile.url, {
      headers: { "Authorization": jimakuKey }
    });
    if (!subRes.ok) {
      return { ok: false, error: "sub_download_failed", message: `Tải file sub thất bại (HTTP ${subRes.status}).` };
    }
    const subText = await subRes.text();
    const cues = parser.parseAssOrSrt(subText);
    return {
      ok: true,
      cues,
      animeTitle: anime.title?.romaji || meta.romajiTitle,
      episode: meta.episode,
      fileName: matchedFile.name
    };
  } catch (err) {
    return { ok: false, error: "fetch_script_failed", message: String(err?.message || err) };
  }
}

async function handleYtLoadCaptions(msg) {
  const videoId = String(msg.videoId || "").trim();
  const preferLang = String(msg.lang || "ja").toLowerCase();
  if (!videoId) {
    return { ok: false, reason: "no_video_id", cues: [], hasEn: false, hasVi: false };
  }

  // Explicit user action (Reload button) bypasses the negative cache.
  if (!msg.force && (await getTtMiss(videoId))) {
    return {
      ok: false,
      reason: "throttled_recently",
      lastError: "http_429_cached",
      cues: [],
      trackCount: 0,
      via: "all_failed",
      hasEn: false,
      hasVi: false,
    };
  }

  const cookieHeader = await getYtCookieHeader();

  /** @type {{ url: string, lang: string, asr: boolean, via: string }[]} */
  const candidates = [];
  const seen = new Set();
  const lastError = { reason: "" };

  const pushUrl = (url, lang, asr, via, track = null) => {
    const key = normalizeTimedtextUrl(url);
    if (!key || !key.includes("/api/timedtext")) return;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({
      url: key,
      lang: lang || "",
      asr: !!asr,
      via,
      track,
    });
  };

  if (msg.baseUrl) {
    // URL lang is truth; msg.lang may be preferLang and mis-tag a VI intercept as ja.
    const urlLang = langFromTimedtextUrl(msg.baseUrl) || msg.lang || preferLang;
    pushUrl(msg.baseUrl, urlLang, !!msg.asr, "page_link");
  }

  // Prefer ANDROID timedtext URLs first — WEB watch HTML baseUrls often 200+empty.
  const androidTracks = await fetchAndroidCaptionTracks(videoId).catch(() => []);
  for (const t of sortTracks(androidTracks, preferLang)) {
    pushUrl(t.baseUrl, t.languageCode || "", t.kind === "asr", "android", t);
  }
  const androidHasJa = androidTracks.some((t) => matchLangFamily(t.languageCode, "ja"));
  if (!androidHasJa) {
    const webTracks = await fetchWebCaptionTracks(videoId, cookieHeader).catch(() => []);
    for (const t of sortTracks(webTracks, preferLang)) {
      pushUrl(t.baseUrl, t.languageCode || "", t.kind === "asr", "watch_html", t);
    }
  }
  // Legacy unsigned URLs last resort — still served anonymously even when
  // signed track URLs come back empty.
  for (const [lang, asr] of [["ja", true], ["en", true], ["vi", false]]) {
    pushUrl(
      `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=${lang}&fmt=json3`,
      lang,
      asr,
      "direct",
    );
  }

  const jaCand =
    candidates.find((c) => matchLangFamily(c.lang, "ja") && c.url.includes("/api/timedtext") && c.via !== "direct") ||
    candidates.find((c) => matchLangFamily(c.lang, "ja") && c.url.includes("/api/timedtext"));
  if (jaCand) {
    const rawJaUrl = jaCand.url;
    const json3Url = rawJaUrl.includes("fmt=")
      ? rawJaUrl.replace(/([?&])fmt=[^&]+/, "$1fmt=json3")
      : `${rawJaUrl}${rawJaUrl.includes("?") ? "&" : "?"}fmt=json3`;
    pushUrl(`${json3Url}&tlang=vi`, "vi", jaCand.asr, `${jaCand.via}_tlang`);
    pushUrl(`${json3Url}&tlang=en`, "en", jaCand.asr, `${jaCand.via}_tlang`);
  }

  const hasEn = candidates.some((c) => matchLangFamily(c.lang, "en"));
  const hasVi = candidates.some((c) => matchLangFamily(c.lang, "vi"));

  if (!candidates.length) {
    return { ok: false, reason: "no_tracks", cues: [], via: "none", hasEn, hasVi };
  }

  // Best track per lang family (manual before ASR), fetched in parallel with isolated errors.
  const jaErr = {};
  const enErr = {};
  const viErr = {};
  const [jaPack, enPack, viPack] = await Promise.all([
    fetchBestLangPack(candidates, "ja", jaErr),
    fetchBestLangPack(candidates, "en", enErr),
    fetchBestLangPack(candidates, "vi", viErr),
  ]);

  const secondary = {
    ...(enPack?.cues?.length ? { enCues: enPack.cues } : {}),
    ...(viPack?.cues?.length ? { viCues: viPack.cues } : {}),
  };

  if (jaPack?.cues?.length) {
    return {
      ok: true,
      status: "ok",
      count: jaPack.cues.length,
      cues: jaPack.cues,
      lang: jaPack.lang || "ja",
      asr: jaPack.asr,
      via: jaPack.via,
      sourceTrack: jaPack.sourceTrack,
      hasEn,
      hasVi,
      ...secondary,
    };
  }

  // No JA: keep en/vi in secondary columns only — never put them into source cues.
  if (enPack?.cues?.length || viPack?.cues?.length) {
    return {
      ok: true,
      status: "ok",
      count: 0,
      cues: [],
      lang: "ja",
      asr: false,
      via: "secondary_only",
      hasEn,
      hasVi,
      ...secondary,
    };
  }

  // Throttle miss → remember briefly so Reload/navigate doesn't re-burst.
  if (isThrottleError(jaErr)) await setTtMiss(videoId);
  return {
    ok: false,
    reason: "timedtext_empty",
    lastError: jaErr.reason || enErr.reason || viErr.reason || lastError.reason || "",
    cues: [],
    trackCount: candidates.length,
    via: "all_failed",
    hasEn,
    hasVi,
  };
}

function langFromTimedtextUrl(url) {
  try {
    return new URL(String(url)).searchParams.get("lang") || "";
  } catch {
    return "";
  }
}

async function fetchWebCaptionTracks(videoId, cookieHeader = "") {
  const headers = {
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "ja,en;q=0.9",
  };
  if (cookieHeader) headers.Cookie = cookieHeader;

  const res = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEDTEXT_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return [];
  const html = await res.text();
  const pr = extractYtInitialPlayerResponse(html);
  return pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
}

function extractYtInitialPlayerResponse(html) {
  const marker = "ytInitialPlayerResponse";
  const idx = html.indexOf(marker);
  if (idx < 0) return null;
  const eq = html.indexOf("=", idx);
  if (eq < 0) return null;
  return parseJsonObjectAt(html, eq + 1);
}

function parseJsonObjectAt(text, start) {
  let i = start;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  if (text[i] !== "{") return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = i; j < text.length; j += 1) {
    const c = text[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(i, j + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

async function fetchAndroidCaptionTracks(videoId) {
  const clients = [
    { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 30 },
    { clientName: "ANDROID", clientVersion: "19.44.38", androidSdkVersion: 30 },
    { clientName: "IOS", clientVersion: "19.45.4", deviceModel: "iPhone14,5" },
  ];
  for (const client of clients) {
    try {
      const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: { client: { ...client, hl: "ja", gl: "JP" } },
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
        signal: AbortSignal.timeout(TIMEDTEXT_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      if (tracks.length) return tracks;
    } catch (_) {
      /* try next */
    }
  }
  return [];
}

/** Lang family aliases: normalized base code → 2-letter family. */
const LANG_FAMILY_ALIASES = {
  ja: ["ja", "jpn", "jp"],
  en: ["en", "eng"],
  vi: ["vi", "vie", "viet", "vn"],
};

/**
 * Match a track lang code (vi, vi-VN, vie, VI, vi_vn, en-US…) to a family
 * (ja / en / vi). Normalizes case + separators; falls back to 3-letter aliases.
 */
function matchLangFamily(lang, family) {
  const raw = String(lang || "")
    .toLowerCase()
    .replace(/_/g, "-")
    .trim();
  if (!raw) return false;
  const base = raw.split("-")[0];
  const aliases = LANG_FAMILY_ALIASES[family] || [];
  if (aliases.includes(raw) || aliases.includes(base)) return true;
  // Compound like "vi-vn" or "en-us": base match covers it above; keep the
  // family-prefix fallback for exotic forms like "vietnamese-vi".
  return raw.startsWith(family + "-");
}

function sortTracks(tracks, preferLang) {
  return [...(tracks || [])].sort(
    (a, b) => scoreTrack(b, preferLang) - scoreTrack(a, preferLang)
  );
}

function scoreTrack(track, preferLang) {
  const lang = String(track.languageCode || "").toLowerCase();
  const prefer = String(preferLang || "ja").toLowerCase();
  const asr = track.kind === "asr";
  let s = 0;
  if (prefer === "auto") {
    if (matchLangFamily(lang, "ja")) s += 90;
    else if (matchLangFamily(lang, "en")) s += 40;
  } else if (matchLangFamily(lang, prefer)) {
    s += 100;
  } else if (matchLangFamily(lang, "ja")) {
    s += 70;
  }
  if (!asr) s += 25;
  return s;
}

/**
 * Best timedtext for a lang prefix (ja / en / vi) from candidates.
 * Manual preferred over ASR. Returns { cues, lang, asr, via } or null.
 * (Do not put lang globs like en-star in block comments — breaks the SW parse.)
 */
async function fetchBestLangPack(candidates, prefix, lastError = null) {
  const ranked = (candidates || [])
    .filter((x) => x && matchLangFamily(x.lang, prefix))
    .sort((a, b) => {
      const viaScoreA = a.via === "direct" ? 0 : 50;
      const viaScoreB = b.via === "direct" ? 0 : 50;
      const sa = (matchLangFamily(a.lang, prefix) ? 100 : 0) + (a.asr ? 0 : 25) + viaScoreA;
      const sb = (matchLangFamily(b.lang, prefix) ? 100 : 0) + (b.asr ? 0 : 25) + viaScoreB;
      return sb - sa;
    });
  for (const x of ranked) {
    // Throttled (429/502) is per-IP: further attempts cannot succeed this load.
    if (isThrottleError(lastError)) return null;
    const body = await fetchTimedtextBody(x.url, lastError);
    if (!body) continue;
    const cues = parseTimedtextBody(body);
    if (cues.length) {
      return { cues, lang: x.lang || prefix, asr: !!x.asr, via: x.via || "track",
        sourceTrack: HardsubTimedtextParse.sourceTrackInfo(x.track, body) };
    }
  }
  return null;
}

/** YouTube throttles bursts per-IP — stop fanning out once flagged. */
function isThrottleError(lastError) {
  return !!lastError && /http_(429|502|503)/.test(String(lastError.reason || ""));
}

/**
 * Fetch one timedtext URL. Anonymous first (credentials: omit) — signed baseUrls
 * issued to an anonymous innertube call get rejected (200 + empty) when replayed
 * with the user's Google cookies; cookie session only retried when omit came back
 * empty (member/age-gated tracks). Keeps the per-load request fan-out small so
 * YouTube's per-IP throttle never trips.
 */
const TIMEDTEXT_FETCH_TIMEOUT_MS = 10000;
async function fetchTimedtextBody(baseUrl, lastError = null) {
  if (!baseUrl) return "";
  const urls = buildTimedtextUrlVariants(baseUrl);
  for (const cred of ["omit", "include"]) {
    for (const url of urls) {
      if (!url.startsWith("https://www.youtube.com/api/timedtext")) continue;
      try {
        const headers = {
          Accept: "*/*",
          Referer: "https://www.youtube.com/",
        };
        const res = await fetch(url, { headers, credentials: cred, cache: "no-store",
          signal: AbortSignal.timeout(TIMEDTEXT_FETCH_TIMEOUT_MS) });
        if (lastError) lastError.status = res.status;
        if (!res.ok) {
          if (lastError && res.status >= 400) {
            lastError.reason = `http_${res.status}_${cred}`;
          }
          // 429/502 = per-IP throttle; retrying other variants cannot succeed.
          if (res.status === 429 || res.status === 502 || res.status === 503) return "";
          continue;
        }
        const text = await res.text();
        if (!text) {
          if (lastError) lastError.reason = `empty_${cred}`;
          continue;
        }
        const trimmed = text.trim();
        if (trimmed[0] === "{" || trimmed[0] === "<") return text;
        if (lastError) {
          lastError.reason = `html_like_${trimmed.slice(0, 24).replace(/\s+/g, " ")}_${cred}`;
        }
      } catch (err) {
        if (lastError) {
          lastError.reason = `fetch_err ${String(err).slice(0, 60)}`;
          lastError.status = 0;
        }
      }
    }
  }
  return "";
}

const decodeEntities = (s) => HardsubTimedtextParse.decodeEntities(s);
const parseJson3 = (data) => HardsubTimedtextParse.parseJson3Cues(data, { includeSource: true });
const parseTimedtextXml = (xml) => HardsubTimedtextParse.parseTimedtextXml(xml);
const parseTimedtextBody = (body) => HardsubTimedtextParse.parseTimedtextBody(body, { includeSource: true });

function dataUrlToBlob(dataUrl) {
  const parts = dataUrl.split(",");
  const mime = parts[0].match(/:(.*?);/)[1];
  const bin = atob(parts[1]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// --- Drive sync: vocab in caption-studio-backup.json, scripts as <videoId>/ folders ---
const DRIVE_BACKUP_NAME = "caption-studio-backup.json";

if (globalThis.__JP_CAP_SW_TEST__) {
  globalThis.__JP_CAP_SW_TEST__.sw = { mergeVocabSnapshot, mergeIosVocab, staleTtMissKeys, setTtMiss };
}
const DRIVE_SETTINGS_NAME = "caption-studio-settings.json";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
const MIRROR_FILES = ["cues.json", "meta.json", "script.txt"];
const DRIVE_UPLOAD_DEBOUNCE_MS = 5000;
const DRIVE_SETTINGS_DEBOUNCE_MS = 1500;
const DRIVE_STORAGE_KEYS = [
  "driveFileId",
  "driveLastAppliedUpdatedAt",
  "driveSyncStatus",
  "driveConnected",
  "driveSettingsFileId",
  "settingsLastAppliedUpdatedAt",
  "driveFolderId",
];

let _cachedDriveFolderId = "";
async function getDriveFolderId(interactive = false) {
  if (_cachedDriveFolderId) return _cachedDriveFolderId;
  const stored = await chrome.storage.local.get(["driveFolderId"]);
  if (stored.driveFolderId) {
    _cachedDriveFolderId = stored.driveFolderId;
    return _cachedDriveFolderId;
  }
  const q = encodeURIComponent("name = 'YouTube JP Caption Studio' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
  const listRes = await driveRequest(`/files?q=${q}&fields=files(id,name)&spaces=drive&supportsAllDrives=true`, {}, interactive).catch(() => null);
  if (listRes && listRes.ok) {
    const list = await listRes.json().catch(() => null);
    if (list?.files && list.files.length > 0) {
      _cachedDriveFolderId = list.files[0].id;
      await chrome.storage.local.set({ driveFolderId: _cachedDriveFolderId });
      return _cachedDriveFolderId;
    }
  }
  const createRes = await driveRequest("/files?supportsAllDrives=true", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "YouTube JP Caption Studio",
      mimeType: DRIVE_FOLDER_MIME,
    }),
  }, interactive).catch(() => null);
  if (createRes && createRes.ok) {
    const created = await createRes.json().catch(() => null);
    if (created?.id) {
      _cachedDriveFolderId = created.id;
      await chrome.storage.local.set({ driveFolderId: _cachedDriveFolderId });
      return _cachedDriveFolderId;
    }
  }
  throw new Error("Không thể tìm hoặc tạo thư mục 'YouTube JP Caption Studio' trên Google Drive.");
}

async function setDriveFolderId(folderIdOrUrl) {
  const raw = String(folderIdOrUrl || "").trim();
  let folderId = raw;
  const m = raw.match(/folders\/([A-Za-z0-9_-]{10,})/);
  if (m && m[1]) folderId = m[1];
  if (!folderId) throw new Error("Folder ID không hợp lệ");
  _cachedDriveFolderId = folderId;
  await chrome.storage.local.set({ driveFolderId: folderId });
  return { ok: true, folderId };
}

async function disconnectDrive() {
  try {
    const token = await getAuthToken(false).catch(() => null);
    if (token) {
      try {
        await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${encodeURIComponent(token)}`);
      } catch (_) {}
      await clearAuthToken(token);
    }
    if (chrome.identity?.clearAllCachedAuthTokens) {
      await chrome.identity.clearAllCachedAuthTokens().catch(() => {});
    }
  } catch (_) {}
  _cachedDriveFolderId = "";
  await chrome.storage.local.remove([
    "driveConnected",
    "driveFileId",
    "driveSettingsFileId",
    "driveFolderId",
    "driveSyncStatus",
    "driveLastAppliedUpdatedAt",
    "settingsLastAppliedUpdatedAt",
  ]);
  await setDriveStatus("");
  return { ok: true };
}

let _driveUploadTimer = null;
let _driveBusy = false;
let _settingsUploadTimer = null;
let _vocabUploadTimer = null;
let _applyingSettings = false;

const DEFAULT_LEVEL_COLORS = {
  n5: { on: true, color: "#7fd6a8" },
  n4: { on: true, color: "#8fd3ff" },
  n3: { on: true, color: "#f5d76e" },
  n2: { on: true, color: "#e08a4a" },
  n1: { on: true, color: "#e74c5c" },
  unknown: { on: true, color: "#c5c5d0" },
};

async function setDriveStatus(text) {
  try {
    await chrome.storage.local.set({ driveSyncStatus: String(text || "") });
  } catch (_) {}
  try {
    chrome.runtime.sendMessage({ type: "DRIVE_STATUS_CHANGED", status: String(text || "") }).catch(() => {});
  } catch (_) {}
}

async function getDriveStatus() {
  const data = await chrome.storage.local.get(DRIVE_STORAGE_KEYS);
  return {
    ok: true,
    connected: !!data.driveConnected && !!data.driveFileId,
    fileId: data.driveFileId || "",
    lastApplied: data.driveLastAppliedUpdatedAt || "",
    status: data.driveSyncStatus || (data.driveFileId ? "Connected" : ""),
  };
}

async function getAuthToken(interactive) {
  try {
    const r = await chrome.identity.getAuthToken({ interactive: !!interactive });
    const token = typeof r === "string" ? r : r?.token;
    if (!token) throw new Error("OAuth token missing — set oauth2.client_id in manifest.json");
    return token;
  } catch (err) {
    if (interactive) {
      try {
        if (chrome.identity?.clearAllCachedAuthTokens) {
          await chrome.identity.clearAllCachedAuthTokens();
        }
      } catch (_) {}
    }
    const msg = String(err?.message || err);
    if (/bad client id/i.test(msg)) {
      throw new Error(`Google OAuth Client ID không khớp với Extension ID (${chrome.runtime.id}). Cần cấu hình OAuth Client ID trong GCP Console cho Extension ID này.`);
    }
    throw err;
  }
}

async function clearAuthToken(token) {
  if (!token) return;
  try {
    await chrome.identity.removeCachedAuthToken({ token });
  } catch (_) {}
}

async function driveRequest(path, opts = {}, interactive = false) {
  let token = await getAuthToken(interactive);
  const doFetch = (t) =>
    fetch(path.startsWith("http") ? path : `${DRIVE_API}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${t}`,
        ...(opts.headers || {}),
      },
    });
  let res = await doFetch(token);
  if (res.status === 401) {
    await clearAuthToken(token);
    token = await getAuthToken(true);
    res = await doFetch(token);
  }
  return res;
}

async function ensureDriveFileId(interactive = false) {
  const stored = await chrome.storage.local.get(["driveFileId"]);
  if (stored.driveFileId) return stored.driveFileId;
  const folderId = await getDriveFolderId(interactive);

  const q = encodeURIComponent(
    `'${folderId}' in parents and name='${DRIVE_BACKUP_NAME}' and trashed=false`
  );
  const listRes = await driveRequest(
    `/files?q=${q}&fields=files(id,name)&pageSize=5&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    {},
    interactive
  );
  if (!listRes.ok) {
    const errText = await listRes.text().catch(() => "");
    throw new Error(`Drive list ${listRes.status}: ${errText.slice(0, 160)}`);
  }
  const list = await listRes.json();
  let fileId = list?.files?.[0]?.id || "";
  if (!fileId) {
    const createRes = await driveRequest(
      `/files?supportsAllDrives=true`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: DRIVE_BACKUP_NAME,
          parents: [folderId],
          mimeType: "application/json",
        }),
      },
      interactive
    );
    if (!createRes.ok) {
      const errText = await createRes.text().catch(() => "");
      throw new Error(`Drive create ${createRes.status}: ${errText.slice(0, 160)}`);
    }
    const created = await createRes.json();
    fileId = created?.id || "";
    if (!fileId) throw new Error("Drive create returned no id");
    const empty = {
      version: 1,
      updatedAt: new Date().toISOString(),
      scripts: [],
      vocab: [],
    };
    await uploadDriveSnapshot(fileId, empty, interactive);
    // Mark seed applied so pullDriveIfNewer does not POST empty → wipe local scripts.
    await chrome.storage.local.set({
      driveFileId: fileId,
      driveConnected: true,
      driveLastAppliedUpdatedAt: empty.updatedAt,
    });
    return fileId;
  }
  await chrome.storage.local.set({ driveFileId: fileId, driveConnected: true });
  return fileId;
}

/** The iPad writes this vocab-only file through the Drive REST API (VocabSync); nothing read it. */
const DRIVE_VOCAB_NAME = "caption-studio-vocab.json";

/** Id of `name` in the sync folder, or "" when that file does not exist yet. */
async function driveFileIdByName(name, interactive = false) {
  const folderId = await getDriveFolderId(interactive);
  const q = encodeURIComponent(
    `'${folderId}' in parents and name='${name}' and trashed=false`
  );
  const res = await driveRequest(
    `/files?q=${q}&fields=files(id,name)&pageSize=5&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    {},
    interactive
  );
  if (!res.ok) throw new Error(`Drive list ${res.status}`);
  const list = await res.json();
  const hit = (list?.files || []).find((f) => f.name === name);
  return hit?.id ? String(hit.id) : "";
}

async function downloadDriveSnapshot(fileId, interactive = false) {
  const res = await driveRequest(
    `/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    {},
    interactive
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Drive download ${res.status}: ${errText.slice(0, 160)}`);
  }
  const text = await res.text();
  if (!text || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error("Drive file is not valid JSON");
  }
}

async function uploadDriveSnapshot(fileId, snapshot, interactive = false) {
  const body = JSON.stringify(snapshot);
  const res = await driveRequest(
    `${DRIVE_UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media&supportsAllDrives=true`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
    },
    interactive
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Drive upload ${res.status}: ${errText.slice(0, 160)}`);
  }
}

let _driveQueue = Promise.resolve();
/** videoId → last Drive freshness probe, so navigation does not hit Drive every time. */
const _freshCheckedAt = new Map();
const FRESH_CHECK_MAX = 256; // cap the per-video map — one entry per watched video would leak
/** Record a freshness probe and drop the oldest entries once the map is full. */
function markFreshChecked(videoId, now) {
  _freshCheckedAt.set(videoId, now);
  while (_freshCheckedAt.size > FRESH_CHECK_MAX) {
    const oldest = _freshCheckedAt.keys().next().value;
    if (oldest === undefined) break;
    _freshCheckedAt.delete(oldest);
  }
}

/** Serialize Drive work: two concurrent mirrors must not create the same subfolder twice. */
function driveQueued(fn) {
  const run = _driveQueue.then(fn, fn);
  _driveQueue = run.catch(() => {});
  return run;
}

async function driveConnected() {
  const s = await chrome.storage.local.get(["driveFileId", "driveConnected"]);
  return !!(s.driveConnected || s.driveFileId);
}

/**
 * Read JSON from the local bridge.
 *
 * `strict: true` turns a failed read into an error instead of null: the Drive
 * mirror must not mistake "the bridge said 500" for "there is nothing to
 * mirror", or the video would leave the queue although the mirror never ran.
 */
async function bridgeJson(path, opts = {}) {
  const res = await fetch(`${BRIDGE}${path}`, { signal: AbortSignal.timeout(BRIDGE_FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    if (opts.strict) throw new Error(`bridge GET ${path} -> HTTP ${res.status}`);
    return null;
  }
  try {
    return await res.json();
  } catch (err) {
    if (opts.strict) throw new Error(`bridge GET ${path} -> invalid JSON`);
    return null;
  }
}

async function driveList(q) {
  const res = await driveRequest(
    `/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=200` +
      `&supportsAllDrives=true&includeItemsFromAllDrives=true`
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Drive list ${res.status}: ${errText.slice(0, 160)}`);
  }
  return (await res.json())?.files || [];
}

async function driveChildren(folderId) {
  const files = await driveList(`'${folderId}' in parents and trashed=false`);
  return new Map(files.map((f) => [f.name, f.id]));
}

async function ensureVideoFolder(videoId) {
  const folderId = await getDriveFolderId(false);
  const found = await driveList(
    `'${folderId}' in parents and name='${videoId}' ` +
      `and mimeType='${DRIVE_FOLDER_MIME}' and trashed=false`
  );
  if (found[0]?.id) return found[0].id;
  const res = await driveRequest(`/files?supportsAllDrives=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: videoId,
      parents: [folderId],
      mimeType: DRIVE_FOLDER_MIME,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Drive mkdir ${res.status}: ${errText.slice(0, 160)}`);
  }
  const id = (await res.json())?.id;
  if (!id) throw new Error("Drive mkdir returned no id");
  return id;
}

async function drivePutText(folderId, name, text, fileId) {
  const mime = `${name.endsWith(".json") ? "application/json" : "text/plain"}; charset=UTF-8`;
  if (fileId) {
    const res = await driveRequest(
      `${DRIVE_UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media&supportsAllDrives=true`,
      { method: "PATCH", headers: { "Content-Type": mime }, body: text }
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Drive update ${name} ${res.status}: ${errText.slice(0, 120)}`);
    }
    return fileId;
  }
  const b = "yjcs-mirror-boundary";
  const body =
    `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify({ name, parents: [folderId] })}\r\n` +
    `--${b}\r\nContent-Type: ${mime}\r\n\r\n${text}\r\n--${b}--`;
  const res = await driveRequest(
    `${DRIVE_UPLOAD}/files?uploadType=multipart&supportsAllDrives=true`,
    { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${b}` }, body }
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Drive create ${name} ${res.status}: ${errText.slice(0, 120)}`);
  }
  return (await res.json())?.id || "";
}

async function driveGetText(fileId) {
  const res = await driveRequest(
    `/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Drive download ${res.status}: ${errText.slice(0, 120)}`);
  }
  return res.text();
}

/** Disk → Drive `<videoId>/` (3 files). Skips videos whose rev is already up there. */
async function mirrorToDrive(videoIds) {
  if (!(await driveConnected())) return { ok: true, skipped: "not_connected" };
  const ids = videoIds?.length
    ? videoIds
    : ((await bridgeJson("/scripts", { strict: true })) || []).map((s) => s.video_id);
  const { lastMirroredRev = {} } = await chrome.storage.local.get(["lastMirroredRev"]);
  const mirrored = [];
  for (const id of ids) {
    const meta = await bridgeJson(`/scripts/${encodeURIComponent(id)}/meta`, { strict: true });
    if (!meta) continue;
    if (lastMirroredRev[id] === meta.rev) continue;
    const files = (await bridgeJson(`/scripts/${encodeURIComponent(id)}/files`, { strict: true }))?.files;
    if (!files) continue;
    const folderId = await ensureVideoFolder(id);
    const existing = await driveChildren(folderId);
    for (const name of MIRROR_FILES) {
      if (typeof files[name] !== "string") continue;
      await drivePutText(folderId, name, files[name], existing.get(name));
    }
    lastMirroredRev[id] = meta.rev;
    mirrored.push(id);
  }
  await chrome.storage.local.set({ lastMirroredRev });
  const status = mirrored.length ? `Uploaded ${mirrored.length}` : "Connected";
  await setDriveStatus(status);
  return { ok: true, mirrored, status };
}

/** Drive → disk for every `<videoId>/` whose meta.json rev beats the bridge's. */
async function mirrorFromDrive(videoIds, opts = {}) {
  if (!(await driveConnected())) return { ok: true, skipped: "not_connected" };
  const want = videoIds?.length ? videoIds : null;
  if (want && opts.maxAgeMs) {
    const now = Date.now();
    const fresh = want.filter((id) => now - (_freshCheckedAt.get(id) || 0) < opts.maxAgeMs);
    if (fresh.length === want.length) return { ok: true, skipped: "checked_recently" };
    for (const id of want) markFreshChecked(id, now);
  }
  const folderId = await getDriveFolderId(false);
  const folders = await driveList(
    `'${folderId}' in parents and mimeType='${DRIVE_FOLDER_MIME}' and trashed=false`
  );
  const { lastMirroredRev = {} } = await chrome.storage.local.get(["lastMirroredRev"]);
  const pulled = [];
  for (const folder of folders) {
    if (want && !want.includes(folder.name)) continue;
    const children = await driveChildren(folder.id);
    if (!children.has("meta.json") || !children.has("cues.json")) continue;
    const metaText = await driveGetText(children.get("meta.json"));
    let remoteRev = 0;
    try {
      remoteRev = Number(JSON.parse(metaText)?.rev) || 0;
    } catch (_) {
      continue; // corrupt mirror — leave disk alone
    }
    const local = await bridgeJson(`/scripts/${encodeURIComponent(folder.name)}/meta`);
    if (remoteRev <= (Number(local?.rev) || 0)) continue;
    const files = { "meta.json": metaText };
    for (const name of MIRROR_FILES) {
      if (name === "meta.json" || !children.has(name)) continue;
      files[name] = await driveGetText(children.get(name));
    }
    const res = await fetch(`${BRIDGE}/scripts/${encodeURIComponent(folder.name)}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files }),
      signal: AbortSignal.timeout(BRIDGE_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`bridge POST ${res.status}: ${errText.slice(0, 120)}`);
    }
    // Disk now equals Drive — do not bounce the same bytes straight back up.
    lastMirroredRev[folder.name] = remoteRev;
    pulled.push(folder.name);
  }
  if (pulled.length) {
    await chrome.storage.local.set({ lastMirroredRev });
    await notifyDriveRestored(pulled);
  }
  return { ok: true, pulled };
}

/** Content scripts need tabs.sendMessage (runtime broadcast won't reach them). */
async function notifyDriveRestored(videoIds) {
  try {
    const tabs = await chrome.tabs.query({
      url: [
        "https://www.youtube.com/*",
        "https://youtube.com/*",
        "https://abema.tv/*",
        "https://*.abema.tv/*",
        "https://www.netflix.com/*",
        "https://netflix.com/*",
      ],
    });
    for (const tab of tabs || []) {
      if (tab?.id == null) continue;
      chrome.tabs.sendMessage(tab.id, { type: "DRIVE_RESTORED", videoIds }).catch(() => {});
    }
  } catch (_) {}
}

function updatedAtMs(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? t : 0;
}

// --- caption-studio-settings.json (LWW; no geometry) ---

async function ensureSettingsFileId(interactive = false, createIfMissing = true) {
  const stored = await chrome.storage.local.get(["driveSettingsFileId"]);
  if (stored.driveSettingsFileId) return stored.driveSettingsFileId;
  const folderId = await getDriveFolderId(interactive);

  const q = encodeURIComponent(
    `'${folderId}' in parents and name='${DRIVE_SETTINGS_NAME}' and trashed=false`
  );
  const listRes = await driveRequest(
    `/files?q=${q}&fields=files(id,name)&pageSize=5&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    {},
    interactive
  );
  if (!listRes.ok) {
    const errText = await listRes.text().catch(() => "");
    throw new Error(`Drive settings list ${listRes.status}: ${errText.slice(0, 160)}`);
  }
  const list = await listRes.json();
  let fileId = list?.files?.[0]?.id || "";
  if (!fileId) {
    if (!createIfMissing) return "";
    const createRes = await driveRequest(
      `/files?supportsAllDrives=true`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: DRIVE_SETTINGS_NAME,
          parents: [folderId],
          mimeType: "application/json",
        }),
      },
      interactive
    );
    if (!createRes.ok) {
      const errText = await createRes.text().catch(() => "");
      throw new Error(`Drive settings create ${createRes.status}: ${errText.slice(0, 160)}`);
    }
    fileId = (await createRes.json())?.id || "";
    if (!fileId) throw new Error("Drive settings create returned no id");
  }
  await chrome.storage.local.set({ driveSettingsFileId: fileId });
  return fileId;
}

async function buildLocalSettingsSnapshot() {
  const data = await chrome.storage.local.get([
    "hardsubSettings",
    "followTimeline",
    "isDarkTheme",
    "sidePanelFontScale",
  ]);
  const s = data.hardsubSettings && typeof data.hardsubSettings === "object" ? data.hardsubSettings : {};
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    showFurigana: s.showFurigana !== false,
    barShowJa: s.barShowJa !== false,
    barShowEn: s.barShowEn !== false,
    barShowVi: s.barShowVi !== false,
    barScale: Number(s.barScale) || 1,
    barBgOpacity: s.barBgOpacity != null ? Number(s.barBgOpacity) : 0.4,
    barTextOpacity: s.barTextOpacity != null ? Number(s.barTextOpacity) : 1,
    dimHardsub: !!s.dimHardsub,
    dictShowSentence: s.dictShowSentence !== false,
    levelHighlightEnabled: s.levelHighlightEnabled !== false,
    levelColors: s.levelColors && typeof s.levelColors === "object" ? s.levelColors : DEFAULT_LEVEL_COLORS,
    followTimeline: data.followTimeline !== false,
    isDarkTheme: data.isDarkTheme !== false,
    sidePanelFontScale: data.sidePanelFontScale != null ? Number(data.sidePanelFontScale) : 1,
  };
}

async function applySettingsSnapshot(remote) {
  if (!remote || typeof remote !== "object") return;
  _applyingSettings = true;
  try {
    const data = await chrome.storage.local.get(["hardsubSettings"]);
    const prev = data.hardsubSettings && typeof data.hardsubSettings === "object" ? data.hardsubSettings : {};
    const next = { ...prev };
    if (remote.showFurigana != null) next.showFurigana = !!remote.showFurigana;
    if (remote.barShowJa != null) next.barShowJa = !!remote.barShowJa;
    if (remote.barShowEn != null) next.barShowEn = !!remote.barShowEn;
    if (remote.barShowVi != null) next.barShowVi = !!remote.barShowVi;
    if (remote.barScale != null) next.barScale = Number(remote.barScale) || 1;
    if (remote.barBgOpacity != null) next.barBgOpacity = Number(remote.barBgOpacity);
    if (remote.barTextOpacity != null) next.barTextOpacity = Number(remote.barTextOpacity);
    if (remote.dimHardsub != null) next.dimHardsub = !!remote.dimHardsub;
    if (remote.dictShowSentence != null) next.dictShowSentence = !!remote.dictShowSentence;
    if (remote.levelHighlightEnabled != null) next.levelHighlightEnabled = !!remote.levelHighlightEnabled;
    if (remote.levelColors && typeof remote.levelColors === "object") next.levelColors = remote.levelColors;
    const patch = { hardsubSettings: next };
    if (remote.followTimeline != null) patch.followTimeline = !!remote.followTimeline;
    if (remote.isDarkTheme != null) patch.isDarkTheme = !!remote.isDarkTheme;
    if (remote.sidePanelFontScale != null) patch.sidePanelFontScale = Number(remote.sidePanelFontScale) || 1;
    if (remote.updatedAt) patch.settingsLastAppliedUpdatedAt = String(remote.updatedAt);
    await chrome.storage.local.set(patch);
  } finally {
    _applyingSettings = false;
  }
}

async function pushSettingsSnapshot() {
  if (!(await driveConnected())) return { skipped: "not_connected" };
  const fileId = await ensureSettingsFileId(false, true);
  const snap = await buildLocalSettingsSnapshot();
  await uploadDriveSnapshot(fileId, snap, false);
  await chrome.storage.local.set({ settingsLastAppliedUpdatedAt: snap.updatedAt });
  return { ok: true, updatedAt: snap.updatedAt };
}

/** Connect / pull path: pull if remote newer, else push (creates file from local if missing). */
async function syncSettingsOnConnect() {
  if (!(await driveConnected())) return { skipped: "not_connected" };
  const stored = await chrome.storage.local.get(["settingsLastAppliedUpdatedAt"]);
  const fileId = await ensureSettingsFileId(false, true);
  const remote = await downloadDriveSnapshot(fileId, false);
  const remoteAt = updatedAtMs(remote?.updatedAt);
  const localAt = updatedAtMs(stored.settingsLastAppliedUpdatedAt);
  if (remote && remoteAt > localAt) {
    await applySettingsSnapshot(remote);
    return { action: "pulled", updatedAt: remote.updatedAt || "" };
  }
  const pushed = await pushSettingsSnapshot();
  return { action: "pushed", updatedAt: pushed.updatedAt || "" };
}

function scheduleSettingsDrivePush() {
  if (_applyingSettings) return;
  if (_settingsUploadTimer) clearTimeout(_settingsUploadTimer);
  _settingsUploadTimer = setTimeout(() => {
    _settingsUploadTimer = null;
    void pushSettingsSnapshot().catch(() => {});
  }, DRIVE_SETTINGS_DEBOUNCE_MS);
}

/** userVocab → bridge then Drive backup.json (vocab-only). */
function scheduleVocabDrivePush() {
  if (_applyingBridgeState) return;
  if (_vocabUploadTimer) clearTimeout(_vocabUploadTimer);
  _vocabUploadTimer = setTimeout(() => {
    _vocabUploadTimer = null;
    void (async () => {
      await pushExtensionStateToBridge();
      await uploadDriveFromBridge();
    })().catch(() => {});
  }, DRIVE_SETTINGS_DEBOUNCE_MS);
}

/** @param {{ pull?: boolean }} [opts] pull=false when about to upload local as source of truth */
async function connectDrive(opts = {}) {
  try {
    await getAuthToken(true);
    const fileId = await ensureDriveFileId(true);
    await chrome.storage.local.set({ driveConnected: true, driveFileId: fileId });
    await setDriveStatus("Connected");
    // Pull once after connect so PC picks up iPad writes (skip when caller will upload).
    if (opts.pull !== false) {
      await pullDriveIfNewer();
    } else {
      await syncSettingsOnConnect();
    }
    return { ok: true, fileId, status: "Connected" };
  } catch (err) {
    const msg = String(err?.message || err);
    await setDriveStatus(`error: ${msg.slice(0, 80)}`);
    return { ok: false, error: msg };
  }
}

/** Vocab only — scripts travel as `<videoId>/` folders, not through the snapshot. */
async function pullVocabSnapshot() {
  const stored = await chrome.storage.local.get(["driveLastAppliedUpdatedAt"]);
  const fileId = await ensureDriveFileId(false);
  const snap = await downloadDriveSnapshot(fileId, false);
  if (!snap || typeof snap !== "object") return { skipped: "empty" };
  const remoteAt = updatedAtMs(snap.updatedAt);
  if (!remoteAt || remoteAt <= updatedAtMs(stored.driveLastAppliedUpdatedAt)) {
    return { skipped: "up_to_date", updatedAt: snap.updatedAt || "" };
  }
  const res = await fetch(`${BRIDGE}/backup/snapshot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snap),
    signal: AbortSignal.timeout(BRIDGE_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`bridge POST ${res.status}: ${errText.slice(0, 120)}`);
  }
  const applied = String(snap.updatedAt || "");
  await chrome.storage.local.set({ driveLastAppliedUpdatedAt: applied });
  return { updatedAt: applied };
}

/**
 * Additive merge of iPad vocab into the local word→status map. The iOS payload carries no
 * status, so an existing local word keeps its status and an unknown word starts at
 * `learning` — nothing is overwritten or deleted.
 * ponytail: additive-only, no per-word LWW; per-word merge needs an updatedAt per entry.
 */
function mergeIosVocab(localVocab, entries) {
  const merged = { ...(localVocab || {}) };
  let added = 0;
  for (const e of Array.isArray(entries) ? entries : []) {
    const word = String(e?.word || "").trim();
    if (!word || merged[word]) continue;
    merged[word] = "learning";
    added++;
  }
  return { merged, added };
}

/** Pull `caption-studio-vocab.json` from Drive and merge its words into `userVocab`. */
async function pullIosVocabSnapshot() {
  const fileId = await driveFileIdByName(DRIVE_VOCAB_NAME, false);
  if (!fileId) return { skipped: "absent" };
  const snap = await downloadDriveSnapshot(fileId, false);
  if (!snap || typeof snap !== "object") return { skipped: "empty" };
  const { userVocab } = await chrome.storage.local.get(["userVocab"]);
  const { merged, added } = mergeIosVocab(userVocab, snap.vocab);
  if (!added) return { skipped: "up_to_date", added: 0 };
  // Storage write; the existing onChanged hook pushes the merged map to the bridge.
  await chrome.storage.local.set({ userVocab: merged });
  return { added, updatedAt: String(snap.updatedAt || "") };
}

async function pullDriveIfNewer() {
  if (_driveBusy) return { ok: true, skipped: "busy" };
  _driveBusy = true;
  try {
    if (!(await driveConnected())) return { ok: true, skipped: "not_connected" };
    const vocab = await pullVocabSnapshot();
    // Absent/extra file must never fail the whole sync — catch a throw, not just a rejection.
    let iosVocab = { skipped: "error" };
    try {
      iosVocab = await pullIosVocabSnapshot();
    } catch (err) {
      iosVocab = { skipped: "error" };
    }
    const settings = await syncSettingsOnConnect();
    const mirror = await driveQueued(() => mirrorFromDrive());
    const restored = !!mirror.pulled?.length;
    await setDriveStatus(restored ? "Restored" : "Connected");
    return {
      ok: true,
      restored,
      pulled: mirror.pulled || [],
      updatedAt: vocab.updatedAt || "",
      iosVocabAdded: iosVocab.added || 0,
      settings: settings?.action || "",
    };
  } catch (err) {
    const msg = String(err?.message || err);
    await setDriveStatus(`error: ${msg.slice(0, 80)}`);
    return { ok: false, error: msg };
  } finally {
    _driveBusy = false;
  }
}

/** Mirror failures are silent otherwise: AGENTS §6 wants them in the bridge log too. */
async function logDriveFailure(context, err) {
  const msg = `Drive mirror failed (${context}): ${String(err?.message || err).slice(0, 300)}`;
  console.warn(`[drive] ${msg}`);
  try {
    await fetch(`${BRIDGE}/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level: "WARNING", message: msg }),
      signal: AbortSignal.timeout(BRIDGE_FETCH_TIMEOUT_MS),
    });
  } catch (_) {}
}

/** videoIds seen since the last flush — one save burst must not mirror the whole library. */
const _pendingMirror = new Set();
/** Serializes pending-list writes so a read-modify-write cannot interleave. */
let _pendingMirrorWrite = Promise.resolve();

/** Union of the persisted and the in-memory pending IDs (order preserved). */
function mergePendingIds(stored, incoming) {
  const out = [];
  const seen = new Set();
  for (const id of [...(Array.isArray(stored) ? stored : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    const key = String(id);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** Pending IDs minus the ones whose mirror succeeded. */
function removePendingIds(ids, done) {
  const drop = new Set((Array.isArray(done) ? done : []).map(String));
  return (Array.isArray(ids) ? ids : []).map(String).filter((id) => !drop.has(id));
}

function pendingMirrorStorage() {
  return chrome.storage.session || chrome.storage.local;
}

/**
 * Persist pending IDs. The stored list is the source of truth across an SW
 * idle-kill: it is unioned with the in-memory set, so a restart (empty Set)
 * can never overwrite IDs that are still queued.
 */
function persistPendingMirror() {
  const storage = pendingMirrorStorage();
  _pendingMirrorWrite = _pendingMirrorWrite
    .then(async () => {
      try {
        const raw = (await storage.get([DRIVE_PENDING_MIRROR_KEY]))[DRIVE_PENDING_MIRROR_KEY];
        await storage.set({
          [DRIVE_PENDING_MIRROR_KEY]: mergePendingIds(raw, Array.from(_pendingMirror)),
        });
      } catch (_) {}
    })
    .catch(() => {});
  return _pendingMirrorWrite;
}

/** Drop only the IDs whose mirror really ran — queued work survives every failure. */
function clearPendingMirror(ids) {
  const storage = pendingMirrorStorage();
  _pendingMirrorWrite = _pendingMirrorWrite
    .then(async () => {
      try {
        const raw = (await storage.get([DRIVE_PENDING_MIRROR_KEY]))[DRIVE_PENDING_MIRROR_KEY];
        const rest = removePendingIds(raw, ids);
        if (rest.length) {
          await storage.set({ [DRIVE_PENDING_MIRROR_KEY]: rest });
        } else {
          await storage.remove([DRIVE_PENDING_MIRROR_KEY]);
        }
      } catch (_) {}
    })
    .catch(() => {});
  return _pendingMirrorWrite;
}

/** Restore IDs queued before an SW idle-kill (the in-memory Set starts empty). */
async function restorePendingMirror() {
  try {
    const raw = (await pendingMirrorStorage().get([DRIVE_PENDING_MIRROR_KEY]))[DRIVE_PENDING_MIRROR_KEY];
    for (const id of Array.isArray(raw) ? raw : []) {
      if (id) _pendingMirror.add(String(id));
    }
  } catch (_) {}
}
void restorePendingMirror();

function scheduleDriveUpload(videoId) {
  if (videoId) _pendingMirror.add(String(videoId));
  if (_driveUploadTimer) clearTimeout(_driveUploadTimer);
  // Persist pending IDs for crash-recovery alarm (MV3 may kill SW between timer and fire).
  void persistPendingMirror();
  // Alarm is the crash-recovery path; timer preserves the existing 5s UI debounce.
  // Periodic, so a mirror that failed (Drive offline) is retried until it lands.
  void chrome.alarms?.create?.(DRIVE_UPLOAD_ALARM, { delayInMinutes: 1, periodInMinutes: 1 }).catch?.(() => {});
  _driveUploadTimer = setTimeout(async () => {
    _driveUploadTimer = null;
    const ids = Array.from(_pendingMirror);
    if (!ids.length) return;
    try {
      const res = await driveQueued(() => mirrorToDrive(ids));
      // Only a real mirror clears the queue — "not_connected" is not an upload.
      if (res && res.ok && !res.skipped) {
        for (const id of ids) _pendingMirror.delete(id);
        void clearPendingMirror(ids);
      }
    } catch (e) {
      void logDriveFailure("debounce", e);
    }
  }, DRIVE_UPLOAD_DEBOUNCE_MS);
}

/** Immediate full mirror (sidepanel button). Connect first if needed; cancels pending debounce. */
async function uploadDriveNow() {
  if (_driveUploadTimer) {
    clearTimeout(_driveUploadTimer);
    _driveUploadTimer = null;
  }
  // IDs queued before this full mirror — the mirror covers exactly these.
  const covered = Array.from(_pendingMirror);
  if (!(await driveConnected())) {
    // No pull before push — pull of empty/stale Drive would wipe local then upload the wipe.
    const c = await connectDrive({ pull: false });
    if (!c?.ok) return c;
  }
  await setDriveStatus("Uploading…");
  try {
    await uploadDriveFromBridge();
  } catch (e) {
    void logDriveFailure("snapshot", e);
  }
  const res = await driveQueued(() => mirrorToDrive());
  // Only a real mirror clears the queue — "not_connected" is not an upload.
  // IDs queued during the mirror stay pending (the mirror may predate them).
  if (res && res.ok && !res.skipped) {
    for (const id of covered) _pendingMirror.delete(id);
    void clearPendingMirror(covered);
  }
  return res;
}

/**
 * Vocab merge for the Drive upload.
 *
 * The bridge knows only {word -> status}. Uploading its snapshot verbatim used to
 * wipe the iPad's gloss/reading/JLPT/frequency (the bridge has no such fields) and
 * drop every word that exists only on the iPad. Keep what the incoming entry does
 * not own, and keep iPad-only words.
 */
function mergeVocabSnapshot(remoteVocab, incomingVocab) {
  const remote = Array.isArray(remoteVocab) ? remoteVocab : [];
  const incoming = Array.isArray(incomingVocab) ? incomingVocab : [];
  const byWord = new Map();
  for (const v of remote) {
    if (v && typeof v === "object" && v.word) byWord.set(String(v.word), v);
  }
  const out = [];
  const seen = new Set();
  for (const inc of incoming) {
    if (!inc || typeof inc !== "object" || !inc.word) continue;
    const word = String(inc.word);
    const prev = byWord.get(word) || {};
    seen.add(word);
    out.push({
      ...prev,
      ...inc,
      reading: inc.reading || prev.reading || "",
      meaning: inc.meaning || prev.meaning || "",
      jlptLevel: inc.jlptLevel ?? prev.jlptLevel ?? null,
      frequencyCount: inc.frequencyCount || prev.frequencyCount || 0,
      status: inc.status || prev.status || "",
    });
  }
  for (const [word, prev] of byWord) {
    if (!seen.has(word)) out.push(prev);
  }
  return out;
}

async function uploadDriveFromBridge() {
  if (_driveBusy) {
    setTimeout(() => void uploadDriveFromBridge(), 800);
    return { ok: true, deferred: true };
  }
  if (!(await driveConnected())) return { ok: true, skipped: "not_connected" };
  _driveBusy = true;
  try {
    const fileId = await ensureDriveFileId(false);
    let res = null;
    try {
      res = await fetch(`${BRIDGE}/backup/snapshot`, { signal: AbortSignal.timeout(BRIDGE_FETCH_TIMEOUT_MS) });
    } catch (_) {
      return { ok: true, skipped: "bridge_offline" };
    }
    if (!res.ok) {
      return { ok: true, skipped: `bridge_${res.status}` };
    }
    const snap = await res.json();
    if (!snap || typeof snap !== "object") throw new Error("bridge snapshot invalid");
    // Merge with what Drive already holds: the bridge knows statuses only, and a
    // blind replace wiped the iPad's glosses and iPad-only words. Refuse to upload
    // when the remote copy cannot be read — an unmergeable write loses data.
    let remote = null;
    try {
      remote = await downloadDriveSnapshot(fileId, false);
    } catch (_) {
      return { ok: true, skipped: "remote_unreadable" };
    }
    if (remote && typeof remote === "object") {
      snap.vocab = mergeVocabSnapshot(remote.vocab, snap.vocab);
      // Scripts travel as folders; a bridge snapshot carries an empty array and
      // must not blank the iPad's script list.
      if (Array.isArray(remote.scripts) && !(Array.isArray(snap.scripts) && snap.scripts.length)) {
        snap.scripts = remote.scripts;
      }
    }
    // Stamp write time if bridge omitted updatedAt.
    if (!snap.updatedAt) snap.updatedAt = new Date().toISOString();
    await uploadDriveSnapshot(fileId, snap, false);
    const applied = String(snap.updatedAt || "");
    await chrome.storage.local.set({ driveLastAppliedUpdatedAt: applied });
    await setDriveStatus("Uploaded");
    return { ok: true, uploaded: true, updatedAt: applied };
  } catch (err) {
    const msg = String(err?.message || err);
    await setDriveStatus(`error: ${msg.slice(0, 80)}`);
    return { ok: false, error: msg };
  } finally {
    _driveBusy = false;
  }
}
