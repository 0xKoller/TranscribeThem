/* TranscribeThem — content script, shared core. Logs: [wa-transcribe]
   Classic script. content-core.js, content-features.js, content-whatsapp.js,
   content-x.js (X only) and content-main.js share one isolated-world global
   scope, in that order. X-only functions are called from here only behind
   isXSite() or data-site="x" checks, so the WhatsApp entry does not load
   content-x.js. */

const HOOK_SOURCE = "wa-local-transcribe";
const LOG = "[wa-transcribe]";

function isXSite() {
  const host = String((location && location.hostname) || "").toLowerCase();
  if (host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com")) return true;
  // blob:, about:blank and data: frames created by x.com have an empty hostname.
  // The X manifest entry is the only one that injects into those frames.
  let origin = "";
  let protocol = "";
  try {
    origin = String(location.origin || "").toLowerCase();
    protocol = String(location.protocol || "").toLowerCase();
  } catch (_) {}
  if (/^https:\/\/([^/]+\.)?(x\.com|twitter\.com)(:\d+)?$/.test(origin)) return true;
  return protocol === "blob:" || protocol === "about:" || protocol === "data:";
}

function shownError(err, code) {
  const msg = mapError(err, code);
  if (!isXSite()) return msg;
  if (code === "RELOAD") return waT("errReloadX");
  if (code === "MEDIA_403") return waT("errMedia403X");
  return msg;
}

function log(...args) {
  console.log(LOG, ...args);
}

function hookReady() {
  return document.documentElement.hasAttribute("data-wa-t-hook");
}

function extractViaHook(container, requestId) {
  return new Promise((resolve, reject) => {
    if (!hookReady()) {
      reject(Object.assign(new Error("RELOAD"), { code: "RELOAD" }));
      return;
    }
    const wrap = resolveWrap(container);
    if (wrap && !wrap.dataset.waTId) {
      wrap.dataset.waTId = `m${Date.now().toString(16)}${Math.random().toString(16).slice(2, 8)}`;
    }
    const marker = (wrap && wrap.dataset.waTId) || container.dataset.waTId;
    if (!marker) {
      reject(Object.assign(new Error("NO_AUDIO"), { code: "NO_AUDIO" }));
      return;
    }
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(Object.assign(new Error("NO_AUDIO"), { code: "NO_AUDIO" }));
    }, 15000);

    function onMessage(event) {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== HOOK_SOURCE || data.type !== "extract-result") return;
      if (data.requestId !== requestId) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      if (data.ok && data.base64) resolve(data);
      else {
        const code = data.error === "MEDIA_403" ? "MEDIA_403" : "NO_AUDIO";
        reject(Object.assign(new Error(data.error || "NO_AUDIO"), { code }));
      }
    }

    window.addEventListener("message", onMessage);
    window.postMessage(
      { source: HOOK_SOURCE, type: "extract", requestId, marker },
      "*"
    );
  });
}

let debugMode = false;
let highlightWords = true;
let siteOn = false;
let observing = false;

function svgIcon(pathD) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "currentColor");
  path.setAttribute("d", pathD);
  svg.appendChild(path);
  return svg;
}

const DOWNLOAD_ICON =
  "M12 3a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42L11 12.59V4a1 1 0 0 1 1-1zM5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1z";
const COPY_ICON =
  "M9 7a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V7zm2 0v9h7V7h-7zM6 9a1 1 0 0 0-1 1v9a2 2 0 0 0 2 2h8a1 1 0 1 0 0-2H7v-9a1 1 0 0 0-1-1z";
// Stylized “Ko-ller” envelope, matching icons/transcribethem.svg.
const TRANSCRIBE_ICON = [
  [2.05, 11.25, 0.7, 1.5],
  [3.25, 10.5, 0.7, 3],
  [4.45, 9, 0.7, 6],
  [5.65, 7, 0.7, 10],
  [6.85, 5, 0.7, 14],
  [8.05, 6, 0.7, 12],
  [9.25, 8, 0.7, 8],
  [10.45, 10, 0.7, 4],
  [11.65, 11, 0.7, 2],
  [12.85, 10.5, 0.7, 3],
  [14.05, 9, 0.7, 6],
  [15.25, 7, 0.7, 10],
  [16.45, 8, 0.7, 8],
  [17.65, 9.5, 0.7, 5],
  [18.85, 10.5, 0.7, 3],
  [20.05, 11, 0.7, 2],
  [21.25, 11.5, 0.7, 1],
];

