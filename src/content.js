/* TranscribeThem — content script. Logs: [wa-transcribe] */

// Patch these if WhatsApp changes testids.
const SELECTORS = {
  exclude: [
    "footer",
    "header",
    "#side",
    '[data-testid="chat-list"]',
    '[data-testid="chatlist"]',
    '[data-testid="compose-box"]',
    '[data-testid="conversation-compose-box-input"]',
    '[data-testid="conversation-compose-box"]',
    '[data-testid="quoted-message"]',
    '[data-testid="quoted-msg"]',
    '[aria-label*="Mensaje citado" i]',
    '[aria-label*="Quoted message" i]',
    '[aria-label*="Quoted" i]',
    ".quoted-mention",
  ],
  playIcon: [
    "audio",
    'span[data-icon="audio-play"]',
    'span[data-icon="audio-pause"]',
    'span[data-icon*="audio-play"]',
    'span[data-icon*="audio-pause"]',
    'span[data-icon*="ptt"]',
    '[data-testid="audio-play"]',
    '[data-testid="audio-pause"]',
    '[data-testid="ptt-audio"]',
    '[data-testid="audio-player"]',
    '[aria-label*="Mensaje de voz" i]',
    '[aria-label*="Voice message" i]',
    '[aria-label*="Play voice" i]',
    '[aria-label*="Reproducir mensaje de voz" i]',
    '[aria-label*="Reproducir" i]',
    '[aria-label*="Play" i]',
    '[aria-label*="Pausar" i]',
  ],
  container: ['[data-testid="msg-container"]', "div.copyable-text"],
  speed: /(?:^|\s)(?:1|1\.5|2)\s*[x×]/i,
  duration: /\b\d{1,2}:\d{2}\b/,
};

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
  if (code === "RELOAD") return "Recargá la pestaña de Mensajes en X.";
  if (code === "MEDIA_403") return "X no dejó bajar el audio (bloqueo o 403).";
  return msg;
}

function log(...args) {
  console.log(LOG, ...args);
}

function isExcluded(el) {
  if (!el || !el.closest) return true;
  for (const sel of SELECTORS.exclude) {
    if (el.closest(sel)) return true;
  }
  return false;
}

function hasPlayControl(node) {
  if (!node || !node.querySelector) return false;
  return SELECTORS.playIcon.some((sel) => {
    try {
      const match = node.matches?.(sel) ? node : node.querySelector(sel);
      if (!match) return false;
      if (isExcluded(match)) return false;
      return true;
    } catch (_) {
      return false;
    }
  });
}

function timeHits(text) {
  const out = [];
  const re = /\b(\d{1,2}):(\d{2})\b/g;
  let m;
  while ((m = re.exec(text || ""))) {
    out.push({ raw: m[0], twoDigit: m[1].length === 2, total: parseInt(m[1], 10) * 60 + parseInt(m[2], 10) });
  }
  return out;
}

function hasVoiceDuration(node) {
  return timeHits(node.textContent || "").some((t) => !t.twoDigit || t.total < 15 * 60);
}

function bubbleStyle(node) {
  try {
    return getComputedStyle(node);
  } catch (_) {
    return null;
  }
}

function isMessageRow(node) {
  if (!node || node.nodeType !== 1) return false;
  if (node.matches?.('[data-testid="msg-container"]')) return true;
  for (const sel of SELECTORS.container) {
    try {
      if (node.matches?.(sel) && sel.includes("msg-container")) return true;
    } catch (_) {
      /* ignore */
    }
  }
  return false;
}

function isFlexRow(node) {
  const st = bubbleStyle(node);
  if (!st) return false;
  const d = st.display;
  if (d !== "flex" && d !== "inline-flex") return false;
  const dir = st.flexDirection || "row";
  return dir === "row" || dir === "row-reverse";
}

function preferBubbleHost(node, row) {
  let n = node;
  for (let i = 0; i < 5 && n && n !== row && n !== document.body; i++) {
    if (!isFlexRow(n)) return n;
    const parent = n.parentElement;
    if (!parent || parent === row || isMessageRow(parent)) return n;
    n = parent;
  }
  return node;
}

function messageBubbleFrom(el) {
  if (!el || isExcluded(el)) return null;
  if (el.closest?.('[data-testid="quoted-message"], [data-testid="quoted-msg"], [aria-label*="citado" i], [aria-label*="quoted" i]')) {
    return null;
  }
  const row = el.closest?.('[data-testid="msg-container"]') || null;
  let n = el.nodeType === 1 ? el : el.parentElement;
  let inner = null;
  for (let i = 0; i < 20 && n && n !== document.body; i++) {
    if (isExcluded(n)) return null;
    if (isMessageRow(n)) break;
    if (hasPlayControl(n) && hasVoiceDuration(n)) {
      inner = n;
      break;
    }
    n = n.parentElement;
  }
  if (inner) return preferBubbleHost(inner, row);
  if (row && !isExcluded(row) && hasPlayControl(row)) {
    let c = el.nodeType === 1 ? el : el.parentElement;
    for (let i = 0; i < 16 && c && c !== row; i++) {
      if (hasPlayControl(c) && hasVoiceDuration(c)) return preferBubbleHost(c, row);
      c = c.parentElement;
    }
    return row;
  }
  return null;
}

function dedupeBubbles(nodes) {
  const arr = [...new Set(nodes.filter(Boolean))];
  return arr.filter((a) => !arr.some((b) => a !== b && a.contains(b)));
}

function findVoiceContainers(root) {
  if (isXSite()) return findXVoiceContainers(root);
  const found = new Set();
  const scope = root && root.querySelectorAll ? root : document;
  const add = (el) => {
    const bubble = messageBubbleFrom(el);
    if (bubble) found.add(bubble);
  };
  for (const sel of SELECTORS.playIcon) {
    let els;
    try {
      els = scope.querySelectorAll(sel);
    } catch (_) {
      continue;
    }
    for (const el of els) add(el);
  }
  if (root && root.nodeType === 1) add(root);
  const list = dedupeBubbles([...found]);
  if (!root || root === document || root === document.body) {
    log("scan bubbles", list.length);
  }
  return list;
}

function findXVoiceContainers(root) {
  const api = globalThis.WaXFind;
  if (!api) return [];
  if (api.xDiscoverWaves) {
    const found = api.xDiscoverWaves(root || document, 5000);
    return (found && found.hosts) || [];
  }
  const list = api.findVoiceHosts ? api.findVoiceHosts(root || document) : [];
  if (!root || root === document || root === document.body) log("scan x bubbles", list.length);
  return list;
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
    span.textContent = ms ? `⚡ Parakeet local (${ms} ms)` : "⚡ Parakeet local";
    badge.append(span);
  } else {
    badge.textContent = "Whisper (navegador)";
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

const CLOCK_RE = /^\d{1,2}:\d{2}$/;

function ownTimeText(el) {
  let text = "";
  for (const n of el.childNodes || []) {
    if (n.nodeType === 3) text += n.textContent || "";
  }
  return text.trim();
}

function playerRowOf(shell) {
  if (!shell || !shell.querySelector) return null;
  const slider = shell.querySelector('[role="slider"], input[type="range"]');
  if (!slider) return null;
  let n = slider.parentElement;
  for (let i = 0; i < 6 && n && n !== shell && n !== document.body; i++) {
    if (isFlexRow(n)) return n;
    n = n.parentElement;
  }
  return slider.parentElement;
}

function findClock(shell, wrap) {
  if (!shell || !shell.querySelectorAll) return null;
  const player = playerRowOf(shell);
  const meta = shell.querySelector('[data-testid="msg-meta"]');
  const pools = meta ? [meta, shell] : [shell];
  let fallback = null;
  const seen = new Set();
  for (const pool of pools) {
    let nodes;
    try {
      nodes = pool.querySelectorAll("span, div, time");
    } catch (_) {
      continue;
    }
    for (const el of nodes) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (wrap && (el === wrap || (wrap.contains && wrap.contains(el)))) continue;
      if (el.closest?.(".wa-t-wrap, .wa-t-tools, .wa-t-copy, .wa-t-save")) continue;
      if (player && player.contains && player.contains(el)) continue;
      if (el.closest?.('[data-testid="quoted-message"], [data-testid="quoted-msg"]')) continue;
      if (!CLOCK_RE.test(ownTimeText(el))) continue;
      const parent = el.parentElement;
      const checks = parent && parent.querySelector?.(
        "[data-icon*='check' i], [data-icon*='msg-dblcheck' i], [aria-label*='Leído' i], [aria-label*='Entregado' i], [aria-label*='Read' i], [aria-label*='Delivered' i]"
      );
      if (checks) return el;
      fallback = el;
    }
    if (meta && pool === meta && fallback) return fallback;
  }
  return fallback;
}

function releaseTimeShare(wrap) {
  const parent = wrap && wrap._waShareParent;
  if (parent && parent.classList) {
    parent.classList.remove("wa-t-share");
    if (parent.querySelectorAll) {
      parent.querySelectorAll(":scope > .wa-t-share-lead").forEach((el) => {
        el.classList.remove("wa-t-share-lead");
      });
    }
  }
  const row = wrap && wrap._waShareRow;
  if (row && row.classList) row.classList.remove("wa-t-share-time");
  if (wrap) {
    wrap._waShareParent = null;
    wrap._waShareRow = null;
    wrap.dataset.share = "";
  }
}

// One shot. Repeating this fights WhatsApp and the clock jumps left and right.
function shareTimeRow(wrap) {
  if (!wrap || wrap.dataset.share === "1") return;
  const parent = wrap.parentElement;
  if (!parent || !parent.classList || parent.classList.contains("wa-t-wrap")) return;
  const shell = wrap._waShell || parent;
  let clock = null;
  try {
    clock = findClock(shell, wrap);
  } catch (_) {
    clock = null;
  }
  if (!clock) return;
  let row = clock;
  while (row.parentElement && row.parentElement !== parent) {
    row = row.parentElement;
    if (row === wrap || row === document.body || row === document.documentElement) return;
  }
  if (!row || row.parentElement !== parent || row === wrap) return;
  if (row.querySelector && row.querySelector('[role="slider"], input[type="range"], .wa-t-wrap')) return;
  const timeText = (row.textContent || "").replace(/\s+/g, " ").trim();
  if (timeText.length > 16) return;
  if ((row.children ? row.children.length : 0) > 6) return;
  let sib = parent.firstElementChild;
  while (sib) {
    if (sib !== wrap && sib !== row) sib.classList.add("wa-t-share-lead");
    sib = sib.nextElementSibling;
  }
  parent.classList.add("wa-t-share");
  row.classList.add("wa-t-share-time");
  wrap._waShareParent = parent;
  wrap._waShareRow = row;
  wrap.dataset.share = "1";
}

