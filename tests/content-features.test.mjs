// Remembered transcripts, auto-transcribe, and the summary and translation
// actions, run against the real content-script files in a fake DOM.
import assert from "node:assert/strict";
import { manifestEntry, loadContentScripts } from "./helpers/fake-dom.mjs";

const waFiles = manifestEntry("web.whatsapp.com");
const xFiles = manifestEntry("x.com");
const LONG = Array.from({ length: 70 }, (_, i) => "palabra" + i).join(" ");
const WORDS = [
  { text: "hola", start: 0, end: 0.4 },
  { text: "che", start: 0.5, end: 0.9 },
];

async function openPage(storage, respond, files = waFiles, href = "https://web.whatsapp.com/") {
  const page = loadContentScripts(files, href, { storage, respond });
  await page.settle();
  // A WhatsApp voice note the way the content script leaves it after inject():
  // a wrap whose shell sits inside the row that carries data-id.
  page.addNote = (id) => {
    const row = page.document.createElement("div");
    if (id) row.setAttribute("data-id", id);
    const shell = page.document.createElement("div");
    row.append(shell);
    page.document.body.append(row);
    const wrap = page.ctx.buildWrap();
    wrap._waShell = shell;
    shell.append(wrap);
    page.ctx.considerNote(wrap);
    return wrap;
  };
  page.finish = (wrap, text, words) => {
    page.deliver({ type: "WA_RESULT", requestId: wrap.dataset.requestId, text, words, engine: "parakeet", transcribeMs: 120 });
  };
  page.hook = () => page.document.documentElement.setAttribute("data-wa-t-hook", "1");
  return page;
}

const classes = (el) => el.className.split(" ");
const actionButtons = (wrap) => wrap._waActions.children.map((el) => classes(el).pop());

/* ---- remembered transcripts ---- */
{
  const page = await openPage({});
  const wrap = page.addNote("true_1@c.us_AAA");
  assert.equal(wrap.dataset.phase, "idle");
  wrap.dataset.requestId = "r1";
  page.finish(wrap, "hola che", WORDS);
  await page.settle();
  assert.equal(wrap.dataset.phase, "done");
  const saved = page.store.transcriptCache["whatsapp:true_1@c.us_AAA"];
  assert.equal(saved.text, "hola che");
  assert.equal(saved.engine, "parakeet");
  assert.equal(saved.transcribeMs, 120);
  assert.deepEqual(saved.words, WORDS);
  assert.ok(saved.savedAt > 0);

  // The same message in a fresh node (tab reload, or the row was recycled).
  const again = page.addNote("true_1@c.us_AAA");
  assert.equal(again.dataset.phase, "done");
  assert.equal(again.hidden, false);
  assert.equal(again._waBtn.hidden, true, "Transcribir hides, like after a fresh transcription");
  assert.equal(again._waCopy.hidden, false, "Copiar shows");
  assert.equal(again.dataset.engine, "parakeet");
  assert.equal(again.dataset.ms, "120");
  // Word spans carry their start time, which is what highlighting and
  // click-to-seek read.
  const spans = again.querySelectorAll(".wa-t-word");
  assert.equal(spans.length, 2);
  assert.equal(spans[1].dataset.start, "0.5");
  assert.equal(again._words.length, 2);
  assert.equal(again.querySelector(".wa-t-body").textContent, "hola che");
  assert.ok(again.dataset.waTId, "the page hook finds the note by this marker");

  // A different message is not touched. A note without an id is never cached.
  assert.equal(page.addNote("true_1@c.us_BBB").dataset.phase, "idle");
  const anon = page.addNote("");
  anon.dataset.requestId = "r2";
  page.finish(anon, "sin id", []);
  await page.settle();
  assert.deepEqual(Object.keys(page.store.transcriptCache), ["whatsapp:true_1@c.us_AAA"]);

  // The options page empties the cache: shown transcripts stay, new nodes start idle.
  await page.chrome.storage.local.set({ transcriptCache: {} });
  await page.settle();
  assert.equal(again.dataset.phase, "done");
  assert.equal(page.addNote("true_1@c.us_AAA").dataset.phase, "idle");
}

