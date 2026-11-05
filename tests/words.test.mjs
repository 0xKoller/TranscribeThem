import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src", "words.js"), "utf8");
const ctx = createContext({ globalThis: {} });
ctx.globalThis = ctx;
runInContext(src, ctx);
const { normalizeWords, activeWordIndex, wordPaint } = ctx.WaWords;

const words = normalizeWords([
  { text: "pasa", start: 0.1, end: 0.4 },
  { word: "que", startTime: 0.4, endTime: 0.7 },
  { text: " ", start: 1 },
  { text: "amigo", start: 0.7, end: 0.2 },
]);
assert.equal(words.length, 3);
assert.equal(words[0].text, "pasa");
assert.equal(words[0].start, 0.1);
assert.equal(words[0].end, 0.4);
assert.equal(words[1].text, "que");
assert.equal(words[1].start, 0.4);
assert.equal(words[2].text, "amigo");
assert.equal(words[2].end, 0.7);
assert.equal(activeWordIndex(words, 0), -1);
assert.equal(activeWordIndex(words, 0.1), 0);
assert.equal(activeWordIndex(words, 0.39), 0);
assert.equal(activeWordIndex(words, 0.4), 1);
assert.equal(activeWordIndex(words, 2), 2);
assert.equal(activeWordIndex([], 1), -1);

assert.equal(wordPaint(0, -1, false).upcoming, true);
assert.equal(wordPaint(0, -1, false).on, false);
assert.equal(wordPaint(0, 1, true).upcoming, false);
assert.equal(wordPaint(0, 1, true).on, false);
assert.equal(wordPaint(1, 1, true).on, true);
assert.equal(wordPaint(1, 1, true).upcoming, false);
assert.equal(wordPaint(2, 1, true).upcoming, true);
assert.equal(wordPaint(0, 1, false).on, false);
assert.equal(wordPaint(0, 1, false).upcoming, false);
assert.equal(wordPaint(2, 1, false).upcoming, true);

console.log("words.test.mjs ok");