function parkTools(wrap) {
  const tools = wrap && wrap._waTools;
  if (!tools) return;
  const out = wrap._waOut || wrap.querySelector(".wa-t-text");
  const home = (out && out.querySelector && out.querySelector(".wa-t-grow")) || out;
  releaseTimeShare(wrap);
  clearMetaPin(wrap);
  releaseClockEnd(wrap);
  if (home && tools.parentElement !== home) home.append(tools);
  tools.classList.remove("wa-t-tools-meta");
}

// Our transcript is the last child of the bubble, under the clock.
// Moves only our node, once, so the message time stays where WhatsApp put it.
function placeBelowClock(wrap) {
  if (!wrap || wrap._waBelowOnce) return;
  const bubble = wrap._waBubble;
  if (!bubble || !bubble.appendChild || !bubble.contains || !bubble.contains(wrap)) return;
  wrap._waBelowOnce = true;
  if (bubble.lastElementChild !== wrap) bubble.appendChild(wrap);
}

// True when the pointer moved into the message, our buttons, or the emoji tray.
// Leaving the message for the emoji must keep the buttons up, same as the smiley.
function pointerStillInside(wrap, ev) {
  const next = ev && ev.relatedTarget;
  const node = next && next.nodeType === 1 ? next : next && next.parentElement;
  if (!node || !node.closest) return false;
  const zones = [wrap._waHoverShell, wrap._waFoot, wrap._waEmojiHost];
  for (const zone of zones) {
    if (zone && zone.contains && zone.contains(node)) return true;
  }
  return false;
}

function bindHover(wrap) {
  if (!wrap || wrap._waHoverShell) return;
  const foot = wrap._waFoot;
  const shell = wrap._waShell || wrap._waBubble;
  if (!foot || !shell || !shell.addEventListener) return;
  wrap._waHoverShell = shell;
  let timer = 0;
  const reveal = () => {
    if (wrap._waHovering) foot.classList.add("is-on");
  };
  const show = () => {
    wrap._waHovering = true;
    if (wrap._waEmojiGaveUp) {
      reveal();
      return;
    }
    if (dockWithEmoji(wrap)) {
      reveal();
      return;
    }
    // The tray is often inserted a moment after the pointer enters.
    let tries = 0;
    clearTimeout(timer);
    const tick = () => {
      if (!wrap._waHovering) return;
      if (dockWithEmoji(wrap)) {
        reveal();
        return;
      }
      tries += 1;
      if (tries < 5) {
        timer = setTimeout(tick, 50);
        return;
      }
      reveal();
    };
    timer = setTimeout(tick, 40);
  };
  const hide = (ev) => {
    if (pointerStillInside(wrap, ev)) return;
    wrap._waHovering = false;
    clearTimeout(timer);
    foot.classList.remove("is-on");
  };
  const watch = (el) => {
    if (!el || !el.addEventListener || el._waHoverBound === wrap) return;
    el._waHoverBound = wrap;
    el.addEventListener("pointerenter", show);
    el.addEventListener("pointerleave", hide);
  };
  wrap._waWatchHover = watch;
  watch(shell);
  watch(foot);
  if (wrap._waEmojiHost) watch(wrap._waEmojiHost);
}

const EMOJI_BTN = /reaccionar|reacci[oó]n|react|emoji|smiley|mood|ic-mood/i;

function isOurNode(el) {
  return !!(el && el.closest && el.closest(".wa-t-wrap, .wa-t-aside, .wa-t-foot, .wa-t-btn, .wa-t-save"));
}

function messageRoot(wrap) {
  const bubble = wrap && wrap._waBubble;
  const shell = wrap && wrap._waShell;
  const from = bubble || shell;
  let id = null;
  try {
    id = from && from.closest ? from.closest("[data-id]") : null;
  } catch (_) {
    id = null;
  }
  if (id && sliderCount(id) <= 1) return id;
  if (shell && sliderCount(shell) <= 1) return shell;
  return from || null;
}

function emojiLabel(el) {
  const icon = el.getAttribute?.("data-icon") || el.querySelector?.("[data-icon]")?.getAttribute?.("data-icon") || "";
  return `${el.getAttribute?.("aria-label") || ""} ${el.getAttribute?.("title") || ""} ${icon}`;
}

function findReactButton(root) {
  if (!root || !root.querySelectorAll) return null;
  let nodes;
  try {
    nodes = root.querySelectorAll("button, [role='button'], [data-icon]");
  } catch (_) {
    return null;
  }
  for (const el of nodes) {
    if (isOurNode(el)) continue;
    if (!EMOJI_BTN.test(emojiLabel(el))) continue;
    const btn = el.closest?.("button, [role='button']") || el;
    if (!btn || isOurNode(btn)) continue;
    return btn;
  }
  return null;
}

// Count visible controls, not a button nested inside another button.
function trayButtons(host) {
  if (!host || !host.querySelectorAll) return 0;
  let nodes;
  try {
    nodes = host.querySelectorAll("button, [role='button']");
  } catch (_) {
    return 0;
  }
  const found = [];
  for (const el of nodes) {
    if (isOurNode(el)) continue;
    if (found.some((parent) => parent.contains(el))) continue;
    found.push(el);
    if (found.length > 4) return found.length;
  }
  return found.length;
}

function hostFromButton(btn, root) {
  if (!btn || !btn.parentElement) return null;
  let host = btn.parentElement;
  let fallback = null;
  for (let i = 0; i < 5 && host && host !== document.body && host !== root; i++) {
    if (sliderCount(host) > 0) break;
    const count = trayButtons(host);
    if (count >= 2 && count <= 4) return host;
    if (!fallback && host.children && host.children.length > 0 && host.children.length <= 4) fallback = host;
    host = host.parentElement;
  }
  if (fallback && sliderCount(fallback) === 0) return fallback;
  return btn.parentElement && sliderCount(btn.parentElement) === 0 ? btn.parentElement : null;
}

// Prefer the react control nearest this bubble when the tray is outside [data-id].
function nearestReactButton(root, bubble) {
  if (!root || !root.querySelectorAll || !bubble || !bubble.getBoundingClientRect) return null;
  let bubbleRect;
  try {
    bubbleRect = bubble.getBoundingClientRect();
  } catch (_) {
    return null;
  }
  if (!(bubbleRect.width > 8)) return null;
  let nodes;
  try {
    nodes = root.querySelectorAll("button, [role='button'], [data-icon]");
  } catch (_) {
    return null;
  }
  let best = null;
  let bestDist = 160;
  for (const el of nodes) {
    if (isOurNode(el) || !EMOJI_BTN.test(emojiLabel(el))) continue;
    const btn = el.closest?.("button, [role='button']") || el;
    if (!btn || isOurNode(btn)) continue;
    let r;
    try {
      r = btn.getBoundingClientRect();
    } catch (_) {
      continue;
    }
    if (r.width < 2 || r.height < 2) continue;
    const dx = Math.min(
      Math.abs(r.left - bubbleRect.right),
      Math.abs(r.right - bubbleRect.left),
      Math.abs(r.left - bubbleRect.left)
    );
    const dy = Math.abs((r.top + r.bottom) / 2 - bubbleRect.top);
    const dist = dx + dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = btn;
    }
  }
  return best;
}

// The smiley and the chevron share one hover tray. Join that tray.
function findEmojiHost(shell, wrap) {
  const root = (wrap && messageRoot(wrap)) || shell;
  const scoped = root && findReactButton(root);
  if (scoped) return hostFromButton(scoped, root);
  const bubble = wrap && wrap._waBubble;
  if (shell && shell !== root) {
    const btn = nearestReactButton(shell, bubble);
    if (btn) return hostFromButton(btn, shell);
  }
  return null;
}

function noteRedock(wrap) {
  const now = Date.now();
  const recent = (wrap._waRedocks || []).filter((t) => now - t < 2000);
  if (recent.length >= 6) return false;
  recent.push(now);
  wrap._waRedocks = recent;
  return true;
}

function giveUpEmoji(wrap) {
  if (!wrap || wrap._waEmojiGaveUp) return;
  wrap._waEmojiGaveUp = true;
  wrap._waEmojiDock = false;
  if (wrap._waEmojiWatch) {
    wrap._waEmojiWatch.disconnect();
    wrap._waEmojiWatch = null;
  }
  const foot = wrap._waFoot;
  if (foot) {
    foot.classList.remove("wa-t-emoji-host");
    foot.classList.add("wa-t-aside");
    if (!wrap._waHovering) foot.classList.remove("is-on");
  }
  if (wrap._waEmojiHost && wrap._waEmojiHost.classList) wrap._waEmojiHost.classList.remove("wa-t-stack");
  wrap._waAsideOnce = false;
  placeAside(wrap);
}

function paintLikeEmoji(wrap, host) {
  const sample = findReactButton(host) || findReactButton(messageRoot(wrap));
  if (!sample) return;
  let st;
  try {
    st = getComputedStyle(sample);
  } catch (_) {
    return;
  }
  const w = parseFloat(st.width);
  const h = parseFloat(st.height);
  if (!(w >= 16 && w <= 64 && h >= 16 && h <= 64)) return;
  for (const el of [wrap._waBtn, wrap._waCopy, wrap._waSave]) {
    if (!el || !el.style) continue;
    el.style.width = `${Math.round(w)}px`;
    el.style.height = `${Math.round(h)}px`;
    if (st.color) el.style.color = st.color;
    el.style.borderRadius = st.borderRadius || "999px";
  }
}

