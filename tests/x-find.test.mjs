import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src", "x-find.js"), "utf8");
const ctx = createContext({ globalThis: {}, document: { body: null, documentElement: null } });
ctx.globalThis = ctx;
runInContext(src, ctx);
const { classifyXSnapshot, isXVoiceMessage, findVoiceHosts, xDiscoverWaves, xPlayControl, xActionBars } = ctx.WaXFind;

function el(tag, attrs = {}, kids = [], text = "") {
  const node = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    attributes: { ...attrs },
    children: [],
    parentElement: null,
    className: attrs.class || "",
    _text: text,
  };
  node.getAttribute = (name) => (name in node.attributes ? node.attributes[name] : null);
  node.classList = {
    contains(name) {
      return node.className.split(/\s+/).includes(name);
    },
  };
  Object.defineProperty(node, "textContent", {
    get() {
      return `${node._text} ${node.children.map((child) => child.textContent || "").join(" ")}`.replace(/\s+/g, " ").trim();
    },
  });
  for (const child of kids) {
    child.parentElement = node;
    node.children.push(child);
  }
  return node;
}

assert.equal(
  classifyXSnapshot({
    labels: ["Reproducir mensaje de voz"],
    testIds: ["message-1"],
    text: "0:08",
    hasAudio: false,
    hasVideo: false,
    voiceLabel: true,
  }),
  true
);

assert.equal(
  classifyXSnapshot({
    labels: ["Play"],
    testIds: ["message-2"],
    text: "0:21",
    hasAudio: false,
    hasVideo: false,
  }),
  true
);

assert.equal(
  classifyXSnapshot({
    labels: [],
    testIds: ["message-3"],
    text: "0:04",
    hasAudio: true,
    hasVideo: false,
  }),
  true
);

assert.equal(
  classifyXSnapshot({
    labels: ["Play video"],
    testIds: ["videoPlayer"],
    text: "0:12",
    hasAudio: false,
    hasVideo: true,
  }),
  false
);

assert.equal(
  classifyXSnapshot({
    labels: ["Voice message"],
    testIds: ["voiceMessageButton"],
    text: "",
    hasAudio: false,
    hasVideo: false,
    voiceLabel: true,
    inComposer: true,
  }),
  false
);

assert.equal(
  classifyXSnapshot({
    labels: ["hola"],
    testIds: ["message-text-4"],
    text: "hola, ¿cómo andás?",
    hasAudio: false,
    hasVideo: false,
  }),
  false
);

const play = el("button", { "aria-label": "Reproducir mensaje de voz" }, [el("svg")]);
const voice = el("div", { "data-testid": "message-abc" }, [play, el("span", {}, [], "0:08")]);
const list = el("div", { "data-testid": "dm-message-list" }, [voice]);
assert.equal(isXVoiceMessage(voice), true);
assert.equal(findVoiceHosts(list).length, 1);
assert.equal(findVoiceHosts(list)[0], voice);
assert.equal(xPlayControl(voice), play);

const videoBtn = el("button", { "aria-label": "Play video" }, [el("svg")]);
const video = el("div", { "data-testid": "message-vid" }, [el("video"), videoBtn, el("span", {}, [], "0:12")]);
assert.equal(isXVoiceMessage(video), false);

const mic = el("button", { "aria-label": "Voice message", "data-testid": "voiceMessageButton" });
const composer = el("div", { "data-testid": "dm-composer-form" }, [mic]);
assert.equal(isXVoiceMessage(mic), false);
assert.equal(findVoiceHosts(composer).length, 0);

const inboxRow = el(
  "div",
  { "data-testid": "dm-conversation-item-9" },
  [el("span", {}, [], "Voice message")]
);
assert.equal(isXVoiceMessage(inboxRow), false);

const barePlay = el("button", { "aria-label": "Play" }, [el("svg")]);
const bare = el("div", {}, [barePlay, el("span", {}, [], "0:15")]);
const panel = el("div", { "data-testid": "dm-conversation-panel" }, [bare]);
assert.equal(findVoiceHosts(panel).length, 1);
assert.equal(findVoiceHosts(panel)[0], bare);

