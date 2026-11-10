// Locale catalogs, key coverage, and language-independent error classification.
import { readFileSync, readdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromeI18n } from "./helpers/i18n-chrome.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const es = JSON.parse(readFileSync(join(root, "_locales", "es", "messages.json"), "utf8"));
const en = JSON.parse(readFileSync(join(root, "_locales", "en", "messages.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

const esKeys = Object.keys(es).sort();
const enKeys = Object.keys(en).sort();
assert.deepEqual(esKeys, enKeys, "es and en must list the same keys");
assert.equal(manifest.default_locale, "en");

const accent = /[áéíóúñÁÉÍÓÚÑ¿¡]/;
function placeholderNames(entry) {
  const fromField = Object.keys(entry.placeholders || {}).map((name) => name.toUpperCase()).sort();
  const fromMessage = [...String(entry.message).matchAll(/\$([A-Z0-9_]+)\$/g)].map((m) => m[1]).sort();
  return { fromField, fromMessage };
}

for (const key of esKeys) {
  assert.equal(typeof es[key].message, "string", key);
  assert.equal(typeof en[key].message, "string", key);
  assert.ok(es[key].message.length > 0, "empty es message " + key);
  assert.ok(en[key].message.length > 0, "empty en message " + key);
  const esPh = placeholderNames(es[key]);
  const enPh = placeholderNames(en[key]);
  assert.deepEqual(esPh.fromField, enPh.fromField, "placeholder names differ for " + key);
  assert.deepEqual(esPh.fromField, esPh.fromMessage, "es placeholder tokens differ for " + key);
  assert.deepEqual(enPh.fromField, enPh.fromMessage, "en placeholder tokens differ for " + key);
}

function filesNamed(dir, ext) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(ext) && name !== "offscreen.bundle.js")
    .map((name) => join(dir, name));
}

const sources = [
  ...filesNamed(join(root, "src"), ".js"),
  ...filesNamed(join(root, "src"), ".html"),
  join(root, "manifest.json"),
];

const used = new Set();
for (const file of sources) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/waT\(\s*["']([A-Za-z0-9_]+)["']/g)) used.add(match[1]);
  for (const match of text.matchAll(/data-i18n="([A-Za-z0-9_]+)"/g)) used.add(match[1]);
  for (const match of text.matchAll(/data-i18n-attr="([^"]*)"/g)) {
    for (const part of match[1].split(/[;,]/)) {
      const idx = part.indexOf(":");
      if (idx > 0) used.add(part.slice(idx + 1).trim());
    }
  }
  for (const match of text.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) used.add(match[1]);
}

const missing = [...used].filter((key) => !es[key] || !en[key]).sort();
assert.deepEqual(missing, [], "referenced keys missing from locales");
const unused = esKeys.filter((key) => !used.has(key));
assert.deepEqual(unused, [], "locale keys not referenced from the extension");

// Strings that must stay Spanish: MAIN-world debug (no chrome.i18n) and
// WhatsApp's own aria-labels, which the content script matches, not displays.
const ALLOW = [
  { file: "src/page-hook.js", includes: "no arrancó" },
  { file: "src/content-whatsapp.js", includes: "Leído" },
];

function spanishLiterals(src) {
  const found = [];
  let i = 0;
  let last = "";
  const lineAt = (idx) => src.slice(0, idx).split("\n").length;
  while (i < src.length) {
    const ch = src[i];
    const two = src.slice(i, i + 2);
    if (two === "//") {
      while (i < src.length && src[i] !== "\n") i += 1;
    } else if (two === "/*") {
      i += 2;
      while (i < src.length && !src.startsWith("*/", i)) i += 1;
      i += 2;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      const start = i;
      i += 1;
      let body = "";
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") {
          body += src.slice(i, i + 2);
          i += 2;
        } else {
          body += src[i];
          i += 1;
        }
      }
      i += 1;
      if (accent.test(body)) found.push({ line: lineAt(start), text: body });
      last = quote;
    } else if (ch === "/" && (last === "" || "(,=:[!&|?{};\n".includes(last))) {
      i += 1;
      let inClass = false;
      while (i < src.length) {
        if (src[i] === "\\") i += 2;
        else if (src[i] === "[") {
          inClass = true;
          i += 1;
        } else if (src[i] === "]") {
          inClass = false;
          i += 1;
        } else if (src[i] === "/" && !inClass) break;
        else i += 1;
      }
      i += 1;
      while (/[a-z]/.test(src[i] || "")) i += 1;
      last = "0";
    } else {
      if (!/[ \t]/.test(ch)) last = ch;
      i += 1;
    }
  }
  return found;
}

