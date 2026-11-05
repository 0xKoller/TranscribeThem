/* global waGetSettings, waSetSettings */
(function (g) {
  g.waCompanionSyncPlan = function waCompanionSyncPlan(localAt, remoteAt) {
    const local = Number(localAt) || 0;
    const remote = Number(remoteAt) || 0;
    if (!local || local > remote) return "push";
    if (remote > local) return "pull";
    return "keep";
  };

  async function base() {
    const settings = await g.waGetSettings();
    return `http://127.0.0.1:${settings.companionPort || 8765}`;
  }

  async function postJSON(path, body) {
    const res = await fetch(`${await base()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(800),
    });
    if (!res.ok) throw new Error(`Companion HTTP ${res.status}`);
    return res.json();
  }

  g.waPushCompanionSettings = async function waPushCompanionSettings() {
    const settings = await g.waGetSettings();
    await g.waSetSettings({ companionSettingsAt: Date.now() });
    try {
      const data = await postJSON("/v1/settings", {
        languageMode: settings.languageMode,
        modelId: settings.modelId,
        useCompanion: settings.engineMode !== "browser",
        engineMode: settings.engineMode,
        debugMode: settings.debugMode,
        polishEnabled: settings.polishEnabled,
        sites: settings.sites,
        highlightWords: settings.highlightWords,
        openAtLaunch: settings.openAtLaunch === true,
      });
      const remoteAt = Date.parse(data && data.settings && data.settings.updatedAt);
      if (!Number.isNaN(remoteAt)) await g.waSetSettings({ companionSettingsAt: remoteAt });
    } catch (_) {
      /* la app puede estar cerrada; el sello local queda más nuevo */
    }
  };

  g.waSyncCompanionSettings = async function waSyncCompanionSettings() {
    let data;
    try {
      const res = await fetch(`${await base()}/v1/settings`, { signal: AbortSignal.timeout(800) });
      if (!res.ok) return;
      data = await res.json();
    } catch (_) {
      return;
    }
    const remote = data && data.settings;
    if (!remote) return;
    const local = await g.waGetSettings();
    const remoteAt = Date.parse(remote.updatedAt);
    const plan = g.waCompanionSyncPlan(local.companionSettingsAt, remoteAt);
    if (plan === "push") {
      await g.waPushCompanionSettings();
      return;
    }
    if (plan === "pull") {
      const before = local.modelId;
      const engineMode = g.waNormalizeEngineMode(remote.engineMode, remote.useCompanion);
      await g.waSetSettings({
        languageMode: g.waNormalizeLanguage(remote.languageMode),
        modelId: remote.modelId,
        useCompanion: engineMode !== "browser",
        engineMode,
        debugMode: remote.debugMode === true,
        polishEnabled: remote.polishEnabled === true,
        sites: g.waNormalizeSites(remote.sites),
        highlightWords: remote.highlightWords !== false,
        openAtLaunch: remote.openAtLaunch === true,
        companionSettingsAt: remoteAt,
      });
      if (remote.modelId && remote.modelId !== before && g.chrome && g.chrome.runtime) {
        g.chrome.runtime.sendMessage({ type: "WA_PRELOAD", modelId: remote.modelId }, () => {
          void g.chrome.runtime.lastError;
        });
      }
    }
  };

  g.waHelloCompanion = async function waHelloCompanion() {
    try {
      const version = g.chrome && g.chrome.runtime && g.chrome.runtime.getManifest
        ? g.chrome.runtime.getManifest().version
        : "";
      await postJSON("/v1/hello", { version, browser: "chrome" });
    } catch (_) {
      /* app cerrada */
    }
  };

  g.waReportCompanionJob = async function waReportCompanionJob(job) {
    try {
      // Only send text to the local app after checking its current opt-in.
      // This setting is owned by the Mac app, never overwritten by sync.
      let transcript;
      if (job.ok === true && typeof job.transcript === "string") {
        try {
          const response = await fetch(`${await base()}/v1/settings`, { signal: AbortSignal.timeout(800) });
          if (response.ok) {
            const data = await response.json();
            if (data && data.settings && data.settings.saveTranscripts === true) transcript = job.transcript;
          }
        } catch (_) { /* preserve metadata reporting when settings are unavailable */ }
      }
      await postJSON("/v1/jobs", {
        transcript,
        audioSeconds: Number(job.audioSeconds) || 0,
        transcribeMs: Number(job.transcribeMs) || 0,
        engine: job.engine || "whisper",
        model: job.model || "",
        ok: job.ok === true,
        site: job.site || "unknown",
        errorCode: job.ok === true ? "" : (job.errorCode || "generic"),
      });
    } catch (_) {
      /* app cerrada */
    }
  };

  g.waOpenCompanion = async function waOpenCompanion() {
    try {
      await postJSON("/v1/open", {});
    } catch (_) {
      /* app cerrada */
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
