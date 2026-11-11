import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import assert from "node:assert/strict";
import { chromeI18n } from "./helpers/i18n-chrome.mjs";

const read = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");

// Loads the real service worker with a fake chrome and a fake Mac app.
function boot({ stored = {}, app, manifest = { version: "0.0.0" } }) {
  const store = { ...stored };
  const listeners = [];
  const offscreenMessages = [];
  const tabMessages = [];
  const calls = [];
  const badge = { text: "" };
  let offscreen = false;
  const chrome = {
    i18n: chromeI18n("es"),
    storage: {
      local: {
        get: async (keys) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]])),
        set: async (patch) => { Object.assign(store, patch); },
      },
    },
    runtime: {
      onMessage: { addListener: (fn) => listeners.push(fn) },
      sendMessage: (msg, cb) => { offscreenMessages.push(msg); if (cb) cb(); },
      getManifest: () => manifest,
      getContexts: async () => [],
    },
    offscreen: {
      hasDocument: async () => offscreen,
      createDocument: async () => { offscreen = true; },
    },
    tabs: { sendMessage: (_tab, msg, _opts, cb) => { tabMessages.push(msg); if (cb) cb(); } },
    alarms: { create() {}, onAlarm: { addListener() {} } },
    action: {
      setBadgeText: async ({ text }) => { badge.text = text; },
      setBadgeBackgroundColor: async () => {},
    },
  };
  const ctx = createContext({
    chrome, URL, AbortSignal, AbortController, atob, Uint8Array, console: { log() {} },
    setTimeout: (fn) => setTimeout(fn, 0),
    fetch: async (url, options = {}) => {
      const path = new URL(url).pathname;
      calls.push(path);
      const out = await app(path, options, calls.filter((p) => p === path).length);
      if (!out) throw new Error("Failed to fetch");
      return { ok: out.status < 400, status: out.status, json: async () => out.body || {} };
    },
  });
  ctx.globalThis = ctx;
  ctx.importScripts = (...names) => names.forEach((name) => runInContext(read(name), ctx));
  runInContext(read("background.js"), ctx);
  const send = (msg) => new Promise((resolve) => {
    const keep = listeners[0](msg, { tab: { id: 1, url: "https://web.whatsapp.com/" }, frameId: 0 }, resolve);
    if (keep !== true) resolve(undefined);
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
  return { send, settle, store, offscreenMessages, tabMessages, calls, badge };
}

const appUp = (path) => {
  if (path === "/health") return { status: 200, body: { ok: true, ready: true, features: { summarize: true, translate: false } } };
  if (path === "/v1/settings") return { status: 200, body: {} };
  return { status: 200, body: { ok: true } };
};
const appDown = () => null;
const preloads = (t) => t.offscreenMessages.filter((m) => m.type === "WA_PRELOAD");

// A page load must not load Whisper while the app is the engine.
{
  const t = boot({ stored: { engineMode: "auto" }, app: appUp });
  const res = await t.send({ type: "WA_PRELOAD" });
  assert.equal(res.skipped, true);
  assert.equal(preloads(t).length, 0);
  assert.equal(t.store.companionActive, true);
  assert.equal(JSON.stringify(t.store.companionFeatures), JSON.stringify({ summarize: true, translate: false }));
}
{
  const t = boot({ stored: { engineMode: "companion" }, app: appDown });
  assert.equal((await t.send({ type: "WA_PRELOAD" })).skipped, true);
  assert.equal(preloads(t).length, 0);
}
// It does when the browser is what will run.
{
  const t = boot({ stored: { engineMode: "auto" }, app: appDown });
  assert.equal((await t.send({ type: "WA_PRELOAD" })).skipped, undefined);
  assert.equal(preloads(t).length, 1);
  assert.equal(t.store.companionActive, false);
}
{
  const t = boot({ stored: { engineMode: "browser" }, app: appUp });
  await t.send({ type: "WA_PRELOAD" });
  assert.equal(preloads(t).length, 1);
}
// Picking a model in the settings UI always downloads it.
{
  const t = boot({ stored: { engineMode: "companion" }, app: appUp });
  await t.send({ type: "WA_PRELOAD", modelId: "Xenova/whisper-medium" });
  assert.equal(preloads(t)[0].modelId, "Xenova/whisper-medium");
}

// While Parakeet is loading (503) the note waits for the app instead of
// falling back to Whisper.
{
  const t = boot({
    stored: { engineMode: "auto" },
    app: (path, _options, nth) => {
      if (path !== "/transcribe") return appUp(path);
      return nth < 3 ? { status: 503, body: { ok: false } } : { status: 200, body: { ok: true, text: "hola", audioSeconds: 2, transcribeMs: 90, words: [] } };
    },
  });
  await t.send({ type: "WA_TRANSCRIBE", requestId: "r1", audioBase64: "AAAA", mimeType: "audio/ogg" });
  for (let i = 0; i < 20 && !t.tabMessages.some((m) => m.type === "WA_RESULT"); i++) await t.settle();
  const result = t.tabMessages.find((m) => m.type === "WA_RESULT");
  assert.ok(result, "the note is transcribed by the app after it finishes loading");
  assert.equal(result.text, "hola");
  assert.equal(result.engine, "parakeet");
  assert.equal(t.calls.filter((p) => p === "/transcribe").length, 3);
  assert.equal(t.offscreenMessages.filter((m) => m.type === "WA_TRANSCRIBE").length, 0);
}
// App closed in Auto: the browser engine takes the note.
{
  const t = boot({ stored: { engineMode: "auto" }, app: appDown });
  await t.send({ type: "WA_TRANSCRIBE", requestId: "r2", audioBase64: "AAAA", mimeType: "audio/ogg" });
  for (let i = 0; i < 20 && !t.offscreenMessages.some((m) => m.type === "WA_TRANSCRIBE"); i++) await t.settle();
  const job = t.offscreenMessages.find((m) => m.type === "WA_TRANSCRIBE");
  assert.ok(job);
  assert.equal("polishEnabled" in job, false);
}

// Summary / translation requests reach the app and come back in the agreed shape.
{
  const t = boot({ app: (path) => (path === "/v1/text" ? { status: 200, body: { ok: true, text: "short" } } : appUp(path)) });
  assert.equal(JSON.stringify(await t.send({ type: "WA_TEXT_ACTION", action: "summarize", text: "x", targetLanguage: "en" })), JSON.stringify({ ok: true, text: "short" }));
  const down = boot({ app: appDown });
  const res = await down.send({ type: "WA_TEXT_ACTION", action: "translate", text: "x", targetLanguage: "en" });
  assert.equal(res.ok, false);
  assert.ok(res.error.length > 10);
}
// Audio goes to the app as raw bytes with the language and site in headers.
{
  let sent = null;
  const t = boot({
    stored: { engineMode: "companion", languageMode: "en" },
    app: (path, options) => {
      if (path !== "/transcribe") return appUp(path);
      sent = options;
      return { status: 200, body: { ok: true, text: "hi", audioSeconds: 1, transcribeMs: 5, words: [] } };
    },
  });
  await t.send({ type: "WA_TRANSCRIBE", requestId: "b1", audioBase64: "AQID", mimeType: "audio/ogg; codecs=opus", byteLength: 3 });
  for (let i = 0; i < 20 && !t.tabMessages.some((m) => m.type === "WA_RESULT"); i++) await t.settle();
  assert.ok(sent.body instanceof Uint8Array, "audio goes as bytes");
  assert.deepEqual([...sent.body], [1, 2, 3]);
  assert.equal(sent.headers["Content-Type"], "audio/ogg; codecs=opus");
  assert.equal(sent.headers["X-Language"], "en");
  assert.equal(sent.headers["X-Site"], "whatsapp");
}

// Cancel: a queued note never reaches the app; a running one is aborted,
// sends nothing back and does not fall back to Whisper.
{
  const hanging = [];
  const t = boot({
    stored: { engineMode: "auto" },
    app: (path, options) => {
      if (path !== "/transcribe") return appUp(path);
      return new Promise((resolve, reject) => {
        hanging.push(resolve);
        options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    },
  });
  await t.send({ type: "WA_TRANSCRIBE", requestId: "c1", audioBase64: "AAAA", mimeType: "audio/ogg" });
  await t.send({ type: "WA_TRANSCRIBE", requestId: "c2", audioBase64: "AAAA", mimeType: "audio/ogg" });
  for (let i = 0; i < 20 && hanging.length < 1; i++) await t.settle();
  assert.equal(hanging.length, 1, "c1 is running, c2 waits");

  await t.send({ type: "WA_CANCEL", requestId: "c2" });
  await t.send({ type: "WA_CANCEL", requestId: "c1" });
  for (let i = 0; i < 5; i++) await t.settle();
  const forC = (id) => t.tabMessages.filter((m) => m.requestId === id && m.type !== "WA_PROGRESS");
  assert.equal(forC("c1").length, 0, "nothing comes back for a cancelled note");
  assert.equal(forC("c2").length, 0);
  assert.equal(t.calls.filter((p) => p === "/transcribe").length, 1, "the queued note never ran");
  assert.equal(t.offscreenMessages.filter((m) => m.type === "WA_TRANSCRIBE").length, 0, "no Whisper fallback");

  // The queue keeps working afterwards.
  await t.send({ type: "WA_TRANSCRIBE", requestId: "c3", audioBase64: "AAAA", mimeType: "audio/ogg" });
  for (let i = 0; i < 20 && hanging.length < 2; i++) await t.settle();
  hanging[1]({ status: 200, body: { ok: true, text: "tres", words: [] } });
  for (let i = 0; i < 20 && !t.tabMessages.some((m) => m.requestId === "c3" && m.type === "WA_RESULT"); i++) await t.settle();
  assert.ok(t.tabMessages.some((m) => m.requestId === "c3" && m.type === "WA_RESULT"));
}
// Updates. A private build (no homepage_url) never asks GitHub.
const RELEASES = "/repos/0xKoller/TranscribeThem/releases/latest";
const release = { tag_name: "v0.6.0", html_url: "https://github.com/0xKoller/TranscribeThem/releases/tag/v0.6.0" };
{
  const t = boot({ app: appUp, manifest: { version: "0.5.0" } });
  for (let i = 0; i < 5; i++) await t.settle();
  assert.equal(t.calls.includes(RELEASES), false, "private builds never check");
  assert.equal((await t.send({ type: "WA_CHECK_UPDATES", force: true })).error, "no_channel");
  assert.equal(t.calls.includes(RELEASES), false);
}
// The public build checks once a day and shows a badge.
{
  const manifest = { version: "0.5.0", homepage_url: "https://github.com/0xKoller/TranscribeThem" };
  const t = boot({ app: (path) => (path === RELEASES ? { status: 200, body: release } : appUp(path)), manifest });
  for (let i = 0; i < 10 && !t.store.updateLatest; i++) await t.settle();
  assert.equal(t.store.updateLatest.version, "0.6.0");
  assert.equal(t.calls.filter((p) => p === RELEASES).length, 1);
  for (let i = 0; i < 5 && t.badge.text === ""; i++) await t.settle();
  assert.equal(t.badge.text, "↑");
  // Within the day nothing new goes out, unless the user asks.
  await t.send({ type: "WA_CHECK_UPDATES" });
  assert.equal(t.calls.filter((p) => p === RELEASES).length, 1);
  const res = await t.send({ type: "WA_CHECK_UPDATES", force: true });
  assert.equal(res.ok, true);
  assert.equal(res.notice.release.version, "0.6.0");
  assert.equal(t.calls.filter((p) => p === RELEASES).length, 2);
}
// The setting turns the automatic check off.
{
  const manifest = { version: "0.5.0", homepage_url: "https://github.com/0xKoller/TranscribeThem" };
  const t = boot({ stored: { checkUpdates: false }, app: (path) => (path === RELEASES ? { status: 200, body: release } : appUp(path)), manifest });
  for (let i = 0; i < 5; i++) await t.settle();
  assert.equal(t.calls.includes(RELEASES), false);
}
// A Chrome Web Store install is updated by Chrome and never checks.
{
  const manifest = { version: "0.5.0", homepage_url: "https://github.com/0xKoller/TranscribeThem", update_url: "https://clients2.google.com/service/update2/crx" };
  const t = boot({ app: (path) => (path === RELEASES ? { status: 200, body: release } : appUp(path)), manifest });
  for (let i = 0; i < 5; i++) await t.settle();
  assert.equal(t.calls.includes(RELEASES), false);
}
// The app passes on its update and its version; an older extension shows the badge.
{
  const health = { status: 200, body: { ok: true, ready: true, version: "0.6.0", update: { version: "0.7.0", url: "https://github.com/0xKoller/TranscribeThem/releases/tag/v0.7.0" } } };
  const t = boot({ app: (path) => (path === "/health" ? health : appUp(path)), manifest: { version: "0.5.0" } });
  await t.send({ type: "WA_CHECK_COMPANION" });
  assert.equal(t.store.appVersion, "0.6.0");
  assert.equal(t.store.appUpdate.version, "0.7.0");
  assert.equal(t.badge.text, "↑");
  // When the app goes away its notice goes with it.
  const down = boot({ stored: { appVersion: "0.6.0" }, app: appDown, manifest: { version: "0.5.0" } });
  await down.send({ type: "WA_CHECK_COMPANION" });
  assert.equal(down.store.appVersion, null);
  assert.equal(down.badge.text, "");
}
console.log("background.test.mjs ok");