// If WhatsApp reconciles the tray and drops our node, put it back.
// Stop if that happens in a tight loop and use the hover fallback instead.
function holdEmojiDock(wrap, host) {
  if (wrap._waEmojiHost === host && wrap._waEmojiWatch) return;
  if (wrap._waEmojiWatch) wrap._waEmojiWatch.disconnect();
  wrap._waEmojiHost = host;
  let scheduled = false;
  const obs = new MutationObserver(() => {
    if (scheduled || wrap._waEmojiGaveUp || !wrap._waEmojiDock) return;
    const foot = wrap._waFoot;
    if (!foot || foot.parentElement === host) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (wrap._waEmojiGaveUp || !wrap._waEmojiDock) return;
      if (!host.isConnected) {
        wrap._waEmojiDock = false;
        dockWithEmoji(wrap);
        return;
      }
      if (!foot || foot.parentElement === host) return;
      if (!noteRedock(wrap)) {
        giveUpEmoji(wrap);
        return;
      }
      try {
        host.appendChild(foot);
      } catch (_) {
        giveUpEmoji(wrap);
      }
    });
  });
  try {
    obs.observe(host, { childList: true });
  } catch (_) {
    return;
  }
  wrap._waEmojiWatch = obs;
}

function dockWithEmoji(wrap) {
  if (wrap && wrap.dataset.site === "x") return false;
  const foot = wrap && wrap._waFoot;
  if (!foot || wrap._waEmojiGaveUp) return false;
  const shell = wrap._waShell || wrap._waBubble || wrap.parentElement;
  const host = findEmojiHost(shell, wrap);
  if (!host || !host.appendChild || host === foot || foot.contains?.(host)) return false;
  if (sliderCount(host) > 0) return false;
  if (foot.parentElement !== host) {
    if (!noteRedock(wrap)) {
      giveUpEmoji(wrap);
      return false;
    }
    try {
      host.appendChild(foot);
    } catch (_) {
      return false;
    }
  }
  // Drop wa-t-aside. The tray stays mounted after the first hover and WhatsApp
  // only fades its own buttons, so is-on is what shows and hides ours.
  foot.classList.add("wa-t-emoji-host");
  foot.classList.remove("wa-t-aside");
  if (!wrap._waHovering) foot.classList.remove("is-on");
  if (host.classList) host.classList.add("wa-t-stack");
  foot.dataset.side = wrap.dataset.side === "out" ? "out" : "in";
  wrap._waEmojiDock = true;
  wrap._waAsideOnce = true;
  paintLikeEmoji(wrap, host);
  holdEmojiDock(wrap, host);
  if (wrap._waWatchHover) wrap._waWatchHover(host);
  return true;
}

// Pull the small clock row to the end of the bubble. Never reparents WhatsApp
// nodes and never sets position or display on them. Classes are added once.
function markKeepStart(host, clock) {
  if (!host || !host.children) return;
  for (const child of host.children) {
    if (child === clock) continue;
    if (child.classList?.contains("wa-t-tools") || child.classList?.contains("wa-t-wrap") || child.classList?.contains("wa-t-tail")) continue;
    if (typeof child.contains === "function" && child.contains(clock)) continue;
    if (!child.classList.contains("wa-t-keep-start")) child.classList.add("wa-t-keep-start");
  }
}

function seatClockEnd(wrap) {
  if (!wrap) return;
  let clock = null;
  try {
    clock = findClock(wrap._waShell || wrap.parentElement, wrap);
  } catch (_) {
    clock = null;
  }
  if (!clock || !clock.parentElement) return;
  const row = clock.parentElement;
  const holdsNote = row === wrap || !!(row.contains && row.contains(wrap));
  const holdsSlider = !!(row.querySelector && row.querySelector('[role="slider"], input[type="range"]'));
  if (!holdsNote && !holdsSlider) {
    if (wrap._waTailRow === row && row.isConnected && row.classList.contains("wa-t-tail")) return;
    if (!row.classList.contains("wa-t-tail")) {
      row.classList.add("wa-t-tail");
      const bubble = wrap._waBubble;
      if (bubble && bubble.getBoundingClientRect && bubble.contains && bubble.contains(row)) {
        let bubbleRight = 0;
        try {
          bubbleRight = bubble.getBoundingClientRect().right;
        } catch (_) {
          bubbleRight = 0;
        }
        let n = row.parentElement;
        while (n && n !== bubble && bubble.contains(n) && bubbleRight) {
          if (n === wrap || n.classList?.contains("wa-t-wrap")) break;
          let right = bubbleRight;
          try {
            right = n.getBoundingClientRect().right;
          } catch (_) {
            break;
          }
          if (!(bubbleRight - right > 24)) break;
          if (!n.classList.contains("wa-t-tail-stretch")) n.classList.add("wa-t-tail-stretch");
          n = n.parentElement;
        }
      }
    }
    let inline = false;
    try {
      const display = getComputedStyle(row).display || "";
      inline = display === "inline" || display === "contents";
    } catch (_) {
      inline = false;
    }
    const host = row.parentElement;
    if (inline && host && host.classList && !host.classList.contains("wa-t-wrap") && !host.classList.contains("wa-t-tail-host")) {
      host.classList.add("wa-t-tail-host");
      markKeepStart(host, row);
    }
    wrap._waTailRow = row;
    return;
  }
  if (holdsSlider || row.classList.contains("wa-t-tail-host")) return;
  row.classList.add("wa-t-tail-host");
  markKeepStart(row, clock);
  wrap._waTailRow = row;
}

function releaseClockEnd(wrap) {
  const shell = wrap && (wrap._waShell || wrap.parentElement);
  if (!shell || !shell.querySelectorAll) return;
  shell.querySelectorAll(".wa-t-tail, .wa-t-tail-stretch, .wa-t-tail-host, .wa-t-keep-start").forEach((el) => {
    el.classList.remove("wa-t-tail", "wa-t-tail-stretch", "wa-t-tail-host", "wa-t-keep-start");
  });
  wrap._waTailRow = null;
}

function clearMetaPin(wrap) {
  const shell = wrap && (wrap._waShell || wrap.parentElement);
  if (!shell || !shell.querySelectorAll) return;
  shell.querySelectorAll(".wa-t-meta, .wa-t-meta-stretch").forEach((el) => {
    el.classList.remove("wa-t-meta", "wa-t-meta-stretch");
  });
}

// Incoming bubbles center the time row. Outgoing ones already sit on the right.
function pinIncomingMeta(clock, wrap) {
  if (!wrap) return;
  if (!wrap.dataset.side) alignWrap(wrap);
  if (wrap.dataset.side === "out") {
    clearMetaPin(wrap);
    return;
  }
  const bubble = wrap._waBubble;
  const row = clock && clock.parentElement;
  if (!row) return;
  if (wrap && row.contains && row.contains(wrap)) return;
  if (row.querySelector && row.querySelector('[role="slider"], input[type="range"]')) return;
  row.classList.add("wa-t-meta");
  if (!bubble || !bubble.getBoundingClientRect || !bubble.contains || !bubble.contains(row)) return;
  const bubbleRight = bubble.getBoundingClientRect().right;
  let n = row.parentElement;
  while (n && n !== bubble && bubble.contains(n)) {
    if (n === wrap || n.classList?.contains("wa-t-wrap")) break;
    const rect = n.getBoundingClientRect();
    if (!(bubbleRight - rect.right > 24)) break;
    n.classList.add("wa-t-meta-stretch");
    n = n.parentElement;
  }
}

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
    idle: "Transcribir",
    queued: "En cola…",
    loading: "Leyendo audio…",
    running: "Transcribiendo…",
    error: "Reintentar",
  };
  let label = labels[phase] || "Transcribir";
  if (phase === "loading" && message && /modelo|whisper/i.test(message)) label = "Cargando modelo…";
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

  // Copy takes the transcribe slot once that button hides.
  if (actions && btn && copyBtn && saveBtn) {
    const order = [btn, copyBtn, saveBtn];
    if (order.some((el, i) => actions.children[i] !== el)) actions.append(btn, copyBtn, saveBtn);
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
}

function sliderCount(node) {
  if (!node || !node.querySelectorAll) return 0;
  try {
    return node.querySelectorAll('[role="slider"], input[type="range"]').length;
  } catch (_) {
    return 0;
  }
}

// One voice note. Prefer the ancestor that holds a single waveform, then the
// message row. Never the chat list.
function singleMessage(el) {
  if (!el) return null;
  const chain = [];
  let n = el;
  for (let i = 0; i < 14 && n && n !== document.body && n !== document.documentElement; i++) {
    chain.push(n);
    n = n.parentElement;
  }
  let best = null;
  for (const node of chain) {
    const count = sliderCount(node);
    if (count === 1) best = node;
    if (count > 1) break;
  }
  if (best) return best;
  for (const node of chain) {
    try {
      if (node.matches?.('[data-testid="msg-container"], [data-id]')) return node;
    } catch (_) {
      /* ignore */
    }
  }
  const row = el.closest?.('[role="row"]');
  if (row && sliderCount(row) <= 1) return row;
  return el.parentElement || el;
}

function resolveWrap(container) {
  if (!container) return null;
  if (container.classList?.contains("wa-t-wrap")) return container;
  const inside = container.querySelector?.(".wa-t-wrap");
  if (inside) return inside;
  const shell = singleMessage(container);
  return shell && shell.querySelector ? shell.querySelector(".wa-t-wrap") : null;
}

function firstControl(container) {
  if (!container) return null;
  for (const sel of SELECTORS.playIcon) {
    let el = null;
    try {
      el = container.matches?.(sel) ? container : container.querySelector?.(sel);
    } catch (_) {
      el = null;
    }
    if (el && !isExcluded(el) && !el.closest?.(".wa-t-wrap")) return el;
  }
  return container;
}

