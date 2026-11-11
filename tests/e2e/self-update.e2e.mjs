// End to end: the Mac app replaces the files of the unpacked extension folder
// and the extension reloads itself with the new version.
// Run with: npm run test:e2e
import { chromium } from "playwright";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const work = mkdtempSync(join(tmpdir(), "tt-self-update-"));
const ext = join(work, "Extension");
for (const part of ["manifest.json", "src", "vendor", "_locales", "icons"]) {
  cpSync(join(root, part), join(ext, part), { recursive: true });
}
const manifestPath = join(ext, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const context = await chromium.launchPersistentContext(join(work, "profile"), {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
try {
  const ours = (w) => w.url().startsWith("chrome-extension://bnmnjapomgkgljobkcalefbbnfcfjlmd/");
  let worker = context.serviceWorkers().find(ours);
  if (!worker) worker = await context.waitForEvent("serviceworker", { predicate: ours });
  // Right after start the worker can answer before its script has run.
  for (let i = 0; i < 50; i++) {
    const ready = await worker.evaluate(() => typeof reloadIfNewerOnDisk === "function").catch(() => false);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(await worker.evaluate(() => chrome.runtime.getManifest().version), manifest.version);

  // Users load the folder with Developer mode on. Without it, Chrome disables
  // an unpacked extension that reloads (unsupportedDeveloperExtension).
  const settings = await context.newPage();
  await settings.goto("chrome://extensions/");
  await settings.evaluate(() => new Promise((r) => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, r)));
  await settings.close();

  // Same version on disk: nothing happens.
  assert.equal(await worker.evaluate(() => reloadIfNewerOnDisk()), false);

  // The app drops a newer copy into the folder.
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: "99.0.0" }, null, 2));
  await worker.evaluate(() => reloadIfNewerOnDisk()).catch(() => {});
  // After a reload Chrome starts the new service worker on its next event.
  // Opening the popup sends it one.
  let reloaded = null;
  for (let i = 0; i < 30 && !reloaded; i++) {
    await new Promise((r) => setTimeout(r, 500));
    for (const w of context.serviceWorkers()) {
      const version = await w.evaluate(() => chrome.runtime.getManifest().version).catch(() => null);
      if (version === "99.0.0") reloaded = w;
    }
    if (!reloaded && i % 4 === 1) {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/popup.html`).catch(() => {});
      await page.close().catch(() => {});
    }
  }
  assert.ok(reloaded, "the extension came back with the version on disk");
  assert.equal(await reloaded.evaluate(() => chrome.runtime.getManifest().version), "99.0.0");
  assert.equal(await reloaded.evaluate(async () => (await chrome.storage.local.get("updatedFrom")).updatedFrom), manifest.version);
  console.log("self-update.e2e.mjs ok");
} finally {
  await context.close();
  rmSync(work, { recursive: true, force: true });
}
