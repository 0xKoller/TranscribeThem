import assert from "node:assert/strict";
import { downloadPct } from "../src/download-progress.js";

const encoder = { loaded: 400, total: 800 * 1024 * 1024 };
assert.equal(downloadPct(new Map([["enc", encoder]]), 0), 0);

const encHalf = { loaded: 400 * 1024 * 1024, total: 800 * 1024 * 1024 };
const onlyEnc = downloadPct(new Map([["enc", encHalf]]), 0);
assert.ok(onlyEnc <= 49, `encoder-only should stay under 50, got ${onlyEnc}`);
assert.equal(onlyEnc, 25);

const encDone = { loaded: 800 * 1024 * 1024, total: 800 * 1024 * 1024 };
assert.equal(downloadPct(new Map([["enc", encDone]]), 25), 49);

const both = new Map([
  ["enc", encDone],
  ["dec", { loaded: 0, total: 800 * 1024 * 1024 }],
]);
assert.equal(downloadPct(both, 49), 50);

const bothLater = new Map([
  ["enc", encDone],
  ["dec", { loaded: 400 * 1024 * 1024, total: 800 * 1024 * 1024 }],
]);
assert.equal(downloadPct(bothLater, 50), 75);
assert.equal(downloadPct(bothLater, 80), 80);

const tiny = new Map([["tok", { loaded: 2e6, total: 2e6 }]]);
assert.equal(downloadPct(tiny, 0), 0);

console.log("download-progress.test.mjs ok");
