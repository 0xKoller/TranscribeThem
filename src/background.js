/* global WA_MSG, WA_TARGET, WA_PHASE, createSerialQueue, waGetSettings, waSetSettings, mapError */
importScripts("messages.js", "settings.js", "companion-sync.js", "errors.js", "queue.js");

const LOG = "[wa-transcribe]";
const OFFSCREEN_URL = "src/offscreen.html";

const queue = createSerialQueue();
const pending = new Map(); // requestId -> { tabId, frameId, resolve, reject }

function log(...args) {
  console.log(LOG, ...args);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let signalOffscreenReady = () => {};
let offscreenReady = Promise.resolve();

function markOffscreenReady() {
  signalOffscreenReady();
}

async function hasOffscreen() {
  if (chrome.offscreen && chrome.offscreen.hasDocument) {
    try {
      return await chrome.offscreen.hasDocument();
    } catch (_) {
      /* fall through */
    }
  }
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  offscreenReady = new Promise((resolve) => {
    signalOffscreenReady = resolve;
  });
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["WORKERS", "BLOBS"],
      justification:
        "Run on-device Whisper ASR with WebGPU/WASM workers and decode voice-note blobs.",
    });
    log("offscreen created");
  } catch (err) {
    if (/Only a single offscreen/i.test(String(err && err.message))) {
      markOffscreenReady();
      return;
    }
    throw err;
  }
  await Promise.race([offscreenReady, delay(8000)]);
}

function siteFromSender(sender) {
  const url = sender && sender.tab && sender.tab.url;
  const id = typeof waSiteId === "function" ? waSiteId(url) : "";
  return id || "unknown";
}

function forwardToTab(requestId, message) {
  const dest = pending.get(requestId);
  if (!dest || dest.tabId == null) return;
  chrome.tabs.sendMessage(dest.tabId, message, { frameId: dest.frameId }, () => {
    void chrome.runtime.lastError;
  });
}

