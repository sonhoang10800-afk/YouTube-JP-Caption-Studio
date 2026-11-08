/**
 * Unit tests for URL canonicalization, video ID generation, and Google Drive folder ID parsing.
 */

const assert = require("node:assert/strict");
const UrlHash = require("./url_hash.js");

console.log("Running URL Canonicalization & Hash Tests...");

// Test 1: YouTube formats all canonicalize to same video ID
const yt1 = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&si=abc123xyz";
const yt2 = "https://youtu.be/dQw4w9WgXcQ?t=10";
const yt3 = "https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share";
const yt4 = "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1";
const yt5 = "https://www.youtube.com/live/dQw4w9WgXcQ";

assert.equal(UrlHash.canonicalVideoId(yt1), "yt_dQw4w9WgXcQ");
assert.equal(UrlHash.canonicalVideoId(yt2), "yt_dQw4w9WgXcQ");
assert.equal(UrlHash.canonicalVideoId(yt3), "yt_dQw4w9WgXcQ");
assert.equal(UrlHash.canonicalVideoId(yt4), "yt_dQw4w9WgXcQ");
assert.equal(UrlHash.canonicalVideoId(yt5), "yt_dQw4w9WgXcQ");
console.log("PASS: Test 1 YouTube variants map to identical yt_ID");

// Test 2: Stripping tracking and ephemeral query parameters
const trackingUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&utm_source=twitter&utm_medium=social&si=track123&ab_channel=Artist";
const cleanUrl = UrlHash.canonicalizeVideoUrl(trackingUrl);
assert.equal(cleanUrl, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
assert.ok(!cleanUrl.includes("utm_"));
assert.ok(!cleanUrl.includes("si="));
console.log("PASS: Test 2 Tracking parameters removed");

// Test 3: Netflix formats
const nf1 = "https://www.netflix.com/watch/81234567?trackId=123";
const nf2 = "https://www.netflix.com/title/81234567";
assert.equal(UrlHash.canonicalVideoId(nf1), "netflix_81234567");
assert.equal(UrlHash.canonicalVideoId(nf2), "netflix_81234567");
console.log("PASS: Test 3 Netflix formats mapped to netflix_ID");

// Test 4: ABEMA format
const abemaUrl = "https://abema.tv/video/episode/123-abc_s1_p1?utm_source=abema";
const abemaId = UrlHash.canonicalVideoId(abemaUrl);
assert.ok(abemaId.startsWith("abema_"));
assert.ok(abemaId.length <= 64);
console.log("PASS: Test 4 ABEMA ID generation");

// Test 4b: AnimeVietSub ID generation
const avsUrl1 = "https://animevietsub.best/phim/mezametara-saikyou-soubi-a6112/xem-phim.html";
const avsId1 = UrlHash.canonicalVideoId(avsUrl1);
assert.ok(avsId1.startsWith("avs_"));
assert.ok(avsId1.endsWith("_ep01"));
assert.ok(avsId1.length <= 64);

const avsUrl2 = "https://animevietsub.best/phim/mezametara-saikyou-soubi-a6112/tap-02-116221.html";
const avsId2 = UrlHash.canonicalVideoId(avsUrl2);
assert.ok(avsId2.endsWith("_ep02"));
assert.notEqual(avsId1, avsId2);
console.log("PASS: Test 4b AnimeVietSub ID generation");

// Test 5: Drive Folder ID Parsing from various URL formats
const driveUrl1 = "https://drive.google.com/drive/folders/1A2b3C4d5E6f7G8h9I0j-kLmNoP";
const driveUrl2 = "https://drive.google.com/drive/u/0/folders/1A2b3C4d5E6f7G8h9I0j-kLmNoP?usp=sharing";
const driveBareId = "1A2b3C4d5E6f7G8h9I0j-kLmNoP";

assert.equal(UrlHash.parseDriveFolderId(driveUrl1), "1A2b3C4d5E6f7G8h9I0j-kLmNoP");
assert.equal(UrlHash.parseDriveFolderId(driveUrl2), "1A2b3C4d5E6f7G8h9I0j-kLmNoP");
assert.equal(UrlHash.parseDriveFolderId(driveBareId), "1A2b3C4d5E6f7G8h9I0j-kLmNoP");
assert.equal(UrlHash.parseDriveFolderId("invalid url"), "");
console.log("PASS: Test 5 Google Drive folder ID parsing");

// Test 6: Safety - ID conforms to filename regex [A-Za-z0-9_-]{6,64}
const allIds = [UrlHash.canonicalVideoId(yt1), UrlHash.canonicalVideoId(nf1), abemaId];
for (const id of allIds) {
  assert.ok(/^[A-Za-z0-9_-]{6,64}$/.test(id), `ID "${id}" does not fit filename regex`);
}
console.log("PASS: Test 6 Filename safety regex [A-Za-z0-9_-]{6,64}");

console.log("ALL URL CANONICALIZATION & HASH TESTS PASSED!");
