// End to end: the real extension in Playwright's Chromium, a synthetic
// WhatsApp page served at https://web.whatsapp.com and a fake Mac app.
// Run with: npm run test:e2e   (first time: npx playwright install chromium)
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PINNED_ID = "bnmnjapomgkgljobkcalefbbnfcfjlmd";
const page = readFileSync(join(root, "tests", "e2e", "whatsapp.html"), "utf8");

// Fake Mac app: answers like the real one and records what it got.
const received = [];
let hold = null; // when set, /transcribe waits until released
let healthExtra = {}; // extra fields in GET /health
const app = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const body = Buffer.concat(chunks);
    const json = (status, obj) => {
      res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": req.headers.origin || "*" });
      res.end(JSON.stringify(obj));
    };
    if (req.url === "/health") return json(200, { ok: true, ready: true, engine: "parakeet", features: {}, ...healthExtra });
    if (req.url === "/v1/settings") return json(404, { ok: false });
    if (req.url === "/transcribe") {
      received.push({ headers: req.headers, body });
      if (hold) await hold;
      const text = "transcripción e2e " + received.length;
      const words = text.split(" ").map((w, i) => ({ text: w, start: i * 0.5, end: i * 0.5 + 0.4 }));
      return json(200, { ok: true, text, audioSeconds: 4, transcribeMs: 42, words });
    }
    return json(200, { ok: true });
  });
});
await new Promise((r) => app.listen(0, "127.0.0.1", r));
const port = app.address().port;

const logs = [];
const profile = mkdtempSync(join(tmpdir(), "tt-e2e-"));
const context = await chromium.launchPersistentContext(profile, {
  // The full Chromium build; the headless shell cannot load extensions.
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
});
const fail = async (err) => {
  try {
    const t = context.pages().find((p) => p.url().startsWith("https://web.whatsapp.com"));
    if (t) {
      console.error("wraps:", await t.evaluate(() => [...document.querySelectorAll(".wa-t-wrap")].map((w) => ({ phase: w.dataset.phase, status: (w._waStatus || {}).textContent }))));
    }
    console.error("app received:", received.length, received.map((r) => r.headers["content-type"]));
    console.error("console:", logs.slice(-15).join("\n"));
  } catch (_) {}
  await context.close().catch(() => {});
  app.close();
  rmSync(profile, { recursive: true, force: true });
  throw err;
};

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  assert.equal(extensionId, PINNED_ID, "the manifest key pins the extension ID");

  await worker.evaluate(async (p) => {
    await chrome.storage.local.set({ companionPort: p, engineMode: "companion", languageMode: "es", transcriptCache: {} });
  }, port);

  await context.route("https://web.whatsapp.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: page })
  );
  const tab = await context.newPage();
  tab.on("console", (m) => logs.push(m.text()));
  await tab.goto("https://web.whatsapp.com/");
  await tab.waitForSelector("[data-wa-t-hook]", { state: "attached", timeout: 10000 });
  await tab.waitForFunction(() => document.querySelectorAll(".wa-t-btn").length === 2, null, { timeout: 10000 });
  const note = (id) => `[data-id="false_111@c.us_${id}"]`;
  const shown = async (id) => ((await tab.locator(`${note(id)} .wa-t-text`).textContent()) || "").replace(/\s+/g, " ").trim();
  // Like a person: hover the note so its actions show, then click.
  const press = async (id) => {
    await tab.locator(`${note(id)} .bubble`).hover();
    await tab.locator(`${note(id)} .wa-t-btn`).click({ timeout: 5000 });
  };

  // 1. Click Transcribe on the first note: the app gets raw bytes, the text shows.
  await press("E2E1");
  await tab.waitForFunction((sel) => document.querySelector(sel + " .wa-t-wrap")?.dataset.phase === "done", note("E2E1"), { timeout: 15000 });
  assert.match(await shown("E2E1"), /transcripción e2e 1/);
  const first = received[0];
  assert.equal(first.headers["x-site"], "whatsapp");
  assert.equal(first.headers["x-language"], "es");
  assert.match(first.headers["content-type"], /^audio\/ogg/);
  assert.equal(first.headers.origin, `chrome-extension://${PINNED_ID}`);
  assert.equal(first.body.length, 8192, "the whole note reaches the app as bytes");
  assert.ok(first.body.subarray(0, 35).toString().startsWith("OggS-fake-audio-false_111@c.us_E2E1"), "and it is this note");

  // 2. Cancel while the app is busy: the note goes back to idle and stays there.
  let release;
  hold = new Promise((r) => { release = r; });
  await press("E2E2");
  for (let i = 0; i < 50 && received.length < 2; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(received.length, 2, "the second note reached the app");
  const busyTitle = await tab.locator(`${note("E2E2")} .wa-t-btn`).getAttribute("title");
  assert.ok(["Cancelar", "Cancel"].includes(busyTitle), "while busy the button cancels (" + busyTitle + ")");
  await press("E2E2");
  await tab.waitForFunction((sel) => document.querySelector(sel + " .wa-t-wrap")?.dataset.phase === "idle", note("E2E2"));
  hold = null;
  release();
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(await tab.locator(`${note("E2E2")} .wa-t-wrap`).getAttribute("data-phase"), "idle", "a cancelled result is dropped");

  // 3. "Transcribe the notes on screen" (popup button / shortcut message) picks the pending one.
  const count = await worker.evaluate(async () => {
    const [t] = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
    return new Promise((resolve) => chrome.tabs.sendMessage(t.id, { type: "WA_TRANSCRIBE_VISIBLE", mode: "all" }, (r) => resolve(r && r.count)));
  });
  assert.equal(count, 1, "only the note without a transcript");
  await tab.waitForFunction((sel) => document.querySelector(sel + " .wa-t-wrap")?.dataset.phase === "done", note("E2E2"), { timeout: 15000 });

  // 4. A reload brings the transcripts back from the cache without asking the app.
  const before = received.length;
  await tab.reload();
  await tab.waitForFunction((sel) => document.querySelector(sel + " .wa-t-wrap")?.dataset.phase === "done", note("E2E1"), { timeout: 10000 });
  assert.match(await shown("E2E1"), /transcripción e2e 1/);
  assert.equal(received.length, before, "restored from the cache, not transcribed again");

  // 5. The popup offers the button on a WhatsApp tab.
  const popup = await context.newPage();
  const popupErrors = [];
  popup.on("pageerror", (e) => popupErrors.push(String(e)));
  await popup.goto(`chrome-extension://${PINNED_ID}/src/popup.html`);
  await popup.waitForSelector("#transcribe-visible", { state: "attached" });
  assert.ok((await popup.locator("#transcribe-visible").innerText()).length > 5);

  // 6. An update the app found shows in the popup, with the badge.
  assert.equal(await popup.locator("#update-box").isHidden(), true, "no notice while up to date");
  healthExtra = { version: "99.0.0", update: { version: "99.1.0", url: "https://github.com/0xKoller/TranscribeThem/releases/tag/v99.1.0" } };
  // The service worker cannot message itself; call its health check directly.
  await worker.evaluate(() => checkCompanion());
  await popup.waitForSelector("#update-box:not([hidden])", { timeout: 5000 });
  assert.match(await popup.locator("#update-title").innerText(), /99\.1\.0/);
  assert.equal(await worker.evaluate(() => chrome.action.getBadgeText({})), "↑");
  healthExtra = {};
  assert.deepEqual(popupErrors, [], "no errors in the popup");

  console.log("extension.e2e.mjs ok");
} catch (err) {
  await fail(err);
}
await context.close();
app.close();
rmSync(profile, { recursive: true, force: true });
