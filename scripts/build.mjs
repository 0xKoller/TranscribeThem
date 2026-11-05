import * as esbuild from "esbuild";
import { cpSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendorOrt = join(root, "vendor", "ort");

mkdirSync(vendorOrt, { recursive: true });

function copyOrt(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (/^ort-wasm-simd-threaded(\.asyncify)?\.(mjs|wasm)$/.test(name)) {
      cpSync(join(dir, name), join(vendorOrt, name));
    }
  }
}

copyOrt(join(root, "node_modules", "onnxruntime-web", "dist"));
copyOrt(join(root, "node_modules", "@huggingface", "transformers", "dist"));
if (!existsSync(join(vendorOrt, "ort-wasm-simd-threaded.asyncify.wasm"))) {
  throw new Error("ORT asyncify wasm missing. Run npm install first.");
}

const empty = join(root, "scripts", "empty.js");

await esbuild.build({
  absWorkingDir: root,
  entryPoints: ["src/offscreen.js"],
  bundle: true,
  format: "esm",
  outfile: "src/offscreen.bundle.js",
  platform: "browser",
  target: ["chrome113"],
  legalComments: "eof",
  logLevel: "info",
  mainFields: ["browser", "module", "main"],
  conditions: ["browser"],
  alias: {
    "@huggingface/transformers": join(
      root,
      "node_modules/@huggingface/transformers/dist/transformers.web.js"
    ),
    "onnxruntime-node": empty,
    sharp: empty,
  },
  plugins: [
    {
      name: "external-wasm",
      setup(build) {
        build.onResolve({ filter: /\.wasm$/ }, (args) => ({
          path: args.path,
          external: true,
        }));
      },
    },
  ],
});

const mapFile = join(root, "src", "offscreen.bundle.js.map");
if (existsSync(mapFile)) rmSync(mapFile);

console.log("build ok");
