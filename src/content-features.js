/* TranscribeThem — content script: remembered transcripts, auto-transcribe,
   summary and translation. Classic script, after content-core.js. Both sites
   load it. The pure cache logic is in transcript-cache.js. */

/* ---- preferences ---- */

// Storage keys that change what this file does, without a new scan of the page.
const NOTE_PREF_KEYS = [
  "autoTranscribe",
  "cacheTranscripts",
  "companionFeatures",
  "companionActive",
  "engineMode",
  "useCompanion",
  "languageMode",
];

// Everything stays off until the settings are read once.
let notePrefs = { ready: false, cache: false, auto: false, summarize: false, translate: false, language: "es" };

function applyNotePrefs(settings) {
  if (!settings) return;
  const features = settings.companionFeatures || {};
  notePrefs = {
    ready: true,
    cache: settings.cacheTranscripts !== false,
    // Never on its own with Whisper in the browser: only when the Mac app answers.
    auto: settings.autoTranscribe === true && settings.companionActive === true && settings.engineMode !== "browser",
    summarize: features.summarize === true,
    translate: features.translate === true,
    language: settings.languageMode,
  };
  if (!notePrefs.cache) {
    transcriptCache = null;
    transcriptCacheLoading = false;
  } else if (!transcriptCache) {
    loadTranscriptCache();
  }
  if (!notePrefs.auto) stopAutoTranscribe();
}

function refreshNotePrefs() {
  if (typeof waGetSettings !== "function") return;
  waGetSettings()
    .then((settings) => {
      applyNotePrefs(settings);
      sweepNotes();
    })
    .catch(() => {});
}

// Every note already on the page, after a preference or the cache changed.
function sweepNotes() {
  if (!notePrefs.ready) return;
  for (const wrap of transcriptWraps()) {
    syncTextActions(wrap);
    considerNote(wrap);
  }
}

/* ---- remembered transcripts ---- */

// null until chrome.storage answered, or while the preference is off.
let transcriptCache = null;
let transcriptCacheLoading = false;
const cacheTouches = new Set();
let cacheTouchTimer = 0;
const CACHE_TOUCH_AFTER_MS = 10 * 60 * 1000;

function loadTranscriptCache() {
  const api = globalThis.WaTranscriptCache;
  if (!api || transcriptCacheLoading) return;
  transcriptCacheLoading = true;
  let pending;
  try {
    pending = api.load();
  } catch (err) {
    pending = Promise.reject(err);
  }
  pending
    .catch((err) => {
      log("transcript cache read failed", err);
      return {};
    })
    .then((cache) => {
      if (!transcriptCacheLoading) return;
      transcriptCacheLoading = false;
      if (!notePrefs.cache) return;
      transcriptCache = cache;
      sweepNotes();
    });
}

// Another tab saved a transcript, or the options page emptied the cache.
function onTranscriptCacheChanged(value) {
  if (!notePrefs.cache) return;
  transcriptCache = value && typeof value === "object" ? value : {};
  transcriptCacheLoading = false;
  sweepNotes();
}

function noteMessageId(wrap) {
  if (!wrap) return "";
  if (wrap.dataset.site === "x") return wrap.dataset.xRow || xRowId(wrap._waShell);
  return waMessageId(wrap);
}

// "" when the message has no stable id. Such a note is not cached and is not
// auto-transcribed, because "once per message" cannot be told without it.
function noteKey(wrap) {
  const api = globalThis.WaTranscriptCache;
  if (!api || !wrap) return "";
  return api.cacheKey(wrap.dataset.site === "x" ? "x" : "whatsapp", noteMessageId(wrap));
}

function rememberTranscript(wrap, result) {
  if (!notePrefs.cache) return;
  const api = globalThis.WaTranscriptCache;
  const key = noteKey(wrap);
  if (!api || !key) return;
  const entry = api.makeEntry(result, Date.now());
  if (!entry) return;
  if (transcriptCache) transcriptCache = api.put(transcriptCache, key, entry);
  try {
    api.update((cache) => api.put(cache, key, entry)).catch((err) => log("transcript cache write failed", err));
  } catch (err) {
    log("transcript cache write failed", err);
  }
}

// A read moves the entry to the back of the eviction line. One write for many
// reads, and none for an entry that was read a few minutes ago.
function touchCached(key, entry) {
  const last = Number(entry.usedAt) || Number(entry.savedAt) || 0;
  if (Date.now() - last < CACHE_TOUCH_AFTER_MS) return;
  cacheTouches.add(key);
  if (cacheTouchTimer) return;
  cacheTouchTimer = setTimeout(() => {
    cacheTouchTimer = 0;
    const keys = [...cacheTouches];
    cacheTouches.clear();
    const api = globalThis.WaTranscriptCache;
    if (!api || !notePrefs.cache || !keys.length) return;
    const now = Date.now();
    try {
      api
        .update((cache) => {
          let next = cache;
          for (const k of keys) next = api.touch(next, k, now);
          return next;
        })
        .catch(() => {});
    } catch (_) {
      /* the extension was reloaded under this tab */
    }
  }, 2000);
}