function alignWrap(wrap) {
  if (wrap && wrap.dataset.site === "x") return;
  const bubble = wrap._waBubble;
  const shell = wrap._waShell;
  if (!bubble || !bubble.getBoundingClientRect) return;
  const bw = bubble.getBoundingClientRect();
  if (!(bw.width > 48)) return;
  const insideBubble = typeof bubble.contains === "function" && bubble.contains(wrap) && !wrap._waInRow;
  wrap.style.setProperty("width", insideBubble ? "100%" : Math.round(bw.width) + "px", "important");
  wrap.style.setProperty("max-width", "100%", "important");
  const sw = shell && shell.getBoundingClientRect ? shell.getBoundingClientRect() : bw;
  const outgoing = sw.width > 0 && (bw.left + bw.right) / 2 > (sw.left + sw.right) / 2 + 8;
  wrap.dataset.side = outgoing ? "out" : "in";
  if (wrap._waInRow) {
    if (outgoing) {
      wrap.style.marginLeft = "auto";
      wrap.style.marginRight = Math.max(0, Math.round(sw.right - bw.right)) + "px";
    } else {
      wrap.style.marginLeft = Math.max(0, Math.round(bw.left - sw.left)) + "px";
      wrap.style.marginRight = "auto";
    }
  } else {
    wrap.style.marginLeft = outgoing ? "auto" : "0";
    wrap.style.marginRight = outgoing ? "0" : "auto";
  }
  const inside = typeof bubble.contains === "function" && bubble.contains(wrap);
  if (inside && !wrap._waInRow) {
    wrap.style.background = "";
    wrap.style.borderRadius = "";
  } else {
    try {
      const st = getComputedStyle(bubble);
      if (st && st.backgroundColor) wrap.style.background = st.backgroundColor;
      if (st && st.borderRadius) wrap.style.borderRadius = st.borderRadius;
    } catch (_) {
      /* ignore */
    }
  }
}

function outerBubble(inner, shell) {
  let edge = inner;
  if (!inner || !inner.parentElement) return inner;
  let n = inner;
  while (n && n.parentElement && n !== shell && n !== document.body) {
    const parent = n.parentElement;
    if (sliderCount(parent) > 1) break;
    if (isFlexRow(parent)) {
      try {
        const pw = parent.getBoundingClientRect().width;
        const nw = n.getBoundingClientRect().width;
        if (pw > nw + 36) return n;
      } catch (_) {
        return n;
      }
    }
    edge = n;
    n = parent;
  }
  return edge;
}

function xOutgoing(node) {
  let n = node;
  for (let i = 0; i < 10 && n; i++) {
    const side = n.getAttribute && n.getAttribute("data-side");
    if (side === "end") return true;
    if (side === "start") return false;
    const cls = String(n.className || "");
    if (/\bjustify-end\b/.test(cls)) return true;
    if (/\bjustify-start\b/.test(cls)) return false;
    n = n.parentElement;
  }
  if (node && node.querySelector) {
    try {
      const inner = node.querySelector("[data-side='end'], [data-side='start']");
      if (inner) return inner.getAttribute("data-side") === "end";
    } catch (_) {
      /* the side stays incoming */
    }
  }
  return false;
}

const xUis = new Map();
// Virtual rows ignore CSS margin. The sizer has to grow by this many pixels
// or the next message stays flush with the transcript.
const X_TRANSCRIPT_GAP = 12;

function xLayer() {
  let layer = document.getElementById("wa-t-x-layer");
  if (layer && layer.isConnected) return layer;
  layer = document.createElement("div");
  layer.id = "wa-t-x-layer";
  layer.className = "wa-t-x-layer";
  (document.body || document.documentElement).appendChild(layer);
  return layer;
}

function xRowId(message) {
  if (!message || !message.getAttribute) return "";
  return message.getAttribute("data-dm-message-row") || message.getAttribute("data-testid") || "";
}

const X_SHADOW_CSS = `
.wa-t-wrap[data-site="x"] {
  display: flex;
  flex-direction: column;
  flex: 1 0 100%;
  width: 100%;
  max-width: min(460px, 100%);
  box-sizing: border-box;
  margin: 6px 0 12px;
  padding: 8px 12px;
  border-radius: 16px;
  background: #2f3336;
  color: #e7e9ea;
  font: 14.5px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  pointer-events: auto;
  user-select: text;
  position: relative;
  clear: both;
}
.wa-t-wrap[data-site="x"][data-side="out"] { margin-left: auto; }
.wa-t-wrap[data-site="x"][data-side="in"] { margin-right: auto; }
.wa-t-wrap[data-site="x"][hidden] { display: none !important; }
.wa-t-text {
  display: grid;
  grid-template-rows: 0fr;
  max-width: 100%;
  opacity: 0;
  transition: grid-template-rows 0.32s ease, opacity 0.28s ease;
}
.wa-t-text.is-open { grid-template-rows: 1fr; opacity: 1; }
.wa-t-grow { overflow: hidden; min-height: 0; }
.wa-t-body { white-space: pre-wrap; overflow-wrap: anywhere; }
.wa-t-wrap[data-site="x"] .wa-t-tools { display: none !important; }
.wa-t-word { display: inline-grid; vertical-align: baseline; cursor: pointer; border-radius: 3px; white-space: nowrap; }
.wa-t-word::before, .wa-t-word-tx { grid-area: 1 / 1; align-self: baseline; }
.wa-t-word::before { content: attr(data-text) / ""; font-weight: 700; visibility: hidden; pointer-events: none; user-select: none; }
.wa-t-word.is-upcoming { opacity: 0.4; }
.wa-t-word.is-on { background: rgba(255, 255, 255, 0.16); opacity: 1; }
.wa-t-word.is-on .wa-t-word-tx { font-weight: 700; }
@media (prefers-reduced-motion: reduce) {
  .wa-t-text { transition: none; }
}
.wa-t-foot.wa-t-x-tools {
  display: inline-flex;
  position: static;
  width: auto;
  margin: 0;
  padding: 0;
  gap: 0;
  background: transparent;
  align-items: center;
  opacity: 1;
  pointer-events: auto;
  flex: 0 0 auto;
}
.wa-t-x-tools .wa-t-actions { display: inline-flex; gap: 0; }
.wa-t-x-tools .wa-t-btn,
.wa-t-x-tools .wa-t-copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
  border: 0;
  box-shadow: none;
  color: inherit;
  width: 32px;
  height: 32px;
  opacity: 0.9;
  overflow: hidden;
}
.wa-t-btn-label { display: none !important; }
.wa-t-x-tools .wa-t-btn svg,
.wa-t-x-tools .wa-t-copy svg {
  width: 16px;
  height: 16px;
  display: block;
}
.wa-t-x-tools .wa-t-save,
.wa-t-x-tools [hidden] { display: none !important; }
.wa-t-x-tools button { cursor: pointer; border-radius: 9999px; }
.wa-t-x-tools button:hover { background: var(--color-gray-100, rgba(255,255,255,.08)); }
.wa-t-x-tools button:disabled { cursor: progress; opacity: .5; }
`;

const xShadowSheets = new WeakMap();

function ensureXShadowStyle(node) {
  const root = node && node.getRootNode ? node.getRootNode() : null;
  if (!root || root.nodeType !== 11 || xShadowSheets.has(root)) return;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(X_SHADOW_CSS);
    root.adoptedStyleSheets = [...(root.adoptedStyleSheets || []), sheet];
    xShadowSheets.set(root, sheet);
  } catch (_) {
    try {
      const style = document.createElement("style");
      style.textContent = X_SHADOW_CSS;
      root.appendChild(style);
      xShadowSheets.set(root, style);
    } catch (_) {
      /* the bubble still has inline layout */
    }
  }
}

function nodeInside(node, ancestor) {
  let n = node;
  for (let i = 0; i < 36 && n; i++) {
    if (n === ancestor) return true;
    const root = typeof n.getRootNode === "function" ? n.getRootNode() : null;
    const next = n.parentElement || (root && root.nodeType === 11 && root.host) || null;
    if (!next || next === n) return false;
    n = next;
  }
  return false;
}

function xItemBox(row) {
  if (!row) return row;
  const cached = row._waTItem;
  if (cached && cached.isConnected && nodeInside(row, cached)) return cached;
  let n = row;
  let found = null;
  for (let i = 0; i < 8 && n; i++) {
    let abs = false;
    try {
      abs = getComputedStyle(n).position === "absolute" || /translate3d|translateY/.test((n.style && n.style.transform) || "");
    } catch (_) {
      abs = false;
    }
    if (n !== row && (abs || (n.hasAttribute && n.hasAttribute("data-index")))) {
      found = n;
      break;
    }
    const root = typeof n.getRootNode === "function" ? n.getRootNode() : null;
    const next = n.parentElement || (root && root.host) || null;
    if (!next || next === n) break;
    n = next;
  }
  if (!found) found = row.parentElement || row;
  row._waTItem = found;
  return found;
}

// The page hook finds the note by data-wa-t-id. While the transcript is hidden
// the wrap is not in the message, so the foot on the light-DOM layer keeps the
// same id and the row id. Removing the wrap makes extract throw NO_AUDIO.
function stampXMarker(wrap) {
  const foot = wrap && wrap._waFoot;
  if (!wrap || !foot) return;
  if (wrap.dataset.waTId) foot.dataset.waTId = wrap.dataset.waTId;
  const id = wrap.dataset.xRow || xRowId(wrap._waShell);
  if (!id) return;
  wrap.dataset.xRow = id;
  foot.dataset.xRow = id;
}

function parkXWrap(wrap) {
  const layer = xLayer();
  if (!layer || wrap.parentElement === layer) return;
  layer.appendChild(wrap);
}

// The transcript bubble is only text. Copy and transcribe stay on the foot.
function keepXFootOutOfTranscript(wrap) {
  const foot = wrap && wrap._waFoot;
  const actions = wrap && wrap._waActions;
  const copy = wrap && wrap._waCopy;
  const btn = wrap && wrap._waBtn;
  const save = wrap && wrap._waSave;
  if (actions && btn && copy && save && (btn.parentElement !== actions || copy.parentElement !== actions)) {
    actions.append(btn, copy, save);
  }
  if (!foot || !wrap || !wrap.contains || !wrap.contains(foot)) return;
  const layer = xLayer();
  if (!layer) return;
  foot.classList.remove("is-docked");
  foot.style.visibility = "hidden";
  if (foot.parentElement !== layer) layer.appendChild(foot);
}

