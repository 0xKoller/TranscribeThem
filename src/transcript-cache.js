/* Transcripts remembered per message. Classic script (content, options).
   The functions under "pure" take and return plain objects: no DOM, no chrome.
   The storage helpers at the bottom are the only part that touches chrome. */
(function (g) {
  const STORAGE_KEY = "transcriptCache";
  const MAX_ENTRIES = 300;
  const MAX_ENTRY_BYTES = 40 * 1024;

  /* ---- pure ---- */

  // "" means: this note has no stable id, so it is not cached.
  function cacheKey(site, messageId) {
    const id = String(messageId == null ? "" : messageId).trim();
    const where = String(site == null ? "" : site).trim();
    if (!id || !where) return "";
    return where + ":" + id;
  }

  // UTF-8 length of the JSON, which is what chrome.storage counts.
  function byteSize(value) {
    let json = "";
    try {
      json = JSON.stringify(value);
    } catch (_) {
      return Infinity;
    }
    if (typeof json !== "string") return 0;
    let bytes = 0;
    for (let i = 0; i < json.length; i++) {
      const code = json.charCodeAt(i);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    }
    return bytes;
  }

  function cleanWords(words) {
    if (!Array.isArray(words)) return [];
    const out = [];
    for (const w of words) {
      if (!w) continue;
      const text = String(w.text || w.word || "").trim();
      const start = Number(w.start != null ? w.start : w.startTime);
      const end = Number(w.end != null ? w.end : w.endTime);
      if (!text || !(start >= 0)) continue;
      out.push({ text: text, start: start, end: end >= start ? end : start });
    }
    return out;
  }

  // The record to store, or null when it has no text or is still too big
  // without its word timings.
  function makeEntry(result, now, maxBytes) {
    const source = result || {};
    const text = typeof source.text === "string" ? source.text : "";
    if (!text.trim()) return null;
    const limit = maxBytes > 0 ? maxBytes : MAX_ENTRY_BYTES;
    const at = Number(now) || 0;
    const ms = Number(source.transcribeMs);
    const entry = {
      text: text,
      words: cleanWords(source.words),
      engine: source.engine ? String(source.engine) : "",
      transcribeMs: ms > 0 ? ms : 0,
      savedAt: at,
      usedAt: at,
    };
    if (byteSize(entry) <= limit) return entry;
    entry.words = [];
    return byteSize(entry) <= limit ? entry : null;
  }

  function isEntry(entry) {
    return !!(entry && typeof entry === "object" && typeof entry.text === "string" && entry.text);
  }

  function lastUsed(entry) {
    return Number(entry.usedAt) || Number(entry.savedAt) || 0;
  }

  // A clean copy with at most `max` entries, dropping the least recently used.
  function prune(cache, max) {
    const limit = max >= 0 ? max : MAX_ENTRIES;
    const source = cache && typeof cache === "object" ? cache : {};
    const keys = Object.keys(source).filter(function (key) { return isEntry(source[key]); });
    keys.sort(function (a, b) { return lastUsed(source[b]) - lastUsed(source[a]); });
    const out = {};
    for (const key of keys.slice(0, limit)) out[key] = source[key];
    return out;
  }

  function put(cache, key, entry, max) {
    const next = Object.assign({}, cache && typeof cache === "object" ? cache : {});
    if (!key || !isEntry(entry)) return prune(next, max);
    next[key] = entry;
    return prune(next, max);
  }

  function get(cache, key) {
    if (!key || !cache || typeof cache !== "object") return null;
    if (!Object.prototype.hasOwnProperty.call(cache, key)) return null;
    const entry = cache[key];
    return isEntry(entry) ? entry : null;
  }

  // Marks a read, so the entry is the last one to be evicted.
  function touch(cache, key, now) {
    const entry = get(cache, key);
    if (!entry) return cache && typeof cache === "object" ? cache : {};
    const next = Object.assign({}, cache);
    next[key] = Object.assign({}, entry, { usedAt: Number(now) || 0 });
    return next;
  }

  /* ---- chrome.storage.local ---- */

  let chain = Promise.resolve();

  async function load() {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const cache = stored && stored[STORAGE_KEY];
    return cache && typeof cache === "object" ? cache : {};
  }

  // Read, change, write. Calls from this page run one after the other.
  function update(change) {
    const run = chain.then(async function () {
      const next = change(await load());
      await chrome.storage.local.set({ [STORAGE_KEY]: next });
      return next;
    });
    chain = run.catch(function () {});
    return run;
  }

  function clear() {
    const run = chain.then(function () {
      return chrome.storage.local.set({ [STORAGE_KEY]: {} });
    });
    chain = run.catch(function () {});
    return run;
  }

  g.WaTranscriptCache = {
    STORAGE_KEY: STORAGE_KEY,
    MAX_ENTRIES: MAX_ENTRIES,
    MAX_ENTRY_BYTES: MAX_ENTRY_BYTES,
    cacheKey: cacheKey,
    byteSize: byteSize,
    makeEntry: makeEntry,
    prune: prune,
    put: put,
    get: get,
    touch: touch,
    load: load,
    update: update,
    clear: clear,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
