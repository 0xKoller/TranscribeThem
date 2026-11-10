import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src", "transcript-cache.js"), "utf8");

// The pure functions must not need chrome or a DOM: this context has neither.
const ctx = createContext({});
ctx.globalThis = ctx;
runInContext(src, ctx);
const api = ctx.WaTranscriptCache;
const plain = (value) => JSON.parse(JSON.stringify(value));

assert.equal(api.STORAGE_KEY, "transcriptCache");
assert.equal(api.MAX_ENTRIES, 300);
assert.equal(api.MAX_ENTRY_BYTES, 40 * 1024);

// Keys: site plus the message id. No id, no key.
assert.equal(api.cacheKey("whatsapp", "true_549@c.us_3EB0"), "whatsapp:true_549@c.us_3EB0");
assert.equal(api.cacheKey("x", " 123 "), "x:123");
assert.notEqual(api.cacheKey("x", "1"), api.cacheKey("whatsapp", "1"));
assert.equal(api.cacheKey("whatsapp", ""), "");
assert.equal(api.cacheKey("whatsapp", null), "");
assert.equal(api.cacheKey("whatsapp", undefined), "");
assert.equal(api.cacheKey("", "abc"), "");

// Size is counted in UTF-8 bytes of the JSON.
assert.equal(api.byteSize("abc"), 5);
assert.equal(api.byteSize("ñ"), 4);
assert.equal(api.byteSize("😀"), 6);
assert.equal(api.byteSize({ a: "é" }), Buffer.byteLength(JSON.stringify({ a: "é" })));

// An entry keeps what is needed to draw the note again.
const words = [
  { text: "hola", start: 0, end: 0.4 },
  { word: "che", startTime: 0.5, endTime: 0.9 },
  { text: "", start: 1, end: 2 },
  null,
];
const entry = api.makeEntry({ text: "hola che", words, engine: "parakeet", transcribeMs: 129, language: "es" }, 1000);
assert.deepEqual(plain(entry), {
  text: "hola che",
  words: [
    { text: "hola", start: 0, end: 0.4 },
    { text: "che", start: 0.5, end: 0.9 },
  ],
  engine: "parakeet",
  transcribeMs: 129,
  savedAt: 1000,
  usedAt: 1000,
});
assert.equal(api.makeEntry({ text: "" }, 1), null);
assert.equal(api.makeEntry({ text: "   " }, 1), null);
assert.equal(api.makeEntry(null, 1), null);
assert.deepEqual(plain(api.makeEntry({ text: "solo texto" }, 5)), {
  text: "solo texto",
  words: [],
  engine: "",
  transcribeMs: 0,
  savedAt: 5,
  usedAt: 5,
});

// Over 40 KB: the word timings go first. Still over: the note is not cached.
const manyWords = Array.from({ length: 2000 }, (_, i) => ({ text: "palabra" + i, start: i, end: i + 0.5 }));
const mediumText = "palabra ".repeat(2000);
const trimmed = api.makeEntry({ text: mediumText, words: manyWords, engine: "whisper" }, 7);
assert.ok(api.byteSize({ text: mediumText, words: manyWords }) > api.MAX_ENTRY_BYTES);
assert.equal(trimmed.text, mediumText);
assert.equal(trimmed.words.length, 0);
assert.ok(api.byteSize(trimmed) <= api.MAX_ENTRY_BYTES);
assert.equal(api.makeEntry({ text: "x".repeat(41 * 1024) }, 7), null);
const justUnder = api.makeEntry({ text: "a".repeat(200), words: manyWords.slice(0, 10) }, 7, 100000);
assert.equal(justUnder.words.length, 10);
// Multi-byte text counts by bytes, not by characters.
assert.equal(api.makeEntry({ text: "ñ".repeat(21 * 1024) }, 7), null);
assert.notEqual(api.makeEntry({ text: "n".repeat(21 * 1024) }, 7), null);

