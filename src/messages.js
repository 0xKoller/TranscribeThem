/* Shared message types. Loaded as a classic script (content, SW, popup). */
(function (g) {
  g.WA_MSG = {
    CANCEL: "WA_CANCEL",
    TRANSCRIBE_VISIBLE: "WA_TRANSCRIBE_VISIBLE",
    TRANSCRIBE: "WA_TRANSCRIBE",
    PROGRESS: "WA_PROGRESS",
    RESULT: "WA_RESULT",
    ERROR: "WA_ERROR",
    GET_STATUS: "WA_GET_STATUS",
    STATUS: "WA_STATUS",
    SETTINGS_CHANGED: "WA_SETTINGS_CHANGED",
    PRELOAD: "WA_PRELOAD",
    SAVE_FILES: "WA_SAVE_FILES",
    CHECK_COMPANION: "WA_CHECK_COMPANION",
    OPEN_COMPANION: "WA_OPEN_COMPANION",
    TEXT_ACTION: "WA_TEXT_ACTION",
  };
  g.WA_TARGET = {
    OFFSCREEN: "offscreen",
    BACKGROUND: "background",
  };
  g.WA_PHASE = {
    QUEUED: "queued",
    LOADING: "loading",
    RUNNING: "running",
    DONE: "done",
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