// Called when a note's UI is injected, and again when preferences or the
// cache change. Shows the remembered transcript, or lines the note up for
// auto-transcribe. Only ever acts on a note that is still idle.
function considerNote(wrap) {
  if (!wrap || !notePrefs.ready || wrap.dataset.phase !== "idle") return;
  const key = noteKey(wrap);
  if (notePrefs.cache) {
    // Wait for the cache before deciding to transcribe a note it may hold.
    if (!transcriptCache) return;
    const entry = key ? globalThis.WaTranscriptCache.get(transcriptCache, key) : null;
    if (entry) {
      setUi(wrap, {
        phase: "done",
        text: entry.text,
        engine: entry.engine || undefined,
        transcribeMs: entry.transcribeMs || undefined,
        words: entry.words,
      });
      touchCached(key, entry);
      return;
    }
  }
  if (notePrefs.auto) watchForAuto(wrap, key);
}

/* ---- auto-transcribe ---- */

const AUTO_MAX_PENDING = 5;
const AUTO_SLOT_TIMEOUT_MS = 3 * 60 * 1000;
let autoIo = null;
const autoTargets = new WeakMap(); // observed element -> wrap
const autoVisible = new Set(); // wraps on screen, waiting for a free slot
const autoRunning = new Map(); // wrap -> timer that frees a stuck slot
// Messages that had their one go in this page load, by hand or on their own.
const autoSeen = new Set();

function autoTarget(wrap) {
  const el = wrap.dataset.site === "x" ? wrap._waShell : wrap._waBubble || wrap._waShell;
  return el && el.nodeType === 1 && el.isConnected ? el : null;
}

function watchForAuto(wrap, key) {
  if (!key || autoSeen.has(key) || wrap._waAutoWatch) return;
  if (typeof IntersectionObserver !== "function") return;
  const target = autoTarget(wrap);
  if (!target) return;
  if (!autoIo) autoIo = new IntersectionObserver(onAutoIntersect, { threshold: 0.25 });
  wrap._waAutoWatch = target;
  autoTargets.set(target, wrap);
  autoIo.observe(target);
}

function unwatchAuto(wrap) {
  const target = wrap && wrap._waAutoWatch;
  if (!target) return;
  wrap._waAutoWatch = null;
  autoVisible.delete(wrap);
  autoTargets.delete(target);
  if (autoIo) {
    try {
      autoIo.unobserve(target);
    } catch (_) {
      /* already gone */
    }
  }
}

function onAutoIntersect(entries) {
  for (const entry of entries) {
    const wrap = autoTargets.get(entry.target);
    if (!wrap) continue;
    if (entry.isIntersecting) autoVisible.add(wrap);
    else autoVisible.delete(wrap);
  }
  pumpAuto();
}

function pumpAuto() {
  if (!notePrefs.auto) return;
  // An extension reload leaves this script without a runtime. Stop quietly
  // instead of putting an error on every note that scrolls into view.
  let alive = false;
  try {
    alive = !!chrome.runtime.id;
  } catch (_) {
    alive = false;
  }
  if (!alive) {
    stopAutoTranscribe();
    return;
  }
  for (const wrap of [...autoVisible]) {
    if (autoRunning.size >= AUTO_MAX_PENDING) return;
    const target = wrap._waAutoWatch;
    unwatchAuto(wrap);
    if (!target || !target.isConnected || wrap.dataset.phase !== "idle") continue;
    const key = noteKey(wrap);
    if (!key || autoSeen.has(key)) continue;
    autoSeen.add(key);
    autoRunning.set(wrap, setTimeout(() => releaseAuto(wrap), AUTO_SLOT_TIMEOUT_MS));
    Promise.resolve(startTranscribe(wrap, wrap)).catch((err) => {
      log("auto transcribe failed", err);
      releaseAuto(wrap);
    });
  }
}

function releaseAuto(wrap) {
  if (!autoRunning.has(wrap)) return;
  clearTimeout(autoRunning.get(wrap));
  autoRunning.delete(wrap);
  pumpAuto();
}

// Jobs already sent keep going. Nothing new starts.
function stopAutoTranscribe() {
  if (!autoIo) return;
  autoIo.disconnect();
  autoIo = null;
  autoVisible.clear();
  for (const wrap of transcriptWraps()) wrap._waAutoWatch = null;
}