function solidColor(value) {
  const color = String(value || "").trim();
  if (!color || color === "transparent") return "";
  if (/^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/.test(color)) return "";
  return color;
}

// The voice pill already sits in the message padding. Match that inset and its fill.
function alignXTranscript(wrap, item) {
  const play = currentXPlay(wrap, wrap._waShell);
  const pill = play && play.parentElement;
  if (!pill || !item || !pill.getBoundingClientRect) return;
  let itemRect = null;
  let pillRect = null;
  try {
    itemRect = item.getBoundingClientRect();
    pillRect = pill.getBoundingClientRect();
  } catch (_) {
    return;
  }
  if (itemRect.width < 8 || pillRect.width < 8) return;
  let padLeft = 0;
  let padRight = 0;
  try {
    const st = getComputedStyle(item);
    padLeft = (parseFloat(st.borderLeftWidth) || 0) + (parseFloat(st.paddingLeft) || 0);
    padRight = (parseFloat(st.borderRightWidth) || 0) + (parseFloat(st.paddingRight) || 0);
  } catch (_) {
    padLeft = 0;
    padRight = 0;
  }
  const contentLeft = itemRect.left + padLeft;
  const contentRight = itemRect.right - padRight;
  const out = wrap.dataset.side === "out";
  const pad = out
    ? Math.max(0, Math.round(contentRight - pillRect.right))
    : Math.max(0, Math.round(pillRect.left - contentLeft));
  const room = Math.max(120, Math.round(contentRight - contentLeft - pad * 2));
  const width = Math.min(460, room);
  wrap.style.marginLeft = out ? "auto" : pad + "px";
  wrap.style.marginRight = out ? pad + "px" : "auto";
  wrap.style.width = width + "px";
  wrap.style.maxWidth = width + "px";
}

function paintXBubble(wrap) {
  if (wrap.dataset.waTBg) return;
  const row = wrap._waShell;
  let n = wrap._waPlay ? wrap._waPlay.parentElement : null;
  for (let i = 0; i < 5 && n && n !== row && n !== document.body; i++) {
    let bg = "";
    let fg = "";
    try {
      const st = getComputedStyle(n);
      bg = solidColor(st.backgroundColor);
      fg = solidColor(st.color);
    } catch (_) {
      break;
    }
    if (bg) {
      wrap.dataset.waTBg = bg;
      wrap.style.backgroundColor = bg;
      if (fg) wrap.style.color = fg;
      return;
    }
    n = n.parentElement;
  }
}

function placeXTranscript(wrap) {
  if (!wrap || wrap.dataset.site !== "x") return;
  stampXMarker(wrap);
  const row = wrap._waShell;
  if (wrap.hidden || !row || !row.isConnected) {
    parkXWrap(wrap);
    return;
  }
  const item = xItemBox(row);
  if (!item || !item.appendChild) return;
  ensureXShadowStyle(item);
  const scrollH = wrap.scrollHeight || 0;
  if (
    wrap._waFitDone &&
    wrap.parentElement === item &&
    wrap._waFitScroll === scrollH &&
    (!wrap._waFitAfter || Date.now() >= wrap._waFitAfter)
  ) {
    return;
  }
  wrap.style.position = "relative";
  wrap.style.top = "auto";
  wrap.style.left = "auto";
  wrap.style.right = "auto";
  wrap.style.visibility = "visible";
  wrap.style.transform = "none";
  wrap.style.boxSizing = "border-box";
  wrap.style.flex = "0 0 auto";
  wrap.style.marginBottom = X_TRANSCRIPT_GAP + "px";
  keepXFootOutOfTranscript(wrap);
  alignXTranscript(wrap, item);
  paintXBubble(wrap);
  try {
    const display = getComputedStyle(item).display || "";
    if (display.includes("flex") && item.style.flexWrap !== "wrap") item.style.flexWrap = "wrap";
  } catch (_) {
    /* leave the row's display alone */
  }
  if (wrap.parentElement !== item) item.appendChild(wrap);
  fitXItem(item, wrap);
}

function fitXItem(item, wrap) {
  if (!item || !wrap) return;
  let itemRect = null;
  let textRect = null;
  try {
    itemRect = item.getBoundingClientRect();
    textRect = wrap.getBoundingClientRect();
  } catch (_) {
    return;
  }
  if (itemRect.height < 2 || textRect.height < 2) return;
  // The gap lives in margin, which this rect does not include.
  const overflow = textRect.bottom + X_TRANSCRIPT_GAP - itemRect.bottom;
  if (overflow <= 2) {
    if (!wrap._waFitAfter || Date.now() >= wrap._waFitAfter) {
      wrap._waFitDone = true;
      wrap._waFitScroll = wrap.scrollHeight || 0;
    }
    return;
  }
  const add = Math.ceil(overflow);
  const stamp = Math.round(textRect.height) + ":" + add;
  if (wrap._waFitStamp === stamp && Date.now() - (wrap._waFitAt || 0) < 80) return;
  wrap._waFitStamp = stamp;
  wrap._waFitAt = Date.now();
  wrap._waFitDone = false;
  let abs = false;
  try {
    abs = getComputedStyle(item).position === "absolute" || !!item.style.height;
  } catch (_) {
    abs = !!item.style.height;
  }
  if (abs) {
    const declared = parseFloat(item.style.height);
    const base = declared > 0 ? declared : itemRect.height;
    const nextPx = Math.ceil(base + add) + "px";
    if (item.style.height !== nextPx) item.style.height = nextPx;
    if (item.style.overflow !== "visible") item.style.overflow = "visible";
  }
  const sizer = item.parentElement;
  const sizerH = sizer && parseFloat(sizer.style && sizer.style.height);
  const grown = Number(wrap.dataset.waTSized || 0);
  // A virtualizer that resets the sizer must not grow it without a ceiling.
  if (sizerH > 0 && add > 2 && grown < 1200) {
    const room = Math.min(add, 1200 - grown);
    sizer.style.height = Math.ceil(sizerH + room) + "px";
    wrap.dataset.waTSized = String(grown + room);
  }
}

// The buttons follow the pill from a layer on document.body. The transcript
// sits in the message flow so the chat scroll moves it.
function mountXUi(wrap) {
  const foot = wrap && wrap._waFoot;
  const layer = xLayer();
  if (!foot || !layer) return;
  const row = wrap._waShell;
  foot.classList.add("wa-t-x-tools", "is-on");
  foot.classList.remove("wa-t-aside", "wa-t-emoji-host");
  const out = xOutgoing(row || wrap._waPlay);
  foot.dataset.side = out ? "out" : "in";
  wrap.dataset.side = foot.dataset.side;
  const id = xRowId(row);
  if (id) wrap.dataset.xRow = id;
  stampXMarker(wrap);
  wrap._waEmojiGaveUp = true;
  wrap._waEmojiDock = false;
  wrap._waAsideOnce = true;
  if (wrap._waSave) wrap._waSave.hidden = true;
  keepXFootOutOfTranscript(wrap);
  if (!foot.classList.contains("is-docked")) {
    if (foot.parentElement !== layer) layer.appendChild(foot);
  }
  placeXTranscript(wrap);
  nudgeXFoot({ wrap, foot, row });
}

function isOurNode(el) {
  const c = el && el.classList;
  if (!c) return false;
  return (
    c.contains("wa-t-foot") ||
    c.contains("wa-t-btn") ||
    c.contains("wa-t-copy") ||
    c.contains("wa-t-save") ||
    c.contains("wa-t-actions") ||
    c.contains("wa-t-wrap") ||
    c.contains("wa-t-tools") ||
    c.contains("wa-t-x-layer") ||
    c.contains("wa-t-status")
  );
}

// The play button's parent is often a full-width row. Measure the bubble from
// the control and its small siblings, never that wide box.
function currentXPlay(wrap, row) {
  let play = wrap && wrap._waPlay;
  if (!play || !play.isConnected) {
    play = globalThis.WaXFind?.xPlayControl(row) || null;
    if (wrap) wrap._waPlay = play;
  }
  return play && play.isConnected ? play : null;
}

