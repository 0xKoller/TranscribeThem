// The options page controls for auto-transcribe and remembered transcripts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { root, loadContentScripts } from "./helpers/fake-dom.mjs";

const html = readFileSync(join(root, "src", "options.html"), "utf8");
const optionsJs = readFileSync(join(root, "src", "options.js"), "utf8");
const settingsUi = readFileSync(join(root, "src", "settings-ui.js"), "utf8");

// Every id options.js asks for is in the page, and the page loads the cache script.
for (const m of optionsJs.matchAll(/getElementById\("([^"]+)"\)/g)) {
  assert.ok(html.includes(`id="${m[1]}"`), "options.html has no #" + m[1]);
}
assert.ok(html.indexOf('src="transcript-cache.js"') > 0);
assert.ok(html.indexOf('src="transcript-cache.js"') < html.indexOf('src="settings-ui.js"'));
const es = JSON.parse(readFileSync(join(root, "_locales", "es", "messages.json"), "utf8"));
assert.equal(es.optAutoTranscribe.message, "Transcribir sola cada nota de voz que aparece");
assert.equal(es.cacheTranscripts.message, "Recordar las transcripciones en este navegador");
assert.equal(es.clearTranscripts.message, "Borrar transcripciones guardadas");
assert.equal(es.optAutoHint.message, "El idioma se detecta en cada nota.");
assert.match(html, /data-i18n="optAutoTranscribe"/);
assert.match(html, /data-i18n="cacheTranscripts"/);
assert.match(html, /data-i18n="clearTranscripts"/);
assert.match(html, /id="auto-hint"[^>]*data-i18n="optAutoHint"/);
assert.match(html, /id="cache-transcripts" checked/);
assert.doesNotMatch(html, /id="auto-transcribe" checked/);
assert.doesNotMatch(html + optionsJs + settingsUi, /polish/i);

async function openOptions(storage) {
  const page = loadContentScripts(
    ["src/i18n.js", "src/messages.js", "src/settings.js", "src/transcript-cache.js", "src/settings-ui.js"],
    "chrome-extension://test/src/options.html",
    { storage }
  );
  let pushes = 0;
  page.ctx.waPushCompanionSettings = async () => {
    pushes += 1;
  };
  const make = (tag) => page.document.createElement(tag);
  const els = {
    autoTranscribeEl: make("input"),
    cacheTranscriptsEl: make("input"),
    clearTranscriptsBtn: make("button"),
    clearTranscriptsStatusEl: make("span"),
  };
  els.clearTranscriptsStatusEl.hidden = true;
  els.cacheTranscriptsEl.checked = true;
  await page.ctx.waInitSettingsUi(els);
  await page.settle();
  return { page, els, pushes: () => pushes };
}

const SAVED = { "whatsapp:m1": { text: "guardada", words: [], engine: "", transcribeMs: 0, savedAt: 1, usedAt: 1 } };

// Defaults: auto off, remember on.
{
  const { els } = await openOptions({});
  assert.equal(els.autoTranscribeEl.checked, false);
  assert.equal(els.cacheTranscriptsEl.checked, true);
}

{
  const { page, els, pushes } = await openOptions({ autoTranscribe: true, cacheTranscripts: false, transcriptCache: SAVED });
  assert.equal(els.autoTranscribeEl.checked, true);
  assert.equal(els.cacheTranscriptsEl.checked, false);

  // Auto-transcribe is stored locally and is not sent to the Mac app.
  els.autoTranscribeEl.checked = false;
  els.autoTranscribeEl.fire("change");
  await page.settle();
  assert.equal(page.store.autoTranscribe, false);
  assert.equal(pushes(), 0);

  // Turning "remember" on keeps what is there.
  els.cacheTranscriptsEl.checked = true;
  els.cacheTranscriptsEl.fire("change");
  await page.settle();
  assert.equal(page.store.cacheTranscripts, true);
  assert.deepEqual(Object.keys(page.store.transcriptCache), ["whatsapp:m1"]);
  assert.equal(els.clearTranscriptsStatusEl.hidden, true);

  // The button empties the cache and says so, then the note goes away.
  els.clearTranscriptsBtn.fire("click");
  await page.settle();
  assert.deepEqual(page.store.transcriptCache, {});
  assert.equal(els.clearTranscriptsStatusEl.hidden, false);
  assert.equal(els.clearTranscriptsStatusEl.textContent, "Transcripciones borradas.");
  assert.equal(page.store.cacheTranscripts, true, "the button does not change the preference");
  page.runTimers(5000);
  assert.equal(els.clearTranscriptsStatusEl.hidden, true);

  // Turning "remember" off empties the cache too.
  await page.chrome.storage.local.set({ transcriptCache: SAVED });
  els.cacheTranscriptsEl.checked = false;
  els.cacheTranscriptsEl.fire("change");
  await page.settle();
  assert.equal(page.store.cacheTranscripts, false);
  assert.deepEqual(page.store.transcriptCache, {});
  assert.equal(els.clearTranscriptsStatusEl.textContent, "Transcripciones borradas.");
  assert.equal(pushes(), 0);

  // A change made elsewhere (another options tab) shows up here.
  await page.chrome.storage.local.set({ autoTranscribe: true, cacheTranscripts: true });
  assert.equal(els.autoTranscribeEl.checked, true);
  assert.equal(els.cacheTranscriptsEl.checked, true);
}

console.log("options-ui.test.mjs ok");