// setUi reports every phase here. A note that started, by hand or not, never
// gets an automatic go again; a finished or failed one frees its slot.
function noteUiPhase(wrap, phase) {
  if (!wrap || phase === "idle") return;
  if (!wrap._waSeenKey) {
    const key = noteKey(wrap);
    if (key) {
      wrap._waSeenKey = key;
      autoSeen.add(key);
    }
  }
  if (wrap._waAutoWatch) unwatchAuto(wrap);
  if (phase === "done" || phase === "error") releaseAuto(wrap);
}

/* ---- summary and translation ---- */

const SUMMARY_MIN_WORDS = 60;
const SUMMARY_ICON = "M4 5h16a1 1 0 1 1 0 2H4a1 1 0 0 1 0-2zm0 6h16a1 1 0 1 1 0 2H4a1 1 0 1 1 0-2zm0 6h9a1 1 0 1 1 0 2H4a1 1 0 1 1 0-2z";
const TRANSLATE_ICON =
  "M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z";
const CLOSE_ICON =
  "M6.7 5.3a1 1 0 0 0-1.4 1.4L10.58 12 5.3 17.3a1 1 0 1 0 1.4 1.4L12 13.42l5.3 5.28a1 1 0 0 0 1.4-1.4L13.42 12l5.28-5.3a1 1 0 0 0-1.4-1.4L12 10.58 6.7 5.3z";

const TEXT_ACTIONS = {
  summarize: {
    slot: "_waSum",
    className: "wa-t-act wa-t-sum",
    icon: SUMMARY_ICON,
    label: waT("summarize"),
    busyLabel: waT("summarizing"),
    heading: waT("summary"),
    failed: waT("summarizeFailed"),
  },
  translate: {
    slot: "_waTr",
    className: "wa-t-act wa-t-tr",
    icon: TRANSLATE_ICON,
    label: waT("translate"),
    busyLabel: waT("translating"),
    heading: waT("translation"),
    failed: waT("translateFailed"),
  },
};
const EXTRA_COPY = {
  copy: waT("copy"),
  copied: waT("copied"),
  copyFailed: waT("copyFailed"),
  hide: waT("hide"),
};

function wordCount(text) {
  const words = String(text || "").trim().split(/\s+/);
  return words[0] ? words.length : 0;
}

function wantsTextAction(wrap, kind) {
  if (wrap.dataset.phase !== "done" || !wrap._waText) return false;
  if (kind === "summarize") return notePrefs.summarize && wordCount(wrap._waText) > SUMMARY_MIN_WORDS;
  return notePrefs.translate;
}

function buildUiButton(className, label, icon, run) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.append(svgIcon(icon));
  // onUiPointerDown runs this on pointerdown, like the other buttons. The
  // click listener covers the keyboard.
  btn._waRun = run;
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (recentUiPointer()) return;
    run();
  });
  return btn;
}

// Resumir and Traducir exist only while the Mac app offers them and there is a
// transcript to work on. Otherwise they are not in the DOM at all.
function syncTextActions(wrap) {
  const actions = wrap && wrap._waActions;
  if (!actions) return;
  let added = false;
  for (const kind of ["summarize", "translate"]) {
    const def = TEXT_ACTIONS[kind];
    const have = wrap[def.slot];
    const want = wantsTextAction(wrap, kind);
    if (want && !have) {
      const btn = buildUiButton(def.className, def.label, def.icon, () => runTextAction(wrap, kind));
      btn._waWrap = wrap;
      wrap[def.slot] = btn;
      added = true;
    } else if (!want && have) {
      have.remove();
      wrap[def.slot] = null;
    }
  }
  // Copy, Resumir, Traducir, then the download button.
  const save = wrap._waSave && wrap._waSave.parentElement === actions ? wrap._waSave : null;
  const tr = wrap._waTr;
  if (tr && tr.parentElement !== actions) actions.insertBefore(tr, save);
  const sum = wrap._waSum;
  if (sum && sum.parentElement !== actions) actions.insertBefore(sum, tr || save);
  if (added && wrap.dataset.site !== "x" && wrap._waEmojiDock && wrap._waEmojiHost) {
    paintLikeEmoji(wrap, wrap._waEmojiHost);
  }
}

function setTextActionBusy(wrap, kind, busy) {
  const def = TEXT_ACTIONS[kind];
  const btn = wrap[def.slot];
  if (!wrap._waExtraBusy) wrap._waExtraBusy = {};
  wrap._waExtraBusy[kind] = busy;
  if (!btn) return;
  const label = busy ? def.busyLabel : def.label;
  btn.disabled = busy;
  btn.title = label;
  btn.setAttribute("aria-label", label);
  if (busy) btn.dataset.busy = "1";
  else delete btn.dataset.busy;
}

