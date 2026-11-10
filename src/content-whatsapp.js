/* TranscribeThem — WhatsApp Web: finding voice notes, placing and docking the
   UI inside the bubble. Classic script, after content-core.js.
   The X entry loads this file too: X reuses bindHover, parkTools, and the
   placeAside / positionWrap / inject dispatchers. */

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

// WhatsApp's own key for the message, the data-id of its row. It survives a
// reload and the row being rebuilt on scroll. "" when the row has none, or
// when one row holds several voice notes and the id would not tell them apart.
function waMessageId(wrap) {
  const from = wrap && (wrap._waBubble || wrap._waShell || wrap.parentElement);
  let row = null;
  try {
    row = from && from.closest ? from.closest("[data-id]") : null;
  } catch (_) {
    row = null;
  }
  if (!row || !row.getAttribute || sliderCount(row) > 1) return "";
  return String(row.getAttribute("data-id") || "").trim();
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
  for (const el of [wrap._waBtn, wrap._waCopy, wrap._waSum, wrap._waTr, wrap._waSave]) {
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
  considerNote(wrap);
}

globalThis.WaFind = { SELECTORS, findVoiceContainers, messageBubbleFrom };
