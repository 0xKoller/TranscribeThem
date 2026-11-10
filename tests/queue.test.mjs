import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src", "queue.js"), "utf8");
const ctx = createContext({});
ctx.globalThis = ctx;
runInContext(src, ctx);
const { createSerialQueue } = ctx;

const q = createSerialQueue();
const order = [];
let maxParallel = 0;
let current = 0;

function job(id, ms) {
  return q.push({ id }, async () => {
    current += 1;
    maxParallel = Math.max(maxParallel, current);
    order.push(`start-${id}`);
    await new Promise((r) => setTimeout(r, ms));
    order.push(`end-${id}`);
    current -= 1;
    return id;
  });
}

const results = await Promise.all([job("a", 40), job("b", 10), job("c", 10)]);
assert.deepEqual(results, ["a", "b", "c"]);
assert.deepEqual(order, ["start-a", "end-a", "start-b", "end-b", "start-c", "end-c"]);
assert.equal(maxParallel, 1);
assert.equal(q.busy, false);
assert.equal(q.pending, 0);
// A queued job can be cancelled before it starts; the running one cannot.
{
  const ran = [];
  const first = q.push({ id: "x" }, async () => { ran.push("x"); await new Promise((r) => setTimeout(r, 20)); return "x"; });
  const second = q.push({ id: "y" }, async () => { ran.push("y"); return "y"; });
  assert.equal(q.cancel((j) => j.id === "x"), false);
  assert.equal(q.cancel((j) => j.id === "y"), true);
  assert.equal(q.cancel((j) => j.id === "y"), false);
  assert.equal(await second, null);
  assert.equal(await first, "x");
  assert.deepEqual(ran, ["x"]);
}
console.log("queue.test.mjs ok");