// A row with two voice notes shares one data-id: no caching for those.
{
  const page = await openPage({});
  const wrap = page.addNote("album_1");
  for (let i = 0; i < 2; i++) {
    const slider = page.document.createElement("div");
    slider.setAttribute("role", "slider");
    wrap._waShell.parentElement.append(slider);
  }
  wrap.dataset.requestId = "r1";
  page.finish(wrap, "dos notas", []);
  await page.settle();
  assert.equal(page.store.transcriptCache, undefined);
}

// A cache filled before the page opened is shown as soon as it is read.
{
  const entry = { text: "guardada", words: [], engine: "whisper", transcribeMs: 0, savedAt: 5, usedAt: 5 };
  const page = await openPage({ transcriptCache: { "whatsapp:m1": entry } });
  const wrap = page.addNote("m1");
  assert.equal(wrap.dataset.phase, "done");
  assert.equal(wrap.querySelector(".wa-t-body").textContent, "guardada");
  // Reading it marks it as used, in one delayed write.
  page.runTimers(5000);
  await page.settle();
  assert.ok(page.store.transcriptCache["whatsapp:m1"].usedAt > 5);
  assert.equal(page.store.transcriptCache["whatsapp:m1"].savedAt, 5);
}

// cacheTranscripts off: nothing is read and nothing is written.
{
  const entry = { text: "guardada", words: [], engine: "", transcribeMs: 0, savedAt: 5, usedAt: 5 };
  const page = await openPage({ cacheTranscripts: false, transcriptCache: { "whatsapp:m1": entry } });
  const wrap = page.addNote("m1");
  assert.equal(wrap.dataset.phase, "idle");
  const other = page.addNote("m2");
  other.dataset.requestId = "r9";
  page.finish(other, "no se guarda", []);
  await page.settle();
  assert.equal(other.dataset.phase, "done");
  assert.deepEqual(Object.keys(page.store.transcriptCache), ["whatsapp:m1"]);
  // Turned back on without a reload: the idle note picks up its transcript.
  await page.chrome.storage.local.set({ cacheTranscripts: true });
  await page.settle();
  assert.equal(wrap.dataset.phase, "done");
}

// X keys by the row id, under its own site prefix.
{
  const page = await openPage({}, undefined, xFiles, "https://x.com/i/chat");
  const wrap = page.ctx.buildWrap();
  wrap.dataset.site = "x";
  wrap.dataset.xRow = "1999";
  assert.equal(page.ctx.noteKey(wrap), "x:1999");
}

/* ---- auto-transcribe ---- */
const AUTO_ON = { autoTranscribe: true, companionActive: true, engineMode: "auto" };
const transcribeCount = (page) => page.sent.filter((msg) => msg.type === "WA_TRANSCRIBE").length;
function scrollIntoView(page, wrap, visible = true) {
  const io = page.observers.find((item) => !item.dead && item.targets.has(wrap._waShell));
  if (!io) return false;
  io.callback([{ target: wrap._waShell, isIntersecting: visible }]);
  return true;
}
// The page hook answers an extract request. Here the extracted audio is set
// directly, which is the same state startTranscribe reaches after the hook.
const AUDIO = { base64: "AAAA", mimeType: "audio/ogg", byteLength: 3 };