async function tryCompanionTranscribe(job, settings) {
  const port = settings.companionPort || 8765;
  const companionUrl = `http://127.0.0.1:${port}`;
  try {
    forwardToTab(job.requestId, {
      type: WA_MSG.PROGRESS,
      requestId: job.requestId,
      phase: WA_PHASE.RUNNING,
      message: "Transcribiendo con Parakeet (app local)…",
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const res = await fetch(`${companionUrl}/transcribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        audioBase64: job.audioBase64,
        mimeType: job.mimeType || "audio/ogg",
        language: waCompanionLanguage(settings.languageMode),
        site: job.site || "unknown",
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Companion HTTP ${res.status}`);
    }
    const data = await res.json();
    if (data && data.ok && typeof data.text === "string") {
      log("Companion transcribed:", {
        text: data.text.slice(0, 80),
        audioSeconds: data.audioSeconds,
        transcribeMs: data.transcribeMs,
      });
      return {
        result: {
          type: WA_MSG.RESULT,
          requestId: job.requestId,
          text: data.text,
          language: settings.languageMode || "es",
          engine: "parakeet",
          duration: data.audioSeconds,
          transcribeMs: data.transcribeMs,
          words: Array.isArray(data.words) ? data.words : [],
        },
      };
    }
    throw new Error(data && data.error ? data.error : "Companion HTTP " + res.status);
  } catch (err) {
    log("Companion app not available or error:", err && err.message);
    return { error: err };
  }
}

async function runTranscribe(job) {
  await waSyncCompanionSettings();
  const settings = await waGetSettings();

  const mode = waNormalizeEngineMode(settings.engineMode, settings.useCompanion);
  if (mode !== "browser") {
    const attempt = await tryCompanionTranscribe(job, settings);
    if (attempt && attempt.result) {
      forwardToTab(job.requestId, attempt.result);
      waSetSettings({ lastError: null, companionActive: true });
      const slot = pending.get(job.requestId);
      if (slot && slot.resolve) slot.resolve(attempt.result);
      pending.delete(job.requestId);
      return attempt.result;
    }
    if (waAfterCompanionMiss(mode, settings.useCompanion) === "fail") {
      const code = waJobErrorCode(attempt && attempt.error);
      const message = code === "model_loading"
        ? "El modelo todavía se está cargando. Reintentá en un momento."
        : "La app no respondió. Reintentá cuando esté lista.";
      waReportCompanionJob({
        audioSeconds: 0,
        transcribeMs: 0,
        engine: "parakeet",
        model: "",
        ok: false,
        site: job.site || "unknown",
        errorCode: code,
      });
      forwardToTab(job.requestId, { type: WA_MSG.ERROR, requestId: job.requestId, message });
      waSetSettings({ lastError: message, companionActive: false });
      const slot = pending.get(job.requestId);
      if (slot && slot.resolve) slot.resolve(null);
      pending.delete(job.requestId);
      return null;
    }
  }

  // App unreachable or disabled: fall back to in-browser Whisper
  forwardToTab(job.requestId, {
    type: WA_MSG.PROGRESS,
    requestId: job.requestId,
    phase: WA_PHASE.LOADING,
    message: mode === "browser"
      ? "Cargando Whisper (navegador)…"
      : "App no detectada. Cargando Whisper (navegador)…",
  });

  await ensureOffscreen();
  return new Promise((resolve, reject) => {
    const prev = pending.get(job.requestId) || {};
    pending.set(job.requestId, { ...prev, resolve, reject });
    chrome.runtime.sendMessage({
      type: WA_MSG.TRANSCRIBE,
      target: WA_TARGET.OFFSCREEN,
      requestId: job.requestId,
      audioBase64: job.audioBase64,
      mimeType: job.mimeType,
      languageMode: waWhisperLanguage(settings.languageMode),
      modelId: settings.modelId || "onnx-community/whisper-small",
      polishEnabled: settings.polishEnabled,
    });
  });
}

function enqueueFromContent(msg, sender) {
  const requestId = msg.requestId;
  const tabId = sender.tab && sender.tab.id;
  const frameId = sender.frameId;
  pending.set(requestId, { tabId, frameId, site: siteFromSender(sender) });

  const alreadyBusy = queue.busy || queue.pending > 0;
  if (alreadyBusy) {
    forwardToTab(requestId, {
      type: WA_MSG.PROGRESS,
      requestId,
      phase: WA_PHASE.QUEUED,
      message: "En cola…",
    });
  }

  queue
    .push(
      {
        requestId,
        audioBase64: msg.audioBase64,
        mimeType: msg.mimeType,
        tabId,
        site: siteFromSender(sender),
      },
      runTranscribe
    )
    .catch((err) => {
      log("queue job failed", err);
      const message = mapError(err, "GENERIC");
      waSetSettings({ lastError: message });
      forwardToTab(requestId, { type: WA_MSG.ERROR, requestId, message });
      const slot = pending.get(requestId);
      if (slot && slot.reject) slot.reject(err);
      pending.delete(requestId);
    });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  // Debug: save extracted voice notes through the downloads API. Downloads
  // started from the WhatsApp page get throttled/blocked by Chrome after a few.
  if (msg.type === WA_MSG.SAVE_FILES) {
    const files = Array.isArray(msg.files) ? msg.files : [];
    Promise.all(
      files.map((f) => {
        const mime = f.mime || "application/octet-stream";
        const url = f.base64
          ? `data:${mime};base64,${f.base64}`
          : `data:${mime},${encodeURIComponent(f.text || "")}`;
        return chrome.downloads.download({
          url,
          filename: `wa-local-transcribe/${f.name}`,
          conflictAction: "uniquify",
          saveAs: false,
        });
      })
    )
      .then((ids) => sendResponse({ ok: true, ids }))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }

  if (msg.type === WA_MSG.TRANSCRIBE && msg.target !== WA_TARGET.OFFSCREEN) {
    enqueueFromContent(msg, sender);
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === WA_MSG.PROGRESS) {
    if (msg.requestId) forwardToTab(msg.requestId, msg);
    if (!msg.requestId) {
      waSetSettings({
        downloadMessage: msg.message || "",
        downloadPct: typeof msg.pct === "number" ? msg.pct : null,
        downloadPhase: msg.phase || "loading",
        modelCached: false,
      });
    }
    return;
  }

  if (msg.type === WA_MSG.RESULT) {
    forwardToTab(msg.requestId, msg);
    const slot = pending.get(msg.requestId);
    if (msg.engine !== "parakeet") {
      waReportCompanionJob({
        audioSeconds: msg.audioSeconds,
        transcribeMs: msg.transcribeMs,
        engine: msg.engine || "whisper",
        model: msg.model || "",
        ok: true,
        site: (slot && slot.site) || "unknown",
      });
    }
    waSetSettings({ lastError: null, modelCached: true });
    if (slot && slot.resolve) slot.resolve(msg);
    pending.delete(msg.requestId);
    return;
  }

  if (msg.type === WA_MSG.ERROR) {
    const message = msg.message || mapError(null, "GENERIC");
    waSetSettings({
      lastError: message,
      downloadPhase: "error",
      downloadMessage: message,
    });
    if (msg.requestId) {
      const slot = pending.get(msg.requestId);
      waReportCompanionJob({
        audioSeconds: msg.audioSeconds || 0,
        transcribeMs: msg.transcribeMs || 0,
        engine: "whisper",
        model: msg.model || "",
        ok: false,
        site: (slot && slot.site) || "unknown",
        errorCode: waJobErrorCode(new Error(message)),
      });
      forwardToTab(msg.requestId, { ...msg, message });
      if (slot && slot.resolve) slot.resolve(null);
      pending.delete(msg.requestId);
    }
    return;
  }

  if (msg.type === WA_MSG.PRELOAD) {
    (async () => {
      try {
        const settings = await waGetSettings();
        const modelId = msg.modelId || settings.modelId || "onnx-community/whisper-small";
        await ensureOffscreen();
        chrome.runtime.sendMessage({
          type: WA_MSG.PRELOAD,
          target: WA_TARGET.OFFSCREEN,
          modelId,
        });
        sendResponse({ ok: true });
      } catch (err) {
        log("preload failed", err);
        sendResponse({ ok: false });
      }
    })();
    return true;
  }

  if (msg.type === WA_MSG.GET_STATUS) {
    (async () => {
      try {
        await ensureOffscreen();
        chrome.runtime.sendMessage({
          type: WA_MSG.GET_STATUS,
          target: WA_TARGET.OFFSCREEN,
        });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: mapError(err, "OFFSCREEN") });
      }
    })();
    return true;
  }

  if (msg.type === WA_MSG.STATUS) {
    markOffscreenReady();
    const patch = {
      webgpu: msg.webgpu,
      device: msg.device,
      modelCached: msg.modelCached === true,
      loadedModelId: msg.modelId || null,
    };
    if (msg.modelCached) {
      patch.downloadPhase = "";
      patch.downloadMessage = "";
      patch.downloadPct = null;
      patch.lastError = null;
    }
    waSetSettings(patch);
    return;
  }

  if (msg.type === WA_MSG.OPEN_COMPANION) {
    waOpenCompanion().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === WA_MSG.CHECK_COMPANION) {
    (async () => {
      try {
        await waSyncCompanionSettings();
        const settings = await waGetSettings();
        const port = settings.companionPort || 8765;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1500);
        const res = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok) {
          const data = await res.json();
          waSetSettings({ companionActive: true });
          waHelloCompanion();
          sendResponse({ ok: true, data });
          return;
        }
        waSetSettings({ companionActive: false });
        sendResponse({ ok: false, error: `HTTP ${res.status}` });
      } catch (err) {
        waSetSettings({ companionActive: false });
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (msg.type === WA_MSG.SETTINGS_CHANGED) {
    (async () => {
      try {
        const settings = await waGetSettings();
        const modelId = msg.modelId || settings.modelId;
        await ensureOffscreen();
        chrome.runtime.sendMessage({
          type: WA_MSG.PRELOAD,
          target: WA_TARGET.OFFSCREEN,
          modelId,
        });
      } catch (err) {
        log("settings preload failed", err);
      }
    })();
    return;
  }
});

waSyncCompanionSettings().then(() => waHelloCompanion());
log("service worker ready");