const text = el("div", { "data-testid": "message-text-1" }, [], "dale, nos vemos 18:31");
assert.equal(isXVoiceMessage(text), false);

function xNote(id, side, duration) {
  const play = el("button", { "aria-label": "Play", type: "button" }, [el("svg", { "data-icon": "icon-play" })]);
  const bars = [];
  for (let i = 0; i < 8; i++) bars.push(el("div", { class: "rounded-full" }));
  const wave = el("div", { "data-testid": "audio-waveform", "aria-hidden": "true" }, bars);
  const pill = el("div", { class: "inline-flex" }, [play, el("div", {}, [wave]), el("span", {}, [], duration)]);
  const contents = el("div", { class: "contents", "data-side": side }, [pill]);
  const group = el("div", { role: "group" }, [contents]);
  const message = el(
    "div",
    { "data-testid": `message-${id}`, "data-dm-message-row": id },
    [el("span", { hidden: "" }, [], side === "end" ? "You" : "Test Sender"), el("span", { hidden: "" }, [], "Voice message"), group]
  );
  return { message, play, group };
}

const incoming = xNote("in", "start", "0:37");
assert.equal(isXVoiceMessage(incoming.message), true);
assert.equal(findVoiceHosts(incoming.message).length, 1);
assert.equal(findVoiceHosts(incoming.message)[0], incoming.message);
assert.equal(xPlayControl(incoming.message), incoming.play);

const outgoing = xNote("out", "end", "0:39");
assert.equal(isXVoiceMessage(outgoing.message), true);
assert.equal(xPlayControl(outgoing.message), outgoing.play);

const plain = el("div", { "data-testid": "message-plain" }, [el("span", {}, [], "hola, ¿cómo andás?")]);
assert.equal(isXVoiceMessage(plain), false);
assert.equal(findVoiceHosts(plain).length, 0);

function withShadow(host, kids) {
  const shadow = { nodeType: 11, host, children: [] };
  const stamp = (node) => {
    node.getRootNode = () => shadow;
    for (const child of node.children || []) stamp(child);
  };
  for (const child of kids) {
    child.parentElement = null;
    stamp(child);
    shadow.children.push(child);
  }
  host.shadowRoot = shadow;
  return host;
}

const shadowed = xNote("shadow", "start", "0:16");
const shadowHost = withShadow(el("div"), [shadowed.message]);
const shadowPage = el("div", {}, [shadowHost]);
assert.equal(findVoiceHosts(shadowPage).length, 1);
assert.equal(findVoiceHosts(shadowPage)[0], shadowed.message);
assert.equal(xPlayControl(findVoiceHosts(shadowPage)[0]), shadowed.play);

const hostNote = xNote("host", "end", "0:05");
const messageHost = withShadow(
  el("div", { "data-testid": "message-host", "data-dm-message-row": "host" }),
  [hostNote.group]
);
assert.equal(findVoiceHosts(el("div", {}, [messageHost]))[0], messageHost);

const reply = el("button", { "aria-label": "Responder" });
const download = el("button", { "aria-label": "Descargar" });
const more = el("button", { "aria-label": "Más" });
const toolbar = el("div", {}, [reply, download, more]);
const withBar = el("div", {}, [incoming.message, toolbar]);
assert.equal(xActionBars(withBar).length, 1);
assert.equal(xActionBars(withBar)[0], toolbar);
assert.equal(xActionBars(incoming.message).length, 0);

const iconBar = el("div", {}, [
  el("button", {}, [el("svg")]),
  el("button", {}, [el("svg")]),
  el("button", {}, [el("svg")]),
]);
const own = el("button", { class: "wa-t-btn", "aria-label": "Transcribir" }, [el("svg")]);
const iconHost = el("div", {}, [incoming.play, iconBar, own]);
assert.equal(xActionBars(iconHost)[0], iconBar);