{
  const page = await openPage(AUTO_ON);
  page.hook();
  const notes = [];
  for (let i = 0; i < 8; i++) {
    const wrap = page.addNote("auto_" + i);
    wrap._extractedAudio = AUDIO;
    notes.push(wrap);
  }
  // In the DOM and off screen: nothing starts.
  await page.settle();
  assert.equal(transcribeCount(page), 0);
  for (const wrap of notes) assert.equal(scrollIntoView(page, wrap, false), true);
  await page.settle();
  assert.equal(transcribeCount(page), 0);

  // All eight scroll into view: five go, three wait.
  for (const wrap of notes) scrollIntoView(page, wrap);
  await page.settle();
  assert.equal(transcribeCount(page), 5);
  assert.equal(notes.filter((wrap) => wrap.dataset.phase !== "idle").length, 5);

  // One finishes: the next one waiting takes the slot.
  page.finish(notes[0], "listo", []);
  await page.settle();
  assert.equal(notes[0].dataset.phase, "done");
  assert.equal(transcribeCount(page), 6);

  // One fails: it is not tried again, and its slot goes to the next one.
  page.deliver({ type: "WA_ERROR", requestId: notes[1].dataset.requestId, message: "falló" });
  await page.settle();
  assert.equal(notes[1].dataset.phase, "error");
  assert.equal(transcribeCount(page), 7);
  assert.equal(scrollIntoView(page, notes[1]), false, "a failed note is no longer watched");
  page.ctx.considerNote(notes[1]);
  page.ctx.sweepNotes();
  await page.settle();
  assert.equal(transcribeCount(page), 7);
  // The same message in a new node (row recycled) does not get a second go.
  const recycled = page.addNote("auto_1");
  recycled._extractedAudio = AUDIO;
  assert.equal(scrollIntoView(page, recycled), false);
  // The manual button still works on the failed note.
  page.ctx.startTranscribe(notes[1], notes[1]);
  await page.settle();
  assert.equal(transcribeCount(page), 8);
}

// Not when the Mac app is away, not with Whisper in the browser, not when off.
for (const storage of [
  { autoTranscribe: true, companionActive: false, engineMode: "auto" },
  { autoTranscribe: true, companionActive: true, engineMode: "browser" },
  { autoTranscribe: true, companionActive: true, useCompanion: false },
  { autoTranscribe: false, companionActive: true, engineMode: "auto" },
  { companionActive: true },
]) {
  const page = await openPage(storage);
  page.hook();
  const wrap = page.addNote("n1");
  wrap._extractedAudio = AUDIO;
  assert.equal(scrollIntoView(page, wrap), false, JSON.stringify(storage));
  await page.settle();
  assert.equal(transcribeCount(page), 0, JSON.stringify(storage));
}

// The setting is picked up from chrome.storage.onChanged, both ways.
{
  const page = await openPage({ companionActive: true });
  page.hook();
  const first = page.addNote("n1");
  first._extractedAudio = AUDIO;
  assert.equal(scrollIntoView(page, first), false);
  await page.chrome.storage.local.set({ autoTranscribe: true });
  await page.settle();
  assert.equal(scrollIntoView(page, first), true);
  await page.settle();
  assert.equal(transcribeCount(page), 1);

  const second = page.addNote("n2");
  second._extractedAudio = AUDIO;
  await page.chrome.storage.local.set({ autoTranscribe: false });
  await page.settle();
  assert.equal(scrollIntoView(page, second), false);
  // The Mac app goes away while the setting is on.
  await page.chrome.storage.local.set({ autoTranscribe: true });
  await page.settle();
  await page.chrome.storage.local.set({ companionActive: false });
  await page.settle();
  assert.equal(scrollIntoView(page, second), false);
  assert.equal(transcribeCount(page), 1);
}

// A note with a remembered transcript, or one already transcribed by hand,
// never runs on its own.
{
  const entry = { text: "guardada", words: [], engine: "", transcribeMs: 0, savedAt: 5, usedAt: 5 };
  const page = await openPage({ ...AUTO_ON, transcriptCache: { "whatsapp:c1": entry } });
  page.hook();
  const cached = page.addNote("c1");
  assert.equal(cached.dataset.phase, "done");
  assert.equal(scrollIntoView(page, cached), false);

  const manual = page.addNote("h1");
  manual._extractedAudio = AUDIO;
  page.ctx.startTranscribe(manual, manual);
  await page.settle();
  assert.equal(transcribeCount(page), 1);
  assert.equal(scrollIntoView(page, manual), false);
  page.finish(manual, "a mano", []);
  await page.settle();
  await page.chrome.storage.local.set({ cacheTranscripts: false });
  await page.settle();
  const manualAgain = page.addNote("h1");
  assert.equal(manualAgain.dataset.phase, "idle");
  assert.equal(scrollIntoView(page, manualAgain), false);
  // No id: not auto-transcribed, since "once per message" cannot be kept.
  assert.equal(scrollIntoView(page, page.addNote("")), false);
  assert.equal(transcribeCount(page), 1);
}

