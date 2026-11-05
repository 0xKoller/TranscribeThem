import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src", "extract-match.js"), "utf8");
const ctx = createContext({ globalThis: {} });
ctx.globalThis = ctx;
runInContext(src, ctx);
const { closestControl, acceptCapturedBlob, restoredMedia, transportControl, voiceDurationSec } = ctx.WaExtractMatch;

const list = { parentElement: null };
const above = { parentElement: list };
const green = { parentElement: list };
const abovePlay = { parentElement: above, contains() { return false; } };
const greenPlay = { parentElement: green, contains() { return false; } };
const wrap = { parentElement: green, contains() { return false; } };

assert.equal(closestControl(wrap, [abovePlay, greenPlay]), greenPlay);
assert.equal(closestControl(wrap, [greenPlay, abovePlay]), greenPlay);
assert.equal(closestControl(above, [abovePlay, greenPlay]), abovePlay);

const greenBlob = { id: "green" };
const aboveBlob = { id: "above" };

assert.equal(
  acceptCapturedBlob({
    blob: aboveBlob,
    playerBlob: aboveBlob,
    wasPlayingBeforeClick: false,
    srcChanged: false,
    ourControlPaused: false,
    foreignPlaying: false,
  }),
  false,
  "stale player src must not be reused just because the duration is close"
);

assert.equal(
  acceptCapturedBlob({
    blob: aboveBlob,
    playerBlob: greenBlob,
    srcChanged: true,
    ourControlPaused: true,
  }),
  false,
  "a prefetched blob that is not the player src is not this note"
);

assert.equal(
  acceptCapturedBlob({
    blob: greenBlob,
    playerBlob: greenBlob,
    wasPlayingBeforeClick: false,
    srcChanged: true,
    ourControlPaused: true,
    foreignPlaying: true,
  }),
  true
);

assert.equal(
  acceptCapturedBlob({
    blob: greenBlob,
    fresh: true,
  }),
  true,
  "a blob decrypted after the click counts even if play() never starts"
);

assert.equal(
  acceptCapturedBlob({
    blob: aboveBlob,
    playerBlob: aboveBlob,
    fresh: false,
    srcChanged: true,
    ourControlPaused: false,
    foreignPlaying: true,
    playingHere: false,
  }),
  true,
  "a player src that changed after the click is the note we asked for"
);

assert.equal(
  acceptCapturedBlob({
    blob: greenBlob,
    playerBlob: greenBlob,
    wasPlayingBeforeClick: true,
    srcChanged: false,
  }),
  true
);

assert.equal(
  acceptCapturedBlob({
    blob: aboveBlob,
    playerBlob: aboveBlob,
    srcChanged: false,
    ourControlPaused: true,
    stableReplay: false,
    foreignPlaying: false,
  }),
  false,
  "pause icon alone can flip before the player src catches up"
);

assert.equal(
  acceptCapturedBlob({
    blob: greenBlob,
    playerBlob: greenBlob,
    srcChanged: false,
    stableReplay: true,
  }),
  true
);

function assertMedia(actual, muted, volume) {
  assert.equal(actual.muted, muted);
  assert.equal(actual.volume, volume);
}
assertMedia(restoredMedia(null), false, 1);
assertMedia(restoredMedia({ muted: false, volume: 0 }), false, 1);
assertMedia(restoredMedia({ muted: true, volume: 0.4 }), true, 0.4);

function ordered(id, index, kids) {
  return {
    id,
    index,
    contains(other) {
      return (kids || []).includes(other);
    },
    compareDocumentPosition(other) {
      if (!other || other.index == null || other.index === index) return 0;
      return other.index > index ? 4 : 2;
    },
  };
}

const slider = ordered("slider", 2);
const play = ordered("play", 1);
const speed = ordered("speed", 3);
const ours = ordered("ours", 4);
const bubble = ordered("bubble", 0, [slider, play, speed]);
assert.equal(transportControl([play, speed, ours], slider), play);
assert.equal(transportControl([bubble, speed, play], slider), play);
assert.equal(transportControl([bubble], slider), null, "the bubble that wraps the slider is not the play control");

const sliderFirst = ordered("slider", 1);
const playAfter = ordered("play", 2);
const speedAfter = ordered("speed", 3);
assert.equal(transportControl([speedAfter, playAfter], sliderFirst), playAfter);

assert.equal(voiceDurationSec([{ total: 27 }, { total: 18 * 60 + 31 }]), 27);
assert.equal(voiceDurationSec([{ total: 3 }]), 3);
assert.equal(voiceDurationSec([{ total: 0 }, { total: 18 * 60 + 31 }]), 18 * 60 + 31);
assert.equal(voiceDurationSec([]), null);

const hook = readFileSync(join(root, "src", "page-hook.js"), "utf8");
assert.match(hook, /acceptCapturedBlob/);
assert.match(hook, /closestControl/);
assert.match(hook, /transportControl/);
assert.match(hook, /restoreAll/);
assert.match(hook, /extractChain/);
assert.match(hook, /origPlay\.apply/);
assert.match(hook, /playsDuringCapture/);
assert.match(hook, /applySeekTime/);
assert.match(hook, /seekSlider/);
assert.match(hook, /suspendContexts/);
assert.match(hook, /type === "seek"/);
assert.doesNotMatch(hook, /swallowedPlay/);
assert.doesNotMatch(hook, /audibleFallback/);
assert.doesNotMatch(hook, /muteAll\(true\)/);
assert.doesNotMatch(hook, /recentBlobs match/);
assert.doesNotMatch(hook, /closest\("button, \[role='button'\]"\) \|\| el/);

console.log("extract-match.test.mjs ok");