let barsIconSequence = 0;

function barsIcon(bars) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  const gradientId = `wa-t-voice-${++barsIconSequence}`;
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const gradient = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
  gradient.setAttribute("id", gradientId);
  gradient.setAttribute("gradientUnits", "userSpaceOnUse");
  gradient.setAttribute("x1", "2.05");
  gradient.setAttribute("x2", "21.95");
  gradient.setAttribute("y1", "0");
  gradient.setAttribute("y2", "0");
  for (const [offset, color] of [["0", "#E8B86D"], ["0.48", "#EE9685"], ["1", "#A5A7F2"]]) {
    const stop = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    stop.setAttribute("offset", offset);
    stop.setAttribute("stop-color", color);
    gradient.appendChild(stop);
  }
  defs.appendChild(gradient);
  for (const [index, [x, y, w, h]] of bars.entries()) {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("class", "wa-t-bar");
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", String(w));
    rect.setAttribute("height", String(h));
    rect.setAttribute("rx", "0.35");
    rect.style.animationDelay = `${-index * 0.06}s`;
    rect.setAttribute("fill", `url(#${gradientId})`);
    svg.appendChild(rect);
  }
  // Gradient definition follows the animated bars.
  svg.appendChild(defs);
  return svg;
}

function applyBadge(wrap) {
  const badge = wrap.querySelector(".wa-t-badge");
  if (!badge) return;
  badge.replaceChildren();
  if (wrap.dataset.phase !== "done" || !debugMode) {
    badge.hidden = true;
    return;
  }
  badge.hidden = false;
  if (wrap.dataset.engine === "parakeet") {
    const span = document.createElement("span");
    span.className = "wa-t-badge-parakeet";
    const ms = wrap.dataset.ms;
    span.textContent = ms ? waT("badgeParakeetMs", ms) : waT("badgeParakeet");
    badge.append(span);
  } else {
    badge.textContent = waT("badgeWhisper");
  }
}

function renderTranscript(wrap, text, words) {
  const body = wrap.querySelector(".wa-t-body");
  if (!body) return;
  const api = globalThis.WaWords;
  const list = api ? api.normalizeWords(words) : [];
  const joined = list.map((w) => w.text).join(" ");
  body.replaceChildren();
  if (!list.length || (text && joined.length < String(text).length * 0.5)) {
    body.textContent = text || "";
    wrap._words = [];
    wrap._wordAt = -1;
    return;
  }
  wrap._wordAt = -1;
  list.forEach((w, i) => {
    if (i) body.append(document.createTextNode(" "));
    const span = document.createElement("span");
    span.className = "wa-t-word is-upcoming";
    span.dataset.start = String(w.start);
    span.dataset.text = w.text;
    const tx = document.createElement("span");
    tx.className = "wa-t-word-tx";
    tx.textContent = w.text;
    span.append(tx);
    body.append(span);
  });
  wrap._words = list;
  paintWrapWords(wrap, -1, false);
}

function paintWrapWords(wrap, at, playing) {
  const api = globalThis.WaWords;
  const nodes = wrap.querySelectorAll(".wa-t-word");
  nodes.forEach((el, i) => {
    const paint = api && api.wordPaint ? api.wordPaint(i, at, playing) : {
      on: !!(playing && at >= 0 && i === at),
      upcoming: !(at >= 0) || i > at,
    };
    el.classList.toggle("is-on", paint.on);
    el.classList.toggle("is-upcoming", paint.upcoming);
  });
}