/* ---- summary and translation ---- */
const FEATURES = { companionFeatures: { summarize: true, translate: true } };

// Features off: the buttons are not in the DOM at all.
{
  const page = await openPage({});
  const wrap = page.addNote("s0");
  wrap.dataset.requestId = "r1";
  page.finish(wrap, LONG, []);
  await page.settle();
  assert.deepEqual(actionButtons(wrap), ["wa-t-btn", "wa-t-copy", "wa-t-save"]);
  assert.equal(page.document.querySelectorAll(".wa-t-act").length, 0);
  assert.equal(wrap._waActions.querySelectorAll(".wa-t-act").length, 0);

  // The Mac app starts offering them: they appear without a reload.
  await page.chrome.storage.local.set(FEATURES);
  await page.settle();
  assert.deepEqual(actionButtons(wrap), ["wa-t-btn", "wa-t-copy", "wa-t-sum", "wa-t-tr", "wa-t-save"]);
  // And go away again, out of the DOM.
  await page.chrome.storage.local.set({ companionFeatures: { summarize: false, translate: true } });
  await page.settle();
  assert.deepEqual(actionButtons(wrap), ["wa-t-btn", "wa-t-copy", "wa-t-tr", "wa-t-save"]);
  await page.chrome.storage.local.set({ companionFeatures: { summarize: false, translate: false } });
  await page.settle();
  assert.deepEqual(actionButtons(wrap), ["wa-t-btn", "wa-t-copy", "wa-t-save"]);
}

