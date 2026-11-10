/* Word timings for karaoke. Classic script, before content-core.js. */
(function (g) {
  function normalizeWords(list) {
    if (!list || !list.length) return [];
    const out = [];
    for (const w of list) {
      if (!w) continue;
      const text = String(w.text || w.word || "").trim();
      const start = Number(w.start != null ? w.start : w.startTime);
      const end = Number(w.end != null ? w.end : w.endTime);
      if (!text || !(start >= 0)) continue;
      out.push({ text: text, start: start, end: end >= start ? end : start });
    }
    return out;
  }

  // Highlight by each word's start. FluidAudio end times sometimes run into
  // the next word, so the next start is the boundary.
  function activeWordIndex(words, time) {
    if (!words || !words.length || !(time >= 0)) return -1;
    let idx = -1;
    for (let i = 0; i < words.length; i++) {
      if (time >= Number(words[i].start)) idx = i;
      else break;
    }
    return idx;
  }

  // Future words stay faded. Words at or before the playhead stay full.
  // Bold is only the word under the playhead while audio is actually playing.
  function wordPaint(index, activeIndex, playing) {
    const known = activeIndex >= 0;
    return {
      on: !!(playing && known && index === activeIndex),
      upcoming: !known || index > activeIndex,
    };
  }

  g.WaWords = {
    normalizeWords: normalizeWords,
    activeWordIndex: activeWordIndex,
    wordPaint: wordPaint,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
