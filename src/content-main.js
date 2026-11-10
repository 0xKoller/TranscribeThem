/* TranscribeThem — content script entry. Classic script, loaded last. */

function start() {
  try {
    if (isXSite()) paintXDebug();
    removeStaleWraps();
    refreshDebug();
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        if (changes.transcriptCache) onTranscriptCacheChanged(changes.transcriptCache.newValue);
        if (changes.debugMode || changes.highlightWords || changes.sites) refreshDebug();
        else if (NOTE_PREF_KEYS.some((key) => changes[key])) refreshNotePrefs();
      });
    }
    if (isXSite()) xRememberPath();
    scan(document);
    window.addEventListener(
      "resize",
      () => {
        document.querySelectorAll(".wa-t-wrap").forEach((wrap) => alignWrap(wrap));
      },
      { passive: true }
    );
    if (isXSite() && !globalThis.__waTXWatch) {
      globalThis.__waTXWatch = true;
      document.addEventListener("scroll", onXScroll, { capture: true, passive: true });
    }
    chrome.runtime.sendMessage({ type: WA_MSG.PRELOAD }, () => {
      void chrome.runtime.lastError;
    });
    log("content script ready");
    if (isXSite()) paintXDebug();
  } catch (err) {
    noteXDebugError("start", err);
    try {
      if (isXSite()) paintXDebug();
    } catch (_) {}
  }
  if (isXSite() && !globalThis.__waTXPrune) {
    globalThis.__waTXPrune = setInterval(() => {
      try {
        pruneShadows();
      } catch (_) {}
    }, 20000);
  }
  if (isXSite() && globalThis.navigation && !globalThis.__waTXNav) {
    globalThis.__waTXNav = true;
    try {
      navigation.addEventListener("navigatesuccess", () => {
        xSeenPath = "";
        xNoteNavigation();
      });
    } catch (_) {}
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
