#!/usr/bin/env node
// Builds dist/TranscribeThem-webstore-<version>.zip for the Chrome Web Store.
// Same files as the release ZIP, minus the manifest "key": the Store rejects
// it and assigns its own extension ID.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const out = join(root, "dist", "webstore");
const zip = join(root, "dist", `TranscribeThem-webstore-${manifest.version}.zip`);

if (!existsSync(join(root, "src", "offscreen.bundle.js"))) {
  console.error("Run npm run build first.");
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "icons"), { recursive: true });
for (const dir of ["src", "vendor", "_locales"]) cpSync(join(root, dir), join(out, dir), { recursive: true });
for (const size of [16, 32, 48, 128]) cpSync(join(root, "icons", `icon${size}.png`), join(out, "icons", `icon${size}.png`));

delete manifest.key;
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

rmSync(zip, { force: true });
execFileSync("zip", ["-qr", "-X", zip, ".", "-x", "*.map", "*.DS_Store"], { cwd: out });
console.log(zip);