function translateTarget() {
  return notePrefs.language === "en" ? "es" : "en";
}

// One request per click. A failure is shown in the block and is not retried.
function runTextAction(wrap, kind) {
  const def = TEXT_ACTIONS[kind];
  if (!wrap || !def || (wrap._waExtraBusy && wrap._waExtraBusy[kind])) return;
  const saved = wrap._waExtras && wrap._waExtras[kind];
  if (saved && saved.ok) {
    showExtra(wrap, kind, saved);
    return;
  }
  const text = wrap._waText;
  if (!text) return;
  setTextActionBusy(wrap, kind, true);
  const finish = (result) => {
    setTextActionBusy(wrap, kind, false);
    if (!wrap._waExtras) wrap._waExtras = {};
    wrap._waExtras[kind] = result;
    showExtra(wrap, kind, result);
  };
  const fail = (err) => {
    const dead = /context invalidated/i.test(String(err && err.message));
    finish({ ok: false, text: dead ? shownError(err, "RELOAD") : def.failed });
  };
  try {
    chrome.runtime.sendMessage(
      { type: WA_MSG.TEXT_ACTION, action: kind, text, targetLanguage: translateTarget() },
      (res) => {
        if (chrome.runtime.lastError) {
          fail(chrome.runtime.lastError);
          return;
        }
        if (res && res.ok && res.text) finish({ ok: true, text: String(res.text) });
        else finish({ ok: false, text: (res && res.error) || def.failed });
      }
    );
  } catch (err) {
    fail(err);
  }
}

function extrasHost(wrap) {
  if (wrap._waExtrasHost) return wrap._waExtrasHost;
  const out = wrap._waOut || wrap.querySelector(".wa-t-text");
  const grow = (out && out.querySelector && out.querySelector(".wa-t-grow")) || out;
  if (!grow) return null;
  const host = document.createElement("div");
  host.className = "wa-t-extras";
  grow.append(host);
  wrap._waExtrasHost = host;
  return host;
}

function wrapHeight(wrap) {
  try {
    return wrap.getBoundingClientRect().height || 0;
  } catch (_) {
    return 0;
  }
}

// On X the transcript sits in a row of a virtual list that was sized by hand,
// so that row has to be measured again whenever a block comes or goes.
function extrasChanged(wrap, heightBefore) {
  if (wrap.dataset.site === "x") refitXTranscript(wrap, heightBefore);
}

function hideExtra(wrap, kind) {
  const block = wrap._waExtraBlocks && wrap._waExtraBlocks[kind];
  if (!block) return;
  const before = wrapHeight(wrap);
  block.remove();
  wrap._waExtraBlocks[kind] = null;
  extrasChanged(wrap, before);
}

function copyExtra(btn, text) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(
    () => {
      btn.dataset.copied = "1";
      btn.title = EXTRA_COPY.copied;
      setTimeout(() => {
        btn.dataset.copied = "";
        btn.title = EXTRA_COPY.copy;
      }, 1600);
    },
    () => {
      btn.title = EXTRA_COPY.copyFailed;
    }
  );
}

// The result, or the error, in its own block under the transcript.
function showExtra(wrap, kind, result) {
  const def = TEXT_ACTIONS[kind];
  const host = extrasHost(wrap);
  if (!host) return;
  if (!wrap._waExtraBlocks) wrap._waExtraBlocks = {};
  const old = wrap._waExtraBlocks[kind];

  const block = document.createElement("div");
  block.className = "wa-t-extra";
  block.dataset.kind = kind;
  block.dataset.state = result.ok ? "ok" : "error";

  const head = document.createElement("div");
  head.className = "wa-t-extra-head";
  const label = document.createElement("span");
  label.className = "wa-t-extra-label";
  label.textContent = def.heading;
  head.append(label);
  if (result.ok) {
    const copy = buildUiButton("wa-t-mini wa-t-extra-copy", EXTRA_COPY.copy, COPY_ICON, () => copyExtra(copy, result.text));
    head.append(copy);
  }
  // Wait for the click to finish, or it lands on whatever moves under the pointer.
  head.append(
    buildUiButton("wa-t-mini wa-t-extra-hide", EXTRA_COPY.hide, CLOSE_ICON, () => {
      setTimeout(() => hideExtra(wrap, kind), 180);
    })
  );

  const body = document.createElement("div");
  body.className = "wa-t-extra-body";
  body.textContent = result.text;
  if (!result.ok) body.setAttribute("role", "alert");
  block.append(head, body);

  if (old && old.parentElement === host) host.replaceChild(block, old);
  else if (kind === "summarize") host.prepend(block);
  else host.append(block);
  wrap._waExtraBlocks[kind] = block;
  extrasChanged(wrap, 0);
}
