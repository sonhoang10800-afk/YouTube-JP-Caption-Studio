#!/usr/bin/env node
/** Live Gemini freshness/cache/revision probe for the fixed MOFA correlation set.
 * The credential is read from a local file path passed by the caller and never
 * printed. Set GEMINI_LIVE_MANIFEST to override the fixture for diagnostics.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Gemini = require("../extension/shared/gemini_translate.js");

const manifestPath = process.env.GEMINI_LIVE_MANIFEST || path.join(__dirname, "../testdata/translation-gold/mofa-2026-01-09.20cue.manifest.json");
const keyPath = process.argv[2];
if (!keyPath) throw new Error("usage: gemini_live_translation_test.js <credential-json>");
const credential = JSON.parse(fs.readFileSync(keyPath, "utf8"));
const apiKey = Array.isArray(credential) ? credential[0]?.apiKey : credential.apiKey;
if (!apiKey) throw new Error("empty credential");
const cues = JSON.parse(fs.readFileSync(manifestPath, "utf8")).cues;
const languages = String(process.env.GEMINI_LIVE_LANGUAGES || "vi,en").split(",").filter(Boolean);
if (!languages.length || languages.some(language => !["vi", "en"].includes(language))) {
  throw new Error("GEMINI_LIVE_LANGUAGES must contain vi and/or en");
}

function makeJobs(language) {
  return cues.map((cue, index) => ({
    id: `${cue.id}-${language}`,
    revision: "fixture-v1",
    source: cue.source,
    context: index ? cues[index - 1].source.slice(-300) : "",
    sourceKey: "mofa-2026-01-09/fixture-v1",
    language,
    priority: 30,
    algorithmVersion: 1,
  }));
}

function summarize(report) {
  return report.results.map(result => ({
    id: result.id,
    revision: result.revision,
    language: result.language,
    status: result.status,
    text: result.text,
    model: result.model,
    cached: !!result.cached,
    httpStatus: result.httpStatus,
    error: result.error,
    attempts: result.request?.attempts,
  }));
}

(async () => {
  const output = { manifest: manifestPath, cues: cues.length, languages: {} };
  for (const language of languages) {
    const jobs = makeJobs(language);
    const fresh = await Gemini.translateGroups(jobs, { apiKey, force: true, priority: 30 });
    if (fresh.failed) {
      console.log(JSON.stringify({ language, failed: fresh.failed, results: summarize(fresh) }, null, 2));
      process.exitCode = 1;
      return;
    }
    assert.equal(fresh.completed, jobs.length, `${language} fresh completion`);
    assert.equal(fresh.failed, 0, `${language} fresh failure count`);
    assert.ok(fresh.results.every(result => result.status === "ready" && result.cached === false));

    const cached = await Gemini.translateGroups(jobs, { apiKey, priority: 30 });
    assert.equal(cached.completed, jobs.length, `${language} cache completion`);
    assert.ok(cached.results.every(result => result.status === "ready" && result.cached === true));
    assert.deepEqual(cached.results.map(result => result.text), fresh.results.map(result => result.text));

    const changed = [{ ...jobs[0], id: `${jobs[0].id}-revision2`, revision: "fixture-v2" }];
    const revision = await Gemini.translateGroups(changed, { apiKey, priority: 30 });
    assert.equal(revision.completed, 1, `${language} revision completion`);
    assert.equal(revision.results[0].status, "ready");
    assert.equal(revision.results[0].cached, false, `${language} revision must bypass stale cache`);
    output.languages[language] = { fresh: summarize(fresh), cached: cached.results.map(result => result.text), revision: summarize(revision) };
  }

  const missingJob = [{ ...makeJobs(languages[0])[0], id: "missing-key", revision: "missing-key" }];
  const previous = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const missing = await Gemini.translateGroups(missingJob, { force: true });
  if (previous !== undefined) process.env.GEMINI_API_KEY = previous;
  assert.equal(missing.results[0].status, "error");
  assert.match(missing.results[0].error, /API key missing/i);
  output.missingKey = { status: missing.results[0].status, error: missing.results[0].error };

  const dummyJob = [{ ...makeJobs(languages[0])[0], id: "dummy-key", revision: "dummy-key" }];
  const dummy = await Gemini.translateGroups(dummyJob, { apiKey: "dummy-not-a-real-key", force: true });
  assert.equal(dummy.results[0].status, "error");
  output.dummyKey = { status: dummy.results[0].status, httpStatus: dummy.results[0].httpStatus, error: dummy.results[0].error };

  const serialized = JSON.stringify(output);
  assert.equal(serialized.includes(apiKey), false, "credential must not appear in output");
  console.log(JSON.stringify(output, null, 2));
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
