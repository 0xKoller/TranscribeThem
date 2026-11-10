import { pipeline, env, LogLevel } from "@huggingface/transformers";
import { detectWhisperLanguage } from "./whisper-lang.js";
import { downloadPct } from "./download-progress.js";

const LOG = "[wa-transcribe]";
const TARGET_SR = 16000;
const DEFAULT_MODEL = "onnx-community/whisper-small";
const DTYPE_FAST = { encoder_model: "fp16", decoder_model_merged: "q4" };
const DTYPE_SAFE = { encoder_model: "fp32", decoder_model_merged: "q4" };

// messages.js and errors.js are classic scripts loaded by offscreen.html before
// this module, so the copy and the message names exist in one place only.
const MSG = globalThis.WA_MSG;
const ERROR_COPY = globalThis.WA_ERROR_COPY;

env.allowLocalModels = false;
env.useBrowserCache = true;
env.useWasmCache = false;
env.logLevel = LogLevel.ERROR;
if (env.backends?.onnx?.wasm) {
  const ortBase = chrome.runtime.getURL("vendor/ort/");
  env.backends.onnx.wasm.wasmPaths = {
    wasm: ortBase + "ort-wasm-simd-threaded.asyncify.wasm",
    mjs: ortBase + "ort-wasm-simd-threaded.asyncify.mjs",
  };
  env.backends.onnx.wasm.proxy = false;
  env.backends.onnx.wasm.numThreads = 1;
}
if (env.backends?.onnx?.webgpu) {
  env.backends.onnx.webgpu.powerPreference = "high-performance";
}

let pipe = null;
let loadedModelId = null;
let loadedDevice = null;
let webgpuOk = null;
let loadPromise = null;
let loadingModelId = null;

const transcribeQueue = [];
let transcribeRunning = false;
const seenRequestIds = new Set();

function log(...args) {
  console.log(LOG, ...args);
}

// Same mapping as the rest of the extension, but an unrecognised engine error
// keeps a short technical detail instead of the generic line.
function mapError(err, code) {
  const mapped = globalThis.mapError(err, code);
  if (mapped !== ERROR_COPY.GENERIC) return mapped;
  const msg = String(err && err.message ? err.message : err || "");
  const short = msg.replace(/\s+/g, " ").trim().slice(0, 140);
  return short ? globalThis.waT("whisperFailed", short) : mapped;
}

async function probeWebGPU() {
  if (!navigator.gpu) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return false;
    if (env.backends?.onnx?.webgpu) {
      env.backends.onnx.webgpu.powerPreference = "high-performance";
      env.backends.onnx.webgpu.adapter = adapter;
    }
    const info = adapter.info || {};
    log("gpu adapter", info.description || info.vendor || info.architecture || "ok", "high-performance");
    return true;
  } catch (_) {
    return false;
  }
}

function send(msg) {
  chrome.runtime.sendMessage(msg, () => {
    void chrome.runtime.lastError;
  });
}

function emitStatus(extra = {}) {
  send({
    type: MSG.STATUS,
    webgpu: webgpuOk,
    device: loadedDevice,
    modelCached: !!pipe && extra.modelCached !== false,
    modelId: loadedModelId,
    ...extra,
  });
}

function emitLoadProgress(requestId, message, pct) {
  send({
    type: MSG.PROGRESS,
    requestId: requestId || null,
    phase: "loading",
    message,
    pct: typeof pct === "number" ? pct : null,
    modelId: loadingModelId || loadedModelId,
  });
}

function isDownloadError(err) {
  const msg = String(err && err.message ? err.message : err || "");
  return /401|403|404|Unauthorized|Failed to fetch|failed to download|Load failed|NetworkError/i.test(msg);
}

function isWebgpuInitError(err) {
  const msg = String(err && err.message ? err.message : err || "");
  return /webgpuInit|no available backend|not a function/i.test(msg);
}

