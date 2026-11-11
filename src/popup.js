/* global waInitSettingsUi, waApplyI18n, waSiteId, waT, WA_MSG, waInitUpdateUi */

waApplyI18n(document);

waInitSettingsUi({
  languageEl: document.getElementById("language"),
  debugEl: document.getElementById("debug-mode"),
  modelsEl: document.getElementById("models"),
  gpuWarnEl: document.getElementById("gpu-warn"),
  webgpuEl: document.getElementById("webgpu"),
  cacheEl: document.getElementById("cache"),
  deviceEl: document.getElementById("device"),
  errorEl: document.getElementById("error"),
  progressEl: document.getElementById("progress"),
  progressBarEl: document.getElementById("progress-bar"),
  progressLabelEl: document.getElementById("progress-label"),
  optionsBtn: document.getElementById("open-options"),
  openAppBtn: document.getElementById("open-app"),
  companionBoxEl: document.getElementById("companion-box"),
  companionStatusEl: document.getElementById("companion-status"),
  companionHintEl: document.getElementById("companion-hint"),
});

waInitUpdateUi({
  boxEl: document.getElementById("update-box"),
  titleEl: document.getElementById("update-title"),
  detailEl: document.getElementById("update-detail"),
  stepsEl: document.getElementById("update-steps"),
  openBtn: document.getElementById("update-open"),
  reloadedEl: document.getElementById("update-reloaded"),
});

// "Transcribe the notes on screen", only on WhatsApp Web and X tabs.
(async function initVisible() {
  const box = document.getElementById("visible-box");
  const button = document.getElementById("transcribe-visible");
  const status = document.getElementById("visible-status");
  const shortcut = document.getElementById("shortcut-hint");
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (_) {
    return;
  }
  // Host permissions expose the URL only for the sites we run on.
  if (!tab || tab.id == null || !waSiteId(tab.url || "")) return;
  box.hidden = false;

  try {
    const commands = await chrome.commands.getAll();
    const command = commands.find((c) => c.name === "transcribe-latest");
    shortcut.textContent = waT("shortcutHint", (command && command.shortcut) || waT("shortcutUnset"));
    shortcut.hidden = false;
  } catch (_) {
    /* no shortcut info */
  }

  button.addEventListener("click", () => {
    button.disabled = true;
    status.textContent = "";
    chrome.tabs.sendMessage(tab.id, { type: WA_MSG.TRANSCRIBE_VISIBLE, mode: "all" }, (resp) => {
      void chrome.runtime.lastError;
      button.disabled = false;
      status.textContent = resp && resp.count
        ? waT("transcribeVisibleCount", resp.count)
        : waT("transcribeVisibleNone");
    });
  });
})();