function transcriptWraps() {
  const list = [];
  const seen = new Set();
  const push = (wrap) => {
    if (!wrap || seen.has(wrap) || !wrap.classList || !wrap.classList.contains("wa-t-wrap")) return;
    seen.add(wrap);
    list.push(wrap);
  };
  try {
    document.querySelectorAll(".wa-t-wrap").forEach(push);
  } catch (_) {
    /* the light DOM still paints WhatsApp */
  }
  // X transcripts sit in an open shadow root. querySelectorAll does not enter it.
  for (const ui of xUis.values()) push(ui.wrap);
  return list;
}

function paintPlayback(marker, time, playing) {
  if (playing && marker) {
    const active = document.querySelector(`.wa-t-wrap[data-wa-t-id="${marker}"]`);
    if (active && active.dataset.site !== "x" && active._waShell && !active._waReanchored) {
      active._waReanchored = true;
      positionWrap(active, active._waPlay || active._waShell, active._waShell);
      setTimeout(() => {
        if (active.isConnected) positionWrap(active, active._waPlay || active._waShell, active._waShell);
      }, 300);
    }
  }
  const api = globalThis.WaWords;
  for (const wrap of transcriptWraps()) {
    const nodes = wrap.querySelectorAll(".wa-t-word");
    if (!nodes.length) continue;
    const mine = !!(marker && wrap.dataset.waTId === marker);
    if (mine && api) wrap._wordAt = api.activeWordIndex(wrap._words, Number(time) || 0);
    const at = typeof wrap._wordAt === "number" ? wrap._wordAt : -1;
    paintWrapWords(wrap, at, !!(playing && mine));
  }
}

// X keeps its UIs here because they sit in a shadow tree or on a layer where
// document.querySelectorAll does not find them. Always empty on WhatsApp.
const xUis = new Map();

function setUi(wrap, { phase, message, text, engine, transcribeMs, words }) {
  const btn = wrap._waBtn || wrap.querySelector(".wa-t-btn");
  const copyBtn = wrap._waCopy || wrap.querySelector(".wa-t-copy");
  const saveBtn = wrap._waSave || wrap.querySelector(".wa-t-save");
  const actions = wrap._waActions || wrap.querySelector(".wa-t-actions");
  const tools = wrap._waTools || wrap.querySelector(".wa-t-tools");
  const status = wrap._waStatus || wrap.querySelector(".wa-t-status");
  const out = wrap._waOut || wrap.querySelector(".wa-t-text");
  wrap.dataset.phase = phase || "idle";
  if (engine) wrap.dataset.engine = engine;
  if (transcribeMs) wrap.dataset.ms = String(transcribeMs);

  const labels = {
    idle: waT("transcribe"),
    queued: waT("inQueue"),
    loading: waT("readingAudio"),
    running: waT("transcribing"),
    error: waT("retry"),
  };
  let label = labels[phase] || waT("transcribe");
  if (phase === "loading" && message && /modelo|model|whisper/i.test(message)) label = waT("loadingModel");
  const hasText = phase === "done" && !!text;
  const busy = phase === "queued" || phase === "loading" || phase === "running";
  btn.hidden = hasText;
  const labelEl = btn._waLabel || btn.querySelector(".wa-t-btn-label");
  if (labelEl) labelEl.textContent = label;
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.disabled = busy;
  if (busy) btn.dataset.busy = "1";
  else delete btn.dataset.busy;

  wrap._waText = hasText ? String(text) : "";
  syncTextActions(wrap);

  // Copy takes the transcribe slot once that button hides.
  if (actions && btn && copyBtn && saveBtn) {
    const order = [btn, copyBtn, wrap._waSum, wrap._waTr, saveBtn].filter(Boolean);
    if (order.some((el, i) => actions.children[i] !== el)) actions.append(...order);
  }
  if (copyBtn) copyBtn.hidden = !hasText;

  if (phase === "error") {
    status.hidden = false;
    status.textContent = message || shownError(null, "GENERIC");
  } else {
    status.hidden = true;
    status.textContent = "";
  }

  if (hasText) {
    const firstOpen = !out.classList.contains("is-open");
    wrap.hidden = false;
    out.hidden = false;
    renderTranscript(wrap, text, words);
    if (firstOpen) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => out.classList.add("is-open"));
      });
    }
    // The open animation grows the row for ~320ms. Measure again once it settles.
    if (wrap.dataset.site === "x") {
      wrap._waFitDone = false;
      wrap._waFitScroll = -1;
      wrap._waFitAfter = Date.now() + 420;
      clearTimeout(wrap._waFitTimer);
      wrap._waFitTimer = setTimeout(() => {
        wrap._waFitDone = false;
        placeXTranscript(wrap);
      }, 440);
      keepXFootOutOfTranscript(wrap);
    }
  } else if (out) {
    out.classList.remove("is-open");
    out.hidden = true;
    wrap.hidden = true;
  }
  placeAside(wrap);
  parkTools(wrap);
  applyBadge(wrap);
  noteUiPhase(wrap, wrap.dataset.phase);
}