function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function resampleMono(audioBuffer) {
  const channels = audioBuffer.numberOfChannels;
  const sr = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const mono = new Float32Array(length);
  if (channels === 1) {
    mono.set(audioBuffer.getChannelData(0));
  } else {
    for (let c = 0; c < channels; c++) {
      const data = audioBuffer.getChannelData(c);
      for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
    }
  }
  if (sr === TARGET_SR) return mono;
  const outLen = Math.max(1, Math.round((length * TARGET_SR) / sr));
  const out = new Float32Array(outLen);
  const ratio = length / outLen;
  for (let i = 0; i < outLen; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(i0 + 1, length - 1);
    const t = x - i0;
    out[i] = mono[i0] * (1 - t) + mono[i1] * t;
  }
  return out;
}

function padPcm(pcm) {
  const min = TARGET_SR;
  if (pcm.length >= min) return pcm;
  const out = new Float32Array(min);
  out.set(pcm);
  return out;
}

async function decodePcmWithContext(arrayBuffer) {
  const ctx = new AudioContext({ sampleRate: TARGET_SR });
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    return resampleMono(audioBuffer);
  } finally {
    try {
      await ctx.close();
    } catch (_) {
      /* ignore */
    }
  }
}

async function decodePcmViaElement(arrayBuffer, mimeType) {
  const type = mimeType && mimeType.includes("audio") ? mimeType : "audio/ogg; codecs=opus";
  const blob = new Blob([arrayBuffer], { type });
  const url = URL.createObjectURL(blob);
  try {
    const audio = new Audio();
    audio.preload = "auto";
    audio.src = url;
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("audio element timeout")), 5000);
      audio.onloadedmetadata = () => {
        clearTimeout(t);
        resolve();
      };
      audio.onerror = () => {
        clearTimeout(t);
        reject(new Error("audio element error"));
      };
    });
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    return decodePcmWithContext(buf);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decodePcm(arrayBuffer, mimeType) {
  try {
    return padPcm(await decodePcmWithContext(arrayBuffer));
  } catch (err) {
    log("decodeAudioData failed, retry typed blob", err && err.message);
  }
  try {
    const typed = await new Blob([arrayBuffer], { type: "audio/ogg; codecs=opus" }).arrayBuffer();
    return padPcm(await decodePcmWithContext(typed));
  } catch (err) {
    log("typed blob decode failed, retry audio element", err && err.message);
  }
  return padPcm(await decodePcmViaElement(arrayBuffer, mimeType));
}

function resolveLanguageMode(languageMode) {
  return languageMode === "en" || languageMode === "auto" ? languageMode : "es";
}

const ALLOWED_MODELS = {
  "onnx-community/whisper-small": true,
  "Xenova/whisper-medium": true,
  "onnx-community/whisper-large-v3-turbo": true,
};
const MODEL_ALIASES = {
  "onnx-community/whisper-medium": "Xenova/whisper-medium",
};

function resolveModelId(modelId) {
  const aliased = MODEL_ALIASES[modelId] || modelId;
  const id = aliased || loadedModelId || DEFAULT_MODEL;
  if (!ALLOWED_MODELS[id] || /\.en$/i.test(id)) {
    log("reject model", id, "→", DEFAULT_MODEL);
    return DEFAULT_MODEL;
  }
  return id;
}

