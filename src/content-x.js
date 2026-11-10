/* TranscribeThem — X messages: shadow DOM discovery, the button layer, the
   transcript placement in the virtual list, debug. Classic script, after
   content-core.js and content-whatsapp.js. Only the X manifest entry loads it. */

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
.wa-t-x-tools .wa-t-copy,
.wa-t-x-tools .wa-t-act {
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
.wa-t-x-tools .wa-t-copy svg,
.wa-t-x-tools .wa-t-act svg {
  width: 16px;
  height: 16px;
  display: block;
}
.wa-t-x-tools .wa-t-save,
.wa-t-x-tools [hidden] { display: none !important; }
.wa-t-x-tools button { cursor: pointer; border-radius: 9999px; }
.wa-t-x-tools button:hover { background: var(--color-gray-100, rgba(255,255,255,.08)); }
.wa-t-x-tools button:disabled { cursor: progress; opacity: .5; }
.wa-t-act[data-busy="1"] svg { animation: wa-t-wait 1s ease-in-out infinite; }
@keyframes wa-t-wait { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
.wa-t-extras { display: block; }
.wa-t-extra {
  margin: 8px 0 2px;
  padding: 6px 0 2px 10px;
  border-left: 2px solid rgba(165, 167, 242, 0.9);
}
.wa-t-extra[data-state="error"] { border-left-color: #f15c4c; }
.wa-t-extra-head { display: flex; align-items: center; gap: 2px; min-height: 22px; }
.wa-t-extra-label {
  flex: 1 1 auto;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .04em;
  text-transform: uppercase;
  opacity: .7;
}
.wa-t-extra-body { white-space: pre-wrap; overflow-wrap: anywhere; }
.wa-t-extra[data-state="error"] .wa-t-extra-body { color: #f4a59c; }
.wa-t-mini {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 9999px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: .7;
  flex: 0 0 auto;
}
.wa-t-mini:hover { opacity: 1; background: rgba(255, 255, 255, 0.1); }
.wa-t-mini svg { width: 14px; height: 14px; display: block; }
@media (prefers-reduced-motion: reduce) {
  .wa-t-act[data-busy="1"] svg { animation: none; }
}
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
    actions.append(...[btn, copy, wrap._waSum, wrap._waTr, save].filter(Boolean));
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

// A summary or translation block was added to, or removed from, the
// transcript. `heightBefore` is the wrap's height before a block was removed.
function refitXTranscript(wrap, heightBefore) {
  if (!wrap || wrap.dataset.site !== "x") return;
  wrap._waFitDone = false;
  wrap._waFitScroll = -1;
  wrap._waFitStamp = "";
  if (heightBefore > 0) giveBackXRoom(wrap, heightBefore);
  placeXTranscript(wrap);
}

// fitXItem only grows the row. When a block is hidden, hand back the room it
// took: never more than the measured empty space under the transcript, and
// never more of the sizer than this note added to it.
function giveBackXRoom(wrap, heightBefore) {
  const item = wrap.parentElement;
  if (!item || !item.style || item !== xItemBox(wrap._waShell)) return;
  let itemRect = null;
  let textRect = null;
  try {
    itemRect = item.getBoundingClientRect();
    textRect = wrap.getBoundingClientRect();
  } catch (_) {
    return;
  }
  if (itemRect.height < 2 || textRect.height < 2) return;
  const freed = Math.floor(heightBefore - textRect.height);
  const slack = Math.floor(itemRect.bottom - (textRect.bottom + X_TRANSCRIPT_GAP));
  const cut = Math.min(freed, slack);
  if (!(cut > 2)) return;
  const declared = parseFloat(item.style.height);
  if (!(declared > cut)) return;
  item.style.height = Math.floor(declared - cut) + "px";
  const sizer = item.parentElement;
  const sizerH = sizer && parseFloat(sizer.style && sizer.style.height);
  const grown = Number(wrap.dataset.waTSized || 0);
  const back = Math.min(cut, grown);
  if (sizerH > back && back > 2) {
    sizer.style.height = Math.floor(sizerH - back) + "px";
    wrap.dataset.waTSized = String(grown - back);
  }
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
  considerNote(wrap);
}

let xDebugLast = "";
let xDebugCopiedUntil = 0;

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
  if (s.waves > 0 && s.hosts === 0) return waT("xDebugWavesNoHost");
  if (s.hosts > 0 && s.noId > 0 && s.buttons === 0) return waT("xDebugNoId");
  if (s.hosts > 0 && s.buttons === 0) return waT("xDebugNoButton");
  if (s.buttons > 0 && s.visible === 0) return waT("xDebugHidden");
  if (s.buttons > 0) return waT("xDebugPosition", s.sample);
  if (s.waves === 0 && s.shadowWaves > 0) return waT("xDebugShadow");
  if (s.rows === 0 && s.waves === 0 && s.frames.count > 0) return waT("xDebugNoChat");
  if (s.rows > 0 && s.waves === 0) return waT("xDebugNoWaves");
  if (!s.hook && (s.rows > 0 || s.waves > 0)) return waT("xDebugNoHook");
  if (s.capped) return waT("xDebugCapped");
  return waT("xDebugNone");
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
  const line1 = waT("xDebugLine1", [
    ver,
    frame,
    path,
    String(rows),
    String(waves),
    shadows.waves ? waT("xDebugShadowPart", String(shadows.waves)) : "",
    String(hosts.length),
    String(buttons),
    hook ? waT("yes") : waT("no"),
  ]);
  const line2 = waT("xDebugLine2", [
    verdict,
    shadows.open + "/" + shadows.closed + (shadows.capped ? "+" : ""),
    String(frames.count),
    frames.sample.length ? " (" + frames.sample.join(", ") + ")" : "",
  ]);
  const text = Date.now() < xDebugCopiedUntil ? line1 + "\n" + line2 + "\n" + waT("xDebugCopied") : line1 + "\n" + line2;

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
    waT("xDumpVersion") + ver,
    waT("xDumpHref") + location.href,
    waT("xDumpFrame") + frame,
    waT("xDumpRows") + rows,
    waT("xDumpWaves") + waves,
    waT("xDumpWavesShadow") + shadows.waves,
    waT("xDumpRowsShadow") + shadows.rows,
    waT("xDumpNotes") + hosts.length,
    waT("xDumpNoId") + noId,
    waT("xDumpButtons") + buttons,
    waT("xDumpVisible") + visible,
    waT("xDumpPos") + (sample || "-"),
    waT("xDumpHook") + (hook ? waT("xDumpYes") : waT("xDumpNo")),
    waT("xDumpShadowsOpen") + shadows.open,
    waT("xDumpShadowsClosed") + shadows.closed,
    waT("xDumpIframes") + frames.count + " " + frames.sample.join(" | "),
    waT("xDumpError") + (xDebugError || "-"),
    waT("xDumpVerdict") + verdict,
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