function sliderCount(node) {
  if (!node || !node.querySelectorAll) return 0;
  try {
    return node.querySelectorAll('[role="slider"], input[type="range"]').length;
  } catch (_) {
    return 0;
  }
}

function resolveWrap(container) {
  if (!container) return null;
  if (container.classList?.contains("wa-t-wrap")) return container;
  const inside = container.querySelector?.(".wa-t-wrap");
  if (inside) return inside;
  const shell = singleMessage(container);
  return shell && shell.querySelector ? shell.querySelector(".wa-t-wrap") : null;
}

function isOurNode(el) {
  const c = el && el.classList;
  if (!c) return false;
  return (
    c.contains("wa-t-foot") ||
    c.contains("wa-t-btn") ||
    c.contains("wa-t-copy") ||
    c.contains("wa-t-save") ||
    c.contains("wa-t-act") ||
    c.contains("wa-t-actions") ||
    c.contains("wa-t-wrap") ||
    c.contains("wa-t-tools") ||
    c.contains("wa-t-x-layer") ||
    c.contains("wa-t-status")
  );
}

function buildWrap() {
  const marker = `m${Date.now().toString(16)}${Math.random().toString(16).slice(2, 8)}`;
  const wrap = document.createElement("div");
  wrap.className = "wa-t-wrap";
  wrap.dataset.phase = "idle";
  wrap.dataset.waTId = marker;
  wrap.hidden = true;

  const actions = document.createElement("div");
  actions.className = "wa-t-actions";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "wa-t-btn";
  btn.title = waT("transcribe");
  btn.setAttribute("aria-label", waT("transcribe"));
  const btnLabel = document.createElement("span");
  btnLabel.className = "wa-t-btn-label";
  btnLabel.textContent = waT("transcribe");
  btnLabel.hidden = true;
  // The button sits in X's shadow tree, where content.css does not apply.
  btnLabel.style.setProperty("display", "none", "important");
  btn.append(barsIcon(TRANSCRIBE_ICON), btnLabel);
  btn._waLabel = btnLabel;

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "wa-t-copy";
  copyBtn.title = waT("copy");
  copyBtn.setAttribute("aria-label", waT("copy"));
  copyBtn.append(svgIcon(COPY_ICON));
  copyBtn.hidden = true;

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "wa-t-save";
  saveBtn.title = waT("saveAudio");
  saveBtn.setAttribute("aria-label", waT("saveAudio"));
  saveBtn.append(svgIcon(DOWNLOAD_ICON));

  const status = document.createElement("div");
  status.className = "wa-t-status";
  status.hidden = true;

  const out = document.createElement("div");
  out.className = "wa-t-text";
  out.hidden = true;

  const body = document.createElement("div");
  body.className = "wa-t-body";
  const tools = document.createElement("div");
  tools.className = "wa-t-tools";
  const grow = document.createElement("div");
  grow.className = "wa-t-grow";
  grow.append(body, tools);
  out.append(grow);

  const badge = document.createElement("div");
  badge.className = "wa-t-badge";
  badge.hidden = true;

  const foot = document.createElement("div");
  foot.className = "wa-t-foot wa-t-aside";
  foot.dataset.side = "in";
  actions.append(btn, copyBtn, saveBtn);
  foot.append(actions, status);
  wrap.append(out, badge);
  wrap._waBtn = btn;
  wrap._waCopy = copyBtn;
  wrap._waSave = saveBtn;
  wrap._waActions = actions;
  wrap._waFoot = foot;
  wrap._waTools = tools;
  wrap._waStatus = status;
  wrap._waOut = out;
  btn._waWrap = wrap;
  copyBtn._waWrap = wrap;
  saveBtn._waWrap = wrap;
  tools._waWrap = wrap;
  foot._waWrap = wrap;

  for (const type of ["click", "mousedown", "mouseup", "pointerdown"]) {
    wrap.addEventListener(type, (ev) => ev.stopPropagation());
    tools.addEventListener(type, (ev) => ev.stopPropagation());
    foot.addEventListener(type, (ev) => ev.stopPropagation());
  }
  // The transcript lives in X's shadow tree. A window listener only sees the host.
  wrap.addEventListener("pointerdown", (ev) => {
    const node = ev.target && ev.target.nodeType === 1 ? ev.target : ev.target && ev.target.parentElement;
    const word = node && node.closest && node.closest(".wa-t-word");
    if (!word) return;
    ev.preventDefault();
    ev.stopPropagation();
    seekWord(word);
  }, true);

  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (recentUiPointer()) return;
    startTranscribe(wrap, wrap);
  });
  saveBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (recentUiPointer()) return;
    saveAudio(wrap, wrap, saveBtn, out);
  });
  copyBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (recentUiPointer()) return;
    copyTranscript(wrap, copyBtn);
  });
  return wrap;
}