async function ensurePipeline(modelId, requestId) {
  await globalThis.waI18nInit();
  modelId = resolveModelId(modelId);
  if (pipe && loadedModelId === modelId) {
    log("reuse pipeline", modelId, loadedDevice);
    return pipe;
  }
  if (loadPromise) {
    if (loadingModelId === modelId) return loadPromise;
    try {
      await loadPromise;
    } catch (_) {
      /* previous load failed; continue */
    }
    return ensurePipeline(modelId, requestId);
  }

  loadingModelId = modelId;
  const run = (async () => {
    if (webgpuOk == null) webgpuOk = await probeWebGPU();

    let device = webgpuOk ? "webgpu" : "wasm";
    if (!webgpuOk) {
      emitLoadProgress(requestId, ERROR_COPY.WEBGPU_FALLBACK, null);
    }

    emitLoadProgress(requestId, globalThis.waT("loadingModel"), 0);

    const load = async (dev, dtype) => {
      log("loading", modelId, "device", dev, "dtype", dtype.encoder_model, dtype.decoder_model_merged);
      const fileBytes = new Map();
      let uiPct = 0;
      return pipeline("automatic-speech-recognition", modelId, {
        device: dev,
        dtype,
        progress_callback: (p) => {
          if (!p) return;
          if (p.status === "progress_total" && (p.total || p.progress != null)) {
            const pct = p.total
              ? Math.round((100 * (p.loaded || 0)) / p.total)
              : Math.round(Number(p.progress) || 0);
            uiPct = Math.max(uiPct, Math.max(0, Math.min(100, pct)));
            emitLoadProgress(requestId, globalThis.waT("loadingModelPct", [String(uiPct)]), uiPct);
            return;
          }
          if (p.status !== "progress" || !p.total) return;
          const key = p.file || p.name || "file";
          fileBytes.set(key, { loaded: p.loaded || 0, total: p.total });
          const nextPct = downloadPct(fileBytes, uiPct);
          if (nextPct === uiPct) return;
          uiPct = nextPct;
          emitLoadProgress(requestId, globalThis.waT("loadingModelPct", [String(uiPct)]), uiPct);
        },
      });
    };

    let next;
    let dtype = DTYPE_FAST;
    try {
      next = await load(device, dtype);
    } catch (err) {
      log("pipeline load failed on", device, dtype.encoder_model, err);
      if (device === "webgpu" && isDownloadError(err)) {
        throw err;
      }
      if (device === "webgpu" && isWebgpuInitError(err)) {
        log("webgpuInit missing, skip fp32 retry, go wasm");
        webgpuOk = false;
        device = "wasm";
        emitLoadProgress(requestId, ERROR_COPY.WEBGPU_FALLBACK, null);
        next = await load("wasm", DTYPE_SAFE);
      } else if (device === "webgpu") {
        log("retry encoder fp32 on webgpu");
        dtype = DTYPE_SAFE;
        try {
          next = await load("webgpu", dtype);
        } catch (err2) {
          log("fp32 webgpu failed, retry wasm", err2);
          webgpuOk = false;
          device = "wasm";
          emitLoadProgress(requestId, ERROR_COPY.WEBGPU_FALLBACK, null);
          next = await load("wasm", DTYPE_SAFE);
        }
      } else {
        throw err;
      }
    }

    stampWhisperMultilingual(next);
    pipe = next;
    loadedModelId = modelId;
    loadedDevice = device;
    emitStatus();
    return pipe;
  })();

  loadPromise = run;
  try {
    return await run;
  } finally {
    if (loadPromise === run) {
      loadPromise = null;
      loadingModelId = null;
    }
  }
}

const WHISPER_LANG_TO_ID = {
  "<|en|>": 50259,
  "<|zh|>": 50260,
  "<|de|>": 50261,
  "<|es|>": 50262,
  "<|ru|>": 50263,
  "<|ko|>": 50264,
  "<|fr|>": 50265,
  "<|ja|>": 50266,
  "<|pt|>": 50267,
  "<|tr|>": 50268,
  "<|pl|>": 50269,
  "<|ca|>": 50270,
  "<|nl|>": 50271,
  "<|ar|>": 50272,
  "<|it|>": 50274,
};
const WHISPER_TASK_TO_ID = { translate: 50358, transcribe: 50359 };

function stampWhisperMultilingual(asr) {
  const gen = asr?.model?.generation_config;
  if (!gen) return;
  gen.lang_to_id = { ...WHISPER_LANG_TO_ID, ...(gen.lang_to_id || {}) };
  gen.task_to_id = { ...WHISPER_TASK_TO_ID, ...(gen.task_to_id || {}) };
  gen.is_multilingual = true;
  gen.task = "transcribe";
  if (!gen.language) gen.language = "es";
  if (asr.model.config) asr.model.config.is_multilingual = true;
  log("whisper multilingual", true, "es", gen.lang_to_id["<|es|>"]);
}

