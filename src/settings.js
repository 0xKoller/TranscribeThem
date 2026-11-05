(function (g) {
  g.WA_DEFAULTS = {
    languageMode: "es",
    modelId: "onnx-community/whisper-small",
    polishEnabled: false,
    useCompanion: true,
    companionPort: 8765,
    debugMode: false,
    engineMode: "auto",
    sites: { whatsapp: true },
    highlightWords: true,
    openAtLaunch: false,
  };

  g.WA_SITES = [
    { id: "whatsapp", label: "WhatsApp Web", host: "web.whatsapp.com" },
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
    return languageMode === "en" ? "en" : "es";
  };

  g.waSiteId = function waSiteId(url) {
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch (_) {
      return "";
    }
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

  g.waAfterCompanionMiss = function waAfterCompanionMiss(engineMode, useCompanion) {
    return g.waNormalizeEngineMode(engineMode, useCompanion) === "companion" ? "fail" : "browser";
  };

  g.WA_MODELS = [
    {
      id: "onnx-community/whisper-small",
      key: "small",
      label: "Small",
      hint: "Rápido. ~250 MB. Alguna palabra puede salir mal.",
      recommended: true,
    },
    {
      id: "Xenova/whisper-medium",
      key: "medium",
      label: "Medium",
      hint: "Más preciso. ~1 GB. Más lento que Small (el encoder es más pesado).",
    },
    {
      id: "onnx-community/whisper-large-v3-turbo",
      key: "turbo",
      label: "Turbo",
      hint: "Lo más fino on-device. ~1.2 GB. En GPU integrada (Intel) puede quedarse sin memoria.",
    },
  ];
  g.WA_ALLOWED_MODELS = g.WA_MODELS.map(function (m) {
    return m.id;
  });
  g.WA_MODEL_ALIASES = {
    "onnx-community/whisper-medium": "Xenova/whisper-medium",
  };

  g.WA_LANGUAGES = [
    { id: "es", label: "Español" },
    { id: "en", label: "English" },
  ];

  g.waGetSettings = async function waGetSettings() {
    const stored = await chrome.storage.local.get([
      "languageMode",
      "modelId",
      "polishEnabled",
      "useCompanion",
      "companionPort",
      "companionActive",
      "debugMode",
      "engineMode",
      "sites",
      "highlightWords",
      "openAtLaunch",
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
      polishEnabled: stored.polishEnabled === true,
      useCompanion: engineMode !== "browser",
      engineMode,
      sites: g.waNormalizeSites(stored.sites),
      highlightWords: stored.highlightWords !== false,
      openAtLaunch: stored.openAtLaunch === true,
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