function copyTranscript(wrap, copyBtn) {
  if (!wrap || !copyBtn) return;
  const out = wrap._waOut || wrap.querySelector(".wa-t-text");
  const bodyEl = out && out.querySelector ? out.querySelector(".wa-t-body") : null;
  const t = (bodyEl && bodyEl.textContent) || "";
  if (!t) return;
  navigator.clipboard.writeText(t).then(
    () => {
      copyBtn.dataset.copied = "1";
      copyBtn.title = waT("copied");
      setTimeout(() => {
        copyBtn.dataset.copied = "";
        copyBtn.title = waT("copy");
      }, 1600);
    },
    () => {
      copyBtn.title = waT("copyFailed");
    }
  );
}

function audioExtension(mime) {
  const m = String(mime || "").toLowerCase();
  if (/ogg|opus/.test(m)) return "ogg";
  if (/mp4|m4a|aac/.test(m)) return "m4a";
  if (/webm/.test(m)) return "webm";
  if (/mpeg|mp3/.test(m)) return "mp3";
  if (/wav/.test(m)) return "wav";
  return "bin";
}

// Debug: download the raw extracted voice note (+ current transcript as .txt
// if there is one) so the same audio can be run through other engines.
async function saveAudio(container, wrap, saveBtn, out) {
  const requestId = `save-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  saveBtn.disabled = true;
  saveBtn.title = waT("extracting");
  try {
    let extracted = wrap._extractedAudio;
    if (!extracted) {
      extracted = await extractViaHook(container, requestId);
      wrap._extractedAudio = extracted;
    }
    const mime = extracted.mimeType || "audio/ogg";
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const base =
      `${isXSite() ? "x-voice" : "wa-voice"}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
      `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const files = [{ name: `${base}.${audioExtension(mime)}`, mime, base64: extracted.base64 }];
    const bodyEl = out && out.querySelector ? out.querySelector(".wa-t-body") : null;
    const text = (bodyEl && bodyEl.textContent) || "";
    if (text) files.push({ name: `${base}.txt`, mime: "text/plain;charset=utf-8", text });

    let res = null;
    try {
      res = await chrome.runtime.sendMessage({ type: WA_MSG.SAVE_FILES, files });
    } catch (msgErr) {
      log("SAVE_FILES message error, will fallback to direct download", msgErr);
    }

    if (!res || !res.ok) {
      log("background save returned not ok, using direct download fallback", res && res.error);
      for (const f of files) {
        const fileMime = f.mime || "application/octet-stream";
        let blobUrl;
        if (f.base64) {
          const bin = atob(f.base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          blobUrl = URL.createObjectURL(new Blob([bytes], { type: fileMime }));
        } else {
          blobUrl = URL.createObjectURL(new Blob([f.text || ""], { type: fileMime }));
        }
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = f.name;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          a.remove();
          URL.revokeObjectURL(blobUrl);
        }, 1500);
      }
    }

    log("saved audio", { mime, bytes: extracted.byteLength, withText: !!text });
    saveBtn.title = waT("saved");
    const st = wrap.querySelector(".wa-t-status");
    if (st && wrap.dataset.phase === "idle") st.hidden = true;
  } catch (err) {
    log("save audio failed", err);
    const reason = String((err && err.message) || err || "error");
    const dead = /context invalidated|Receiving end does not exist/i.test(reason);
    const noAudio = /NO_AUDIO/i.test(reason);
    saveBtn.title = waT("saveFailed");
    const status = wrap.querySelector(".wa-t-status");
    if (status) {
      status.hidden = false;
      status.textContent = dead
        ? isXSite()
          ? waT("extReloadedX")
          : waT("extReloadedWa")
        : noAudio
        ? isXSite()
          ? waT("extractFailX")
          : waT("extractFailWa")
        : waT("saveFailedDetail", (err && err.code) || reason);
    }
  } finally {
    setTimeout(() => {
      saveBtn.disabled = false;
      saveBtn.title = waT("saveAudio");
    }, 1800);
  }
}

async function startTranscribe(container, wrap) {
  const phase = wrap && wrap.dataset.phase;
  if (phase === "loading" || phase === "queued" || phase === "running") return;
  const failSend = (err) => {
    const dead = /context invalidated/i.test(String(err && err.message));
    setUi(wrap, { phase: "error", message: shownError(err, dead ? "RELOAD" : "OFFSCREEN") });
  };
  try {
    if (!chrome.runtime?.id) {
      failSend(new Error("Extension context invalidated."));
      return;
    }
  } catch (err) {
    failSend(err);
    return;
  }
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  wrap.dataset.requestId = requestId;
  setUi(wrap, { phase: "loading" });

  let extracted;
  try {
    if (wrap._extractedAudio) {
      extracted = wrap._extractedAudio;
    } else {
      extracted = await extractViaHook(container, requestId);
      wrap._extractedAudio = extracted;
    }
  } catch (err) {
    log("extract failed", err);
    setUi(wrap, { phase: "error", message: shownError(err, err.code || "NO_AUDIO") });
    return;
  }
  log("blob", {
    requestId,
    mime: extracted.mimeType || "unknown",
    bytes: extracted.byteLength,
  });

  // sendMessage can throw synchronously after an unpacked-extension reload;
  // lastError only covers failures delivered through the callback.
  try {
    chrome.runtime.sendMessage(
      {
        type: WA_MSG.TRANSCRIBE,
        requestId,
        audioBase64: extracted.base64,
        mimeType: extracted.mimeType || "audio/ogg",
        byteLength: extracted.byteLength,
      },
      () => {
        if (chrome.runtime.lastError) failSend(chrome.runtime.lastError);
      }
    );
  } catch (err) {
    failSend(err);
  }
}

function wrapForRequest(requestId) {
  return document.querySelector(`.wa-t-wrap[data-request-id="${CSS.escape(requestId)}"]`);
}

let uiPointerAt = 0;

function markUiPointer() {
  uiPointerAt = Date.now();
}

function recentUiPointer() {
  return Date.now() - uiPointerAt < 700;
}

function eventNode(ev) {
  const path = ev && typeof ev.composedPath === "function" ? ev.composedPath() : null;
  const t = (path && path[0]) || (ev && ev.target);
  if (!t) return null;
  return t.nodeType === 1 ? t : t.parentElement;
}

function ourUiHit(ev) {
  const node = eventNode(ev);
  if (!node || !node.closest) return null;
  return node.closest(".wa-t-btn, .wa-t-copy, .wa-t-save, .wa-t-act, .wa-t-mini, .wa-t-word, .wa-t-tools");
}

function seekWord(word) {
  const start = Number(word && word.dataset.start);
  const wrap = (word && word.closest && word.closest(".wa-t-wrap")) || null;
  const marker = wrap && wrap.dataset.waTId;
  if (!marker || !(start >= 0)) return;
  window.postMessage({ source: HOOK_SOURCE, type: "seek", marker, time: start }, "*");
}

function onUiPointerDown(ev) {
  const hit = ourUiHit(ev);
  if (!hit) return;
  ev.stopPropagation();
  if (ev.button != null && ev.button !== 0) return;
  if (ev.type === "mousedown" && recentUiPointer()) return;
  markUiPointer();
  const node = eventNode(ev);
  const word = node.closest(".wa-t-word");
  if (word) {
    ev.preventDefault();
    seekWord(word);
    return;
  }
  // Resumir, Traducir and the buttons of their result block.
  const act = node.closest(".wa-t-act, .wa-t-mini");
  if (act) {
    ev.preventDefault();
    if (!act.disabled && !act.hidden && typeof act._waRun === "function") act._waRun();
    return;
  }
  const btn = node.closest(".wa-t-btn");
  if (btn && !btn.disabled && !btn.hidden) {
    ev.preventDefault();
    const wrap = btn._waWrap || btn.closest(".wa-t-wrap");
    if (wrap) startTranscribe(wrap, wrap);
    return;
  }
  const copy = node.closest(".wa-t-copy");
  if (copy && !copy.hidden) {
    ev.preventDefault();
    copyTranscript(copy._waWrap || copy.closest(".wa-t-wrap"), copy);
    return;
  }
  const save = node.closest(".wa-t-save");
  if (save && !save.disabled && !save.hidden) {
    ev.preventDefault();
    const wrap = save._waWrap || save.closest(".wa-t-wrap");
    if (wrap) saveAudio(wrap, wrap, save, wrap._waOut || wrap.querySelector(".wa-t-text"));
  }
}

window.addEventListener("pointerdown", onUiPointerDown, true);
window.addEventListener("mousedown", onUiPointerDown, true);
for (const type of ["pointerup", "mouseup"]) {
  window.addEventListener(type, (ev) => {
    if (ourUiHit(ev)) ev.stopPropagation();
  }, true);
}
window.addEventListener("click", (ev) => {
  if (ourUiHit(ev) && recentUiPointer()) ev.stopPropagation();
}, true);

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== HOOK_SOURCE || data.type !== "playback") return;
  paintPlayback(data.marker, data.currentTime, data.playing);
});

function applyHighlightClass() {
  document.documentElement.classList.toggle("wa-t-no-highlight", highlightWords === false);
}

function currentSiteId() {
  if (typeof waSiteId !== "function") return "whatsapp";
  return waSiteId(location.href) || "whatsapp";
}

function siteAllowed(settings) {
  if (typeof waSiteEnabled !== "function") return true;
  return waSiteEnabled(settings, currentSiteId());
}

function applyPrefs(settings) {
  debugMode = !!(settings && settings.debugMode);
  highlightWords = !settings || settings.highlightWords !== false;
  applyHighlightClass();
  document.querySelectorAll(".wa-t-wrap").forEach(applyBadge);
  applyNotePrefs(settings);
  applySiteGate(settings || { sites: { whatsapp: true } });
  sweepNotes();
}

function applySiteGate(settings) {
  const on = isXSite() || siteAllowed(settings);
  siteOn = on;
  if (!on) {
    if (observing) {
      observer.disconnect();
      observing = false;
    }
    removeStaleWraps();
    return;
  }
  scan(document);
  if (!observing && document.body) {
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
    observing = true;
  }
}

function refreshDebug() {
  if (typeof waGetSettings !== "function") return;
  waGetSettings().then(applyPrefs).catch(() => applySiteGate({ sites: { whatsapp: true } }));
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.type) return;
  const wrap = msg.requestId ? wrapForRequest(msg.requestId) : null;
  if (!wrap) return;

  if (msg.type === WA_MSG.PROGRESS) {
    const phase = msg.phase || "running";
    setUi(wrap, { phase, message: msg.message });
  } else if (msg.type === WA_MSG.RESULT) {
    log("result", { requestId: msg.requestId, language: msg.language, engine: msg.engine, text: (msg.text || "").slice(0, 160) });
    setUi(wrap, {
      phase: "done",
      text: msg.text || "",
      engine: msg.engine,
      transcribeMs: msg.transcribeMs,
      words: msg.words,
    });
    rememberTranscript(wrap, msg);
  } else if (msg.type === WA_MSG.ERROR) {
    log("error ui", { requestId: msg.requestId, message: msg.message });
    setUi(wrap, { phase: "error", message: msg.message || shownError(null, "GENERIC") });
  }
});

let xDebugError = "";

function noteXDebugError(where, err) {
  const text = where + ": " + String((err && (err.message || err)) || err);
  if (text === xDebugError) return;
  xDebugError = text;
  log("x debug", xDebugError);
}

function scan(root) {
  if (!isXSite() && !siteOn) return;
  try {
    if (isXSite()) {
      if (!root || root === document || root === document.documentElement || root === document.body) xBootScan();
      else noteXAdded(root);
      return;
    }
    for (const container of findVoiceContainers(root || document)) inject(container);
  } catch (err) {
    noteXDebugError("scan", err);
  }
}

let scanTimer = 0;
function scheduleScan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(() => scan(document), 80);
}

const OUR_UI = ".wa-t-wrap, .wa-t-aside, .wa-t-foot, .wa-t-tools, .wa-t-btn, .wa-t-x-layer, .wa-t-x-debug";

function onDomMutations(mutations) {
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches?.(OUR_UI) || node.closest?.(OUR_UI)) continue;
      if (isXSite()) noteXAdded(node);
      else scan(node);
    }
    for (const node of m.removedNodes) {
      if (node.nodeType !== 1) continue;
      if (isXSite()) {
        rescueXFoot(node);
        scheduleLooseXFeet();
      }
      if (!isXSite() && (node.classList?.contains("wa-t-wrap") || node.querySelector?.(".wa-t-wrap"))) scheduleScan();
      if (node.matches?.(OUR_UI) || node.closest?.(OUR_UI)) continue;
      const tools = node.classList?.contains("wa-t-tools") ? node : node.querySelector?.(".wa-t-tools");
      const owner = tools && tools._waWrap;
      if (owner) setTimeout(() => parkTools(owner), 0);
    }
  }
}

const observer = new MutationObserver(onDomMutations);

// A previous content-script instance (extension reloaded without reloading the
// tab) leaves dead buttons behind. Remove them so only live ones remain.
function removeStaleWraps() {
  // Feet live in the emoji tray, outside the wrap. Drop them with the old script.
  const layer = document.getElementById("wa-t-x-layer");
  if (layer) layer.remove();
  xUis.clear();
  document.querySelectorAll(".wa-t-foot").forEach((n) => n.remove());
  document.querySelectorAll(".wa-t-wrap").forEach((n) => {
    const parent = n.parentElement;
    // A previous build moved WhatsApp's clock into the wrap. Put that node back.
    n.querySelectorAll(".wa-t-docked").forEach((el) => {
      if (el.classList.contains("wa-t-tools") || el.classList.contains("wa-t-foot") || el.classList.contains("wa-t-actions")) return;
      el.querySelectorAll(".wa-t-tools, .wa-t-foot").forEach((own) => n.append(own));
      el.classList.remove("wa-t-docked", "wa-t-meta", "wa-t-meta-stretch", "wa-t-share-time");
      if (parent) parent.insertBefore(el, n);
    });
    releaseTimeShare(n);
    n.remove();
  });
  document.querySelectorAll(".wa-t-share, .wa-t-share-lead, .wa-t-share-time, .wa-t-docked, .wa-t-tail, .wa-t-tail-stretch, .wa-t-tail-host, .wa-t-keep-start, .wa-t-stack").forEach((el) => {
    el.classList.remove("wa-t-share", "wa-t-share-lead", "wa-t-share-time", "wa-t-docked", "wa-t-tail", "wa-t-tail-stretch", "wa-t-tail-host", "wa-t-keep-start", "wa-t-stack");
  });
  document.querySelectorAll(".wa-t-host").forEach((n) => n.classList.remove("wa-t-host"));
}
