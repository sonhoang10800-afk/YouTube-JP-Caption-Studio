/**
 * Regression tests for the side panel P0 fixes (audit 2026-10-18, section 4).
 *
 * - P0-1  cue list rows must follow the cue order after a timeline edit
 * - P0-5  the Words / Saved tabs must only re-render when their data changed
 * - P0-7  the saved-word box must never be injected inside an HTML entity
 * - P0-4  the settings modal sections must not be nested into each other
 *
 * Pure logic only: no chrome.* API and no DOM harness.
 */
const assert = require("assert");
const Pure = require("./sidepanel_pure.js");

// ---------------------------------------------------------------- P0-1
assert.strictEqual(Pure.rowsNeedReorder(["a", "b"], ["a", "b"]), false, "same order needs no reorder");
assert.strictEqual(Pure.rowsNeedReorder(["a", "b"], ["b", "a"]), true, "swapped cues need a reorder");
assert.strictEqual(Pure.rowsNeedReorder(["a", "b"], ["a", "b", "c"]), true, "an appended cue needs a reorder");
assert.strictEqual(Pure.rowsNeedReorder(["a", "c", "b"], ["a", "b", "c"]), true, "a moved cue needs a reorder");
assert.strictEqual(Pure.rowsNeedReorder([], []), false, "empty lists need no reorder");
assert.strictEqual(Pure.rowsNeedReorder(["a"], ["a", "b"]), true, "a missing row needs a reorder");

// ---------------------------------------------------------------- P0-5
const cues = [
  { id: "c1", tokens: [{ lemma: "犬", surface: "犬", pos: "名詞", jlpt: "n5", freq_rank: 120 }, { lemma: "犬", surface: "犬", pos: "名詞" }] },
  { id: "c2", tokens: [{ lemma: "猫", surface: "猫", pos: "名詞", jlpt: "n4", freq_rank: 900 }] },
];
const words = Array.from(Pure.collectWords(cues, (pos) => pos === "助詞").values());
assert.strictEqual(words.length, 2, "one entry per lemma");
assert.strictEqual(words[0].count, 2, "repeated lemma is counted once per token");
assert.strictEqual(Pure.collectWords(cues, () => true).size, 0, "skipped POS tokens are dropped");

const sigA = Pure.wordsSignature(words, { 猫: "learning" });
const sigB = Pure.wordsSignature(words, { 猫: "learning" });
assert.strictEqual(sigA, sigB, "unchanged words data keeps the same signature");
assert.notStrictEqual(
  sigA,
  Pure.wordsSignature(words, {}),
  "a changed saved-state changes the signature"
);
assert.notStrictEqual(
  sigA,
  Pure.wordsSignature([], { 猫: "learning" }),
  "different words change the signature"
);

const model = { showContext: true, practice: false, words: [{ lemma: "猫", context: "猫だ" }], cues: [{ id: "c1", source: "猫だ", vi: "mèo", en: "cat" }] };
assert.strictEqual(Pure.savedSignature(model), Pure.savedSignature({ ...model }), "unchanged saved data keeps the same signature");
assert.notStrictEqual(
  Pure.savedSignature(model),
  Pure.savedSignature({ ...model, practice: true }),
  "toggling the practice mode changes the signature"
);
assert.notStrictEqual(
  Pure.savedSignature(model),
  Pure.savedSignature({ ...model, words: [{ lemma: "猫", context: "別の文" }] }),
  "a changed context changes the signature"
);

// ---------------------------------------------------------------- P0-7
const escapeHtml = (s) =>
  s == null
    ? ""
    : String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