function xBubbleRect(wrap, row) {
  const play = currentXPlay(wrap, row);
  if (!play) return null;
  const target = play;
  if (!target || !target.getBoundingClientRect) return null;
  let base = null;
  try {
    base = target.getBoundingClientRect();
  } catch (_) {
    return null;
  }
  if (!base || base.width < 4 || !play || !play.parentElement) return base;
  const kids = play.parentElement.children;
  const count = kids ? kids.length : 0;
  if (count < 1 || count > 8) return base;
  let left = base.left;
  let right = base.right;
  let top = base.top;
  let bottom = base.bottom;
  const mid = base.top + base.height / 2;
  for (let i = 0; i < count; i++) {
    const child = kids[i];
    if (!child || !child.getBoundingClientRect) continue;
    if (child.classList && (child.classList.contains("wa-t-wrap") || child.classList.contains("wa-t-foot"))) continue;
    let r = null;
    try {
      r = child.getBoundingClientRect();
    } catch (_) {
      r = null;
    }
    if (!r || r.width < 4 || r.height < 4 || r.width > base.width + 220) continue;
    if (Math.abs(r.top + r.height / 2 - mid) > 36) continue;
    if (r.left < left) left = r.left;
    if (r.right > right) right = r.right;
    if (r.top < top) top = r.top;
    if (r.bottom > bottom) bottom = r.bottom;
  }
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

function parkXFoot(foot, rect, out, wrap) {
  const layer = xLayer();
  foot.classList.remove("is-docked");
  if (layer && foot.parentElement !== layer) layer.appendChild(foot);
  foot.style.position = "fixed";
  foot.style.right = "auto";
  foot.style.bottom = "auto";
  foot.style.transform = "none";
  foot.style.visibility = rect ? "visible" : "hidden";
  foot.style.pointerEvents = "auto";
  if (!rect) return;
  const top = Math.round(rect.top + rect.height / 2 - 16);
  const left = Math.round(out ? rect.left - 40 : rect.right + 8);
  foot.style.top = top + "px";
  foot.style.left = Math.max(4, left) + "px";
}

function placeXTools(wrap) {
  if (!wrap || wrap.dataset.site !== "x") return;
  mountXUi(wrap);
  ensureXSync();
}

let xPlaceRaf = 0;
let xScrollRaf = 0;

function placeKnownFeet() {
  if (!xOnChatPath()) {
    looseXFeet();
    return;
  }
  for (const [, ui] of xUis) {
    const foot = ui.foot;
    const wrap = ui.wrap;
    if (!foot || !wrap || foot.classList.contains("is-docked")) continue;
    nudgeXFoot(ui);
  }
}

// One frame after notes are found. A timer that keeps measuring freezes X.
function ensureXSync() {
  if (xPlaceRaf || !xUis.size) return;
  xPlaceRaf = requestAnimationFrame(() => {
    xPlaceRaf = 0;
    placeKnownFeet();
  });
}

function onXScroll() {
  if (xScrollRaf || !xUis.size) return;
  xScrollRaf = requestAnimationFrame(() => {
    xScrollRaf = 0;
    for (const [, ui] of xUis) {
      const foot = ui.foot;
      const wrap = ui.wrap;
      if (!foot || !wrap || foot.classList.contains("is-docked")) continue;
      if (!xOnChatPath()) {
        if (foot.style.visibility !== "hidden") foot.style.visibility = "hidden";
        continue;
      }
      nudgeXFoot(ui);
    }
  });
}

// Verified in X's live shadow DOM: the rail belongs to the attachment group
// and its native controls carry the owning message ID. No global bar search.
function dockXNativeRail(ui) {
  const { row, foot } = ui;
  const rail = row.querySelector('[data-hover-rail]');
  if (!rail || rail === foot || foot.contains(rail)) return false;
  const id = xRowId(row);
  const reply = Array.from(rail.children).find(el =>
    el.getAttribute('data-testid') === 'message-reply-button-' + id);
  if (!reply) return false;
  ensureXShadowStyle(rail);
  if (foot.parentElement !== rail) rail.prepend(foot);
  foot.classList.add('is-docked');
  Object.assign(foot.style, {
    position: 'static', top: 'auto', left: 'auto', right: 'auto', bottom: 'auto',
    transform: 'none', visibility: 'visible', margin: '0', width: 'auto',
  });
  return true;
}

function nudgeXFoot(ui) {
  const { wrap, foot, row } = ui;
  if (!wrap || !foot || !row || !row.isConnected) return;
  if (xOnChatPath() && dockXNativeRail(ui)) return;
  parkXFoot(foot, null, wrap.dataset.side === "out", wrap);
}

// Transcribir and download sit outside the colored bubble. The clock stays put.
// Once only: moving it again makes the observer rescan and freezes WhatsApp.
function placeAside(wrap) {
  if (!wrap) return;
  if (wrap.dataset.site === "x") {
    placeXTools(wrap);
    return;
  }
  if (wrap._waEmojiDock) return;
  if (!wrap._waEmojiGaveUp && dockWithEmoji(wrap)) return;
  if (wrap._waAsideOnce) return;
  const foot = wrap._waFoot;
  if (!foot || !wrap._waBubble) return;
  const edge = outerBubble(wrap._waBubble, wrap._waShell);
  if (!edge || !edge.appendChild) return;
  foot.classList.add("wa-t-aside");
  foot.dataset.side = wrap.dataset.side === "out" ? "out" : "in";
  let clipped = false;
  let positioned = false;
  try {
    const st = getComputedStyle(edge);
    clipped = /hidden|clip/.test(`${st.overflow}${st.overflowX}${st.overflowY}`);
    positioned = st.position !== "static";
  } catch (_) {
    clipped = false;
  }
  if (positioned && !clipped) {
    if (foot.parentElement !== edge) edge.appendChild(foot);
    wrap._waAsideOnce = true;
    return;
  }
  const host = edge.parentElement;
  if (!host) return;
  const outgoing = foot.dataset.side === "out";
  let reverse = false;
  try {
    reverse = /reverse/.test(getComputedStyle(host).flexDirection || "");
  } catch (_) {
    reverse = false;
  }
  const beforeBubble = outgoing !== reverse;
  const ref = beforeBubble ? edge : edge.nextSibling;
  if (!(foot.parentElement === host && (beforeBubble ? foot.nextSibling === edge : foot.previousSibling === edge))) {
    if (ref && ref.parentElement === host) host.insertBefore(foot, ref);
    else if (beforeBubble) host.insertBefore(foot, edge);
    else host.appendChild(foot);
  }
  wrap._waAsideOnce = true;
}

function positionWrap(wrap, playEl, shell) {
  const api = globalThis.WaUiMount;
  if (!api || !shell) return;
  const mount = api.chooseMount(playEl || shell, shell, isFlexRow);
  const parent = mount.parent;
  if (!parent) return;
  const before = mount.before && mount.before !== wrap ? mount.before : null;
  if (!wrap._waBelowOnce) {
    const already =
      wrap.parentElement === parent &&
      (before ? wrap.nextSibling === before : parent.lastElementChild === wrap);
    if (!already) {
      if (before) parent.insertBefore(wrap, before);
      else parent.appendChild(wrap);
    }
  }
  if (parent.classList) parent.classList.toggle("wa-t-row", !!mount.inRow && wrap.dataset.site !== "x");
  wrap._waPlay = playEl || null;
  wrap._waBubble = mount.bubble || null;
  wrap._waShell = shell;
  wrap._waInRow = !!mount.inRow && wrap.dataset.site !== "x";
  alignWrap(wrap);
  if (wrap.dataset.site === "x") {
    placeBelowClock(wrap);
    placeXTools(wrap);
  } else {
    placeAside(wrap);
    placeBelowClock(wrap);
  }
  bindHover(wrap);
  parkTools(wrap);
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
  btn.title = "Transcribir";
  btn.setAttribute("aria-label", "Transcribir");
  const btnLabel = document.createElement("span");
  btnLabel.className = "wa-t-btn-label";
  btnLabel.textContent = "Transcribir";
  btnLabel.hidden = true;
  // The button sits in X's shadow tree, where content.css does not apply.
  btnLabel.style.setProperty("display", "none", "important");
  btn.append(barsIcon(TRANSCRIBE_ICON), btnLabel);
  btn._waLabel = btnLabel;

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "wa-t-copy";
  copyBtn.title = "Copiar";
  copyBtn.setAttribute("aria-label", "Copiar");
  copyBtn.append(svgIcon(COPY_ICON));
  copyBtn.hidden = true;

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "wa-t-save";
  saveBtn.title = "Guardar audio";
  saveBtn.setAttribute("aria-label", "Guardar audio");
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
      copyBtn.title = "Copiado";
      setTimeout(() => {
        copyBtn.dataset.copied = "";
        copyBtn.title = "Copiar";
      }, 1600);
    },
    () => {
      copyBtn.title = "No se pudo copiar";
    }
  );
}

function injectX(message) {
  if (!message || message.nodeType !== 1) return;
  const id = xRowId(message);
  if (!id) return;
  const prev = xUis.get(id);
  if (prev && prev.row === message && prev.foot && prev.foot.isConnected) {
    if (!prev.wrap._waPlay?.isConnected) ensureXSync();
    return;
  }
  if (prev) {
    if (prev.foot) prev.foot.remove();
    if (prev.wrap) prev.wrap.remove();
    xUis.delete(id);
  }
  const api = globalThis.WaXFind;
  const playEl = (api && api.xPlayControl(message)) || null;
  const wrap = buildWrap();
  wrap.dataset.site = "x";
  wrap._waEmojiGaveUp = true;
  wrap._waPlay = playEl;
  wrap._waShell = message;
  wrap._waBubble = (playEl && playEl.parentElement) || message;
  wrap._waInRow = false;
  const foot = wrap._waFoot;
  xUis.set(id, { wrap, foot, row: message });
  mountXUi(wrap);
  bindHover(wrap);
  parkTools(wrap);
  ensureXSync();
}

function inject(container) {
  if (!container) return;
  if (isXSite()) {
    injectX(container);
    return;
  }
  if (container.closest && container.closest(".wa-t-wrap")) return;
  const playEl = firstControl(container);
  const shell = singleMessage(playEl || container);
  if (!shell) return;
  const wrap = shell.querySelector(".wa-t-wrap") || buildWrap();
  positionWrap(wrap, playEl || container, shell);
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
  saveBtn.title = "Extrayendo…";
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
    saveBtn.title = "Guardado";
    const st = wrap.querySelector(".wa-t-status");
    if (st && wrap.dataset.phase === "idle") st.hidden = true;
  } catch (err) {
    log("save audio failed", err);
    const reason = String((err && err.message) || err || "error");
    const dead = /context invalidated|Receiving end does not exist/i.test(reason);
    const noAudio = /NO_AUDIO/i.test(reason);
    saveBtn.title = "No se pudo guardar";
    const status = wrap.querySelector(".wa-t-status");
    if (status) {
      status.hidden = false;
      status.textContent = dead
        ? isXSite()
          ? "La extensión se recargó. Recargá la pestaña de Mensajes en X."
          : "La extensión se recargó. Recargá la pestaña de WhatsApp Web."
        : noAudio
        ? isXSite()
          ? "No se pudo extraer automáticamente. Dale Play a la nota en X y volvé a tocar Guardar audio."
          : "No se pudo extraer automáticamente. Dale Play a la nota en WhatsApp y volvé a tocar Guardar audio."
        : `No se pudo guardar: ${(err && err.code) || reason}`;
    }
  } finally {
    setTimeout(() => {
      saveBtn.disabled = false;
      saveBtn.title = "Guardar audio";
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
  return node.closest(".wa-t-btn, .wa-t-copy, .wa-t-save, .wa-t-word, .wa-t-tools");
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
  applySiteGate(settings || { sites: { whatsapp: true } });
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
  } else if (msg.type === WA_MSG.ERROR) {
    log("error ui", { requestId: msg.requestId, message: msg.message });
    setUi(wrap, { phase: "error", message: msg.message || shownError(null, "GENERIC") });
  }
});

let xDebugError = "";
let xDebugLast = "";
let xDebugCopiedUntil = 0;

