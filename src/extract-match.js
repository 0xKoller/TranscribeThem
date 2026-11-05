/* Which captured blob belongs to the bubble the user clicked, and how to undo mute. */
(function (g) {
  function lcaDistance(origin, target) {
    const ups = new Map();
    let n = origin;
    let up = 0;
    while (n && up <= 40) {
      ups.set(n, up);
      n = n.parentElement || null;
      up += 1;
    }
    let m = target;
    let down = 0;
    while (m && down <= 40) {
      if (ups.has(m)) return ups.get(m) + down;
      m = m.parentElement || null;
      down += 1;
    }
    return 9999;
  }

  // Play controls in an earlier message are farther from this bubble's button
  // than its own control. Never take the first button in document order.
  function closestControl(origin, candidates) {
    let best = null;
    let bestD = 9999;
    for (const el of candidates || []) {
      if (!el || el === origin) continue;
      if (typeof el.contains === "function" && el.contains(origin)) continue;
      const d = lcaDistance(origin, el);
      if (d < bestD) {
        best = el;
        bestD = d;
      }
    }
    return best;
  }

  // The shared player keeps the previous note loaded, so a similar duration is
  // not identity. A blob created after the click is this note: WhatsApp often
  // decrypts it before play() is allowed to start, so the element never looks
  // "playing". An older blob is this note only when the player src changed or
  // this bubble was already the one playing.
  function acceptCapturedBlob(s) {
    if (!s || !s.blob) return false;
    if (s.fresh) return true;
    if (!s.playerBlob || s.blob !== s.playerBlob) return false;
    if (s.wasPlayingBeforeClick || s.stableReplay) return true;
    if (s.srcChanged) return true;
    return false;
  }

  function restoredMedia(saved) {
    if (!saved) return { muted: false, volume: 1 };
    const volume = typeof saved.volume === "number" && saved.volume > 0 ? saved.volume : 1;
    return { muted: !!saved.muted, volume };
  }

  const FOLLOWING = 4;

  function documentBefore(a, b) {
    return typeof a.compareDocumentPosition === "function" && (a.compareDocumentPosition(b) & FOLLOWING) !== 0;
  }

  // The play control is the button just before the waveform slider. A button
  // that contains the slider is the whole bubble; clicking it does not play.
  // When the triangle is after the slider in the tree, take the first button
  // after it. Callers drop our UI, the speed control, and the mic status icon.
  function transportControl(buttons, slider) {
    const list = [];
    for (const b of buttons || []) {
      if (!b) continue;
      if (slider && typeof b.contains === "function" && b.contains(slider)) continue;
      list.push(b);
    }
    if (slider) {
      const before = list.filter((b) => documentBefore(b, slider)).sort((a, b) => (documentBefore(a, b) ? -1 : documentBefore(b, a) ? 1 : 0));
      if (before.length) return before[before.length - 1];
      const after = list.filter((b) => documentBefore(slider, b)).sort((a, b) => (documentBefore(a, b) ? -1 : documentBefore(b, a) ? 1 : 0));
      if (after.length) return after[0];
      return null;
    }
    return list.length === 1 ? list[0] : null;
  }

  // 0:27 on the note and 18:31 on the clock share the same shape. The duration
  // is the shorter one. A lone clock time still returns so the caller can log it.
  function voiceDurationSec(times) {
    const totals = [];
    for (const t of times || []) {
      const total = typeof t === "number" ? t : t && t.total;
      if (total > 0 && total < 90 * 60) totals.push(total);
    }
    if (!totals.length) return null;
    totals.sort((a, b) => a - b);
    return totals[0];
  }

  g.WaExtractMatch = {
    lcaDistance,
    closestControl,
    acceptCapturedBlob,
    restoredMedia,
    transportControl,
    voiceDurationSec,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
