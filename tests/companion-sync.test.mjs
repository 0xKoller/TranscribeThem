import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromeI18n } from "./helpers/i18n-chrome.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src", "companion-sync.js"), "utf8");
const i18n = readFileSync(join(root, "src", "i18n.js"), "utf8");

function loadCompanion(extra) {
  const ctx = createContext({ chrome: { i18n: chromeI18n("es") }, ...extra });
  ctx.globalThis = ctx;
  runInContext(i18n, ctx);
  runInContext(src, ctx);
  return ctx;
}

const ctx = loadCompanion({});

assert.equal(ctx.waCompanionSyncPlan(0, 100), "push");
assert.equal(ctx.waCompanionSyncPlan(50, 100), "pull");
assert.equal(ctx.waCompanionSyncPlan(200, 100), "push");
assert.equal(ctx.waCompanionSyncPlan(100, 100), "keep");
assert.equal(typeof ctx.waPushCompanionSettings, "function");
assert.equal(typeof ctx.waReportCompanionJob, "function");
assert.match(src, /engineMode/);
assert.match(src, /highlightWords/);
assert.match(src, /sites/);
assert.match(src, /errorCode/);
for (const enabled of [true, false, "unavailable"]) {
  const posted = [];
  const testContext = loadCompanion({
    URL, AbortSignal,
    waGetSettings: async () => ({ companionPort: 8765 }),
    fetch: async (url, options = {}) => {
      if (url.endsWith("/v1/settings")) {
        if (enabled === "unavailable") throw new Error("offline");
        return { ok: true, json: async () => ({ settings: { saveTranscripts: enabled } }) };
      }
      assert.ok(url.startsWith("http://127.0.0.1:8765/"));
      posted.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  await testContext.waReportCompanionJob({ ok: true, transcript: "local private text", site: "x" });
  assert.equal(posted.length, 1);
  assert.equal(posted[0].site, "x");
  assert.equal(posted[0].transcript, enabled === true ? "local private text" : undefined);
}

// Timeout grows with the note and stays inside [20 s, 180 s].
assert.equal(ctx.waCompanionTimeoutMs(0), 20000);
assert.equal(ctx.waCompanionTimeoutMs(undefined), 20000);
assert.equal(ctx.waCompanionTimeoutMs(2000 * 120), 80000);
assert.equal(ctx.waCompanionTimeoutMs(2000 * 3600), 180000);

// Summary / translation through the app.
async function textAction(fetchImpl, action = "summarize") {
  const c = loadCompanion({
    URL, AbortSignal,
    waGetSettings: async () => ({ companionPort: 8765 }),
    fetch: fetchImpl,
  });
  return c.waCompanionTextAction(action, "hola mundo", "en");
}
let sent = null;
const good = await textAction(async (url, options) => {
  sent = { url, body: JSON.parse(options.body) };
  return { ok: true, status: 200, json: async () => ({ ok: true, text: " resumen " }) };
});
assert.equal(sent.url, "http://127.0.0.1:8765/v1/text");
assert.equal(JSON.stringify(sent.body), JSON.stringify({ action: "summarize", text: "hola mundo", targetLanguage: "en" }));
assert.equal(good.ok, true);
assert.equal(good.text, "resumen");
const unavailable = await textAction(async () => ({ ok: false, status: 501, json: async () => ({ ok: false, code: "unavailable" }) }));
assert.equal(unavailable.ok, false);
assert.equal(unavailable.code, "unavailable");
assert.ok(unavailable.error.length > 10);
// An older app has no /v1/text route.
const old = await textAction(async () => ({ ok: false, status: 404, json: async () => ({ ok: false, error: "Not Found" }) }));
assert.equal(old.code, "unavailable");
const offline = await textAction(async () => { throw new Error("Failed to fetch"); });
assert.equal(offline.code, "offline");
const bad = await textAction(async () => { throw new Error("must not be called"); }, "delete");
assert.equal(bad.code, "bad_request");
const empty = await textAction(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, text: "  " }) }));
assert.equal(empty.ok, false);
console.log("companion-sync.test.mjs ok");
