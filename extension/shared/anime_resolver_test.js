/**
 * Unit & Live Contract tests for Anime Resolver.
 * Run with: node extension/shared/anime_resolver_test.js [--live]
 */
const assert = require("assert");
const {
  parseAnimeMetadata,
  makeCacheKey,
  findMatchingFileForEpisode,
  searchAniList,
  resolveAniList,
  searchJimaku,
  fetchJimakuFiles
} = require("./anime_resolver.js");

function testMetadataExtraction() {
  const url = "https://animevietsub.best/phim/mezametara-saikyou-soubi-to-uchuusenmochi-datta-node-ikkodate-mezashite-youhei-toshite-jiyuu-ni-ikitai-a6112/xem-phim.html";
  const domInfo = {
    title: "Tập 01 Mezametara Saikyou Soubi to Uchuusenmochi Datta node, Ikkodate Mezashite Youhei toshite Jiyuu ni Ikitai (Reborn as a Space Mercenary: I Woke Up Piloting the Strongest Starship!, Mezameza) 2026 HD-VietSub",
    h1: "Mezametara Saikyou Soubi to Uchuusenmochi Datta node, Ikkodate Mezashite Youhei toshite Jiyuu ni Ikitai",
    h2: "Reborn as a Space Mercenary: I Woke Up Piloting the Strongest Starship!, Mezameza",
    activeEpisode: "01"
  };

  const meta = parseAnimeMetadata(url, domInfo);
  assert.strictEqual(meta.episode, 1);
  assert.strictEqual(meta.slug, "mezametara-saikyou-soubi-to-uchuusenmochi-datta-node-ikkodate-mezashite-youhei-toshite-jiyuu-ni-ikitai-a6112");
  assert.strictEqual(meta.romajiTitle, "Mezametara Saikyou Soubi to Uchuusenmochi Datta node, Ikkodate Mezashite Youhei toshite Jiyuu ni Ikitai");
  assert.strictEqual(meta.englishTitle, "Reborn as a Space Mercenary: I Woke Up Piloting the Strongest Starship!");

  // Test episode extraction from tap-02 URL
  const urlEp2 = "https://animevietsub.best/phim/some-slug-a123/tap-02-116221.html";
  const metaEp2 = parseAnimeMetadata(urlEp2, { title: "Tập 02 Phim Hay", h1: "Phim Hay", h2: "Great Movie" });
  assert.strictEqual(metaEp2.episode, 2);
}

function testCacheKeyCollisionProof() {
  const key1 = makeCacheKey("mezametara-saikyou-soubi-a6112", 1);
  const key2 = makeCacheKey("sono-bisque-doll-a5672", 1);
  assert.notStrictEqual(key1, key2, "Two different anime at episode 1 must NOT share cache key");
  assert.strictEqual(key1.length <= 64, true, "Cache key must be <= 64 chars");
  assert.strictEqual(/^[A-Za-z0-9_-]+$/.test(key1), true, "Cache key must match safe regex");
}

function testEpisodeFileMatching() {
  const files = [
    { name: "Mezameza.S01E01.WEBRip.ABEMA.ja.srt", url: "https://jimaku.cc/download/ep1.srt" },
    { name: "Mezameza.S01E02.WEBRip.ABEMA.ja.srt", url: "https://jimaku.cc/download/ep2.srt" },
    { name: "Mezameza.S01E03.WEBRip.ABEMA.ja.srt", url: "https://jimaku.cc/download/ep3.srt" }
  ];

  const matched = findMatchingFileForEpisode(files, 2);
  assert.ok(matched, "Should match episode 2");
  assert.strictEqual(matched.name, "Mezameza.S01E02.WEBRip.ABEMA.ja.srt");
}

async function testLiveContract() {
  const isLive = process.argv.includes("--live");
  if (!isLive) {
    console.log("SKIP: Live network contract tests (pass --live to execute)");
    return;
  }

  console.log("Running Live AniList & Jimaku Contract Tests...");
  const meta = {
    romajiTitle: "Mezametara Saikyou Soubi to Uchuusenmochi Datta node, Ikkodate Mezashite Youhei toshite Jiyuu ni Ikitai",
    englishTitle: "Reborn as a Space Mercenary: I Woke Up Piloting the Strongest Starship!"
  };

  const anime = await resolveAniList(meta);
  assert.ok(anime, "AniList resolution should succeed");
  assert.strictEqual(anime.id, 186541, "AniList ID should be 186541");
  console.log("  ✓ AniList resolved ID:", anime.id, anime.title.romaji);

  const apiKey = process.env.JIMAKU_API_KEY || "AAAAAAAASf0uAS4WuT8jGDRi2aBhlfRbpbrybuzKXyCnxjCyWGmsx0q5wg";
  const entries = await searchJimaku(anime.id, apiKey);
  assert.ok(Array.isArray(entries) && entries.length > 0, "Jimaku entries should be found");
  assert.strictEqual(entries[0].anilist_id, 186541);
  console.log("  ✓ Jimaku found entry ID:", entries[0].id, entries[0].name);

  const files = await fetchJimakuFiles(entries[0].id, apiKey);
  assert.ok(Array.isArray(files) && files.length > 0, "Jimaku files should be returned");
  const ep1 = findMatchingFileForEpisode(files, 1);
  assert.ok(ep1, "Should find file for episode 1");
  console.log("  ✓ Jimaku found Ep 1 file:", ep1.name);
}

async function runAll() {
  testMetadataExtraction();
  testCacheKeyCollisionProof();
  testEpisodeFileMatching();
  await testLiveContract();
  console.log("PASS: anime_resolver_test.js");
}

runAll().catch(err => {
  console.error("FAIL: anime_resolver_test.js", err);
  process.exit(1);
});
