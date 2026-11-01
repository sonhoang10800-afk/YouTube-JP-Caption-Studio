#!/usr/bin/env node
/*
 * Smoke test for the dev-only real-sidepanel bridge.
 *
 * bsk controls a YouTube tab; content/sp_test_bridge.js forwards whitelisted
 * commands to the real Chrome side panel via sidepanel/sp_test_bridge.js.
 * Does not use bsk DOM tools on chrome-extension://, Playwright, or a second
 * browser. Visual capture is external screencapture (not bsk screenshot).
 *
 * Usage:
 *   node scripts/bsk_sidepanel_bridge_smoke.js [--out DIR] [--browser LABEL]
 */
"use strict";

const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BSK = process.env.BSK || "bsk";
const DEFAULT_VIDEO = "https://www.youtube.com/watch?v=66E0wpL6O9Q";
const TEST_URL = `${DEFAULT_VIDEO}&sp_test=1#sp_test=1`;

function arg(name, fallback = "") {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const outDir =
  arg("--out") || path.join(os.tmpdir(), `sidepanel-bridge-${Date.now()}`);
const browserLabel = arg("--browser", "Youtube-Agent");
fs.mkdirSync(outDir, { recursive: true });

let sessionId = null;
let panelOpenedByTest = false;
const result = {
  ok: false,
  surface: "real Chrome side panel via dev-only bridge",
  test_url: TEST_URL,
  browser: null,
  session: null,
  git: {},
  ping: null,
  snapshot: null,
  clicks: {},
  visual: null,
  cleanup: null,
};

function run(args, opts = {}) {
  const r = spawnSync(BSK, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: opts.timeout || 120000,
  });
  if (r.status !== 0 && !opts.allowFail) {
    const detail = [r.stdout, r.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`bsk ${args.join(" ")} failed (${r.status}): ${detail}`);
  }
  return r;
}

function bskJson(args, opts = {}) {
  const r = run([...args, "--json"], opts);
  try {
    return JSON.parse(r.stdout.trim());
  } catch (error) {
    throw new Error(`bsk ${args.join(" ")} returned non-JSON: ${r.stdout.slice(0, 500)}`);
  }
}

function evalPage(expression) {
  const d = bskJson(["evaluate", "--session", sessionId, "--timeout", "30s", expression]);
  if (!d || d.ok !== true) {
    throw new Error(`evaluate failed: ${JSON.stringify(d)}`);
  }
  return d.value;
}

