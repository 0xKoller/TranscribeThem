import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src", "errors.js"), "utf8");
const ctx = createContext({ globalThis: {} });
ctx.globalThis = ctx;
runInContext(src, ctx);
const { mapError, WA_ERROR_COPY, waJobErrorCode } = ctx;

assert.equal(mapError(null, "NO_AUDIO"), WA_ERROR_COPY.NO_AUDIO);
assert.equal(mapError(null, "MEDIA_403"), WA_ERROR_COPY.MEDIA_403);
assert.equal(mapError(null, "RELOAD"), WA_ERROR_COPY.RELOAD);
assert.equal(mapError(null, "NO_WEBGPU"), WA_ERROR_COPY.NO_WEBGPU);
assert.equal(mapError(new Error("Failed to fetch model")), WA_ERROR_COPY.DOWNLOAD);
assert.equal(mapError(new Error("Unauthorized access to file")), WA_ERROR_COPY.DOWNLOAD);
assert.equal(mapError(new Error("401")), WA_ERROR_COPY.DOWNLOAD);
assert.equal(mapError(new Error("EncodingError: decode ogg")), WA_ERROR_COPY.DECODE);
assert.equal(mapError(new Error("GPU out of memory")), WA_ERROR_COPY.OOM);
assert.equal(mapError(new Error("offscreen create failed")), WA_ERROR_COPY.OFFSCREEN);
assert.equal(
  mapError(new Error("no available backend found. ERR: [webgpu] TypeError: webgpuInit is not a function")),
  WA_ERROR_COPY.WEBGPU_FALLBACK
);
assert.match(mapError(new Error("weird")), /Reintentar/);
assert.equal(waJobErrorCode(Object.assign(new Error("aborted"), { name: "AbortError" })), "timeout");
assert.equal(waJobErrorCode(new Error("Companion HTTP 503")), "model_loading");
assert.equal(waJobErrorCode(new Error("No pude bajar este audio. Reintentá.")), "no_audio");
assert.equal(waJobErrorCode(new Error("No pude decodificar el audio (Opus).")), "decode");
assert.equal(waJobErrorCode(new Error("Companion HTTP 500")), "http");
assert.equal(waJobErrorCode(new Error("Falló la transcripción. Tocá Reintentar.")), "generic");
console.log("errors.test.mjs ok");
