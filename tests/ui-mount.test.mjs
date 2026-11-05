import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src", "ui-mount.js"), "utf8");
const ctx = createContext({ globalThis: {} });
ctx.globalThis = ctx;
runInContext(src, ctx);
const { chooseMount } = ctx.WaUiMount;

function chain(flexFlags) {
  let parent = null;
  const nodes = flexFlags.map((flex) => {
    const node = { flex, parentElement: parent, nextSibling: null, children: [] };
    if (parent) {
      const prev = parent.children[parent.children.length - 1];
      if (prev) prev.nextSibling = node;
      parent.children.push(node);
    }
    parent = node;
    return node;
  });
  const shell = nodes[0];
  shell.contains = (other) => {
    let n = other;
    while (n) {
      if (n === shell) return true;
      n = n.parentElement;
    }
    return false;
  };
  return nodes;
}

const isFlex = (n) => !!(n && n.flex);

// avatar | stack > bubble > player > play. Buttons go under the bubble, not in the player row.
{
  const [shell, stack, bubble, player, play] = chain([true, false, false, true, false]);
  shell.flex = true;
  const mount = chooseMount(play, shell, isFlex);
  assert.equal(mount.parent, stack);
  assert.equal(mount.bubble, bubble);
  assert.equal(mount.player, player);
  assert.equal(mount.inRow, false);
  assert.equal(mount.before, null);
}

// Message row is the flex (avatar | bubble). The bar is a full-width sibling, not inside the player.
{
  const [shell, bubble, player, play] = chain([true, false, true, false]);
  const mount = chooseMount(play, shell, isFlex);
  assert.equal(mount.parent, shell);
  assert.equal(mount.inRow, true);
  assert.equal(mount.player, player);
  assert.notEqual(mount.parent, player);
}

// No flex row yet: hang the bar on the play control's parent.
{
  const [shell, play] = chain([false, false]);
  const mount = chooseMount(play, shell, isFlex);
  assert.equal(mount.parent, shell);
  assert.equal(mount.player, null);
}

function el(extra) {
  const node = { flex: false, parentElement: null, nextSibling: null, children: [], textContent: "", ...extra };
  node.contains = (other) => {
    let n = other;
    while (n) {
      if (n === node) return true;
      n = n.parentElement;
    }
    return false;
  };
  return node;
}

function add(parent, child) {
  const prev = parent.children[parent.children.length - 1];
  if (prev) prev.nextSibling = child;
  child.parentElement = parent;
  parent.children.push(child);
  return child;
}

// The speed chip centers on its row. The transcript goes after that row, inside the bubble.
{
  const shell = el();
  const speedRow = el({ flex: true });
  const col = el();
  const player = el({ flex: true });
  const play = el();
  const slider = el({ slider: true });
  const speed = el({ textContent: "1.5×" });
  add(shell, speedRow);
  add(speedRow, col);
  add(speedRow, speed);
  add(col, player);
  add(player, play);
  add(player, slider);
  const mount = chooseMount(play, shell, isFlex);
  assert.equal(mount.parent, shell);
  assert.equal(mount.player, speedRow);
  assert.equal(mount.before, null);
  assert.equal(mount.inRow, false);
  assert.notEqual(mount.parent, col);
}

// Shell stopped at the column. Still mount after the speed row, on the bubble.
{
  const bubble = el();
  const speedRow = el({ flex: true });
  const col = el();
  const play = el();
  const slider = el({ slider: true });
  const speed = el({ textContent: "1.5×" });
  add(bubble, speedRow);
  add(speedRow, col);
  add(speedRow, speed);
  add(col, play);
  add(col, slider);
  const mount = chooseMount(play, col, isFlex);
  assert.equal(mount.parent, bubble);
  assert.equal(mount.player, speedRow);
}

const content = readFileSync(join(root, "src", "content.js"), "utf8");
const css = readFileSync(join(root, "src", "content.css"), "utf8");
assert.match(content, /chooseMount/);
assert.match(content, /Leyendo audio/);
assert.doesNotMatch(content, /message: "Cargando modelo/);
assert.doesNotMatch(content, /Otra vez/);
assert.match(content, /debugMode/);
assert.match(content, /wa-t-word/);
assert.match(content, /is-upcoming/);
assert.match(content, /wa-t-tools-meta/);
assert.match(content, /wordPaint/);
assert.match(content, /findClock/);
assert.match(content, /wa-t-meta/);
assert.match(content, /wa-t-word-tx/);
assert.match(content, /wa-t-foot/);
assert.match(content, /placeAside/);
assert.match(content, /_waAsideOnce/);
assert.match(content, /wa-t-aside, \.wa-t-foot/);
assert.match(content, /wa-t-aside/);
assert.match(css, /\.wa-t-aside/);
assert.match(css, /\[hidden\]/);
assert.match(content, /wa-t-share-time/);
assert.match(content, /shareTimeRow/);
assert.match(content, /dataset\.share === "1"/);
assert.doesNotMatch(content, /dockClock/);
assert.match(content, /wa-t-btn-label/);
assert.match(content, /TRANSCRIBE_ICON/);
assert.match(css, /\.wa-t-meta/);
assert.match(css, /\.wa-t-word::before/);
assert.match(css, /\.wa-t-foot/);
assert.match(css, /\.wa-t-share-time/);
assert.doesNotMatch(css, /\.wa-t-docked/);
assert.doesNotMatch(css, /#00a884/);
assert.doesNotMatch(css, /#008f72/);
assert.doesNotMatch(css, /\.wa-t-host/);
assert.doesNotMatch(css, /background:\s*rgba\(0,\s*0,\s*0,\s*0\.12\)/);
assert.match(css, /background:\s*transparent/);
assert.match(css, /\.wa-t-word\.is-upcoming/);
assert.match(css, /\.wa-t-tools-meta/);
assert.match(content, /wa-t-bar/);
assert.match(content, /barsIcon/);
assert.match(content, /dataset\.busy/);
assert.match(content, /seatClockEnd/);
assert.match(content, /placeBelowClock/);
assert.match(content, /_waBelowOnce/);
assert.match(content, /bindHover/);
assert.match(content, /dockWithEmoji/);
assert.match(content, /wa-t-emoji-host/);
assert.match(content, /pointerStillInside/);
assert.match(content, /foot\.classList\.remove\("is-on"\)/);
assert.doesNotMatch(content, /if \(!wrap\._waEmojiDock\) foot\.classList\.remove\("is-on"\)/);
assert.match(css, /wa-t-emoji-host/);
assert.match(css, /\.wa-t-emoji-host\.is-on/);
assert.doesNotMatch(content, /insertBefore\(tools, clock\)/);
assert.match(content, /wa-t-tail/);
assert.match(content, /aria-label/);
assert.match(css, /\.wa-t-btn-label/);
assert.match(css, /wa-t-eq/);
assert.match(css, /\.wa-t-aside \.wa-t-actions/);
assert.match(css, /\.wa-t-tail/);
assert.match(css, /\.wa-t-tail-host/);
assert.match(css, /\.wa-t-aside\.is-on/);
assert.match(css, /\.wa-t-text\.is-open/);
assert.match(css, /\.wa-t-text[\s\S]*padding-inline-end:\s*12px/);
assert.match(css, /grid-template-rows:\s*0fr/);
assert.doesNotMatch(content, /btn\.textContent = label/);

console.log("ui-mount.test.mjs ok");