// put / get.
let cache = {};
cache = api.put(cache, "whatsapp:a", api.makeEntry({ text: "uno" }, 10));
cache = api.put(cache, "whatsapp:b", api.makeEntry({ text: "dos" }, 20));
assert.equal(api.get(cache, "whatsapp:a").text, "uno");
assert.equal(api.get(cache, "whatsapp:zzz"), null);
assert.equal(api.get(cache, ""), null);
assert.equal(api.get(null, "whatsapp:a"), null);
assert.equal(api.get(cache, "toString"), null);
// put does not change the object it was given.
const before = JSON.stringify(cache);
const after = api.put(cache, "whatsapp:c", api.makeEntry({ text: "tres" }, 30));
assert.equal(JSON.stringify(cache), before);
assert.equal(Object.keys(after).length, 3);
// A bad key or entry adds nothing.
assert.equal(Object.keys(api.put(cache, "", api.makeEntry({ text: "x" }, 1))).length, 2);
assert.equal(Object.keys(api.put(cache, "whatsapp:d", null)).length, 2);

// Eviction drops the least recently used, not the oldest saved.
let small = {};
small = api.put(small, "k1", api.makeEntry({ text: "1" }, 100), 3);
small = api.put(small, "k2", api.makeEntry({ text: "2" }, 200), 3);
small = api.put(small, "k3", api.makeEntry({ text: "3" }, 300), 3);
small = api.touch(small, "k1", 400);
assert.equal(small.k1.usedAt, 400);
assert.equal(small.k1.savedAt, 100);
small = api.put(small, "k4", api.makeEntry({ text: "4" }, 500), 3);
assert.deepEqual(Object.keys(small).sort(), ["k1", "k3", "k4"]);
// touch on a missing key changes nothing.
assert.deepEqual(Object.keys(api.touch(small, "nope", 999)).sort(), ["k1", "k3", "k4"]);

// The real cap is 300.
let big = {};
for (let i = 0; i < 320; i++) big = api.put(big, "x:" + i, api.makeEntry({ text: "t" + i }, i + 1));
assert.equal(Object.keys(big).length, 300);
assert.equal(api.get(big, "x:0"), null);
assert.equal(api.get(big, "x:19"), null);
assert.equal(api.get(big, "x:20").text, "t20");
assert.equal(api.get(big, "x:319").text, "t319");

// prune throws away junk left in storage by anything else.
const cleaned = api.prune({ good: { text: "ok", savedAt: 1 }, bad: "nope", empty: { text: "" }, none: null }, 10);
assert.deepEqual(Object.keys(cleaned), ["good"]);
assert.deepEqual(Object.keys(api.prune(null, 10)), []);

// Storage helpers, against a fake chrome.storage.local.
const store = {};
ctx.chrome = {
  storage: {
    local: {
      get: async (key) => (key in store ? { [key]: JSON.parse(JSON.stringify(store[key])) } : {}),
      set: async (partial) => Object.assign(store, JSON.parse(JSON.stringify(partial))),
    },
  },
};
assert.deepEqual(plain(await api.load()), {});
// Two writes started together both land: the second reads what the first wrote.
await Promise.all([
  api.update((c) => api.put(c, "whatsapp:a", api.makeEntry({ text: "uno" }, 1))),
  api.update((c) => api.put(c, "whatsapp:b", api.makeEntry({ text: "dos" }, 2))),
]);
assert.deepEqual(Object.keys(store.transcriptCache).sort(), ["whatsapp:a", "whatsapp:b"]);
assert.equal((await api.load())["whatsapp:b"].text, "dos");
await api.clear();
assert.deepEqual(store.transcriptCache, {});
// A failed write does not block the next one.
const realSet = ctx.chrome.storage.local.set;
ctx.chrome.storage.local.set = async () => {
  throw new Error("quota");
};
await assert.rejects(() => api.update((c) => c));
ctx.chrome.storage.local.set = realSet;
await api.update((c) => api.put(c, "x:1", api.makeEntry({ text: "sigue" }, 3)));
assert.equal(store.transcriptCache["x:1"].text, "sigue");

console.log("transcript-cache.test.mjs ok");
