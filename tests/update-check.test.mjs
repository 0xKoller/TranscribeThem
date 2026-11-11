import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import assert from "node:assert/strict";

const ctx = createContext({ URL });
ctx.globalThis = ctx;
runInContext(readFileSync(new URL("../src/update-check.js", import.meta.url), "utf8"), ctx);
const g = ctx;

assert.deepEqual([...g.waVersionParts("v0.5.0")], [0, 5, 0]);
assert.deepEqual([...g.waVersionParts("1.2.3-beta")], [1, 2, 3]);
assert.equal(g.waVersionParts("dev"), null);
assert.equal(g.waVersionParts(""), null);
assert.equal(g.waVersionParts("1..2"), null);

assert.equal(g.waIsNewerVersion("0.6.0", "0.5.0"), true);
assert.equal(g.waIsNewerVersion("v0.10.0", "0.9.9"), true);
assert.equal(g.waIsNewerVersion("1.0.1", "1.0"), true);
assert.equal(g.waIsNewerVersion("0.5.0", "0.5"), false);
assert.equal(g.waIsNewerVersion("0.5.0", "dev"), false);

// Channel: only a manifest with a GitHub homepage_url and no update_url checks.
assert.equal(g.waUpdateRepo({ homepage_url: "https://github.com/0xKoller/TranscribeThem" }), "0xKoller/TranscribeThem");
assert.equal(g.waUpdateRepo({ homepage_url: "https://github.com/0xKoller/TranscribeThem/" }), "0xKoller/TranscribeThem");
assert.equal(g.waUpdateRepo({}), null, "private builds never check");
assert.equal(g.waUpdateRepo({ homepage_url: "https://github.com/a/b", update_url: "https://clients2.google.com/service/update2/crx" }), null);
assert.equal(g.waUpdateRepo({ homepage_url: "https://example.com/a/b" }), null);
assert.equal(g.waUpdateRepo({ homepage_url: "https://github.com/a/b/c" }), null);
assert.equal(g.waUpdateRepo({ homepage_url: "https://github.com/../b" }), null);

const page = "https://github.com/a/b/releases/tag/v0.6.0";
assert.deepEqual({ ...g.waParseRelease({ tag_name: "v0.6.0", html_url: page }) }, { version: "0.6.0", url: page });
assert.equal(g.waParseRelease({ tag_name: "v0.6.0", html_url: page, prerelease: true }), null);
assert.equal(g.waParseRelease({ tag_name: "v0.6.0", html_url: page, draft: true }), null);
assert.equal(g.waParseRelease({ tag_name: "v0.6.0", html_url: "https://evil.example/x" }), null);
assert.equal(g.waParseRelease({ tag_name: "latest", html_url: page }), null);
assert.equal(g.waNormalizeAppUpdate({ version: "0.6.0", url: "javascript:alert(1)" }), null);
assert.deepEqual({ ...g.waNormalizeAppUpdate({ version: "0.6.0", url: page }) }, { version: "0.6.0", url: page });

const day = g.WA_UPDATE_INTERVAL_MS;
assert.equal(g.waUpdateDue(0, 1000), true);
assert.equal(g.waUpdateDue(1000, 1000 + day - 1), false);
assert.equal(g.waUpdateDue(1000, 1000 + day), true);
assert.equal(g.waUpdateDue(5000, 1000), true, "a check in the future is due");

const rel = (version) => ({ version, url: page });
assert.equal(g.waUpdateNotice({ current: "0.6.0", own: rel("0.6.0") }), null);
assert.equal(g.waUpdateNotice({ current: "0.5.0", own: rel("0.6.0") }).release.version, "0.6.0");
assert.equal(g.waUpdateNotice({ current: "0.5.0", own: rel("0.6.0"), fromApp: rel("0.7.0") }).release.version, "0.7.0", "the newest wins");
const behind = g.waUpdateNotice({ current: "0.5.0", appVersion: "0.6.0" });
assert.equal(behind.release, null);
assert.equal(behind.extensionBehind, true);
assert.equal(behind.appVersion, "0.6.0");
assert.equal(g.waUpdateNotice({ current: "0.6.0", appVersion: "0.5.0" }), null);
assert.equal(g.waUpdateNotice({ current: "0.5.0", appVersion: "dev" }), null);

console.log("update-check.test.mjs ok");