// The lemma occurs in the raw text → the box wraps the raw match.
assert.strictEqual(
  Pure.buildSavedWordHtml("猫", "吾輩は猫である", escapeHtml),
  '吾輩は<span class="lr-saved-word-box">猫</span>である',
  "the lemma is boxed in place"
);
// The lemma only occurs inside an HTML entity (& → &amp;) → it must NOT be
// boxed inside the entity (that produced broken markup).
const entityCase = Pure.buildSavedWordHtml("amp", "Tom & Jerry", escapeHtml);
assert.ok(!/&<span/.test(entityCase), "the box must not be injected inside an HTML entity");
assert.strictEqual(
  entityCase,
  '<span class="lr-saved-word-box">amp</span> · Tom &amp; Jerry',
  "a lemma that is only part of an entity falls back to the plain context"
);
// A context without the lemma keeps the "word · context" layout.
assert.strictEqual(
  Pure.buildSavedWordHtml("犬", "吾輩は猫である", escapeHtml),
  '<span class="lr-saved-word-box">犬</span> · 吾輩は猫である',
  "a missing lemma falls back to the plain context"
);
// Special characters in the context stay escaped.
assert.strictEqual(
  Pure.buildSavedWordHtml("猫", 'a <b> "c" & 猫', escapeHtml),
  'a &lt;b&gt; &quot;c&quot; &amp; <span class="lr-saved-word-box">猫</span>',
  "the context stays escaped"
);

// ---------------------------------------------------------------- P0-4
// The settings modal markup is produced by the real createModalHtml().
require("../content/settings_modal.js");
const { createModalHtml } = globalThis.HardsubSettingsModal;
const modalHtml = createModalHtml({});

const VOID_TAGS = new Set(["input", "br", "hr", "img", "meta", "link", "source", "wbr", "area", "base", "col", "embed", "param", "track"]);
const tree = { tag: "#root", classes: "", children: [] };
const stack = [tree];
const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
let m;
while ((m = tagRe.exec(modalHtml))) {
  const [, closing, tag, attrs, selfClose] = m;
  if (closing) {
    assert.ok(stack.length > 1, "no unbalanced closing tag in the modal markup");
    stack.pop();
    continue;
  }
  if (VOID_TAGS.has(tag.toLowerCase()) || selfClose === "/") continue;
  const classes = (attrs.match(/class="([^"]*)"/) || [, ""])[1];
  const node = { tag, classes, children: [] };
  stack[stack.length - 1].children.push(node);
  stack.push(node);
}
assert.strictEqual(stack.length, 1, "every opened tag is closed");
const findByClass = (node, cls) => {
  for (const child of node.children) {
    if (child.classes.split(" ").includes(cls)) return child;
    const hit = findByClass(child, cls);
    if (hit) return hit;
  }
  return null;
};
const body = findByClass(tree, "lr-settings-body");
const dialog = findByClass(tree, "lr-settings-dialog");
assert.ok(body, "the settings body exists");
assert.ok(dialog, "the settings dialog exists");
const sections = body.children.filter((c) => c.classes === "lr-settings-section");
assert.strictEqual(sections.length, 6, "all 6 sections are direct children of the settings body");
assert.ok(
  !body.children.some((c) => c.classes.includes("lr-settings-footer")),
  "the footer must not be nested inside the settings body"
);
assert.ok(
  dialog.children.includes(findByClass(tree, "lr-settings-footer")),
  "the footer is a sibling of the settings body"
);
for (const section of sections) {
  assert.ok(
    !section.children.some((c) => c.classes === "lr-settings-section"),
    "a settings section must not contain another settings section"
  );
}

// ------------------------------------------------ Enhanced downgrade response
const DOWNGRADE = "Enhanced chưa bật (cần bật trong Cài đặt) — đang dùng Original";
assert.strictEqual(
  Pure.captionModeDowngrade("enhanced", { ok: true, captionMode: "enhanced" }),
  "",
  "an applied Enhanced mode must not show a downgrade warning"
);
assert.strictEqual(
  Pure.captionModeDowngrade("enhanced", { ok: true, captionMode: "original" }),
  DOWNGRADE,
  "an explicit Original fallback must show the downgrade warning"
);
assert.strictEqual(
  Pure.captionModeDowngrade("enhanced", { ok: true }),
  "",
  "a response without an applied mode is not evidence of a downgrade"
);

console.log("sidepanel_pure_test: all assertions passed");