const leftovers = [];
for (const file of sources) {
  if (!file.endsWith(".js") && !file.endsWith(".html")) continue;
  const rel = file.slice(root.length + 1);
  const text = readFileSync(file, "utf8");
  const hits = file.endsWith(".html")
    ? text.split("\n").flatMap((line, index) => (accent.test(line) ? [{ line: index + 1, text: line.trim() }] : []))
    : spanishLiterals(text);
  for (const hit of hits) {
    const line = text.split("\n")[hit.line - 1] || "";
    const allowed = ALLOW.some((item) => rel === item.file && line.includes(item.includes));
    if (!allowed) leftovers.push(rel + ":" + hit.line + ":" + hit.text.slice(0, 80));
  }
}
assert.deepEqual(leftovers, [], "Spanish user-facing literals left in src");

function bootErrors(locale) {
  const ctx = createContext({ globalThis: {}, chrome: { i18n: chromeI18n(locale) } });
  ctx.globalThis = ctx;
  runInContext(readFileSync(join(root, "src", "i18n.js"), "utf8"), ctx);
  runInContext(readFileSync(join(root, "src", "errors.js"), "utf8"), ctx);
  return ctx;
}

const english = bootErrors("en");
assert.equal(english.waJobErrorCode(new Error(english.mapError(null, "NO_AUDIO"))), "no_audio");
assert.equal(english.waJobErrorCode(new Error(english.mapError(null, "DECODE"))), "decode");
assert.equal(english.waJobErrorCode(new Error(english.mapError(null, "GENERIC"))), "generic");
assert.equal(english.waJobErrorCode(new Error(english.waT("modelStillLoading"))), "model_loading");
assert.equal(english.waJobErrorCode(new Error(english.waT("errDownload"))), "generic");
assert.equal(english.mapError(new Error(english.waT("errReload"))), english.WA_ERROR_COPY.RELOAD);
assert.equal(english.mapError(new Error(english.waT("errNoAudio"))), english.WA_ERROR_COPY.NO_AUDIO);
assert.equal(english.mapError(new Error(english.waT("extReloadedWa"))), english.WA_ERROR_COPY.RELOAD);
assert.match(english.mapError(null, "GENERIC"), /Retry/);
assert.doesNotMatch(english.mapError(null, "GENERIC"), /Reintentar/);

const spanish = bootErrors("es");
assert.equal(spanish.waJobErrorCode(new Error(spanish.waT("modelStillLoading"))), "model_loading");
assert.equal(spanish.waJobErrorCode(new Error("No pude bajar este audio. Reintentá.")), "no_audio");
assert.match(spanish.mapError(null, "GENERIC"), /Reintentar/);

// Fallback loader: no chrome.i18n, fetch reads the real catalogs.
function bootFallback(lang) {
  const ctx = createContext({
    navigator: { language: lang },
    chrome: { runtime: { getURL: (path) => "ext://" + path } },
    fetch: async (url) => {
      const rel = String(url).replace(/^ext:\/\//, "");
      return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(join(root, rel), "utf8")) };
    },
  });
  ctx.globalThis = ctx;
  runInContext(readFileSync(join(root, "src", "i18n.js"), "utf8"), ctx);
  return ctx;
}

const fallbackEn = bootFallback("en");
assert.equal(await fallbackEn.waI18nInit("en"), "en");
assert.equal(fallbackEn.waT("transcribe"), "Transcribe");
assert.equal(fallbackEn.waT("errGeneric"), "Transcription failed. Tap Retry.");
assert.equal(fallbackEn.waT("badgeParakeetMs", 12), "⚡ Local Parakeet (12 ms)");

const fallbackEs = bootFallback("es-AR");
assert.equal(await fallbackEs.waI18nInit("es-AR"), "es");
assert.equal(fallbackEs.waT("transcribe"), "Transcribir");
assert.equal(fallbackEs.waT("retry"), "Reintentar");
assert.equal(fallbackEs.waT("errReload"), "Recargá la pestaña de WhatsApp Web.");
assert.notEqual(fallbackEs.waT("transcribe"), "");

console.log("fallback en:", fallbackEn.waT("transcribe"), "|", fallbackEn.waT("openSettings"));
console.log("fallback es-AR:", fallbackEs.waT("transcribe"), "|", fallbackEs.waT("openSettings"));
console.log("i18n.test.mjs ok", esKeys.length, "keys");
