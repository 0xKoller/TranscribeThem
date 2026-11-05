/* global waInitSettingsUi */

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
