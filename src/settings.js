(function (g) {
  g.WA_DEFAULTS = {
    languageMode: "es",
    modelId: "onnx-community/whisper-small",
    useCompanion: true,
    companionPort: 8765,
    debugMode: false,
    engineMode: "auto",
    sites: { whatsapp: true, x: true },
    highlightWords: true,
    openAtLaunch: false,
    autoTranscribe: false,
    cacheTranscripts: true,
    checkUpdates: true,
  };

  g.WA_SITES = [
    { id: "whatsapp", label: "WhatsApp Web", host: "web.whatsapp.com" },
    { id: "x", label: "X", host: "x.com" },
  ];

  g.waNormalizeLanguage = function waNormalizeLanguage(value) {
    return value === "en" || value === "auto" ? value : "es";
  };

  g.waNormalizeEngineMode = function waNormalizeEngineMode(engineMode, useCompanion) {
    if (engineMode === "auto" || engineMode === "companion" || engineMode === "browser") return engineMode;
    return useCompanion === false ? "browser" : "auto";
  };

  g.waCompanionLanguage = function waCompanionLanguage(languageMode) {
    if (languageMode === "en") return "en";
    if (languageMode === "auto") return "none";
    return "es";
  };

  g.waWhisperLanguage = function waWhisperLanguage(languageMode) {
    if (languageMode === "en") return "en";
    // "auto" lets Whisper detect the language from the audio.
    return languageMode === "auto" ? "auto" : "es";
  };

  g.waSiteId = function waSiteId(url) {
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch (_) {
      return "";
    }
    if (host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com")) return "x";
    const site = g.WA_SITES.find(function (item) { return item.host === host; });
    return site ? site.id : "";
  };

  g.waNormalizeSites = function waNormalizeSites(raw) {
    const sites = {};
    const source = raw && typeof raw === "object" ? raw : {};
    for (const site of g.WA_SITES) {
      sites[site.id] = source[site.id] !== false;
    }
    return sites;
  };

  g.waSiteEnabled = function waSiteEnabled(settings, id) {
    if (!g.WA_SITES.some(function (site) { return site.id === id; })) return false;
    const sites = g.waNormalizeSites(settings && settings.sites);
    return sites[id] !== false;
  };

  // What the Mac app can do besides transcribing, as reported by GET /health.
  g.waNormalizeFeatures = function waNormalizeFeatures(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    return { summarize: source.summarize === true, translate: source.translate === true };
  };

  g.waAfterCompanionMiss = function waAfterCompanionMiss(engineMode, useCompanion) {
    return g.waNormalizeEngineMode(engineMode, useCompanion) === "companion" ? "fail" : "browser";
  };

  g.WA_MODELS = [
    {
      id: "onnx-community/whisper-small",
      key: "small",
      label: "Small",
      get hint() {
        return g.waT("modelSmallHint");
      },
      recommended: true,
    },
    {
      id: "Xenova/whisper-medium",
      key: "medium",
      label: "Medium",
      get hint() {
        return g.waT("modelMediumHint");
      },
    },
    {
      id: "onnx-community/whisper-large-v3-turbo",
      key: "turbo",
      label: "Turbo",
      get hint() {
        return g.waT("modelTurboHint");
      },
    },
  ];
  g.WA_ALLOWED_MODELS = g.WA_MODELS.map(function (m) {
    return m.id;
  });
  g.WA_MODEL_ALIASES = {
    "onnx-community/whisper-medium": "Xenova/whisper-medium",
  };

  g.WA_LANGUAGES = [
    { id: "es", get label() { return g.waT("langEs"); } },
    { id: "en", get label() { return g.waT("langEn"); } },
  ];

  g.waGetSettings = async function waGetSettings() {
    const stored = await chrome.storage.local.get([
      "languageMode",
      "modelId",
      "useCompanion",
      "companionPort",
      "companionActive",
      "debugMode",
      "engineMode",
      "sites",
      "highlightWords",
      "openAtLaunch",
      "autoTranscribe",
      "cacheTranscripts",
      "checkUpdates",
      "updateLatest",
      "updateCheckedAt",
      "updateAttemptAt",
      "appUpdate",
      "appVersion",
      "updatedFrom",
      "companionFeatures",
      "companionSettingsAt",
      "lastError",
      "modelCached",
      "webgpu",
      "device",
      "loadedModelId",
      "downloadPct",
      "downloadMessage",
      "downloadPhase",
    ]);
    const aliased = g.WA_MODEL_ALIASES[stored.modelId] || stored.modelId;
    const modelId = g.WA_ALLOWED_MODELS.indexOf(aliased) >= 0
      ? aliased
      : g.WA_DEFAULTS.modelId;
    if (stored.modelId && stored.modelId !== modelId) {
      chrome.storage.local.set({ modelId });
    }
    const engineMode = g.waNormalizeEngineMode(stored.engineMode, stored.useCompanion);
    return {
      languageMode: g.waNormalizeLanguage(stored.languageMode),
      modelId,
      useCompanion: engineMode !== "browser",
      engineMode,
      sites: g.waNormalizeSites(stored.sites),
      highlightWords: stored.highlightWords !== false,
      openAtLaunch: stored.openAtLaunch === true,
      // Extension-only preferences: never synced with the Mac app.
      autoTranscribe: stored.autoTranscribe === true,
      cacheTranscripts: stored.cacheTranscripts !== false,
      checkUpdates: stored.checkUpdates !== false,
      updateLatest: stored.updateLatest && typeof stored.updateLatest === "object" ? stored.updateLatest : null,
      updateCheckedAt: typeof stored.updateCheckedAt === "number" ? stored.updateCheckedAt : 0,
      updateAttemptAt: typeof stored.updateAttemptAt === "number" ? stored.updateAttemptAt : 0,
      appUpdate: stored.appUpdate && typeof stored.appUpdate === "object" ? stored.appUpdate : null,
      appVersion: typeof stored.appVersion === "string" ? stored.appVersion : null,
      updatedFrom: typeof stored.updatedFrom === "string" ? stored.updatedFrom : null,
      companionFeatures: g.waNormalizeFeatures(stored.companionFeatures),
      companionPort: typeof stored.companionPort === "number" ? stored.companionPort : 8765,
      debugMode: stored.debugMode === true,
      companionSettingsAt: typeof stored.companionSettingsAt === "number" ? stored.companionSettingsAt : 0,
      companionActive: stored.companionActive === true,
      lastError: stored.lastError || null,
      modelCached: stored.modelCached === true,
      webgpu: stored.webgpu,
      device: stored.device || null,
      loadedModelId: stored.loadedModelId || null,
      downloadPct: typeof stored.downloadPct === "number" ? stored.downloadPct : null,
      downloadMessage: stored.downloadMessage || "",
      downloadPhase: stored.downloadPhase || "",
    };
  };

  g.waSetSettings = async function waSetSettings(partial) {
    await chrome.storage.local.set(partial);
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
