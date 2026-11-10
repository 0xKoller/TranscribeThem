/* global waInitSettingsUi, waApplyI18n */

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
