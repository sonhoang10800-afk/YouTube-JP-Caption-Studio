/*
 * Dev-only test bridge: page (bsk evaluate) -> content script -> real Chrome side panel.
 *
 * Enabled only when ALL of:
 *   - the extension is an unpacked/dev build (manifest has no update_url)
 *   - the page URL has ?sp_test=1
 *   - a random token is present in chrome.storage.local
 *
 * No production path uses this file; it is inert in packed builds.
 */
(() => {
  "use strict";

  const TOKEN_KEY = "__spTestBridgeToken";
  const isDev = !chrome.runtime?.getManifest?.()?.update_url;
  const wanted =
    new URLSearchParams(location.search).get("sp_test") === "1" ||
    location.hash.includes("sp_test=1");
  if (!isDev || !wanted) return;

  let token = null;

  async function ensureToken() {
    if (token) return token;
    const stored = await chrome.storage.local.get(TOKEN_KEY);
    token = stored?.[TOKEN_KEY] || crypto.randomUUID();
    await chrome.storage.local.set({ [TOKEN_KEY]: token });
    return token;
  }

  function post(id, result) {
    window.postMessage({ source: "sp-test-result", id, result }, "*");
  }

  async function openPanel() {
    try {
      const r = await chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" });
      return r?.ok ? { ok: true } : { ok: false, error: r?.error || "open_failed" };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  }

  function ensureButton() {
    if (document.getElementById("sp-test-open")) return;
    const btn = document.createElement("button");
    btn.id = "sp-test-open";
    btn.type = "button";
    btn.textContent = "SP TEST OPEN";
    btn.style.cssText =
      "position:fixed;left:8px;top:8px;z-index:2147483647;" +
      "background:#9c40bf;color:#fff;border:0;border-radius:4px;" +
      "padding:6px 10px;font:12px/1.2 monospace;cursor:pointer;opacity:.85";
    btn.addEventListener("click", async () => {
      const result = await openPanel();
      post("open", result);
    });
    (document.body || document.documentElement).appendChild(btn);
  }

  async function handle(data) {
    const { id, cmd, selector } = data || {};
    if (!id || !cmd) return;
    try {
      if (cmd === "open") {
        post(id, await openPanel());
        return;
      }
      if (cmd === "disable") {
        await chrome.storage.local.remove(TOKEN_KEY);
        token = null;
        document.getElementById("sp-test-open")?.remove();
        post(id, { ok: true });
        return;
      }
      const t = await ensureToken();
      const result = await chrome.runtime.sendMessage({
        type: "SP_TEST_CMD",
        token: t,
        cmd,
        selector,
      });
      post(id, result || { ok: false, error: "no_response" });
    } catch (error) {
      post(id, { ok: false, error: String(error?.message || error) });
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "sp-test" || data.type !== "cmd") return;
    void handle(data);
  });

  const start = () => {
    ensureButton();
    void ensureToken().catch(() => {});
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  window.addEventListener("pagehide", () => {
    token = null;
    document.getElementById("sp-test-open")?.remove();
    chrome.storage.local.remove(TOKEN_KEY).catch(() => {});
  });
})();
