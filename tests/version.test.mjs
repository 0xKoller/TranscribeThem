import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

// manifest.json is the single source of the version. package.json follows it,
// and the Mac app bundle is stamped from it at packaging time.
const read = (name) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));
const manifest = read("manifest.json");
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(read("package.json").version, manifest.version);
assert.equal(read("package-lock.json").version, manifest.version);
console.log("version.test.mjs ok");