function noteXDebugError(where, err) {
  const text = where + ": " + String((err && (err.message || err)) || err);
  if (text === xDebugError) return;
  xDebugError = text;
  log("x debug", xDebugError);
}

function xFrameBits() {
  let list = [];
  try {
    list = document.querySelectorAll("iframe, frame");
  } catch (_) {
    list = [];
  }
  const sample = [];
  for (const frame of list) {
    if (sample.length >= 3) break;
    let src = "";
    try {
      src = frame.getAttribute("src") || frame.src || "";
    } catch (_) {
      src = "";
    }
    if (!src) {
      sample.push("(sin src)");
      continue;
    }
    try {
      const url = new URL(src, location.href);
      if (url.protocol === "about:" || url.protocol === "blob:" || url.protocol === "data:") {
        sample.push(url.protocol.replace(":", "") + (url.pathname ? url.pathname.slice(0, 18) : ""));
      } else {
        sample.push(url.host + url.pathname.slice(0, 28));
      }
    } catch (_) {
      sample.push(String(src).slice(0, 32));
    }
  }
  return { count: list.length, sample };
}

function xShadowBits() {
  let open = 0;
  let closed = 0;
  let waves = 0;
  let rows = 0;
  let seen = 0;
  const cap = 8000;
  const stack = [document.body || document.documentElement];
  const openClosed = chrome.dom && chrome.dom.openOrClosedShadowRoot;
  while (stack.length && seen < cap) {
    const el = stack.pop();
    if (!el) continue;
    if (el.nodeType === 11) {
      if (el.querySelectorAll) {
        try { waves += el.querySelectorAll("[data-testid='audio-waveform']").length; } catch (_) {}
        try { rows += el.querySelectorAll("[data-dm-message-row]").length; } catch (_) {}
      }
      const kids = el.children;
      if (kids) for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
      continue;
    }
    if (el.nodeType !== 1) continue;
    if (el.id === "wa-t-x-debug" || el.id === "wa-t-x-debug-main") continue;
    seen++;
    let root = null;
    try {
      root = el.shadowRoot || (openClosed ? openClosed(el) : null);
    } catch (_) {
      root = el.shadowRoot || null;
    }
    if (root) {
      if (el.shadowRoot) open++;
      else closed++;
      stack.push(root);
    }
    const kids = el.children;
    if (kids) for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
  }
  return { open, closed, waves, rows, capped: seen >= cap };
}

function xDebugVerdict(s) {
  if (s.err) return s.err;
  if (s.waves > 0 && s.hosts === 0) return "veo las ondas, pero el clasificador no las toma";
  if (s.hosts > 0 && s.noId > 0 && s.buttons === 0) return "hay notas sin id; no se puede armar el botón";
  if (s.hosts > 0 && s.buttons === 0) return "hay notas y el botón no se creó";
  if (s.buttons > 0 && s.visible === 0) return "el botón está creado y oculto";
  if (s.buttons > 0) return "botón en " + s.sample + "; si no lo ves, es la posición";
  if (s.waves === 0 && s.shadowWaves > 0) return "las ondas están dentro de un shadow DOM";
  if (s.rows === 0 && s.waves === 0 && s.frames.count > 0) return "este marco no tiene el chat";
  if (s.rows > 0 && s.waves === 0) return "hay mensajes y ninguna onda de audio";
  if (!s.hook && (s.rows > 0 || s.waves > 0)) return "veo el chat y el hook de audio no arrancó";
  if (s.capped) return "no vi notas en este recorrido; la página es más grande";
  return "en este documento no hay notas";
}

function paintXDebug() {
  if (!document.documentElement) return;
  const stale = document.getElementById("wa-t-x-debug-main");
  const bar = document.getElementById("wa-t-x-debug");
  if (stale) stale.remove();
  if (bar) bar.remove();
  return;
  if (!isXSite() || !document.documentElement) return;

  let ver = "?";
  try {
    ver = chrome.runtime.getManifest().version;
  } catch (_) {}

  let rows = 0;
  let waves = 0;
  try {
    rows = document.querySelectorAll("[data-dm-message-row]").length;
    waves = document.querySelectorAll("[data-testid='audio-waveform']").length;
  } catch (_) {}

  const shadows = xShadowBits();
  let hosts = [];
  if (waves > 0 || rows > 0) {
    try {
      hosts = (globalThis.WaXFind && globalThis.WaXFind.findVoiceHosts(document)) || [];
    } catch (err) {
      noteXDebugError("notas", err);
    }
  }
  let noId = 0;
  for (const host of hosts) {
    if (!host || !host.getAttribute) continue;
    if (!host.getAttribute("data-dm-message-row") && !host.getAttribute("data-testid")) noId++;
  }

  const layer = document.getElementById("wa-t-x-layer");
  let buttons = 0;
  let visible = 0;
  let sample = "";
  if (layer) {
    for (const foot of layer.querySelectorAll(".wa-t-foot")) {
      buttons++;
      let rect = null;
      try { rect = foot.getBoundingClientRect(); } catch (_) { rect = null; }
      if (foot.style.visibility !== "hidden" && rect && rect.width > 0 && rect.height > 0) {
        visible++;
        if (!sample) sample = Math.round(rect.left) + "," + Math.round(rect.top);
      }
    }
  }

  const frames = xFrameBits();
  const hook = document.documentElement.getAttribute("data-wa-t-hook") === "1";
  const frame = window === window.top ? "top" : "iframe";
  let path = location.pathname || "/";
  if (path.length > 36) path = path.slice(0, 36) + "…";
  const verdict = xDebugVerdict({
    err: xDebugError,
    hook,
    waves,
    hosts: hosts.length,
    noId,
    buttons,
    visible,
    sample: sample || "?",
    rows,
    frames,
    shadowWaves: shadows.waves,
    capped: shadows.capped,
  });
  const line1 =
    "wa-t " + ver + " · " + frame + " · " + path +
    " · filas " + rows + " · ondas " + waves +
    (shadows.waves ? " · ondas-shadow " + shadows.waves : "") +
    " · notas " + hosts.length + " · botones " + buttons +
    " · hook " + (hook ? "sí" : "no");
  const line2 =
    verdict +
    " · sombras " + shadows.open + "/" + shadows.closed + (shadows.capped ? "+" : "") +
    " · iframes " + frames.count +
    (frames.sample.length ? " (" + frames.sample.join(", ") + ")" : "") +
    " · clic para copiar";
  const text = Date.now() < xDebugCopiedUntil ? line1 + "\n" + line2 + "\ncopiado" : line1 + "\n" + line2;

  let el = document.getElementById("wa-t-x-debug");
  if (!el) {
    el = document.createElement("div");
    el.id = "wa-t-x-debug";
    el.className = "wa-t-x-debug";
    el.style.cssText = [
      "position:fixed",
      "top:0",
      "left:0",
      "right:0",
      "z-index:2147483647",
      "background:#ffe14a",
      "color:#111",
      "font:600 13px/1.35 ui-monospace,Menlo,monospace",
      "padding:8px 12px",
      "white-space:pre-wrap",
      "text-align:left",
      "pointer-events:auto",
      "cursor:pointer",
    ].join(";");
    el.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      xDebugCopiedUntil = Date.now() + 1500;
      const dump = el.dataset.dump || el.textContent || "";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(dump).catch(() => {});
      }
    });
    document.documentElement.appendChild(el);
  }
  el.dataset.dump = [
    "version " + ver,
    "href " + location.href,
    "frame " + frame,
    "filas " + rows,
    "ondas " + waves,
    "ondasShadow " + shadows.waves,
    "filasShadow " + shadows.rows,
    "notas " + hosts.length,
    "sinId " + noId,
    "botones " + buttons,
    "visibles " + visible,
    "pos " + (sample || "-"),
    "hook " + (hook ? "si" : "no"),
    "sombrasAbiertas " + shadows.open,
    "sombrasCerradas " + shadows.closed,
    "iframes " + frames.count + " " + frames.sample.join(" | "),
    "error " + (xDebugError || "-"),
    "veredicto " + verdict,
  ].join("\n");
  if (el.textContent !== text) el.textContent = text;
  document.documentElement.setAttribute("data-wa-t-ext", ver);
  if (text !== xDebugLast) {
    xDebugLast = text;
    log("x debug", text.replace(/\n/g, " | "));
  }
}

const watchedShadows = new Set();
const shadowMos = new WeakMap();
const xDirtyRoots = new Set();
const xRechecked = new WeakSet();
let xDirtyTimer = 0;
let xBooted = false;
let xBootTries = 0;
let xBootTimer = 0;
let xSeenPath = "";
let xPeekTimer = 0;
let xPeekNode = null;

function xOnChatPath() {
  try {
    return /^\/(i\/chat|messages|chat)(\/|$)/.test(String(location.pathname || ""));
  } catch (_) {
    return false;
  }
}

function xRememberPath() {
  try {
    xSeenPath = location.pathname || "";
  } catch (_) {
    xSeenPath = "";
  }
}

function observeShadow(root) {
  if (!root || root.nodeType !== 11 || watchedShadows.has(root)) return;
  watchedShadows.add(root);
  try {
    const mo = new MutationObserver(onDomMutations);
    mo.observe(root, { childList: true, subtree: true });
    shadowMos.set(root, mo);
  } catch (_) {
    /* this root cannot be observed */
  }
}

function xShadowInteresting(root) {
  if (!root || typeof root.querySelector !== "function") return false;
  try {
    return !!root.querySelector("[data-testid='audio-waveform'], [data-dm-message-row]");
  } catch (_) {
    return false;
  }
}

function xConsiderShadow(root) {
  if (!root || root.nodeType !== 11 || watchedShadows.has(root)) return;
  if (xShadowInteresting(root)) {
    observeShadow(root);
    xInjectShadow(root);
    return;
  }
  if (!xOnChatPath() || xRechecked.has(root)) return;
  xRechecked.add(root);
  setTimeout(() => {
    if (watchedShadows.has(root) || !xShadowInteresting(root)) return;
    observeShadow(root);
    xInjectShadow(root);
  }, 700);
}