function whisperOpts(language) {
  return {
    task: "transcribe",
    language: language === "es" ? "spanish" : language,
    // Whisper decodes 30 s windows; chunk longer notes with overlap.
    chunk_length_s: 30,
    stride_length_s: 5,
    temperature: 0,
    is_multilingual: true,
    lang_to_id: WHISPER_LANG_TO_ID,
    task_to_id: WHISPER_TASK_TO_ID,
  };
}

function wordsFromWhisper(output) {
  const chunks = output && output.chunks;
  if (!Array.isArray(chunks)) return [];
  const words = [];
  for (const chunk of chunks) {
    const text = String((chunk && chunk.text) || "").trim();
    const ts = chunk && chunk.timestamp;
    if (!text || !ts || ts[0] == null) continue;
    const start = Number(ts[0]);
    const end = ts[1] == null ? start : Number(ts[1]);
    if (!(start >= 0)) continue;
    words.push({ text, start, end: end >= start ? end : start });
  }
  if (words.length === 1 && words[0].text.split(/\s+/).length > 6) return [];
  return words;
}

async function transcribePcm(asr, pcm, opts) {
  try {
    return await asr(pcm, { ...opts, return_timestamps: "word" });
  } catch (err) {
    log("word timestamps failed, retry plain", err && err.message);
    return await asr(pcm, opts);
  }
}

// "auto" asks the model which language it hears; a failed detection uses Spanish.
async function pickLanguage(asr, pcm, languageMode) {
  if (languageMode !== "auto") return languageMode;
  try {
    const detected = await detectWhisperLanguage(asr, pcm, WHISPER_LANG_TO_ID, TARGET_SR);
    log("language detected", detected);
    return detected || "es";
  } catch (err) {
    log("language detection failed", err && err.message);
    return "es";
  }
}

async function runTranscribe({ requestId, audioBase64, mimeType, languageMode, modelId }) {
  await globalThis.waI18nInit();
  modelId = resolveModelId(modelId);
  languageMode = resolveLanguageMode(languageMode);
  try {
    let pcm;
    try {
      const buf = base64ToArrayBuffer(audioBase64);
      log("decode", mimeType || "unknown", buf.byteLength, "bytes");
      pcm = await decodePcm(buf, mimeType);
      log("pcm samples", pcm.length, "sec", (pcm.length / TARGET_SR).toFixed(2));
    } catch (err) {
      log("decode failed", err && err.message, err);
      send({ type: MSG.ERROR, requestId, message: mapError(err, "DECODE") });
      return;
    }

    send({
      type: MSG.PROGRESS,
      requestId,
      phase: "running",
      message: globalThis.waT("transcribing"),
    });

    const audioSeconds = pcm.length / TARGET_SR;

    let asr = await ensurePipeline(modelId, requestId);
    stampWhisperMultilingual(asr);
    const language = await pickLanguage(asr, pcm, languageMode);
    const opts = whisperOpts(language);
    const gen = asr?.model?.generation_config;
    log("asr config", {
      requestId,
      languageMode,
      language,
      optsLanguage: opts.language,
      optsTask: opts.task,
      genLanguage: gen && gen.language,
      genTask: gen && gen.task,
      genMulti: gen && gen.is_multilingual,
      langEs: gen && gen.lang_to_id && gen.lang_to_id["<|es|>"],
      taskTranscribe: gen && gen.task_to_id && gen.task_to_id.transcribe,
      device: loadedDevice,
      pcmSec: +(pcm.length / TARGET_SR).toFixed(2),
      bytes: audioBase64 ? Math.round((audioBase64.length * 3) / 4) : 0,
    });
    let output;
    let transcribeStarted = performance.now();
    try {
      log("asr start", loadedDevice, "samples", pcm.length);
      transcribeStarted = performance.now();
      const t0 = transcribeStarted;
      output = await transcribePcm(asr, pcm, opts);
      log(
        "asr ok",
        loadedDevice,
        "ms",
        Math.round(performance.now() - t0),
        "raw",
        JSON.stringify(output && output.text ? output.text : output).slice(0, 200)
      );
    } catch (err) {
      log("asr fail", loadedDevice, err && err.message);
      const msg = String(err && err.message ? err.message : err);
      if (loadedDevice === "wasm" || /English-only|is_multilingual|<\|es\|>/i.test(msg)) throw err;
      send({
        type: MSG.PROGRESS,
        requestId,
        phase: "running",
        message: globalThis.waT("webgpuCpuRetry"),
      });
      pipe = null;
      loadedModelId = null;
      loadedDevice = null;
      webgpuOk = false;
      asr = await ensurePipeline(modelId, requestId);
      stampWhisperMultilingual(asr);
      log("asr retry wasm", "samples", pcm.length);
      transcribeStarted = performance.now();
      output = await transcribePcm(asr, pcm, opts);
      log("asr ok wasm");
    }
    const text = (output && output.text ? output.text : String(output || "")).trim();
    const words = wordsFromWhisper(output);
    log("done", { requestId, language, device: loadedDevice, text: text.slice(0, 160) });
    send({
      type: MSG.RESULT,
      requestId,
      text,
      language,
      words,
      audioSeconds,
      transcribeMs: Math.round(performance.now() - transcribeStarted),
      engine: "whisper",
      model: modelId,
    });
  } catch (err) {
    log("transcribe failed", err && err.message, err);
    send({ type: MSG.ERROR, requestId, message: mapError(err) });
  }
}

