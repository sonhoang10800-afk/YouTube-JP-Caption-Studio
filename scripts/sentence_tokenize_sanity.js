/** Production sentence NLP helpers against the actual local bridge; read-only text inputs. */
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../extension/content/content.js'), 'utf8');
const projection = source.slice(source.indexOf('  let sortedCuesCache ='), source.indexOf('  /**\n   * Token enrich via /tokenize_batch'));
const enrich = source.slice(source.indexOf('  async function enrichSentenceGroups'), source.indexOf('  function syncCueAtMediaTime'));
const langFns = source.slice(source.indexOf('  function detectCuesLanguage'), source.indexOf('  function stampSecondaryStatus'));
let requests = 0, actualRows = [];
let holdNext = null;
async function bridgeFetch(path, options) {
  const hold = holdNext; holdNext = null;
  assert.equal(path, '/tokenize_batch');
  const response = await fetch(`${(process.env.CAPTION_BRIDGE_URL || process.env.BRIDGE_URL || 'http://127.0.0.1:8765')}${path}`, { method: options.method,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body) });
  assert.equal(response.status, 200);
  const data = await response.json(); requests++; actualRows = data.results;
  console.log(`HTTP: POST ${path} ${response.status}; parsed ${data.results.length} sentence results`);
  if (hold) { hold.arrived(); await hold.wait; }
  return { ok: response.ok, data };
}
const ctx = vm.createContext({ console, HardsubSentenceGroups: require('../extension/shared/sentence_groups.js'), bridgeFetch });
vm.runInContext(`
let cues=[{id:'a',source:'😀どこに',start_media_time:0,end_media_time:1},
 {id:'b',source:'行くんですか?',start_media_time:1,end_media_time:3},
 {id:'locked',source:'自分。',vi:'Tôi giữ',mt_locked:true,start_media_time:3,end_media_time:4}];
let currentSource='youtube',currentVideoId='token-fixture',captionMode='original',sentenceSourceKey='',
 sentenceProjection=null,sentenceProjectionCues=null,enhancedCues=[],sentenceTranslations={},sentenceTokens={},
 sentenceUndoIds=new Set(),sentenceUndoRevisions={},sentenceStateLoadedKey='',sentenceStateLoadedGen=-1,sentenceStateLoad=null,
 listDirty=true,currentMediaTime=1.5,navigateGen=1,bridgeReady=true,sentenceBenchmark=null,sentenceRawTrack=null;
const settings={sourceLang:'ja'},sentenceTokenPending=new Set(),sentenceTokenRetryAt=new Map();
const findVideo=()=>({playbackRate:1}),scheduleTranslationPaint=()=>{};
${langFns}
${projection}
${enrich}
refreshSentenceProjection(true);captionMode='enhanced';
`, ctx);
const run = expression => vm.runInContext(expression, ctx);
(async () => {
  // This script talks to the REAL local bridge, so it is an integration check:
  // skip (instead of failing) when the bridge is not running.
  const bridgeUrl = (process.env.CAPTION_BRIDGE_URL || process.env.BRIDGE_URL || 'http://127.0.0.1:8765');
  try {
    const probe = await fetch(`${bridgeUrl}/health`, { signal: AbortSignal.timeout(2000) });
    if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
  } catch (err) {
    console.log(`SKIP: sentence_tokenize_sanity.js needs the local bridge on ${bridgeUrl} (${err.message})`);
    process.exit(77);
  }
  const original = run('JSON.stringify(cues)');
  await run('enrichSentenceGroups()');
  assert.equal(requests, 1); assert.equal(actualRows.length, 1);
  const display = run('enhancedCues[1]');
  assert.equal(display.source, '😀どこに行くんですか?');
  assert.ok(display.tokens.length > 0);
  for (const token of display.tokens) assert.equal(display.source.slice(token.start, token.end), token.surface);
  const originals = run('cues');
  for (const token of display.tokens) assert.equal(token.sourceRefs.map(ref => originals.find(c=>c.id===ref.cueId)
    .source.slice(ref.charStart,ref.charEnd)).join(''),token.surface);
  assert.equal(display.tokens.find(t => t.surface === '行く').start, 5);
  assert.equal(display.tokens.find(t => t.surface === '行く').reading, 'いく');
  assert.equal(display.tokens[0].offsetUnit, 'utf16');
  assert.equal(run('JSON.stringify(cues)'), original);
  await run('enrichSentenceGroups()'); assert.equal(requests, 1);
  const Groups = require('../extension/shared/sentence_groups.js');
  assert.throws(() => Groups.tokensFromCodePoints('😀どこ', '😀どこ', [{ surface: 'どこ', start: 0, end: 1 }]), /span/);
  console.log('PASS: whole joined sentence tokenized through real bridge HTTP200; emoji code-point→UTF16 offsets/readings validated, lock and originals unchanged, no duplicate call');
  run("cues=[{id:'space',source:'晴れ。 川。',start_media_time:0,end_media_time:3}];sentenceTokens={};refreshSentenceProjection(true)");
  await run('enrichSentenceGroups()');
  assert.equal(actualRows.length,2);
  assert.equal(run("enhancedCues[0].tokens.map(t=>t.surface).join('')"),'晴れ。 川。');
  console.log('PASS: real bridge trimming across two logical groups preserves exact display source including neutral whitespace');
  run('sentenceTokens={};navigateGen++;refreshSentenceProjection(true)');
  let arrive, release;
  const arrived = new Promise(resolve => { arrive = resolve; });
  holdNext = { arrived: arrive, wait: new Promise(resolve => { release = resolve; }) };
  const beforeNavigation = requests, oldWork = run('enrichSentenceGroups()');
  await arrived;
  run('navigateGen++;cues=cues.map(c=>({...c}));refreshSentenceProjection(true)');
  await run('enrichSentenceGroups()');
  release(); await oldWork;
  assert.equal(requests,beforeNavigation+2);
  assert.equal(run("enhancedCues[0].tokens.map(t=>t.surface).join('')"),'晴れ。 川。');
  assert.equal(run('sentenceTokenPending.size'),0);
  console.log('PASS: held real HTTP200 from prior session cannot block same-track new-session NLP or discard its tokens');
})().catch(error => { console.error(error); process.exitCode = 1; });
