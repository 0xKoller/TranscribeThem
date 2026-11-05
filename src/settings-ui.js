/* global WA_MSG, WA_MODELS, WA_DEFAULTS, waGetSettings, waSetSettings */

(function (g) {
  function looksWeakIgpu(info) {
    const blob = [info.vendor, info.architecture, info.description, info.device]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (/apple|nvidia|geforce|\brtx\b|\bgtx\b|radeon\s+rx|radeon\s+pro/.test(blob)) return false;
    if (/intel|uhd graphics|iris|hd graphics/.test(blob)) return true;
    if (/\bamd\b/.test(blob) && /radeon graphics/.test(blob)) return true;
    return false;
  }

  function yn(el, value, unknown) {
    if (!el) return;
    if (value === true) {
      el.textContent = "sí";
      el.className = "yes";
    } else if (value === false) {
      el.textContent = "no";
      el.className = "no";
    } else {
      el.textContent = unknown || "…";
      el.className = "";
    }
  }

  function modelMeta(id) {
    return WA_MODELS.find((m) => m.id === id) || WA_MODELS[0];
  }

  g.waInitSettingsUi = async function waInitSettingsUi(els) {
    const {
      languageEl,
      debugEl,
      modelsEl,
      gpuWarnEl,
      webgpuEl,
      cacheEl,
      deviceEl,
      errorEl,
      progressEl,
      progressBarEl,
      progressLabelEl,
      loadedModelEl,
      versionEl,
      optionsBtn,
      openAppBtn,
      companionBoxEl,
      companionStatusEl,
      companionHintEl,
      enginesEl,
      siteEl,
      highlightEl,
      autoHintEl,
    } = els;

    let weakIgpu = false;
    let selectedId = WA_DEFAULTS.modelId;

    function updateWarn(modelId) {
      if (!gpuWarnEl) return;
      const meta = modelMeta(modelId);
      const heavy = meta.key === "medium" || meta.key === "turbo";
      if (weakIgpu && heavy) {
        gpuWarnEl.hidden = false;
        gpuWarnEl.textContent =
          "Tu GPU parece integrada (Intel u similar). Medium y Turbo pueden quedarse sin memoria. Small es más seguro.";
      } else {
        gpuWarnEl.hidden = true;
        gpuWarnEl.textContent = "";
      }
    }

    function selectCard(id) {
      selectedId = id;
      if (!modelsEl) return;
      for (const input of modelsEl.querySelectorAll('input[name="model"]')) {
        input.checked = input.value === id;
        input.closest(".model-card")?.classList.toggle("is-selected", input.value === id);
      }
      updateWarn(id);
    }

    function showProgress(visible, message, pct) {
      if (!progressEl) return;
      progressEl.hidden = !visible;
      if (progressLabelEl) progressLabelEl.textContent = message || "";
      if (progressBarEl) {
        const n = typeof pct === "number" ? Math.max(0, Math.min(100, pct)) : visible ? 8 : 0;
        progressBarEl.style.width = `${n}%`;
      }
    }

    function showError(message) {
      if (!errorEl) return;
      if (message) {
        errorEl.hidden = false;
        errorEl.textContent = message;
      } else {
        errorEl.hidden = true;
        errorEl.textContent = "";
      }
    }

    function fillModels() {
      if (!modelsEl) return;
      modelsEl.innerHTML = "";
      for (const m of WA_MODELS) {
        const label = document.createElement("label");
        label.className = "model-card";
        const input = document.createElement("input");
        input.type = "radio";
        input.name = "model";
        input.value = m.id;
        const body = document.createElement("span");
        body.className = "model-card-body";
        const title = document.createElement("span");
        title.className = "model-card-title";
        title.textContent = m.label;
        if (m.recommended) {
          const badge = document.createElement("em");
          badge.textContent = "recomendado";
          title.appendChild(badge);
        }
        const hint = document.createElement("span");
        hint.className = "model-card-hint";
        hint.textContent = m.hint;
        body.append(title, hint);
        label.append(input, body);
        input.addEventListener("change", () => {
          if (input.checked) onModelPick(m.id);
        });
        modelsEl.appendChild(label);
      }
    }

    function renderStatus(settings, status) {
      yn(webgpuEl, status?.webgpu ?? settings.webgpu);
      const loaded = status?.modelId ?? settings.loadedModelId;
      const cached = status?.modelCached ?? settings.modelCached;
      yn(cacheEl, cached === true && loaded === settings.modelId);
      if (deviceEl) deviceEl.textContent = (status?.device ?? settings.device) || "—";
      if (loadedModelEl) {
        const meta = loaded ? modelMeta(loaded) : null;
        loadedModelEl.textContent = meta ? meta.label : "—";
      }
    }

    async function onModelPick(id) {
      selectCard(id);
      showError("");
      showProgress(true, "Cargando modelo…", 0);
      await waSetSettings({
        modelId: id,
        modelPicked: true,
        modelCached: false,
        lastError: null,
        downloadPhase: "loading",
        downloadMessage: "Cargando modelo…",
        downloadPct: 0,
      });
      if (g.waPushCompanionSettings) await g.waPushCompanionSettings();
      chrome.runtime.sendMessage({ type: WA_MSG.PRELOAD, modelId: id }, () => {
        void chrome.runtime.lastError;
      });
    }

    async function probeGpu() {
      if (!navigator.gpu) return;
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return;
        const info = adapter.info || (await adapter.requestAdapterInfo?.()) || {};
        weakIgpu = looksWeakIgpu(info);
      } catch (_) {
        /* ignore */
      }
    }

    fillModels();
    if (versionEl && chrome.runtime.getManifest) {
      versionEl.textContent = chrome.runtime.getManifest().version;
    }
    if (optionsBtn) {
      optionsBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
        else window.open(chrome.runtime.getURL("src/options.html"));
      });
    }
    if (openAppBtn) {
      openAppBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        if (g.waOpenCompanion) g.waOpenCompanion();
      });
    }
    function languageValue(value) {
      return g.waNormalizeLanguage ? g.waNormalizeLanguage(value) : (value === "en" ? "en" : "es");
    }

    function syncAutoHint(mode) {
      if (!autoHintEl) return;
      autoHintEl.hidden = mode !== "auto";
    }

    function syncEngine(mode) {
      if (enginesEl) {
        for (const input of enginesEl.querySelectorAll('input[name="engine"]')) {
          input.checked = input.value === mode;
          input.closest(".model-card")?.classList.toggle("is-selected", input.value === mode);
        }
      }
      if (modelsEl) modelsEl.classList.toggle("is-dimmed", mode === "companion");
    }

    if (languageEl) {
      languageEl.addEventListener("change", async () => {
        const mode = languageValue(languageEl.value);
        syncAutoHint(mode);
        await waSetSettings({ languageMode: mode });
        if (g.waPushCompanionSettings) await g.waPushCompanionSettings();
      });
    }
    if (debugEl) {
      debugEl.addEventListener("change", async () => {
        await waSetSettings({ debugMode: debugEl.checked });
        if (g.waPushCompanionSettings) await g.waPushCompanionSettings();
      });
    }
    if (highlightEl) {
      highlightEl.addEventListener("change", async () => {
        await waSetSettings({ highlightWords: highlightEl.checked });
        if (g.waPushCompanionSettings) await g.waPushCompanionSettings();
      });
    }
    if (siteEl) {
      siteEl.addEventListener("change", async () => {
        const current = await waGetSettings();
        await waSetSettings({ sites: Object.assign({}, current.sites, { whatsapp: siteEl.checked }) });
        if (g.waPushCompanionSettings) await g.waPushCompanionSettings();
      });
    }
    if (enginesEl) {
      enginesEl.addEventListener("change", async (ev) => {
        const mode = ev.target && ev.target.value;
        if (mode !== "auto" && mode !== "companion" && mode !== "browser") return;
        syncEngine(mode);
        await waSetSettings({ engineMode: mode, useCompanion: mode !== "browser" });
        if (g.waPushCompanionSettings) await g.waPushCompanionSettings();
      });
    }

    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || !msg.type) return;
      if (msg.type === WA_MSG.STATUS) {
        yn(webgpuEl, msg.webgpu);
        const ready = msg.modelCached && msg.modelId === selectedId;
        yn(cacheEl, ready);
        if (deviceEl) deviceEl.textContent = msg.device || "—";
        if (loadedModelEl && msg.modelId) {
          loadedModelEl.textContent = modelMeta(msg.modelId).label;
        }
        if (ready) {
          showProgress(false, "", 0);
          showError("");
        } else if (!msg.modelCached) {
          /* still loading or failed; ERROR/PROGRESS handle the rest */
        }
      }
      if (msg.type === WA_MSG.PROGRESS && !msg.requestId) {
        showProgress(true, msg.message || "Cargando modelo…", msg.pct);
      }
      if (msg.type === WA_MSG.ERROR && !msg.requestId) {
        showProgress(false, "", 0);
        showError(msg.message);
        if (msg.modelId && selectedId === msg.modelId) {
          waGetSettings().then((s) => {
            if (s.loadedModelId) selectCard(s.loadedModelId);
          });
        }
      }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.lastError) {
        const val = changes.lastError.newValue;
        if (val) showError(val);
        else showError("");
      }
      if (changes.modelCached) yn(cacheEl, changes.modelCached.newValue === true);
      if (changes.webgpu) yn(webgpuEl, changes.webgpu.newValue);
      if (changes.device && deviceEl) deviceEl.textContent = changes.device.newValue || "—";
      if (changes.loadedModelId && loadedModelEl) {
        const id = changes.loadedModelId.newValue;
        loadedModelEl.textContent = id ? modelMeta(id).label : "—";
      }
      if (changes.downloadPhase || changes.downloadMessage || changes.downloadPct) {
        const phase = changes.downloadPhase
          ? changes.downloadPhase.newValue
          : undefined;
        if (phase === "loading") {
          const pct = changes.downloadPct ? changes.downloadPct.newValue : null;
          const message = changes.downloadMessage
            ? changes.downloadMessage.newValue
            : "Cargando modelo…";
          showProgress(true, message, pct);
        } else if (phase === "" || phase === "error") {
          showProgress(false, "", 0);
        }
      }
    });

    async function checkCompanion() {
      if (!companionBoxEl) return;
      try {
        const res = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: WA_MSG.CHECK_COMPANION }, (resp) => {
            resolve(resp || { ok: false });
          });
        });
        if (res && res.ok && res.data) {
          companionBoxEl.classList.add("is-online");
          companionBoxEl.classList.remove("is-offline");
          if (companionStatusEl) {
            companionStatusEl.textContent = res.data.ready
              ? "App local: Conectada (Parakeet v3)"
              : "App local: Cargando modelo…";
          }
          if (companionHintEl) {
            companionHintEl.textContent = res.data.ready
              ? "⚡ Transcribiendo con Parakeet v3 a ~100 ms (CoreML)."
              : "El modelo Parakeet v3 se está preparando en la app.";
          }
        } else {
          companionBoxEl.classList.add("is-offline");
          companionBoxEl.classList.remove("is-online");
          if (companionStatusEl) {
            companionStatusEl.textContent = "App local: No detectada";
          }
          if (companionHintEl) {
            companionHintEl.textContent = "Usando Whisper en el navegador. Abrí la app TranscribeThem para máxima velocidad.";
          }
        }
      } catch (_) {
        if (companionBoxEl) {
          companionBoxEl.classList.add("is-offline");
          companionBoxEl.classList.remove("is-online");
        }
      }
    }

    await checkCompanion();
    await probeGpu();
    const settings = await waGetSettings();
    if (languageEl) languageEl.value = languageValue(settings.languageMode);
    syncAutoHint(languageValue(settings.languageMode));
    syncEngine(settings.engineMode || "auto");
    if (debugEl) debugEl.checked = settings.debugMode === true;
    if (highlightEl) highlightEl.checked = settings.highlightWords !== false;
    if (siteEl) siteEl.checked = !settings.sites || settings.sites.whatsapp !== false;
    selectCard(settings.modelId);
    renderStatus(settings, null);
    if (settings.lastError) showError(settings.lastError);
    if (settings.downloadPhase === "loading") {
      showProgress(true, settings.downloadMessage || "Cargando modelo…", settings.downloadPct);
    }
    chrome.runtime.sendMessage({ type: WA_MSG.GET_STATUS }, () => {
      void chrome.runtime.lastError;
    });
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
