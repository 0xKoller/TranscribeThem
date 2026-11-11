/* global waGetSettings, waSetSettings, waUpdateNotice, waUpdateRepo, waSafeReleaseUrl, waT, WA_MSG */
/* The update notice in the popup and in Options. Classic script. */
(function (g) {
  const KEYS = ["updateLatest", "appUpdate", "appVersion", "updateCheckedAt", "checkUpdates"];

  // "github" (checks itself), "store" (Chrome updates it) or "none" (private build).
  g.waUpdateChannel = function waUpdateChannel(manifest) {
    if (manifest && manifest.update_url) return "store";
    return g.waUpdateRepo(manifest) ? "github" : "none";
  };

  function openTab(url) {
    const safe = g.waSafeReleaseUrl(url);
    if (!safe) return;
    if (chrome.tabs && chrome.tabs.create) chrome.tabs.create({ url: safe });
    else window.open(safe, "_blank", "noopener");
  }

  g.waInitUpdateUi = function waInitUpdateUi(els) {
    const manifest = chrome.runtime.getManifest();
    const current = manifest.version;
    const channel = g.waUpdateChannel(manifest);
    const repo = g.waUpdateRepo(manifest);
    let openUrl = null;

    async function render() {
      const settings = await g.waGetSettings();
      // Shown once, the first time the popup opens after the app updated the folder.
      if (els.reloadedEl && settings.updatedFrom) {
        els.reloadedEl.textContent = g.waT("updateReloaded", current);
        els.reloadedEl.hidden = false;
        g.waSetSettings({ updatedFrom: null });
      }
      const notice = g.waUpdateNotice({
        current,
        own: settings.updateLatest,
        fromApp: settings.appUpdate,
        appVersion: settings.appVersion,
      });
      if (els.toggleEl) els.toggleEl.checked = settings.checkUpdates;
      if (els.lastEl) {
        els.lastEl.hidden = channel !== "github" || !settings.updateCheckedAt;
        if (settings.updateCheckedAt) {
          els.lastEl.textContent = g.waT("updateLastChecked", new Date(settings.updateCheckedAt).toLocaleString());
        }
      }
      if (!els.boxEl) return;
      els.boxEl.hidden = !notice;
      if (!notice) return;
      if (notice.release) {
        els.titleEl.textContent = g.waT("updateAvailable", notice.release.version);
        els.detailEl.textContent = g.waT("updateYouHave", current);
        openUrl = notice.release.url;
      } else {
        els.titleEl.textContent = g.waT("updateExtensionOld");
        els.detailEl.textContent = g.waT("updateExtensionBehind", [notice.appVersion, current]);
        openUrl = repo ? "https://github.com/" + repo + "/releases/latest" : null;
      }
      if (els.stepsEl) {
        els.stepsEl.textContent = channel === "store" ? g.waT("updateStepsStore") : g.waT("updateSteps");
      }
      if (els.openBtn) els.openBtn.hidden = !openUrl;
    }

    if (els.openBtn) els.openBtn.addEventListener("click", () => openTab(openUrl));

    if (els.channelEl) {
      if (channel === "store") els.channelEl.textContent = g.waT("updateByStore");
      else if (channel === "none") els.channelEl.textContent = g.waT("updateNoChannel");
      else els.channelEl.textContent = g.waT("optCheckUpdatesHint");
    }
    if (els.controlsEl) els.controlsEl.hidden = channel !== "github";

    if (els.toggleEl) {
      els.toggleEl.addEventListener("change", () => {
        g.waSetSettings({ checkUpdates: els.toggleEl.checked });
      });
    }

    if (els.nowBtn) {
      els.nowBtn.addEventListener("click", () => {
        els.nowBtn.disabled = true;
        if (els.statusEl) {
          els.statusEl.hidden = false;
          els.statusEl.textContent = g.waT("updateChecking");
        }
        chrome.runtime.sendMessage({ type: g.WA_MSG.CHECK_UPDATES, force: true }, (resp) => {
          void chrome.runtime.lastError;
          els.nowBtn.disabled = false;
          if (!els.statusEl) return;
          if (!resp || !resp.ok) els.statusEl.textContent = g.waT("updateCheckFailed");
          else if (resp.notice && resp.notice.release) els.statusEl.textContent = "";
          else els.statusEl.textContent = g.waT("updateUpToDate");
          render();
        });
      });
    }

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && KEYS.some((key) => key in changes)) render();
    });
    return render();
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
