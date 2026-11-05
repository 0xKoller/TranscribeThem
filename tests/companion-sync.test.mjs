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
console.log("companion-sync.test.mjs ok");
