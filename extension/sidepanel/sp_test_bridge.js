/*
 * Dev-only side-panel test bridge. Inert in packed builds.
 * Receives whitelisted commands from content/sp_test_bridge.js and returns
 * real side-panel DOM/state. No arbitrary JS, no storage values, no screenshots.
 */
(() => {
  "use strict";

  const TOKEN_KEY = "__spTestBridgeToken";
  const manifest = chrome.runtime?.getManifest?.();
  const isDev = !!manifest && !manifest.update_url;
  if (!isDev || !chrome.storage?.local || !chrome.runtime?.onMessage) return;

  let token = null;

  async function loadToken() {
    try {
      const stored = await chrome.storage.local.get(TOKEN_KEY);
      token = stored?.[TOKEN_KEY] || null;
    } catch {
      token = null;
    }
    return token;
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[TOKEN_KEY]) return;
    token = changes[TOKEN_KEY].newValue || null;
  });
  void loadToken();

  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  };

  const text = (el) =>
    (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 400);

  // sidepanel.js switches tabs via .sp-tab.active + [hidden] on .sp-view;
  // the initial .sp-view.active class is not toggled.
  const activeTabName = () =>
    document.querySelector(".sp-tab.active")?.dataset.tab || null;
  const activeViewId = () =>
    activeTabName() ? `sp-view-${activeTabName()}` : null;

  function fire(selector) {
    const allowed =
      selector === "#sp-btn-settings" ||
      selector === "#sp-settings" ||
      selector === "#sp-follow" ||
      selector === "#sp-btn-close" ||
      selector === ".sp-sentence" ||
      /^\.sp-tab\[data-tab="(subtitles|words|saved)"\]$/.test(selector);
    if (!allowed) throw new Error(`selector_not_allowed:${selector}`);
    const el = document.querySelector(selector);
    if (!el) throw new Error(`selector_not_found:${selector}`);
    el.click();
    return { selector, clicked: true };
  }

  async function snapshot() {
    const activeView = activeViewId();
    const tabs = [...document.querySelectorAll(".sp-tab")].map((el) => ({
      tab: el.dataset.tab || null,
      active: el.classList.contains("active"),
      text: text(el),
      rect: rect(el),
    }));
    const rows = [...document.querySelectorAll("#sp-list .sp-sentence")]
      .slice(0, 40)
      .map((el) => ({
        id: el.dataset.id || null,
        text: text(el).slice(0, 160),
        rect: rect(el),
      }));
    const controls = ["#sp-btn-settings", "#sp-follow", "#sp-btn-close"].map((selector) => {
      const el = document.querySelector(selector);
      return { selector, found: !!el, rect: rect(el), text: text(el) };
    });
    let activeTab = null;
    try {
      const tabsList = await chrome.tabs.query({ active: true, currentWindow: true });
      const t = tabsList?.[0];
      if (t) activeTab = { id: t.id ?? null, title: t.title || "", url: t.url || "" };
    } catch {
      activeTab = null;
    }
    let storageKeys = [];
    try {
      storageKeys = Object.keys((await chrome.storage.local.get(null)) || {})
        .filter((key) => key !== "__spTestBridgeToken")
        .sort();
    } catch {
      storageKeys = [];
    }
    return {
      ok: true,
      title: document.title,
      url: location.href,
      width: window.innerWidth,
      height: window.innerHeight,
      visibility: document.visibilityState,
      activeView,
      tabs,
      rows,
      controls,
      activeTab,
      storageKeys,
    };
  }

  async function handle(msg) {
    switch (msg.cmd) {
      case "ping":
        return {
          ok: true,
          title: document.title,
          url: location.href,
          width: window.innerWidth,
          height: window.innerHeight,
          visibility: document.visibilityState,
        };
      case "snapshot":
        return snapshot();
      case "click":
        return { ok: true, ...fire(msg.selector), activeView: activeViewId() };
      case "close":
        return { ok: true, closing: true };
      default:
        return { ok: false, error: `command_not_allowed:${msg.cmd}` };
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "SP_TEST_CMD") return;
    (async () => {
      const current = token || (await loadToken());
      if (!current || msg.token !== current) {
        sendResponse({ ok: false, error: "bridge_disabled" });
        return;
      }
      try {
        const result = await handle(msg);
        sendResponse(result);
        if (msg.cmd === "close") setTimeout(() => window.close(), 80);
      } catch (error) {
        sendResponse({ ok: false, error: String(error?.message || error) });
      }
    })();
    return true;
  });
})();
