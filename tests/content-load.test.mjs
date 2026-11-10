// The content script is several classic scripts that share one global scope.
// Nothing links them, so a function moved to the wrong file only fails in the
// browser. This test is the stand-in: it runs each manifest entry's files in
// manifest order, calls start(), and checks that every bare name the files use
// is declared by a file of the same entry.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { root, manifestEntry, loadContentScripts } from "./helpers/fake-dom.mjs";

const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const waFiles = manifestEntry("web.whatsapp.com");
const xFiles = manifestEntry("x.com");

// Every listed file exists, src/content.js is gone, and the order is the one
// the files assume.
for (const entry of manifest.content_scripts) {
  for (const file of entry.js) assert.ok(existsSync(join(root, file)), file + " is in the manifest and missing on disk");
}
assert.equal(existsSync(join(root, "src", "content.js")), false);
assert.deepEqual(waFiles.slice(-5), [
  "src/transcript-cache.js",
  "src/content-core.js",
  "src/content-features.js",
  "src/content-whatsapp.js",
  "src/content-main.js",
]);
assert.deepEqual(xFiles.slice(-6), [
  "src/transcript-cache.js",
  "src/content-core.js",
  "src/content-features.js",
  "src/content-whatsapp.js",
  "src/content-x.js",
  "src/content-main.js",
]);
assert.ok(!waFiles.includes("src/content-x.js"), "the WhatsApp entry must not load the X file");
assert.ok(!waFiles.includes("src/x-find.js"));
assert.ok(xFiles.indexOf("src/x-find.js") < xFiles.indexOf("src/content-core.js"));

/* ---- static: names resolve inside the entry ---- */

// Source with comments, strings, templates and regex literals blanked out.
function codeOnly(src) {
  let out = "";
  let i = 0;
  let last = "";
  const skipTo = (end) => {
    while (i < src.length && !src.startsWith(end, i)) i += src[i] === "\\" ? 2 : 1;
    i += end.length;
  };
  while (i < src.length) {
    const ch = src[i];
    const two = src.slice(i, i + 2);
    if (two === "//") {
      while (i < src.length && src[i] !== "\n") i += 1;
    } else if (two === "/*") {
      i += 2;
      skipTo("*/");
    } else if (ch === '"' || ch === "'" || ch === "`") {
      i += 1;
      skipTo(ch);
      out += '""';
      last = '"';
    } else if (ch === "/" && (last === "" || "(,=:[!&|?{};\n".includes(last))) {
      i += 1;
      let inClass = false;
      while (i < src.length) {
        if (src[i] === "\\") i += 2;
        else if (src[i] === "[") (inClass = true), (i += 1);
        else if (src[i] === "]") (inClass = false), (i += 1);
        else if (src[i] === "/" && !inClass) break;
        else i += 1;
      }
      i += 1;
      while (/[a-z]/.test(src[i] || "")) i += 1;
      out += "0";
      last = "0";
    } else {
      out += ch;
      if (!/[ \t]/.test(ch)) last = ch;
      i += 1;
    }
  }
  return out;
}

