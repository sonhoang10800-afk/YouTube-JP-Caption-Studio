/** Production content helpers + real localhost HTTP. No installed-extension/DOM claim. */
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), http = require('node:http');
const source = fs.readFileSync(require.resolve('../extension/content/content.js'), 'utf8');
const projection = source.slice(source.indexOf('  let sortedCuesCache ='), source.indexOf('  /**\n   * Token enrich via /tokenize_batch'));
const scheduler = source.slice(source.indexOf('  let sentencePublishTimer ='), source.indexOf('  function compactSource'));
const langFns = source.slice(source.indexOf('  function detectCuesLanguage'), source.indexOf('  function stampSecondaryStatus'));
const workerSource = fs.readFileSync(require.resolve('../extension/background/service_worker.js'), 'utf8');
const workerFunctions = workerSource.slice(workerSource.indexOf('let savedStateWritePending'), workerSource.indexOf('async function ensureBridgePollAlarm'));
const actualFetch = global.fetch;
let mode = 'valid', requests = 0, arrived, release;
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', b => body += b); req.on('end', async () => {
    requests++;
    const jobs = JSON.parse(JSON.parse(body).contents[0].parts[0].text);
    const held=mode!=='hold-last'||jobs.some(j=>j.source==='遅い。');
    if(held) arrived?.();
    if (release && held) await new Promise(resolve => { release.resolve = resolve; });
    if (mode === 'error') { res.writeHead(503); res.end('fixture unavailable'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      translations: jobs.map(j => ({ id: j.id, revision: j.revision, text: `${j.targetLanguage}: ${j.source}` })),
    }) }] } }] }));
  });
});
function createContent(videoId) {
  const ctx = vm.createContext({ console, structuredClone, setTimeout, clearTimeout, performance, HardsubSentenceGroups: require('../extension/shared/sentence_groups.js'),
    testTrace: require('../extension/shared/sentence_benchmark.js').createTrace({traceId:videoId}),
    HardsubGeminiTranslate: { getStoredApiKey: async () => 'test-only',
      translateGroups: (...args) => require('../extension/shared/gemini_translate.js').translateGroups(...args),
      translateCues: (...args) => require('../extension/shared/gemini_translate.js').translateCues(...args) } });
  vm.runInContext(`
let cues=[{id:'a',source:'晴れ。',start_media_time:0,end_media_time:1},
 {id:'b',source:'どこ?',start_media_time:1,end_media_time:3},
 {id:'c',source:'川。',start_media_time:3,end_media_time:4}];
let currentSource='youtube',currentVideoId=${JSON.stringify(videoId)},captionMode='original',sentenceSourceKey='',
 sentenceProjection=null,sentenceProjectionCues=null,enhancedCues=[],sentenceTranslations={},sentenceTokens={},
 sentenceUndoIds=new Set(),sentenceUndoRevisions={},sentenceCandidates={},sentenceTrackKind='asr',audioListeningAutoStarted=false,
 sentenceStateLoadedKey='',sentenceStateLoadedGen=-1,sentenceStateLoad=null,
 listDirty=true,currentMediaTime=2,navigateGen=1,translatingWithGemini=false,paints=[],publishes=0,sentenceBenchmark=testTrace,sentenceRawTrack=null,lastBackgroundPrefetchTime=0,
 transcriptMeta={rev:1,owned:false,tombstones:[]};
const settings={sourceLang:'ja',barShowVi:true,barShowEn:false};
const storage={};
const chrome={runtime:{id:'fixture',getURL:path=>'chrome-extension://fixture/'+path,
 sendMessage:msg=>handleSavedCueMutation(msg,{id:'fixture',url:'https://www.youtube.com/watch?v=fixture',tab:{id:1}})},
 storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,storage[key]])),
 set:async patch=>Object.assign(storage,structuredClone(patch))}}};
const isSupportedUrl=url=>url.startsWith('https://www.youtube.com/');
${langFns}
${workerFunctions}
const findVideo=()=>({playbackRate:1}),toast=()=>{},scheduleSaveTranscript=()=>{};
const updateBar=c=>{paints.push(c?.source||'')},publishSidePanelState=()=>{publishes++};
${projection}
${scheduler}
`, ctx);
  return expression => vm.runInContext(expression, ctx);
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  global.fetch = (_url, opts) => actualFetch(`http://127.0.0.1:${server.address().port}`, opts);
  const disabled = createContent('flag-disabled');
  await disabled('loadSentenceState()'); disabled("refreshSentenceProjection(true);captionMode='enhanced';settings.sentence_translation_prefetch_enabled=false");
  const beforeDisabled=requests;
  await disabled('triggerGeminiTranslationIfNeeded()');
  assert.equal(requests,beforeDisabled,'disabled automatic prefetch must make no HTTP request');
  await disabled('triggerGeminiTranslationIfNeeded(true)');
  assert.equal(requests,beforeDisabled+1,'explicit manual translation remains available with prefetch disabled');
  assert.equal(disabled('enhancedCues[1].vi'),'vi: どこ?');
  const disabledEvents=JSON.parse(disabled('JSON.stringify(sentenceBenchmark.snapshot().events)'));
  assert.ok(disabledEvents.some(e=>e.type==='group_prepared'),'actual projection must record prepared groups');
  assert.equal(disabledEvents.filter(e=>e.type==='translation_queued').length,3,'manual submissions recorded even with automatic prefetch off');
  assert.equal(disabledEvents.filter(e=>e.type==='translation_ready'&&e.accepted).length,3,'only accepted valid results are ready');
  assert.ok(disabledEvents.filter(e=>e.type==='translation_ready').every(e=>disabledEvents.some(q=>q.type==='translation_queued'&&q.groupRef===e.groupRef&&q.language===e.language&&q.atMs<=e.atMs)));
  console.log('PASS: prefetch flag suppresses automatic HTTP while explicit manual translation still executes HTTP200');

  const run = createContent('happy');
  await run('loadSentenceState();'); run("refreshSentenceProjection(true)");
  assert.equal(run('captionMode'), 'enhanced', 'fresh eligible track must prefetch in its default Enhanced mode');
  await run('triggerGeminiTranslationIfNeeded()');
  assert.equal(run('enhancedCues[1].vi'), 'vi: どこ?');
  assert.equal(run('JSON.stringify(cues.map(c=>c.vi))'), '[null,null,null]');
  const paintRun = createContent('debounce');
  paintRun('scheduleTranslationPaint(1);navigateGen=2;scheduleTranslationPaint(2)');
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(paintRun('publishes'), 1);
  console.log('PASS: production content applies group HTTP200 without changing originals; new-session debounce publishes once');

  const stale = createContent('stale-context');
  await stale('loadSentenceState()'); stale("refreshSentenceProjection(true);captionMode='enhanced'");
  release = {};
  const arrival = new Promise(resolve => { arrived = resolve; });
  const work = stale('triggerGeminiTranslationIfNeeded()');
  await arrival; arrived = null;
  stale("cues[0].source='雨。';cues[0].mt_locked=true;currentMediaTime=3.5;refreshSentenceProjection(true)");
  release.resolve(); release = null; await work;
  // Neighbouring a was locked and retexted: the sentence grouping changes, so
  // EVERY queued result (including the untouched tail) is stale and must be
  // discarded - a late result may never repaint a changed sentence.
  assert.equal(stale('enhancedCues[0].vi'), '');
  assert.equal(stale('enhancedCues[1].vi'), '');
  assert.equal(stale('enhancedCues[2].vi'), '');
  assert.ok(JSON.parse(stale('JSON.stringify(paints)')).every(text => !String(text).includes('vi: ')),
    'no discarded translation may be painted');
  const staleEvents=JSON.parse(stale('JSON.stringify(sentenceBenchmark.snapshot().events)'));
  assert.equal(staleEvents.filter(e=>e.type==='translation_queued').length,3,'the first automatic prefetch also queues the background group');
  assert.equal(staleEvents.filter(e=>e.type==='translation_discarded').length,3,'every result is stale after the neighbour changed');
  assert.equal(staleEvents.filter(e=>e.type==='translation_ready'&&e.accepted).length,0,'no stale result may be accepted');
  console.log('PASS: neighbor edit/lock rejects stale target translation; valid late result paints current playhead, never rewinds');

  for (const flag of ['sentence_translation_prefetch_enabled','enhanced_subtitles_enabled','sentence_grouping_enabled']) {
    const gated = createContent('late-'+flag);
    await gated('loadSentenceState()'); gated("refreshSentenceProjection(true);captionMode='enhanced'");
    release={}; const gateArrival=new Promise(resolve=>{arrived=resolve});
    const gateWork=gated('triggerGeminiTranslationIfNeeded()'); await gateArrival; arrived=null;
    gated(`settings.${flag}=false;refreshSentenceProjection(true)`);
    release.resolve();release=null;await gateWork;
    assert.equal(gated('Object.keys(sentenceTranslations).length'),0,`${flag} must reject late automatic result`);
    assert.equal(gated('JSON.stringify(cues.map(c=>c.vi))'),'[null,null,null]');
    assert.equal(gated("sentenceBenchmark.snapshot().events.filter(e=>e.type==='translation_ready').length"),0);
    // The first automatic prefetch also queues the background group, so three
    // results are in flight; the flag makes every one of them stale.
    assert.equal(gated("sentenceBenchmark.snapshot().events.filter(e=>e.type==='translation_queued').length"),3);
    assert.equal(gated("sentenceBenchmark.snapshot().events.filter(e=>e.type==='translation_discarded').length"),3);
  }
  console.log('PASS: held real HTTP200 after disabling each flag cannot apply stale Enhanced results or mutate originals');

  const original=createContent('original-lifecycle');
  await original('loadSentenceState()');
  original("captionMode='original';currentMediaTime=0;cues[0].vi='existing';cues[1].mt_locked=true");
  const originalBefore=requests;
  await original('triggerGeminiTranslationIfNeeded()');
  let originalEvents=JSON.parse(original('JSON.stringify(sentenceBenchmark.snapshot().events)'));
  assert.equal(originalEvents.filter(e=>e.type==='translation_queued'&&e.mode==='original').length,1,'legacy wrapper filters existing/locked targets before trace');
  assert.equal(originalEvents.filter(e=>e.type==='translation_ready'&&e.mode==='original').length,1);
  assert.equal(requests,originalBefore+1);
  original("cues[2].vi=''");
  await original('triggerGeminiTranslationIfNeeded()');
  originalEvents=JSON.parse(original('JSON.stringify(sentenceBenchmark.snapshot().events)'));
  assert.ok(originalEvents.some(e=>e.type==='translation_ready'&&e.cached));
  assert.equal(requests,originalBefore+1,'cache settlement must not invent a second HTTP attempt');
  assert.equal(original('sentenceBenchmark.snapshot().requestCount'),1);
  console.log('PASS: Original trace uses filtered cue jobs, records accepted/cache results, no extra HTTP or locked/existing rewrite');

  const bilingual=createContent('bilingual-lifecycle');
  await bilingual('loadSentenceState()');
  bilingual("refreshSentenceProjection(true);captionMode='enhanced';settings.barShowEn=true");
  await bilingual('triggerGeminiTranslationIfNeeded()');
  const bilingualEvents=JSON.parse(bilingual('JSON.stringify(sentenceBenchmark.snapshot().events)'));
  for(const language of ['vi','en']) {
    // Three groups (elapsed, current, ahead) are prefetched per language.
    assert.equal(bilingualEvents.filter(e=>e.type==='translation_queued'&&e.language===language).length,3);
    assert.equal(bilingualEvents.filter(e=>e.type==='translation_ready'&&e.language===language&&e.accepted).length,3);
  }
  assert.equal(bilingual('enhancedCues[1].en'),'en: どこ?');
  assert.equal(bilingual('JSON.stringify(cues.map(c=>[c.vi,c.en]))'),'[[null,null],[null,null],[null,null]]');
  assert.equal(bilingual('sentenceBenchmark.snapshot().requestCount'),2,'VI and EN use separate prompts, so each language is its own HTTP attempt');
  console.log('PASS: Enhanced VI/EN filtered submissions and accepted results have separate language events, one HTTP attempt per language and unchanged originals');

  const partial=createContent('original-partial');
  await partial('loadSentenceState()');
  // BATCH_SIZE is 10, so 31 cues are four HTTP calls. Hold the last cue's batch.
  partial("captionMode='original';currentMediaTime=0;cues=Array.from({length:31},(_,i)=>({id:'partial-'+i,source:i===30?'遅い。':'速い'+i+'。',start_media_time:0,end_media_time:4}))");
  mode='hold-last';release={};const partialArrival=new Promise(resolve=>{arrived=resolve});
  const partialWork=partial('triggerGeminiTranslationIfNeeded()');
  await partialArrival;arrived=null;
  try {
    for(let i=0;i<100&&partial("sentenceBenchmark.snapshot().events.filter(e=>e.type==='translation_ready').length")<30;i++)
      await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(partial("sentenceBenchmark.snapshot().events.filter(e=>e.type==='translation_ready').length"),30,'first real batch must settle while second is held');
    assert.equal(partial('sentenceBenchmark.snapshot().requestCount'),3,'mid-flight export keeps the three settled batches of 10');
  } finally {release.resolve();release=null;await partialWork;mode='valid';}
  assert.equal(partial('sentenceBenchmark.snapshot().requestCount'),4,'final aggregate adds the held last cue without recounting settled batches');
  console.log('PASS: mid-flight Original export keeps three HTTP receipts with 30 ready results while the last cue is held; final four attempts do not double count');

  const failed = createContent('error');
  await failed('loadSentenceState()'); failed("refreshSentenceProjection(true);captionMode='enhanced'");
  mode = 'error'; const before = requests;
  await failed('triggerGeminiTranslationIfNeeded()');
  // One batch: primary model retries once on HTTP 503, then the fallback model does the same.
  assert.equal(requests, before + 4, 'a 503 batch tries the primary and fallback model once each');
  assert.equal(failed('enhancedCues[1].translationStates.vi'), 'error');
  await failed('triggerGeminiTranslationIfNeeded()');
  assert.equal(requests, before + 4, 'Failure must not cause immediate prefetch retry loop');
  // One error event per failed job (three groups were prefetched).
  assert.equal(failed("sentenceBenchmark.snapshot().events.filter(e=>e.type==='translation_error'&&e.httpStatus===503).length"),3);
  const metrics=JSON.parse(failed('JSON.stringify(sentenceBenchmark.snapshot())'));
  assert.ok(!JSON.stringify(metrics).includes('晴れ')&&!JSON.stringify(metrics).includes('どこ')&&!JSON.stringify(metrics).includes('test-only'),'export contains no caption/key text');
  const originalError=createContent('original-error');
  await originalError('loadSentenceState()');
  originalError("captionMode='original';currentMediaTime=0;cues[0].vi='existing';cues[1].mt_locked=true");
  await originalError('triggerGeminiTranslationIfNeeded()');
  assert.equal(originalError("sentenceBenchmark.snapshot().events.filter(e=>e.type==='translation_error'&&e.httpStatus===503&&e.accepted===false&&e.mode==='original').length"),1);
  console.log('PASS: real HTTP503 becomes per-language content error and suppresses automatic retry for 30s');
  console.log('PASS: actual projection/submission/accepted/stale/error lifecycle exported without caption/key text; no onset-readiness claim');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { global.fetch = actualFetch; server.close(); });
