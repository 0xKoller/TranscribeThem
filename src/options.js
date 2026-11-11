/* global waInitSettingsUi, waApplyI18n, waT, waInitUpdateUi */

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
  loadedModelEl: document.getElementById("loaded-model"),
  versionEl: document.getElementById("version"),
  openAppBtn: document.getElementById("open-app"),
  enginesEl: document.getElementById("engines"),
  siteEl: document.getElementById("site-whatsapp"),
  siteXEl: document.getElementById("site-x"),
  highlightEl: document.getElementById("highlight-words"),
  autoHintEl: document.getElementById("auto-hint"),
  autoTranscribeEl: document.getElementById("auto-transcribe"),
  cacheTranscriptsEl: document.getElementById("cache-transcripts"),
  clearTranscriptsBtn: document.getElementById("clear-transcripts"),
  clearTranscriptsStatusEl: document.getElementById("clear-transcripts-status"),
});

waInitUpdateUi({
  boxEl: document.getElementById("update-box"),
  titleEl: document.getElementById("update-title"),
  detailEl: document.getElementById("update-detail"),
  stepsEl: document.getElementById("update-steps"),
  openBtn: document.getElementById("update-open"),
  toggleEl: document.getElementById("check-updates"),
  controlsEl: document.getElementById("update-controls"),
  channelEl: document.getElementById("update-channel"),
  lastEl: document.getElementById("update-last"),
  nowBtn: document.getElementById("check-updates-now"),
  statusEl: document.getElementById("check-updates-status"),
});

(async function showShortcut() {
  const el = document.getElementById("shortcut-key");
  if (!el || !chrome.commands) return;
  try {
    const commands = await chrome.commands.getAll();
    const command = commands.find((c) => c.name === "transcribe-latest");
    el.textContent = (command && command.shortcut) || waT("shortcutUnset");
  } catch (_) {
    /* keep the placeholder */
  }
})();