function topLevelNames(code) {
  const names = new Set();
  for (const m of code.matchAll(/^(?:async function|function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  return names;
}

// Anything a file declares at any depth: functions, variables, parameters.
function declaredAnywhere(code) {
  const names = new Set();
  const addList = (list) => {
    for (const part of list.split(",")) {
      const m = part.replace(/[{}[\]]/g, " ").trim().match(/^(?:\.\.\.)?([A-Za-z_$][\w$]*)/);
      if (m) names.add(m[1]);
    }
  };
  for (const m of code.matchAll(/\bfunction\s*([A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/g)) {
    if (m[1]) names.add(m[1]);
    addList(m[2]);
  }
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of code.matchAll(/\b(?:const|let|var)\s+[{[]([^=]*)[}\]]\s*=/g)) addList(m[1]);
  for (const m of code.matchAll(/\(([^()]*)\)\s*=>/g)) addList(m[1]);
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) names.add(m[1]);
  for (const m of code.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  return names;
}

function bareCalls(code) {
  const names = new Set();
  for (const m of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) names.add(m[1]);
  return names;
}

const KEYWORDS = ["if", "for", "while", "switch", "catch", "function", "return", "typeof", "await", "async", "new", "void"];
const BROWSER = [
  "String", "Number", "Boolean", "Object", "Array", "Set", "Map", "WeakMap", "WeakSet", "Promise", "Error", "Date", "Math",
  "JSON", "URL", "Blob", "Uint8Array", "parseInt", "parseFloat", "atob", "setTimeout", "clearTimeout", "setInterval",
  "clearInterval", "requestAnimationFrame", "getComputedStyle", "MutationObserver", "IntersectionObserver", "CSSStyleSheet",
];
// Globals that the files loaded before the content script put on globalThis.
const LIBRARY = ["mapError", "waGetSettings", "waSiteId", "waSiteEnabled", "waT"];

const code = {};
for (const file of new Set([...waFiles, ...xFiles])) code[file] = codeOnly(readFileSync(join(root, file), "utf8"));
const contentFiles = (files) => files.filter((file) => /\/content-[a-z]+\.js$/.test(file));

function unresolvedCalls(files) {
  const known = new Set([...KEYWORDS, ...BROWSER, ...LIBRARY]);
  for (const file of contentFiles(files)) for (const name of declaredAnywhere(code[file])) known.add(name);
  const missing = [];
  for (const file of contentFiles(files)) {
    for (const name of bareCalls(code[file])) if (!known.has(name)) missing.push(file + ": " + name);
  }
  return missing.sort();
}

// The X entry loads every file, so every call must resolve.
assert.deepEqual(unresolvedCalls(xFiles), []);

// The WhatsApp entry does not load content-x.js. The shared files do name
// X-only functions and state, each behind an isXSite() or data-site="x" check
// that was read by a person. This list is that audit: a new name here means a
// new reference from a shared file into content-x.js. Check its guard, then
// add it.
const X_ONLY_USED_BY_SHARED = [
  "src/content-core.js: keepXFootOutOfTranscript",
  "src/content-core.js: noteXAdded",
  "src/content-core.js: placeXTranscript",
  "src/content-core.js: rescueXFoot",
  "src/content-core.js: scheduleLooseXFeet",
  "src/content-core.js: xBootScan",
  "src/content-features.js: refitXTranscript",
  "src/content-features.js: xRowId",
  "src/content-main.js: onXScroll",
  "src/content-main.js: paintXDebug",
  "src/content-main.js: pruneShadows",
  "src/content-main.js: xNoteNavigation",
  "src/content-main.js: xRememberPath",
  "src/content-main.js: xSeenPath",
  "src/content-whatsapp.js: findXVoiceContainers",
  "src/content-whatsapp.js: injectX",
  "src/content-whatsapp.js: placeXTools",
];
const xOnly = topLevelNames(code["src/content-x.js"]);
const sharedIntoX = [];
for (const file of contentFiles(waFiles)) {
  for (const name of xOnly) {
    if (new RegExp("(?<![.\\w$])" + name.replace(/\$/g, "\\$") + "(?![\\w$])").test(code[file])) sharedIntoX.push(file + ": " + name);
  }
}
assert.deepEqual(sharedIntoX.sort(), X_ONLY_USED_BY_SHARED);
// Apart from those audited names, the WhatsApp entry resolves on its own.
const allowed = new Set(X_ONLY_USED_BY_SHARED);
assert.deepEqual(unresolvedCalls(waFiles).filter((item) => !allowed.has(item)), []);

// No top-level name is declared twice across the files of an entry: a second
// `const` would be a SyntaxError in the browser, a second function would
// silently replace the first.
for (const files of [waFiles, xFiles]) {
  const seen = new Map();
  for (const file of contentFiles(files)) {
    for (const name of topLevelNames(code[file])) {
      assert.ok(!seen.has(name), name + " is declared in " + seen.get(name) + " and " + file);
      seen.set(name, file);
    }
  }
}

/* ---- dynamic: evaluate each entry and call start() ---- */

const BROKEN = /ReferenceError|SyntaxError|is not defined|x debug|before initialization/;

async function boot(files, href, storage) {
  // loadContentScripts throws on a SyntaxError or a ReferenceError at load.
  const page = loadContentScripts(files, href, { storage });
  await page.settle();
  page.runTimers();
  await page.settle();
  // start() and scan() catch their own errors and log them: read the log.
  assert.deepEqual(page.logs.filter((line) => BROKEN.test(line)), [], href);
  assert.ok(page.logs.some((line) => line.includes("content script ready")), href + ": start() did not finish");
  return page;
}

for (const storage of [{}, { autoTranscribe: true, companionActive: true, cacheTranscripts: false, debugMode: true }]) {
  const wa = await boot(waFiles, "https://web.whatsapp.com/", storage);
  assert.equal(typeof wa.ctx.start, "function");
  assert.equal(typeof wa.ctx.WaFind.findVoiceContainers, "function");
  assert.equal(typeof wa.ctx.WaFind.messageBubbleFrom, "function");
  assert.ok(Array.isArray(wa.ctx.WaFind.SELECTORS.playIcon));
  assert.equal(wa.ctx.WaFind.SELECTORS, wa.evaluate("SELECTORS"));
  assert.equal(wa.ctx.isXSite(), false);
  assert.equal(typeof wa.ctx.injectX, "undefined", "X code leaked into the WhatsApp entry");
  assert.equal(wa.evaluate("siteOn"), true);
  assert.equal(wa.evaluate("notePrefs.ready"), true);
  // start() ran once at load. It can be called again without throwing.
  assert.doesNotThrow(() => wa.ctx.start());
  await wa.settle();
  assert.deepEqual(wa.logs.filter((line) => BROKEN.test(line)), []);
  // The service worker is asked to preload. No tab polls the Mac app.
  assert.ok(wa.sent.some((msg) => msg.type === "WA_PRELOAD"));
  assert.ok(!wa.sent.some((msg) => msg.type === "WA_CHECK_COMPANION"));

  for (const href of ["https://x.com/i/chat", "https://x.com/home"]) {
    const x = await boot(xFiles, href, storage);
    assert.equal(x.ctx.isXSite(), true);
    assert.equal(typeof x.ctx.injectX, "function");
    assert.equal(typeof x.ctx.WaXFind.xDiscoverWaves, "function");
    assert.equal(typeof x.ctx.WaFind.findVoiceContainers, "function");
    assert.doesNotThrow(() => x.ctx.start());
    await x.settle();
    assert.deepEqual(x.logs.filter((line) => BROKEN.test(line)), []);
    assert.ok(!x.sent.some((msg) => msg.type === "WA_CHECK_COMPANION"));
  }
}

// WhatsApp turned off in settings: start() still runs, nothing is scanned.
const off = await boot(waFiles, "https://web.whatsapp.com/", { sites: { whatsapp: false, x: true } });
assert.equal(off.evaluate("siteOn"), false);

console.log("content-load.test.mjs ok");