{
  const replies = [];
  const page = await openPage({ ...FEATURES, languageMode: "es" }, (msg) => (msg.type === "WA_TEXT_ACTION" ? replies.shift() : undefined));
  const textActions = () => page.sent.filter((msg) => msg.type === "WA_TEXT_ACTION");

  // Before there is a transcript there is nothing to act on.
  const idle = page.addNote("s1");
  assert.deepEqual(actionButtons(idle), ["wa-t-btn", "wa-t-copy", "wa-t-save"]);

  // 60 words or fewer: Traducir only.
  const short = page.addNote("s2");
  short.dataset.requestId = "r1";
  page.finish(short, Array.from({ length: 60 }, () => "hola").join(" "), []);
  await page.settle();
  assert.deepEqual(actionButtons(short), ["wa-t-btn", "wa-t-copy", "wa-t-tr", "wa-t-save"]);

  // More than 60: both, next to Copiar.
  idle.dataset.requestId = "r2";
  page.finish(idle, LONG, []);
  await page.settle();
  const wrap = idle;
  assert.deepEqual(actionButtons(wrap), ["wa-t-btn", "wa-t-copy", "wa-t-sum", "wa-t-tr", "wa-t-save"]);
  assert.equal(wrap._waSum.title, "Resumir");
  assert.equal(wrap._waTr.getAttribute("aria-label"), "Traducir");

  // Resumir: busy while waiting, then a labelled block under the transcript.
  replies.push({ ok: true, text: "Un resumen corto." });
  wrap._waSum.click();
  assert.equal(wrap._waSum.dataset.busy, "1");
  assert.equal(wrap._waSum.disabled, true);
  wrap._waSum.click();
  assert.equal(textActions().length, 1, "a second click while busy sends nothing");
  assert.deepEqual({ ...textActions()[0] }, { type: "WA_TEXT_ACTION", action: "summarize", text: LONG, targetLanguage: "en" });
  await page.settle();
  assert.equal(wrap._waSum.dataset.busy, undefined);
  assert.equal(wrap._waSum.disabled, false);
  let block = wrap.querySelector(".wa-t-extra");
  assert.equal(block.dataset.kind, "summarize");
  assert.equal(block.dataset.state, "ok");
  assert.equal(block.querySelector(".wa-t-extra-label").textContent, "Resumen");
  assert.equal(block.querySelector(".wa-t-extra-body").textContent, "Un resumen corto.");
  assert.ok(wrap._waOut.contains(block), "the block is inside the transcript box that X measures");
  assert.equal(wrap.querySelector(".wa-t-body").textContent, LONG, "the transcript itself is untouched");
  // Its own copy, and a way to hide it.
  let copied = "";
  page.ctx.navigator.clipboard.writeText = async (text) => {
    copied = text;
  };
  block.querySelector(".wa-t-extra-copy").click();
  await page.settle();
  assert.equal(copied, "Un resumen corto.");
  block.querySelector(".wa-t-extra-hide").click();
  page.runTimers();
  assert.equal(wrap.querySelector(".wa-t-extra"), null);
  // Showing it again does not ask the Mac app a second time.
  wrap._waSum.click();
  await page.settle();
  assert.equal(textActions().length, 1);
  assert.equal(wrap.querySelector(".wa-t-extra-body").textContent, "Un resumen corto.");

  // Traducir fails: the error text from the service worker, inline, no retry.
  replies.push({ ok: false, error: "La app de Mac no pudo traducir." });
  wrap._waTr.click();
  await page.settle();
  page.runTimers(5000);
  await page.settle();
  assert.equal(textActions().length, 2, "no retry after an error");
  assert.equal(textActions()[1].action, "translate");
  assert.equal(textActions()[1].targetLanguage, "en");
  const blocks = wrap.querySelectorAll(".wa-t-extra");
  assert.deepEqual(blocks.map((el) => el.dataset.kind), ["summarize", "translate"]);
  block = blocks[1];
  assert.equal(block.dataset.state, "error");
  assert.equal(block.querySelector(".wa-t-extra-label").textContent, "Traducción");
  assert.equal(block.querySelector(".wa-t-extra-body").textContent, "La app de Mac no pudo traducir.");
  assert.equal(block.querySelector(".wa-t-extra-copy"), null);
  assert.equal(wrap._waTr.disabled, false);
  // The user asks again: one new request, and the block is replaced.
  replies.push({ ok: true, text: "A translation." });
  wrap._waTr.click();
  await page.settle();
  assert.equal(textActions().length, 3);
  assert.equal(wrap.querySelectorAll(".wa-t-extra").length, 2);
  assert.equal(wrap.querySelectorAll(".wa-t-extra")[1].dataset.state, "ok");

  // No answer at all (service worker gone): an inline error, not a hang.
  short._waTr.click();
  await page.settle();
  assert.equal(short.querySelector(".wa-t-extra").dataset.state, "error");
  assert.equal(short.querySelector(".wa-t-extra-body").textContent, "No se pudo traducir.");
  assert.equal(short._waTr.disabled, false);

  // English notes translate to Spanish.
  await page.chrome.storage.local.set({ languageMode: "en" });
  await page.settle();
  replies.push({ ok: true, text: "Una traducción." });
  short._waTr.click();
  await page.settle();
  assert.equal(textActions().pop().targetLanguage, "es");
  await page.chrome.storage.local.set({ languageMode: "auto" });
  await page.settle();
  assert.equal(page.ctx.translateTarget(), "en");
}

// The pointerdown path the real page uses (the window listener in
// content-core.js) runs the same action, once.
{
  const page = await openPage(FEATURES, (msg) => (msg.type === "WA_TEXT_ACTION" ? { ok: true, text: "ok" } : undefined));
  const wrap = page.addNote("p1");
  wrap.dataset.requestId = "r1";
  page.finish(wrap, LONG, []);
  await page.settle();
  const ev = { type: "pointerdown", button: 0, target: wrap._waTr, preventDefault() {}, stopPropagation() {} };
  page.ctx.onUiPointerDown(ev);
  wrap._waTr.click();
  await page.settle();
  assert.equal(page.sent.filter((msg) => msg.type === "WA_TEXT_ACTION").length, 1);
  assert.equal(wrap.querySelector(".wa-t-extra").dataset.kind, "translate");
}

