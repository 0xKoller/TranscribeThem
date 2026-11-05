import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src", "companion-sync.js"), "utf8");
const ctx = createContext({ globalThis: {} });
ctx.globalThis = ctx;
runInContext(src, ctx);

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
  const testContext = createContext({
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
  runInContext(src, testContext);
  await testContext.waReportCompanionJob({ ok: true, transcript: "local private text", site: "x" });
  assert.equal(posted.length, 1);
  assert.equal(posted[0].site, "x");
  assert.equal(posted[0].transcript, enabled === true ? "local private text" : undefined);
}
console.log("companion-sync.test.mjs ok");