async function pageCmd(cmd, selector, timeoutMs = 8000) {
  const id = `sp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const payload = JSON.stringify({ source: "sp-test", type: "cmd", id, cmd, selector });
  const expression = `(() => new Promise((resolve) => {
    const id = ${JSON.stringify(id)};
    const timer = setTimeout(() => {
      window.removeEventListener("message", on);
      resolve({ok:false,error:"timeout"});
    }, ${timeoutMs});
    function on(e) {
      if (e.source !== window || !e.data || e.data.source !== "sp-test-result" || e.data.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener("message", on);
      resolve(e.data.result);
    }
    window.addEventListener("message", on);
    window.postMessage(${payload}, "*");
  }))()`;
  return evalPage(expression);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function bskClick(selector) {
  return bskJson(["click", "--session", sessionId, "--selector", selector]);
}

function stopSession() {
  if (!sessionId) return null;
  try {
    const stopped = bskJson(["session", "stop", sessionId]);
    const list = bskJson(["session", "list"]);
    const remaining = (Array.isArray(list) ? list : list?.sessions || []).some(
      (s) => (s.session_id || s.id) === sessionId
    );
    return { stopped, remaining };
  } catch (error) {
    return { error: String(error?.message || error) };
  }
}

(async () => {
  try {
    // Preflight.
    let status;
    try {
      status = bskJson(["status"]);
    } catch (error) {
      run(["doctor"], { allowFail: true });
      status = bskJson(["status"]);
    }
    const browsers = bskJson(["browsers"]);
    const list = Array.isArray(browsers) ? browsers : browsers?.browsers || [];
    const browser =
      list.find((b) => (b.label || "").toLowerCase() === browserLabel.toLowerCase()) ||
      list[0];
    if (!browser) throw new Error("no bsk browser connected; run bsk doctor");
    result.browser = {
      instance_id: browser.instance_id,
      label: browser.label,
      browser_version: browser.browser_version,
    };

    result.git.head = execFileSync("git", ["-C", ROOT, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim();
    result.git.status = execFileSync("git", ["-C", ROOT, "status", "--porcelain"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);

    // Start one session and navigate to the explicit test URL.
    const started = bskJson([
      "session",
      "start",
      "--browser",
      browser.instance_id,
      "--focus",
      "--name",
      "sidepanel-bridge-smoke",
    ]);
    sessionId = started.session_id;
    if (!sessionId) throw new Error(`session start returned no session_id: ${JSON.stringify(started)}`);
    result.session = sessionId;

    bskJson(["navigate", "--session", sessionId, TEST_URL]);
    bskJson(["wait-for-navigation", "--session", sessionId, "--wait-until", "load", "--timeout", "30s"]);
    await sleep(3500);

    // Wait for the content bridge + test button.
    let button = false;
    for (let i = 0; i < 30 && !button; i += 1) {
      button = !!evalPage('!!document.getElementById("sp-test-open")');
      if (!button) await sleep(500);
    }
    if (!button) {
      throw new Error(
        "test bridge content script not found. Reload the unpacked extension, then retry; " +
          "verify the page URL still contains sp_test=1."
      );
    }

    // If the real panel is already open, ping works. Otherwise click the test
    // button (trusted click -> OPEN_SIDE_PANEL) and poll for the bridge.
    let ping = await pageCmd("ping").catch((e) => ({ ok: false, error: String(e.message || e) }));
    if (!ping?.ok) {
      bskClick("#sp-test-open");
      panelOpenedByTest = true;
      for (let i = 0; i < 12 && !ping?.ok; i += 1) {
        await sleep(800);
        ping = await pageCmd("ping").catch((e) => ({ ok: false, error: String(e.message || e) }));
      }
    }
    result.ping = ping;
    if (!ping?.ok) {
      throw new Error(
        `sidepanel bridge did not respond: ${JSON.stringify(ping)}. ` +
          "Open the sidepanel manually once, then retry; Chrome may require a user gesture."
      );
    }

    const snap = await pageCmd("snapshot");
    if (!snap?.ok) throw new Error(`snapshot failed: ${JSON.stringify(snap)}`);
    result.snapshot = snap;
    if (!(snap.width > 0 && snap.height > 0)) throw new Error("sidepanel has zero viewport");
    if (!Array.isArray(snap.tabs) || !snap.tabs.some((t) => t.tab === "words")) {
      throw new Error(`sidepanel tabs missing: ${JSON.stringify(snap.tabs)}`);
    }

    // External visual capture only. bsk cannot screenshot the side panel.
    try {
      execFileSync("osascript", ["-e", 'tell application "Google Chrome" to activate'], {
        timeout: 10000,
      });
      await sleep(500);
      const shot = path.join(outDir, "real-sidepanel.png");
      execFileSync("screencapture", ["-x", shot], { timeout: 15000 });
      result.visual = { path: shot, backend: "macOS screencapture (external, not bsk)" };
    } catch (error) {
      result.visual = { error: String(error?.message || error), backend: "screencapture unavailable" };
    }

    // Whitelisted interactions. Verify each tab click before moving on.
    for (const [name, selector, expectedView] of [
      ["words", '.sp-tab[data-tab="words"]', "sp-view-words"],
      ["saved", '.sp-tab[data-tab="saved"]', "sp-view-saved"],
      ["settings", "#sp-btn-settings", null],
      ["follow", "#sp-follow", null],
    ]) {
      const click = await pageCmd("click", selector);
      if (!click?.ok) throw new Error(`${name} click failed: ${JSON.stringify(click)}`);
      await sleep(300);
      const state = await pageCmd("snapshot");
      if (!state?.ok) throw new Error(`${name} snapshot failed: ${JSON.stringify(state)}`);
      if (expectedView && state.activeView !== expectedView) {
        throw new Error(`${name} did not activate ${expectedView}: got ${state.activeView}`);
      }
      result.clicks[name] = { click, activeView: state.activeView };
    }
    const after = await pageCmd("snapshot");
    if (!after?.ok) throw new Error(`post-click snapshot failed: ${JSON.stringify(after)}`);
    result.snapshot_after = after;

    // Close the panel via the bridge; then ping must fail.
    const closed = await pageCmd("close").catch((e) => ({ ok: false, error: String(e.message || e) }));
    result.closed = closed;
    await sleep(1000);
    const postClose = await pageCmd("ping").catch((e) => ({ ok: false, error: String(e.message || e) }));
    if (postClose?.ok) throw new Error("sidepanel still responds after close");
    result.post_close = postClose;
    result.ok = true;

    fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ok: true, out: outDir, summary: result }, null, 2));
  } catch (error) {
    result.error = String(error?.stack || error?.message || error);
    fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(result, null, 2));
    console.error(JSON.stringify({ ok: false, out: outDir, error: result.error }, null, 2));
    process.exitCode = 1;
  } finally {
    result.cleanup = stopSession();
    if (result.cleanup?.remaining) {
      console.error("WARNING: session still listed after stop:", result.cleanup);
      process.exitCode = 1;
    }
    try {
      fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(result, null, 2));
    } catch {}
  }
})();