// A remembered transcript gets the same actions as a fresh one.
{
  const entry = { text: LONG, words: [], engine: "", transcribeMs: 0, savedAt: 5, usedAt: 5 };
  const page = await openPage({ ...FEATURES, transcriptCache: { "whatsapp:k1": entry } });
  const wrap = page.addNote("k1");
  assert.deepEqual(actionButtons(wrap), ["wa-t-btn", "wa-t-copy", "wa-t-sum", "wa-t-tr", "wa-t-save"]);
}

/* ---- X: the row of the virtual list follows the extra block ---- */
{
  const longWords = LONG.split(" ").map((text, i) => ({ text, start: i, end: i + 0.5 }));
  const entry = { text: LONG, words: longWords, engine: "parakeet", transcribeMs: 90, savedAt: 5, usedAt: 5 };
  const page = await openPage(
    { ...FEATURES, transcriptCache: { "x:777": entry } },
    (msg) => (msg.type === "WA_TEXT_ACTION" ? { ok: true, text: "Resumen de X." } : undefined),
    xFiles,
    "https://x.com/i/chat"
  );
  const make = (attrs = {}) => {
    const el = page.document.createElement("div");
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    return el;
  };
  const sizer = make();
  sizer.style.height = "1000px";
  const item = make({ "data-index": "3" });
  item.style.height = "50px";
  const row = make({ "data-dm-message-row": "777" });
  const pill = make();
  const play = make({ "aria-label": "Play" });
  pill.append(play);
  row.append(pill);
  item.append(row);
  sizer.append(item);
  page.document.body.append(sizer);
  // Layout the fake DOM does not have: the row is as tall as its declared
  // height, the transcript is 60px and 120px with a block open.
  const box = (top, height) => ({ left: 0, right: 300, top, bottom: top + height, width: 300, height });
  item.getBoundingClientRect = () => box(0, parseFloat(item.style.height));

  page.ctx.injectX(row);
  const ui = page.evaluate("xUis.get('777')");
  const wrap = ui.wrap;
  wrap.getBoundingClientRect = () => box(20, wrap.querySelector(".wa-t-extra") ? 120 : 60);
  page.ctx.refitXTranscript(wrap, 0);

  // The remembered transcript is in the message row, in the done state.
  assert.equal(wrap.dataset.phase, "done");
  assert.equal(wrap.parentElement, item);
  assert.equal(wrap.querySelectorAll(".wa-t-word").length, 70);
  assert.deepEqual(actionButtons(wrap), ["wa-t-btn", "wa-t-copy", "wa-t-sum", "wa-t-tr", "wa-t-save"]);
  assert.equal(ui.foot.dataset.xRow, "777");
  assert.equal(item.style.height, "92px", "transcript bottom 80 + gap 12");
  assert.equal(sizer.style.height, "1042px");

  // The summary block makes the transcript taller: the row grows with it.
  wrap._waSum.click();
  await page.settle();
  assert.equal(wrap.querySelector(".wa-t-extra-body").textContent, "Resumen de X.");
  assert.equal(item.style.height, "152px", "transcript bottom 140 + gap 12");
  assert.equal(sizer.style.height, "1102px");

  // Hidden again: the room is handed back, no more than was taken.
  wrap.querySelector(".wa-t-extra-hide").click();
  page.runTimers();
  assert.equal(wrap.querySelector(".wa-t-extra"), null);
  assert.equal(item.style.height, "92px");
  assert.equal(sizer.style.height, "1042px");
  assert.equal(wrap.parentElement, item);
  assert.deepEqual(page.logs.filter((line) => /Error|x debug/.test(line)), []);
}

console.log("content-features.test.mjs ok");