function xHostFromWave(wave) {
  let n = wave;
  for (let i = 0; i < 14 && n; i++) {
    if (n.nodeType === 1 && n.getAttribute) {
      const testId = n.getAttribute("data-testid") || "";
      if (n.getAttribute("data-dm-message-row") || (testId.startsWith("message-") && !testId.startsWith("message-text-"))) {
        return n;
      }
    }
    const root = typeof n.getRootNode === "function" ? n.getRootNode() : null;
    const next = n.parentElement || (root && root.nodeType === 11 && root.host) || null;
    if (!next || next === n) break;
    n = next;
  }
  return null;
}

function xInjectShadow(root) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  let waves = [];
  try {
    waves = root.querySelectorAll("[data-testid='audio-waveform']");
  } catch (_) {
    return;
  }
  for (const wave of waves) {
    const host = xHostFromWave(wave);
    if (host) injectX(host);
  }
}

function scheduleXDirty() {
  if (xDirtyTimer) return;
  xDirtyTimer = setTimeout(() => {
    xDirtyTimer = 0;
    const roots = [...xDirtyRoots];
    xDirtyRoots.clear();
    for (const root of roots) xInjectShadow(root);
  }, 250);
}

function xPeekShadows(node) {
  const stack = [node];
  let seen = 0;
  while (stack.length && seen < 48) {
    const el = stack.pop();
    if (!el || el.nodeType !== 1) continue;
    seen += 1;
    if (el.shadowRoot) xConsiderShadow(el.shadowRoot);
    const kids = el.children;
    if (!kids || !kids.length) continue;
    for (let i = kids.length - 1; i >= 0; i--) {
      const kid = kids[i];
      if (kid && kid.shadowRoot) stack.push(kid);
    }
    if (seen < 8) {
      for (let i = kids.length - 1; i >= 0; i--) {
        const kid = kids[i];
        if (kid && !kid.shadowRoot) stack.push(kid);
      }
    }
  }
}

function scheduleXPeek(node) {
  xPeekNode = node;
  if (xPeekTimer) return;
  xPeekTimer = setTimeout(() => {
    xPeekTimer = 0;
    const target = xPeekNode;
    xPeekNode = null;
    if (!target || !target.isConnected) return;
    xPeekShadows(target);
  }, 400);
}

function xNoteNavigation() {
  let path = "";
  try {
    path = location.pathname || "";
  } catch (_) {
    return;
  }
  if (path === xSeenPath) return;
  xSeenPath = path;
  clearTimeout(xBootTimer);
  xBooted = false;
  xBootTries = 0;
  looseXFeet();
  if (xOnChatPath()) xBootScan();
}

function looseXFeet() {
  const onChat = xOnChatPath();
  const layer = document.getElementById("wa-t-x-layer");
  for (const [, ui] of xUis) {
    const foot = ui.foot;
    const wrap = ui.wrap;
    const row = ui.row;
    const gone = !onChat || !row || !row.isConnected;
    if (!gone) continue;
    if (wrap) {
      wrap._waHovering = false;
      clearTimeout(wrap._waDockTimer);
      clearTimeout(wrap._waHideTimer);
    }
    if (!foot) continue;
    foot.classList.remove("is-docked");
    foot.style.visibility = "hidden";
    if (layer && foot.parentElement !== layer) {
      try {
        layer.appendChild(foot);
      } catch (_) {
        /* the foot left with the chat */
      }
    }
  }
  if (layer) layer.style.visibility = onChat ? "" : "hidden";
}

let xLooseRaf = 0;
function scheduleLooseXFeet() {
  if (xLooseRaf) return;
  xLooseRaf = requestAnimationFrame(() => {
    xLooseRaf = 0;
    looseXFeet();
  });
}

function xBootScan() {
  if (xBooted) return;
  xBooted = true;
  const api = globalThis.WaXFind;
  if (!api || !api.xDiscoverWaves) return;
  let found = { hosts: [], shadows: [] };
  try {
    found = api.xDiscoverWaves(document, 5000) || found;
  } catch (err) {
    noteXDebugError("boot", err);
  }
  for (const shadow of found.shadows || []) observeShadow(shadow);
  for (const host of found.hosts || []) injectX(host);
  const empty = !(found.hosts && found.hosts.length) && !(found.shadows && found.shadows.length);
  if (empty && xOnChatPath() && xBootTries < 3) {
    xBootTries += 1;
    clearTimeout(xBootTimer);
    xBootTimer = setTimeout(() => {
      xBootTimer = 0;
      xBooted = false;
      xBootScan();
    }, 1500);
  }
}

function noteXAdded(node) {
  if (!node || node.nodeType !== 1) return;
  const rail = node.closest?.('[data-hover-rail]');
  if (rail) {
    const row = rail.closest('[data-dm-message-row]');
    const ui = row && xUis.get(xRowId(row));
    if (ui) nudgeXFoot(ui);
    return;
  }
  const testId = (node.getAttribute && node.getAttribute("data-testid")) || "";
  if (testId === "audio-waveform") {
    const host = xHostFromWave(node);
    if (host) injectX(host);
    const root = typeof node.getRootNode === "function" ? node.getRootNode() : null;
    if (root && root.nodeType === 11) observeShadow(root);
    return;
  }
  const rowId = node.getAttribute && node.getAttribute("data-dm-message-row");
  if (rowId || (testId.startsWith("message-") && !testId.startsWith("message-text-"))) {
    let wave = null;
    try {
      wave = node.querySelector && node.querySelector("[data-testid='audio-waveform']");
    } catch (_) {
      wave = null;
    }
    if (!wave) return;
    const root = typeof node.getRootNode === "function" ? node.getRootNode() : null;
    if (root && root.nodeType === 11) observeShadow(root);
    injectX(node);
    return;
  }
  if (node.shadowRoot) xConsiderShadow(node.shadowRoot);
  const kids = node.childElementCount || 0;
  if (kids > 40) {
    xNoteNavigation();
    const root = typeof node.getRootNode === "function" ? node.getRootNode() : null;
    if (root && root.nodeType === 11 && watchedShadows.has(root)) {
      xDirtyRoots.add(root);
      scheduleXDirty();
    } else if (xOnChatPath()) {
      scheduleXPeek(node);
    }
    return;
  }
  if (kids && kids <= 8 && node.children) {
    for (let i = 0; i < node.children.length; i++) {
      const kid = node.children[i];
      if (kid && kid.shadowRoot) xConsiderShadow(kid.shadowRoot);
    }
  }
  const root = typeof node.getRootNode === "function" ? node.getRootNode() : null;
  if (root && root.nodeType === 11 && watchedShadows.has(root)) {
    xDirtyRoots.add(root);
    scheduleXDirty();
  }
}

function pruneShadows() {
  for (const root of [...watchedShadows]) {
    const host = root.host;
    if (host && host.isConnected) continue;
    watchedShadows.delete(root);
    const mo = shadowMos.get(root);
    if (mo) {
      mo.disconnect();
      shadowMos.delete(root);
    }
  }
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

// React drops the hover bar and the foot with it. Put the marker back on the
// layer so extract can still find data-wa-t-id. Only a small removed node:
// querying a virtualizer subtree on every removal freezes the tab.
function rescueXFoot(node) {
  if (!node || node.nodeType !== 1) return;
  const kids = node.childElementCount || 0;
  let foot = null;
  if (node.classList && node.classList.contains("wa-t-foot")) foot = node;
  else if (kids > 0 && kids <= 8 && node.querySelector) {
    try {
      foot = node.querySelector(".wa-t-foot");
    } catch (_) {
      foot = null;
    }
  }
  if (!foot || !foot._waWrap || foot._waWrap.dataset.site !== "x") return;
  if (foot.isConnected && foot.classList.contains("is-docked")) return;
  const layer = xLayer();
  if (!layer || foot.parentElement === layer) return;
  foot.classList.remove("is-docked");
  foot.style.visibility = "hidden";
  layer.appendChild(foot);
  ensureXSync();
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

// Reloading an unpacked extension invalidates the old tab's runtime.
// Stop its polling rather than throwing every eight seconds until tab reload.
function startCompanionPolling() {
  let timer = 0;
  const pullShared = () => {
    try {
      if (!chrome.runtime?.id) {
        clearInterval(timer);
        return false;
      }
      chrome.runtime.sendMessage({ type: WA_MSG.CHECK_COMPANION }, () => {
        void chrome.runtime.lastError;
      });
      return true;
    } catch (err) {
      clearInterval(timer);
      if (!/context invalidated/i.test(String(err && err.message))) console.warn(LOG, "companion polling stopped", err);
      return false;
    }
  };
  if (pullShared()) timer = setInterval(pullShared, 8000);
}

function start() {
  try {
    if (isXSite()) paintXDebug();
    removeStaleWraps();
    refreshDebug();
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        if (!changes.debugMode && !changes.highlightWords && !changes.sites) return;
        refreshDebug();
      });
    }
    xRememberPath();
    scan(document);
    window.addEventListener(
      "resize",
      () => {
        document.querySelectorAll(".wa-t-wrap").forEach((wrap) => alignWrap(wrap));
      },
      { passive: true }
    );
    if (isXSite() && !globalThis.__waTXWatch) {
      globalThis.__waTXWatch = true;
      document.addEventListener("scroll", onXScroll, { capture: true, passive: true });
    }
    chrome.runtime.sendMessage({ type: WA_MSG.PRELOAD }, () => {
      void chrome.runtime.lastError;
    });
    log("content script ready");
    if (isXSite()) paintXDebug();
  } catch (err) {
    noteXDebugError("start", err);
    try { paintXDebug(); } catch (_) {}
  }
  if (isXSite() && !globalThis.__waTXPrune) {
    globalThis.__waTXPrune = setInterval(() => {
      try {
        pruneShadows();
      } catch (_) {}
    }, 20000);
  }
  if (isXSite() && globalThis.navigation && !globalThis.__waTXNav) {
    globalThis.__waTXNav = true;
    try {
      navigation.addEventListener("navigatesuccess", () => {
        xSeenPath = "";
        xNoteNavigation();
      });
    } catch (_) {}
  }
  startCompanionPolling();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}

globalThis.WaFind = { SELECTORS, findVoiceContainers, messageBubbleFrom };