async function enqueueTranscribe(msg) {
  if (msg.requestId && seenRequestIds.has(msg.requestId)) {
    log("skip duplicate TRANSCRIBE", msg.requestId);
    return;
  }
  if (msg.requestId) {
    seenRequestIds.add(msg.requestId);
    if (seenRequestIds.size > 80) seenRequestIds.clear();
  }
  log("queue TRANSCRIBE", {
    requestId: msg.requestId,
    modelId: msg.modelId || DEFAULT_MODEL,
    languageMode: resolveLanguageMode(msg.languageMode),
    bytes: msg.byteLength || (msg.audioBase64 ? Math.round((msg.audioBase64.length * 3) / 4) : 0),
  });
  transcribeQueue.push(msg);
  if (transcribeRunning) return;
  transcribeRunning = true;
  try {
    while (transcribeQueue.length) {
      await runTranscribe(transcribeQueue.shift());
    }
  } finally {
    transcribeRunning = false;
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.type) return;
  if (msg.target !== "offscreen") return;

  if (msg.type === MSG.TRANSCRIBE) {
    enqueueTranscribe(msg);
    return;
  }
  if (msg.type === MSG.PRELOAD) {
    (async () => {
      try {
        log("preload start", msg.modelId);
        await ensurePipeline(msg.modelId);
        log("preload done", loadedModelId, loadedDevice);
        emitStatus();
      } catch (err) {
        log("preload failed", err && err.message);
        send({
          type: MSG.ERROR,
          message: mapError(err, isDownloadError(err) ? "DOWNLOAD" : null),
          modelId: msg.modelId,
        });
        emitStatus({ modelCached: !!pipe });
      }
    })();
    return;
  }
  if (msg.type === MSG.GET_STATUS) {
    (async () => {
      if (webgpuOk == null) webgpuOk = await probeWebGPU();
      emitStatus();
    })();
    return;
  }
  if (msg.type === MSG.SETTINGS_CHANGED) {
    if (msg.modelId && msg.modelId !== loadedModelId) {
      ensurePipeline(msg.modelId).catch((err) => {
        log("settings load failed", err && err.message);
      });
    }
  }
});

(async () => {
  webgpuOk = await probeWebGPU();
  if (!webgpuOk) log("no WebGPU adapter; wasm fallback");
  emitStatus();
  log("offscreen ready");
})();