const like = el("button", { "aria-label": "Me gusta" });
const likeBar = el("div", {}, [like, reply, download, more]);
assert.equal(xActionBars(el("div", {}, [incoming.message, likeBar]))[0], likeBar);

let deepWave = el("div", { "data-testid": "audio-waveform" });
for (let i = 0; i < 39; i++) deepWave = el("div", {}, [deepWave]);
const capped = xDiscoverWaves(deepWave, 10);
assert.equal(capped.truncated, true);
assert.equal(capped.hosts.length, 0);
assert.ok(capped.visited <= 10);

const discovered = xNote("disc", "start", "0:15");
const open = xDiscoverWaves(discovered.message, 40);
assert.equal(open.truncated, false);
assert.equal(open.hosts.length, 1);
assert.equal(open.hosts[0], discovered.message);

const shadowedNote = xNote("shadow-disc", "end", "0:08");
const discoverPage = el("div", {}, [withShadow(el("div"), [shadowedNote.message])]);
const fromShadow = xDiscoverWaves(discoverPage, 80);
assert.equal(fromShadow.hosts.length, 1);
assert.equal(fromShadow.hosts[0], shadowedNote.message);
assert.equal(fromShadow.shadows.length, 1);
assert.equal(fromShadow.shadows[0], discoverPage.children[0].shadowRoot);

const boringShadow = {
  nodeType: 11,
  children: [],
  querySelector() {
    return null;
  },
};
let boringLeaf = el("div");
for (let i = 0; i < 40; i++) boringLeaf = el("div", {}, [boringLeaf]);
boringShadow.children.push(boringLeaf);
const boringHost = el("div");
boringHost.shadowRoot = boringShadow;
boringShadow.host = boringHost;
const kept = xNote("kept", "start", "0:04");
const mixed = el("div", {}, [boringHost, kept.message]);
const skipped = xDiscoverWaves(mixed, 30);
assert.equal(skipped.truncated, false);
assert.equal(skipped.hosts.length, 1);
assert.equal(skipped.hosts[0], kept.message);
assert.equal(skipped.shadows.length, 0);

