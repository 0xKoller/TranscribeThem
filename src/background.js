/* global WA_MSG, WA_TARGET, WA_PHASE, createSerialQueue, waGetSettings, waSetSettings, mapError */
importScripts("i18n.js", "messages.js", "settings.js", "companion-sync.js", "errors.js", "queue.js");

const LOG = "[wa-transcribe]";
const OFFSCREEN_URL = "src/offscreen.html";

const queue = createSerialQueue();
const pending = new Map(); // requestId -> { tabId, frameId, resolve, reject }
const cancelled = new Set(); // running jobs the user cancelled; drop their results
const companionAborts = new Map(); // requestId -> AbortController

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
  if (cancelled.has(requestId)) return;
  const dest = pending.get(requestId);
  if (!dest || dest.tabId == null) return;
  chrome.tabs.sendMessage(dest.tabId, message, { frameId: dest.frameId }, () => {
    void chrome.runtime.lastError;
  });
}

// The app answers 503 while Parakeet is still loading (right after launch).
// Wait for it instead of treating the app as missing.
const MODEL_LOADING_WAIT_MS = 20000;
const MODEL_LOADING_STEP_MS = 1500;

function base64ToBytes(base64) {
  const binary = atob(base64 || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function postToCompanion(job, settings) {
  const port = settings.companionPort || 8765;
  const bytes = job.byteLength || (job.audioBase64 ? Math.round((job.audioBase64.length * 3) / 4) : 0);
  // One controller for the timeout and for a cancel from the page.
  const controller = new AbortController();
  const timeout = AbortSignal.timeout(waCompanionTimeoutMs(bytes));
  timeout.addEventListener("abort", () => controller.abort(), { once: true });
  companionAborts.set(job.requestId, controller);
  let res;
  try {
    // Raw bytes instead of base64 JSON: a third smaller, no JSON parse in the app.
    res = await fetch(`http://127.0.0.1:${port}/transcribe`, {
      method: "POST",
      headers: {
        "Content-Type": job.mimeType || "audio/ogg",
        "X-Language": waCompanionLanguage(settings.languageMode),
        "X-Site": job.site || "unknown",
      },
      body: base64ToBytes(job.audioBase64),
      signal: controller.signal,
    });
  } finally {
    companionAborts.delete(job.requestId);
  }
  if (res.status === 503) return { loading: true };
  if (!res.ok) throw new Error(`Companion HTTP ${res.status}`);
  const data = await res.json();
  if (data && data.ok && typeof data.text === "string") return { data };
  throw new Error(data && data.error ? data.error : "Companion HTTP " + res.status);
}

async function tryCompanionTranscribe(job, settings) {
  try {
    await waI18nInit();
    forwardToTab(job.requestId, {
      type: WA_MSG.PROGRESS,
      requestId: job.requestId,
      phase: WA_PHASE.RUNNING,
      message: waT("parakeetRunning"),
    });

    const giveUpAt = Date.now() + MODEL_LOADING_WAIT_MS;
    let attempt = await postToCompanion(job, settings);
    while (attempt.loading) {
      if (cancelled.has(job.requestId)) throw new Error("cancelled");
      if (Date.now() >= giveUpAt) throw new Error("Companion HTTP 503");
      forwardToTab(job.requestId, {
        type: WA_MSG.PROGRESS,
        requestId: job.requestId,
        phase: WA_PHASE.LOADING,
        message: waT("appLoadingModel"),
      });
      await delay(MODEL_LOADING_STEP_MS);
      attempt = await postToCompanion(job, settings);
    }

    const data = attempt.data;
    log("Companion transcribed:", {
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
  } catch (err) {
    log("Companion app not available or error:", err && err.message);
    return { error: err };
  }
}

function settleCancelled(requestId) {
  cancelled.delete(requestId);
  const slot = pending.get(requestId);
  if (slot && slot.resolve) slot.resolve(null);
  pending.delete(requestId);
  return null;
}

// Queued: leaves the queue. Running: the app request is aborted, a Whisper
// run cannot be stopped, so its result is dropped when it arrives.
function cancelJob(requestId) {
  if (!requestId) return;
  if (queue.cancel((job) => job.requestId === requestId)) {
    pending.delete(requestId);
    log("cancelled queued job", requestId);
    return;
  }
  if (!pending.has(requestId)) return;
  cancelled.add(requestId);
  const controller = companionAborts.get(requestId);
  if (controller) controller.abort();
  log("cancelled running job", requestId);
}

// One health check for everyone: the popup, the options page and the periodic
// alarm. It also records what the app can do besides transcribing.
async function checkCompanion() {
  try {
    await waSyncCompanionSettings();
    const settings = await waGetSettings();
    const port = settings.companionPort || 8765;
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) {
      waSetSettings({ companionActive: false, companionFeatures: waNormalizeFeatures(null) });
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    waSetSettings({
      companionActive: true,
      companionFeatures: waNormalizeFeatures(data && data.features),
    });
    waHelloCompanion();
    return { ok: true, data };
  } catch (err) {
    waSetSettings({ companionActive: false, companionFeatures: waNormalizeFeatures(null) });
    return { ok: false, error: String((err && err.message) || err) };
  }
}

// Whisper weighs hundreds of MB. Only load it ahead of time when the browser
// is the engine that will actually run: always in "browser" mode, never in
// "companion" mode, and in "auto" only while the app is not answering.
async function shouldPreloadWhisper() {
  const settings = await waGetSettings();
  const mode = waNormalizeEngineMode(settings.engineMode, settings.useCompanion);
  if (mode === "browser") return true;
  if (mode === "companion") return false;
  const health = await checkCompanion();
  return !health.ok;
}

async function runTranscribe(job) {
  await waI18nInit();
  await waSyncCompanionSettings();
  const settings = await waGetSettings();

  const mode = waNormalizeEngineMode(settings.engineMode, settings.useCompanion);
  if (cancelled.has(job.requestId)) return settleCancelled(job.requestId);
  if (mode !== "browser") {
    const attempt = await tryCompanionTranscribe(job, settings);
    if (cancelled.has(job.requestId)) return settleCancelled(job.requestId);
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
      await waI18nInit();
      const message = code === "model_loading"
        ? waT("modelStillLoading")
        : waT("appNoResponse");
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
      ? waT("loadingWhisper")
      : waT("appMissingWhisper"),
  });

  await ensureOffscreen();
  if (cancelled.has(job.requestId)) return settleCancelled(job.requestId);
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
    waI18nInit().then(() => {
      forwardToTab(requestId, {
        type: WA_MSG.PROGRESS,
        requestId,
        phase: WA_PHASE.QUEUED,
        message: waT("inQueue"),
      });
    });
  }

  queue
    .push(
      {
        requestId,
        audioBase64: msg.audioBase64,
        mimeType: msg.mimeType,
        byteLength: msg.byteLength,
        tabId,
        site: siteFromSender(sender),
      },
      runTranscribe
    )
    .catch((err) => {
      log("queue job failed", err);
      waI18nInit().then(() => {
        const message = mapError(err, "GENERIC");
        waSetSettings({ lastError: message });
        forwardToTab(requestId, { type: WA_MSG.ERROR, requestId, message });
        const slot = pending.get(requestId);
        if (slot && slot.reject) slot.reject(err);
        pending.delete(requestId);
      });
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

  if (msg.type === WA_MSG.CANCEL) {
    cancelJob(msg.requestId);
    sendResponse({ ok: true });
    return;
  }

  if ((msg.type === WA_MSG.RESULT || msg.type === WA_MSG.ERROR) && msg.requestId && cancelled.has(msg.requestId)) {
    settleCancelled(msg.requestId);
    return;
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
        transcript: msg.text,
        site: (slot && slot.site) || "unknown",
      });
    }
    waSetSettings({ lastError: null, modelCached: true });
    if (slot && slot.resolve) slot.resolve(msg);
    pending.delete(msg.requestId);
    return;
  }

  if (msg.type === WA_MSG.ERROR) {
    waI18nInit().then(() => {
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
    });
    return;
  }

  if (msg.type === WA_MSG.PRELOAD) {
    (async () => {
      try {
        // A page load asks without a model; the settings UI names one because
        // the user just picked it, and that download is wanted.
        if (!msg.modelId && !(await shouldPreloadWhisper())) {
          sendResponse({ ok: true, skipped: true });
          return;
        }
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
        await waI18nInit();
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
    checkCompanion().then(sendResponse);
    return true;
  }

  if (msg.type === WA_MSG.TEXT_ACTION) {
    waI18nInit().then(() => waCompanionTextAction(msg.action, msg.text, msg.targetLanguage)).then((out) => {
      sendResponse(out.ok ? { ok: true, text: out.text } : { ok: false, error: out.error });
    });
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

// Keyboard shortcut: transcribe the newest voice note on screen.
if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command !== "transcribe-latest" || !tab || tab.id == null) return;
    chrome.tabs.sendMessage(tab.id, { type: WA_MSG.TRANSCRIBE_VISIBLE, mode: "latest" }, () => {
      void chrome.runtime.lastError;
    });
  });
}

// Keep "is the app there" fresh from one place instead of from every tab.
const COMPANION_ALARM = "wa-companion-check";
if (chrome.alarms) {
  chrome.alarms.create(COMPANION_ALARM, { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === COMPANION_ALARM) checkCompanion();
  });
}

checkCompanion();
log("service worker ready");