const content = readFileSync(join(root, "src", "content.js"), "utf8");
assert.match(content, /xDiscoverWaves/);
assert.match(content, /function xBootScan/);
assert.match(content, /function noteXAdded/);
assert.doesNotMatch(content, /xActionBars\(\s*document\s*\)/);
assert.doesNotMatch(content, /function watchShadows/);
assert.doesNotMatch(content, /function queueScan/);
assert.doesNotMatch(content, /__waTXDebug/);
assert.match(content, /function looseXFeet/);
assert.match(content, /keepXFootOutOfTranscript/);
assert.doesNotMatch(content, /pointermove/);
assert.doesNotMatch(content, /function barsInSmall/);
assert.doesNotMatch(content, /xActionBars\(/);
assert.doesNotMatch(content, /xActionBars\(\s*document\s*\)/);

console.log("x-find.test.mjs ok");

// Opening a transcript must not move the action away from the audio pill.
const positioning = createContext({
  xLayer: () => layer,
});
const layer = { appendChild(foot) { foot.parentElement = this; } };
runInContext(content.slice(content.indexOf("function parkXFoot("), content.indexOf("function placeXTools(")), positioning);
const foot = { style: {}, classList: { remove() {} } };
const pill = { left: 100, right: 380, top: 40, height: 48 };
for (const hidden of [true, false]) {
  const wrap = { hidden, getBoundingClientRect() { throw new Error("Do not anchor actions to the transcript"); } };
  positioning.parkXFoot(foot, pill, false, wrap);
  assert.equal(foot.parentElement, layer);
  assert.equal(foot.style.left, "388px");
  assert.equal(foot.style.top, "48px");
  positioning.parkXFoot(foot, pill, true, wrap);
  assert.equal(foot.style.left, "60px");
  assert.equal(foot.style.top, "48px");
}
positioning.parkXFoot(foot, null, false, {});
assert.equal(foot.style.visibility, "hidden");

// React can replace Play without replacing its full-width message row.
const freshPlay = { isConnected: true, getBoundingClientRect: () => ({ left: 20, right: 52, top: 50, bottom: 82, width: 32, height: 32 }) };
let currentPlay = freshPlay;
const geometry = createContext({ WaXFind: { xPlayControl: () => currentPlay } });
runInContext(content.slice(content.indexOf("function currentXPlay("), content.indexOf("function parkXFoot(")), geometry);
const fullRow = { getBoundingClientRect() { throw new Error("Must not measure the full-width message row"); } };
const staleWrap = { _waPlay: { isConnected: false } };
assert.equal(geometry.xBubbleRect(staleWrap, fullRow).right, 52);
assert.equal(staleWrap._waPlay, freshPlay);
freshPlay.isConnected = false;
currentPlay = null;
assert.equal(geometry.xBubbleRect(staleWrap, fullRow), null);

// A tab's old interval stops after extension reload, including a race where
// runtime.id is still present but sendMessage already throws.
let tick;
let stopped = false;
let invalidated = false;
const polling = createContext({
  chrome: { runtime: { id: "test", sendMessage(_msg, callback) {
    if (invalidated) throw new Error("Extension context invalidated.");
    callback();
  } } },
  WA_MSG: { CHECK_COMPANION: "check" },
  setInterval(callback) { tick = callback; return 123; },
  clearInterval(id) { if (id === 123) stopped = true; },
  console, LOG: "test",
});
runInContext(content.slice(content.indexOf("function startCompanionPolling("), content.indexOf("function start()")), polling);
polling.startCompanionPolling();
assert.equal(typeof tick, "function");
invalidated = true;
assert.doesNotThrow(() => tick());
assert.equal(stopped, true);

// Live X markup uses a message-owned data-hover-rail, not a page overlay.
let prepends = 0;
const nativeReply = { getAttribute: name => name === 'data-testid' ? 'message-reply-button-note' : null };
const nativeRail = {
  children: [nativeReply],
  prepend(node) { prepends++; node.parentElement = this; this.children.unshift(node); },
};
const nativeFoot = { style: {}, contains: () => false, classList: { add() {} }, getAttribute: () => null };
const nativeRow = { querySelector(selector) { assert.equal(selector, '[data-hover-rail]'); return nativeRail; } };
const docking = createContext({ xRowId: () => 'note', ensureXShadowStyle() {} });
runInContext(content.slice(content.indexOf('function dockXNativeRail('), content.indexOf('function nudgeXFoot(')), docking);
assert.equal(docking.dockXNativeRail({ row: nativeRow, foot: nativeFoot }), true);
assert.equal(nativeRail.children[0], nativeFoot);
assert.equal(nativeFoot.style.position, 'static');
assert.equal(docking.dockXNativeRail({ row: nativeRow, foot: nativeFoot }), true);
assert.equal(prepends, 1);
nativeReply.getAttribute = () => 'message-reply-button-another-note';
assert.equal(docking.dockXNativeRail({ row: nativeRow, foot: nativeFoot }), false);

// Transcription can replace Play before the transcript is aligned. The new
// bubble's 16px message inset must survive that replacement.
const insetPill = { getBoundingClientRect: () => ({ left: 270, right: 552, width: 282 }) };
const insetPlay = { isConnected: true, parentElement: insetPill };
const alignment = createContext({ WaXFind: { xPlayControl: () => insetPlay }, getComputedStyle: () => ({}) });
runInContext(content.slice(content.indexOf('function currentXPlay('), content.indexOf('function xBubbleRect(')), alignment);
runInContext(content.slice(content.indexOf('function alignXTranscript('), content.indexOf('function paintXBubble(')), alignment);
const insetWrap = { _waPlay: { isConnected: false, parentElement: null }, _waShell: {}, dataset: { side: 'in' }, style: {} };
alignment.alignXTranscript(insetWrap, { getBoundingClientRect: () => ({ left: 254, right: 1022, width: 768 }) });
assert.equal(insetWrap.style.marginLeft, '16px');
assert.equal(insetWrap.style.width, '460px');
