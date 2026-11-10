/* MAIN world. Capture WA-decrypted audio without the user pressing Play. */
(function () {
  // Temporary probe for the missing X button. The content script removes this once it paints.
  function onXDocument() {
    const host = String((location && location.hostname) || "");
    if (/(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(host)) return true;
    let origin = "";
    let protocol = "";
    try {
      origin = String(location.origin || "");
      protocol = String(location.protocol || "");
    } catch (_) {}
    if (/^https:\/\/([^/]+\.)?(x\.com|twitter\.com)(:\d+)?$/i.test(origin)) return true;
    return protocol === "blob:" || protocol === "about:" || protocol === "data:";
  }

  function deepQuery(selector) {
    const seen = new Set();
    const stack = [document];
    while (stack.length) {
      const root = stack.pop();
      if (!root || seen.has(root)) continue;
      seen.add(root);
      if (typeof root.querySelector === "function") {
        let hit = null;
        try {
          hit = root.querySelector(selector);
        } catch (_) {
          hit = null;
        }
        if (hit) return hit;
      }
      if (typeof root.querySelectorAll !== "function") continue;
      let all = [];
      try {
        all = root.querySelectorAll("*");
      } catch (_) {
        all = [];
      }
      for (const el of all) {
        if (el && el.shadowRoot) stack.push(el.shadowRoot);
      }
    }
    return null;
  }

  function deepAll(selector) {
    const out = [];
    const seen = new Set();
    const stack = [document];
    while (stack.length) {
      const root = stack.pop();
      if (!root || seen.has(root) || typeof root.querySelectorAll !== "function") continue;
      seen.add(root);
      try {
        root.querySelectorAll(selector).forEach((el) => out.push(el));
      } catch (_) {
        /* this root rejects the selector */
      }
      let all = [];
      try {
        all = root.querySelectorAll("*");
      } catch (_) {
        all = [];
      }
      for (const el of all) {
        if (el && el.shadowRoot) stack.push(el.shadowRoot);
      }
    }
    return out;
  }

  function paintMainMark() {
    return;
    if (!onXDocument()) return;
    const paint = () => {
      if (!document.documentElement) return false;
      if (document.getElementById("wa-t-x-debug")) {
        const old = document.getElementById("wa-t-x-debug-main");
        if (old) old.remove();
        return true;
      }
      if (window.innerWidth < 80 || window.innerHeight < 80) return false;
      let el = document.getElementById("wa-t-x-debug-main");
      if (!el) {
        el = document.createElement("div");
        el.id = "wa-t-x-debug-main";
        el.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#ffe14a;color:#111;font:600 13px/1.35 ui-monospace,Menlo,monospace;padding:8px 12px;pointer-events:none;text-align:left;white-space:pre-wrap";
        document.documentElement.appendChild(el);
      }
      const frame = window === window.top ? "top" : "iframe";
      let path = location.pathname || "/";
      if (path.length > 48) path = path.slice(0, 48) + "…";
      el.textContent = "wa-t MAIN 0.1.40 · " + frame + " · " + path + "\nsi esta barra queda, el script de la UI no arrancó en este marco";
      return false;
    };
    try {
      console.log("[wa-transcribe]", "main", window === window.top ? "top" : "iframe", location.href);
      paint();
      let n = 0;
      const timer = setInterval(() => {
        n += 1;
        let done = false;
        try { done = paint(); } catch (_) { done = true; }
        if (done || n > 30) clearInterval(timer);
      }, 1000);
    } catch (_) {}
  }
  paintMainMark();

  function bootHook() {
  const LOG = "[wa-transcribe]";
  const SOURCE = "wa-local-transcribe";
  const MIN_BYTES = 200;

  const blobsByUrl = new Map();
  const recentBlobs = [];
  const audioEls = new Set();
  let pending = null;
  let silent = false;
  let playsDuringCapture = 0;
  let seekStick = null;
  const savedMedia = new WeakMap();
  const audioContexts = new Set();
  const suspendedByUs = new Set();

  function log(...args) {
    console.log(LOG, ...args);
  }

  function isAudioBlob(blob) {
    if (!(blob instanceof Blob) || blob.size < MIN_BYTES) return false;
    const t = String(blob.type || "").toLowerCase();
    if (!t) return blob.size >= MIN_BYTES;
    if (/audio|ogg|opus|mpeg|mp4|webm|octet-stream/i.test(t)) return true;
    return false;
  }

  function remember(blob, url) {
    if (!isAudioBlob(blob)) return;
    if (url) blobsByUrl.set(url, blob);
    recentBlobs.push({ blob, url: url || "", t: Date.now() });
    if (recentBlobs.length > 30) recentBlobs.shift();
    if (pending) pending(blob);
  }

  const origCreateObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (obj) {
    const url = origCreateObjectURL(obj);
    try {
      remember(obj, url);
    } catch (_) {
      /* ignore */
    }
    return url;
  };

  let lastMediaForbidden = false;

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const reqUrl = String((args[0] && args[0].url) || args[0] || "");
    const p = origFetch.apply(this, args);
    p.then((res) => {
      try {
        const url = res.url || reqUrl;
        if (res.status === 403 && /whatsapp\.net|cdn\.whatsapp|mmg\./i.test(url)) {
          lastMediaForbidden = true;
        }
        const ct = (res.headers && res.headers.get("content-type")) || "";
        if (!/audio|ogg|opus|octet-stream/i.test(ct)) return;
        res.clone().blob().then((blob) => remember(blob, url)).catch(() => {});
      } catch (_) {
        /* ignore */
      }
    }).catch(() => {});
    return p;
  };

  const mediaProto = HTMLMediaElement.prototype;

  const srcDesc = Object.getOwnPropertyDescriptor(mediaProto, "src");
  if (srcDesc && srcDesc.set && srcDesc.get) {
    Object.defineProperty(mediaProto, "src", {
      configurable: true,
      enumerable: srcDesc.enumerable,
      get() {
        return srcDesc.get.call(this);
      },
      set(value) {
        srcDesc.set.call(this, value);
        audioEls.add(this);
        if (typeof value === "string") fetchSrc(value);
      },
    });
  }

  const origSetAttribute = mediaProto.setAttribute;
  mediaProto.setAttribute = function (name, value) {
    const ret = origSetAttribute.apply(this, arguments);
    if (String(name).toLowerCase() === "src" && value) {
      audioEls.add(this);
      fetchSrc(String(value));
    }
    return ret;
  };

  function rememberMedia(el) {
    if (!el || savedMedia.has(el)) return;
    let muted = false;
    let volume = 1;
    try {
      muted = !!el.muted;
      if (typeof el.volume === "number") volume = el.volume;
    } catch (_) {
      /* ignore */
    }
    savedMedia.set(el, { muted, volume });
  }

  function quietMedia(el) {
    if (!el) return;
    rememberMedia(el);
    try {
      el.muted = true;
      el.volume = 0;
    } catch (_) {
      /* ignore */
    }
  }

  function armQuietHooks(el) {
    if (!el || el.__waTQuiet) return;
    el.__waTQuiet = true;
    const quiet = () => {
      if (silent) quietMedia(el);
    };
    el.addEventListener("volumechange", quiet);
    el.addEventListener("playing", quiet);
  }

  function trackContext(ctx) {
    if (!ctx) return;
    audioContexts.add(ctx);
    if (!silent || ctx.state === "suspended") return;
    try {
      const pendingSuspend = ctx.suspend();
      if (pendingSuspend && pendingSuspend.catch) pendingSuspend.catch(() => {});
      suspendedByUs.add(ctx);
    } catch (_) {
      /* ignore */
    }
  }

  function suspendContexts() {
    for (const ctx of audioContexts) trackContext(ctx);
  }

  function resumeContexts() {
    for (const ctx of suspendedByUs) {
      try {
        const pendingResume = ctx.resume();
        if (pendingResume && pendingResume.catch) pendingResume.catch(() => {});
      } catch (_) {
        /* ignore */
      }
    }
    suspendedByUs.clear();
  }

  function hookAudioContext(Native) {
    if (typeof Native !== "function" || Native.__waTCtx) return Native;
    function WrappedAudioContext(...args) {
      const ctx = new Native(...args);
      trackContext(ctx);
      return ctx;
    }
    WrappedAudioContext.prototype = Native.prototype;
    Object.setPrototypeOf(WrappedAudioContext, Native);
    WrappedAudioContext.__waTCtx = true;
    return WrappedAudioContext;
  }

  const origPlay = mediaProto.play;
  mediaProto.play = function () {
    audioEls.add(this);
    bindPlayback(this);
    const src = this.currentSrc || this.src;
    if (src) fetchSrc(src);
    // Keep the note inaudible, but let play() run. Swallowing it meant WhatsApp
    // never decrypted until a later click, whenever decrypt was slower than the
    // old fallback timer.
    if (silent) {
      playsDuringCapture += 1;
      quietMedia(this);
      armQuietHooks(this);
      suspendContexts();
    }
    const result = origPlay.apply(this, arguments);
    if (silent) {
      const el = this;
      queueMicrotask(() => {
        if (silent) quietMedia(el);
      });
    }
    return result;
  };

  const NativeAudio = window.Audio;
  window.Audio = function Audio(...args) {
    const el = args.length ? new NativeAudio(...args) : new NativeAudio();
    audioEls.add(el);
    bindPlayback(el);
    if (args[0]) fetchSrc(String(args[0]));
    return el;
  };
  window.Audio.prototype = NativeAudio.prototype;
  Object.setPrototypeOf(window.Audio, NativeAudio);
  if (window.AudioContext) window.AudioContext = hookAudioContext(window.AudioContext);
  if (window.webkitAudioContext) window.webkitAudioContext = hookAudioContext(window.webkitAudioContext);

  function hookDecodeAudio(proto) {
    if (!proto || typeof proto.decodeAudioData !== "function" || proto.decodeAudioData.__waT) return;
    const orig = proto.decodeAudioData;
    proto.decodeAudioData = function (audioData, ...rest) {
      trackContext(this);
      try {
        const copy = audioData && audioData.slice ? audioData.slice(0) : audioData;
        remember(new Blob([copy], { type: "audio/ogg; codecs=opus" }), "decodeAudioData");
      } catch (_) {
        /* ignore */
      }
      return orig.call(this, audioData, ...rest);
    };
    proto.decodeAudioData.__waT = true;
  }
  hookDecodeAudio(window.AudioContext && window.AudioContext.prototype);
  hookDecodeAudio(window.webkitAudioContext && window.webkitAudioContext.prototype);

  try {
    const srcObj = Object.getOwnPropertyDescriptor(mediaProto, "srcObject");
    if (srcObj && srcObj.set) {
      Object.defineProperty(mediaProto, "srcObject", {
        configurable: true,
        enumerable: srcObj.enumerable,
        get: srcObj.get,
        set(value) {
          audioEls.add(this);
          srcObj.set.call(this, value);
        },
      });
    }
  } catch (_) {
    /* ignore */
  }

  async function fetchSrc(src, timeoutMs = 800) {
    if (!src || src === location.href || src.endsWith("#")) return null;
    if (blobsByUrl.has(src)) return blobsByUrl.get(src);
    const ac = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
    try {
      const res = await origFetch.call(window, src, ac ? { signal: ac.signal } : {});
      if (!res.ok) return null;
      const blob = await res.blob();
      remember(blob, src);
      return isAudioBlob(blob) ? blob : null;
    } catch (err) {
      log("fetch src failed", String(src).slice(0, 80), err && err.message);
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function allAudio() {
    const set = new Set(audioEls);
    for (const el of document.querySelectorAll("audio, video")) set.add(el);
    return [...set];
  }

  let silentGuard = null;

  function matchApi() {
    const api = globalThis.WaExtractMatch;
    if (!api) throw new Error("RELOAD");
    return api;
  }

  function restoreAll() {
    for (const el of allAudio()) {
      if (!savedMedia.has(el)) continue;
      const saved = savedMedia.get(el);
      savedMedia.delete(el);
      const next = matchApi().restoredMedia(saved);
      try {
        el.muted = next.muted;
        el.volume = next.volume;
        el.pause();
        if (el.currentTime) el.currentTime = 0;
      } catch (_) {
        /* ignore */
      }
    }
  }

  function startSilentGuard() {
    silent = true;
    playsDuringCapture = 0;
    suspendContexts();
    for (const el of allAudio()) {
      quietMedia(el);
      armQuietHooks(el);
    }
    if (silentGuard) clearInterval(silentGuard);
    silentGuard = setInterval(() => {
      if (!silent) return;
      for (const el of allAudio()) quietMedia(el);
    }, 40);
  }

  function stopSilentGuard() {
    silent = false;
    if (silentGuard) {
      clearInterval(silentGuard);
      silentGuard = null;
    }
    restoreAll();
    resumeContexts();
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        const comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error || new Error("FileReader"));
      reader.readAsDataURL(blob);
    });
  }

  function realClick(el) {
    if (!el) return;
    // Press this node. Climbing to the nearest role=button lands on the bubble,
    // and React never delivers that event to the play triangle.
    const rect = el.getBoundingClientRect();
    const x = rect.left + Math.max(4, rect.width / 2);
    const y = rect.top + Math.max(4, rect.height / 2);
    const base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      buttons: 1,
    };
    const press = (node) => {
      if (!node) return;
      try {
        node.dispatchEvent(new PointerEvent("pointerdown", base));
        node.dispatchEvent(new MouseEvent("mousedown", base));
        node.dispatchEvent(new PointerEvent("pointerup", { ...base, buttons: 0 }));
        node.dispatchEvent(new MouseEvent("mouseup", { ...base, buttons: 0 }));
        node.dispatchEvent(new MouseEvent("click", { ...base, buttons: 0 }));
        if (typeof node.click === "function") node.click();
      } catch (_) {}
    };
    press(el);
    let inner = null;
    try {
      if (rect.width > 0 && rect.height > 0) inner = document.elementFromPoint(x, y);
    } catch (_) {}
    if (inner && inner !== el && typeof el.contains === "function" && el.contains(inner) && !isOurUi(inner)) {
      press(inner);
    }
  }

  function isOurUi(el) {
    return !!(el && el.closest && el.closest(".wa-t-wrap, .wa-t-aside, .wa-t-foot, .wa-t-x-tools, .wa-t-btn, .wa-t-tools, .wa-t-copy, .wa-t-save"));
  }

  function onXHost() {
    return onXDocument();
  }

  function inXComposer(el) {
    if (!onXHost() || !el || !el.closest) return false;
    return !!el.closest(
      '[data-testid="dm-composer-form"], [data-testid="dm-composer-container"], [data-testid="voiceMessageButton"]'
    );
  }

  function isSpeedControl(el) {
    if (!el) return false;
    const t = `${el.textContent || ""} ${el.getAttribute("aria-label") || ""} ${el.getAttribute("data-icon") || ""}`;
    return /(?:^|\s)(?:1|1\.5|2)\s*[x×]|velocidad|playback speed/i.test(t);
  }

  function describeEl(el) {
    if (!el) return "none";
    return [el.tagName, el.getAttribute("data-icon"), el.getAttribute("aria-label"), (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 32)]
      .filter(Boolean)
      .join("|");
  }

  function isStatusIcon(el) {
    if (!el) return false;
    const t = `${el.getAttribute("data-icon") || ""} ${el.getAttribute("aria-label") || ""} ${el.className || ""}`.toLowerCase();
    return /ptt-status|status|msg-check|check|ack|forward|tail|delivered|read/i.test(t);
  }

  function isQuoted(el) {
    if (!el || !el.closest) return false;
    return !!el.closest(
      '[data-testid="quoted-message"], [data-testid="quoted-msg"], [aria-label*="citado" i], [aria-label*="quoted" i]'
    );
  }

  function playTarget(el) {
    if (!el || isOurUi(el) || isSpeedControl(el) || isStatusIcon(el) || isQuoted(el)) return null;
    const ancestor = el.closest ? el.closest("button, [role='button']") : null;
    if (!ancestor || ancestor === el) return el;
    // The bubble is a role=button around the slider and our buttons. Keep the glyph.
    if (ancestor.querySelector(".wa-t-wrap, [role='slider'], input[type='range']")) return el;
    if (isOurUi(ancestor) || isSpeedControl(ancestor) || isStatusIcon(ancestor) || isQuoted(ancestor)) return null;
    return ancestor;
  }

  const PLAY_SELS = [
    '[aria-label*="reproducir" i]',
    '[aria-label*="pausar" i]',
    '[aria-label*="play" i]',
    '[aria-label*="pause" i]',
    '[aria-label*="escuchar" i]',
    '[aria-label*="voice" i]',
    '[aria-label*="voz" i]',
    '[aria-label*="audio" i]',
    '[data-testid*="play" i]',
    '[data-testid*="pause" i]',
    '[data-testid*="audio" i]',
    '[data-testid*="ptt" i]',
    'button[aria-label]',
    '[role="button"][aria-label]',
    'span[data-icon*="play" i]',
    'span[data-icon*="pause" i]',
    'span[data-icon*="audio" i]',
    'span[data-icon*="ptt" i]',
    'span[data-icon="ic-play-arrow-filled"]',
  ];

  function collectPlayTargets(scope) {
    if (!scope || !scope.querySelectorAll) return [];
    const seen = new Set();
    const out = [];
    const add = (el) => {
      const target = playTarget(el);
      if (!target || seen.has(target)) return;
      seen.add(target);
      out.push(target);
    };
    for (const sel of PLAY_SELS) {
      let els;
      try {
        els = scope.querySelectorAll(sel);
      } catch (_) {
        continue;
      }
      for (const el of els) add(el);
    }
    for (const btn of scope.querySelectorAll('button, [role="button"]')) {
      if (isOurUi(btn) || isSpeedControl(btn) || isStatusIcon(btn) || isQuoted(btn)) continue;
      const text = `${btn.getAttribute("aria-label") || ""} ${btn.getAttribute("data-testid") || ""} ${btn.getAttribute("data-icon") || ""}`.toLowerCase();
      if (/play|reproducir|pause|pausar|escuchar|mensaje de voz|voice message|ptt/.test(text)) add(btn);
      else if (btn.querySelector('span[data-icon*="play"], span[data-icon*="audio-play"], span[data-icon*="ptt"], span[data-icon*="pause"]')) add(btn);
    }
    return out;
  }

  // Largest ancestor that still contains a single voice-note control.
  // Walking into the chat list would make querySelector return the note above.
  function messageScope(root) {
    if (!root) return null;
    let n = root;
    let withOne = null;
    for (let i = 0; i < 8 && n && n !== document.body && n !== document.documentElement; i++) {
      const count = collectPlayTargets(n).length;
      if (count === 1) withOne = n;
      if (count > 1) break;
      n = n.parentElement;
    }
    return withOne || root;
  }

  function messageRow(root) {
    if (!root || !root.closest) return root;
    // X lists use role=row on the whole thread. Stay on the message bubble.
    if (onXHost()) {
      let n = root;
      for (let i = 0; i < 18 && n && n !== document.body; i++) {
        const id = (n.getAttribute && n.getAttribute("data-testid")) || "";
        if (id === "messageEntry" || (/^message-/.test(id) && !/^message-text-/.test(id))) return n;
        n = n.parentElement;
      }
    }
    const row = root.closest('[data-id], [data-testid="msg-container"], [role="row"]');
    if (row && row !== document.body && row !== document.documentElement) return row;
    return messageScope(root);
  }

  // Smallest ancestor that still holds this note's waveform, and no second one.
  function bubbleScope(root) {
    if (!root) return null;
    const sel = '[role="slider"], input[type="range"]';
    let n = root;
    let best = root;
    for (let i = 0; i < 10 && n && n !== document.body && n !== document.documentElement; i++) {
      let count = 0;
      try {
        count = n.querySelectorAll(sel).length;
      } catch (_) {
        count = 0;
      }
      if (count === 1) best = n;
      if (count > 1) break;
      n = n.parentElement;
    }
    return best;
  }

  function candidateButtons(scope) {
    if (!scope || !scope.querySelectorAll) return [];
    const out = [];
    const seen = new Set();
    let buttons;
    try {
      buttons = scope.querySelectorAll("button, [role='button']");
    } catch (_) {
      return [];
    }
    for (const el of buttons) {
      if (seen.has(el) || isOurUi(el) || isSpeedControl(el) || isStatusIcon(el) || isQuoted(el)) continue;
      if (el.getAttribute("role") === "slider") continue;
      seen.add(el);
      out.push(el);
    }
    return out;
  }

  function findTransport(scope) {
    if (!scope || !scope.querySelector) return null;
    let slider = null;
    try {
      slider = scope.querySelector('[role="slider"], input[type="range"]');
    } catch (_) {
      slider = null;
    }
    return matchApi().transportControl(candidateButtons(scope), slider);
  }

  function pickControl(origin, targets) {
    if (!targets || !targets.length) return null;
    const outside = targets.filter((el) => !(el.contains && el.contains(origin)));
    // The voice-note control often wraps our buttons. Click it anyway when it
    // is the only one in this message; skipping it leaves the triangle on Play.
    const pool = outside.length ? outside : targets;
    if (pool.length === 1) return pool[0];
    return matchApi().closestControl(origin, pool);
  }

  function iconControls(scope) {
    if (!scope || !scope.querySelectorAll) return [];
    const out = [];
    const seen = new Set();
    for (const btn of scope.querySelectorAll("button, [role='button']")) {
      if (isOurUi(btn) || isSpeedControl(btn) || isStatusIcon(btn) || isQuoted(btn) || seen.has(btn)) continue;
      if (!btn.querySelector("svg, span[data-icon]")) continue;
      seen.add(btn);
      out.push(btn);
    }
    return out;
  }

  function findPlay(root) {
    if (!root || inXComposer(root)) return null;
    const scope = bubbleScope(root) || messageRow(root) || root;
    if (inXComposer(scope)) return null;
    if (onXHost() && scope.querySelector) {
      let named = null;
      try {
        named = scope.querySelector(
          'button[aria-label="Play" i], button[aria-label="Pause" i], button[aria-label="Reproducir" i], button[aria-label="Pausar" i], [data-icon="icon-play"], [data-icon="icon-pause"]'
        );
      } catch (_) {
        named = null;
      }
      if (named) {
        const btn = named.closest ? named.closest("button, [role='button']") || named : named;
        if (!inXComposer(btn)) return btn;
      }
    }
    const transport = findTransport(scope);
    const origin = (root.querySelector && root.querySelector(".wa-t-wrap")) || root;
    const picked =
      transport || pickControl(origin, collectPlayTargets(scope)) || pickControl(origin, iconControls(scope));
    if (inXComposer(picked)) return null;
    return picked;
  }

  function usableSrc(audio) {
    if (!audio) return "";
    const src = audio.currentSrc || audio.src;
    if (!src || src === location.href || src.endsWith("#")) return "";
    return src;
  }

  function isPlayingBubble(root) {
    if (!root || !root.querySelector) return false;
    return !!(
      root.querySelector('[aria-label*="Pause" i], [aria-label*="Pausar" i], [data-icon*="pause" i], [data-testid="audio-pause"]')
    );
  }

  function parseBubbleDuration(root, playEl) {
    const found = [];
    const re = /\b(\d{1,2}):(\d{2})\b/g;
    const pushText = (text) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text || ""))) {
        found.push({ total: parseInt(m[1], 10) * 60 + parseInt(m[2], 10) });
      }
    };
    const slider = root && root.querySelector && root.querySelector('[role="slider"], input[type="range"]');
    if (slider) {
      pushText(slider.getAttribute("aria-valuetext") || "");
      pushText(slider.getAttribute("aria-label") || "");
      if (slider.parentElement && !isOurUi(slider.parentElement)) pushText(slider.parentElement.textContent || "");
    }
    const playerRow = playEl ? (playEl.closest('[data-testid="audio-player"]') || playEl.parentElement) : null;
    if (playerRow && !isOurUi(playerRow)) pushText(playerRow.textContent || "");

    // Walk root, ignoring message metadata/timestamp, quoted messages, and our injected UI
    function walk(node) {
      if (!node) return;
      if (node.nodeType === 1) {
        if (
          node.classList?.contains("wa-t-wrap") ||
          node.matches?.('[data-testid="msg-meta"], [data-testid*="meta"], [data-testid="quoted-message"], [data-testid="quoted-msg"]') ||
          node.closest?.('[data-testid="msg-meta"], [data-testid*="meta"], [data-testid="quoted-message"], [data-testid="quoted-msg"]')
        ) {
          return;
        }
      }
      if (node.nodeType === 3) {
        const text = node.textContent || "";
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text))) {
          found.push({ total: parseInt(m[1], 10) * 60 + parseInt(m[2], 10) });
        }
        return;
      }
      for (const child of node.childNodes) walk(child);
    }
    walk(root);
    return matchApi().voiceDurationSec(found);
  }

  function sizeFitsDuration(bytes, expectedSec) {
    if (!bytes || bytes < MIN_BYTES) return false;
    if (expectedSec == null) return bytes < 30 * 1024 * 1024;
    const min = Math.max(MIN_BYTES, Math.floor((expectedSec - 5) * 300));
    const max = Math.max(100 * 1024, Math.ceil((expectedSec + 15) * 16000));
    return bytes >= min && bytes <= max;
  }

  function liveSrc() {
    const playing = allAudio().find((a) => !a.paused && usableSrc(a));
    return playing ? usableSrc(playing) : "";
  }

  function residentSrc() {
    const els = allAudio();
    for (let i = els.length - 1; i >= 0; i--) {
      const src = usableSrc(els[i]);
      if (src) return src;
    }
    return "";
  }

  async function blobForSrc(src) {
    if (!src) return null;
    if (blobsByUrl.has(src)) {
      const blob = blobsByUrl.get(src);
      return isAudioBlob(blob) ? blob : null;
    }
    const blob = await fetchSrc(src);
    return blob && isAudioBlob(blob) ? blob : null;
  }

  function controlLabel(el) {
    if (!el) return "";
    const icon = el.querySelector?.("[data-icon]")?.getAttribute("data-icon") || "";
    return `${el.getAttribute?.("aria-label") || ""} ${el.getAttribute?.("data-icon") || ""} ${icon}`;
  }

  function controlShowsPause(el) {
    return /pause|pausar/i.test(controlLabel(el));
  }

  function controlLooksLikePlay(el) {
    const label = controlLabel(el);
    if (!label.trim() || /pause|pausar/i.test(label)) return false;
    return /play|reproducir|escuchar/i.test(label);
  }

  function otherBubblePlaying(scope) {
    const sel = '[aria-label*="Pause" i], [aria-label*="Pausar" i], [data-icon*="pause" i], [data-testid="audio-pause"]';
    for (const el of document.querySelectorAll(sel)) {
      if (isOurUi(el) || isQuoted(el)) continue;
      if (scope && scope.contains(el)) continue;
      return true;
    }
    return false;
  }

  function waitForBlob(ms, { expectedSec, snapSrc, scope, play, knownBlobs }) {
    return new Promise((resolve, reject) => {
      let timer = null;
      let replaySince = 0;
      let replaySrc = "";
      const finish = (blob, why) => {
        if (!pending) return;
        pending = null;
        clearTimeout(timer);
        log(why, "expectedSec", expectedSec, blob.type || "unknown", blob.size, "bytes");
        resolve(blob);
      };
      const consider = async () => {
        if (!pending) return;
        const src = liveSrc() || residentSrc();
        const srcChanged = !!src && src !== snapSrc;
        const livePlay = findPlay(scope) || play;
        const ourControlPaused = controlShowsPause(livePlay);
        const foreign = otherBubblePlaying(scope);
        if (ourControlPaused && !srcChanged && src && !foreign) {
          if (src !== replaySrc) {
            replaySrc = src;
            replaySince = Date.now();
          }
        } else if (srcChanged || !ourControlPaused) {
          replaySince = 0;
          replaySrc = "";
        }
        const playerBlob = src ? await blobForSrc(src) : null;
        if (!pending || !playerBlob) return;
        const accepted = matchApi().acceptCapturedBlob({
          blob: playerBlob,
          playerBlob,
          wasPlayingBeforeClick: false,
          stableReplay: replaySince > 0 && Date.now() - replaySince >= 160,
          srcChanged,
          ourControlPaused,
          foreignPlaying: foreign,
          playingHere: isPlayingBubble(scope),
        });
        if (!accepted) return;
        if (!sizeFitsDuration(playerBlob.size, expectedSec)) {
          log("identity ok, size mismatch", playerBlob.size, "expectedSec", expectedSec);
          return;
        }
        finish(playerBlob, srcChanged ? "player src changed" : "playing bubble");
      };
      timer = setTimeout(() => {
        pending = null;
        log("timeout no matching blob", "expectedSec", expectedSec, "src", (liveSrc() || "").slice(0, 48));
        reject(new Error("NO_AUDIO"));
      }, ms);
      pending = (blob) => {
        const fresh = !!(blob && knownBlobs && !knownBlobs.has(blob));
        // A clock time parsed as the duration (18:31) used to reject the real
        // clip. A blob created by this click is already identified.
        if (
          fresh &&
          isAudioBlob(blob) &&
          blob.size < 30 * 1024 * 1024 &&
          matchApi().acceptCapturedBlob({ blob, fresh: true })
        ) {
          finish(blob, "fresh blob");
          return;
        }
        consider();
      };
      const poll = async () => {
        if (!pending) return;
        try {
          await consider();
        } catch (err) {
          if (!pending) return;
          pending = null;
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        if (pending) setTimeout(poll, 80);
      };
      poll();
    });
  }

  function extractRoot(node) {
    const rowId = node && node.dataset && node.dataset.xRow;
    if (rowId) {
      let row = null;
      try {
        row = deepQuery(`[data-dm-message-row="${CSS.escape(rowId)}"]`);
      } catch (_) {
        row = null;
      }
      if (!row) {
        try {
          row = deepQuery(`[data-testid="${CSS.escape(rowId)}"]`);
        } catch (_) {
          row = null;
        }
      }
      // The foot and the hidden wrap sit on #wa-t-x-layer. That parent is not the note.
      return row;
    }
    return node ? node.parentElement || node : null;
  }

  function markerNode(marker) {
    if (!marker) return null;
    return deepQuery(`[data-wa-t-id="${CSS.escape(marker)}"]`);
  }

  async function extract(marker) {
    const marked = markerNode(marker);
    const root = marked && extractRoot(marked);
    if (!root) {
      log("extract: no root for", marker);
      throw new Error("NO_AUDIO");
    }

    const scope = bubbleScope(root) || messageRow(root) || messageScope(root);
    const play = findPlay(root);
    log("clicking play", describeEl(play), "scopeKids", scope && scope.childElementCount);
    const expectedSec = parseBubbleDuration(scope, play) || parseBubbleDuration(root, play);
    const snapSrc = liveSrc() || residentSrc();
    const wasPlayingThis =
      (isPlayingBubble(scope) || controlShowsPause(play)) && !otherBubblePlaying(scope);
    log(
      "extract play",
      !!play,
      "expectedSec",
      expectedSec,
      "wasPlayingThis",
      wasPlayingThis,
      "audios",
      allAudio().length,
      "cachedBlobs",
      recentBlobs.length,
      "playerSrc",
      (snapSrc || "").slice(0, 48)
    );

    if (wasPlayingThis) {
      const blob = await blobForSrc(liveSrc());
      if (blob && sizeFitsDuration(blob.size, expectedSec)) {
        log("extracted from already-playing", blob.size, "bytes");
        return blob;
      }
    }

    if (!play) throw new Error("NO_AUDIO");

    startSilentGuard();
    let retry = 0;
    try {
      const knownBlobs = new Set(recentBlobs.map((x) => x.blob));
      const waiter = waitForBlob(12000, { expectedSec, snapSrc, scope, play, knownBlobs });
      realClick(play);
      retry = setTimeout(() => {
        if (!pending) return;
        // play() already ran. A second click pauses the note and drops the blob.
        if (playsDuringCapture > 0) return;
        const now = liveSrc();
        if (now && now !== snapSrc) return;
        const again = findPlay(root) || play;
        if (!again || controlShowsPause(again) || isPlayingBubble(scope)) return;
        // An icon-only triangle has no "play" label. A second click would pause
        // the note before the blob arrives, so only retry when it still says play.
        if (!controlLooksLikePlay(again)) return;
        log("retry play click", describeEl(again));
        realClick(again);
      }, 800);
      const blob = await waiter;
      log("extracted", blob.type || "unknown", blob.size, "bytes");
      const again = findPlay(root) || play;
      if (!wasPlayingThis && again && controlShowsPause(again)) {
        log("reset play icon");
        realClick(again);
      }
      return blob;
    } catch (err) {
      if (lastMediaForbidden) throw new Error("MEDIA_403");
      throw err;
    } finally {
      clearTimeout(retry);
      stopSilentGuard();
    }
  }

  function waitFor(pred, ms) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        let ok = false;
        try { ok = !!pred(); } catch (_) { ok = false; }
        if (ok || Date.now() - t0 >= ms) {
          resolve(ok);
          return;
        }
        setTimeout(tick, 40);
      };
      tick();
    });
  }

  function bindPlayback(el) {
    if (!el || el.__waTTime) return;
    el.__waTTime = true;
    const emit = () => emitPlayback();
    el.addEventListener("timeupdate", emit);
    el.addEventListener("play", emit);
    el.addEventListener("pause", emit);
    el.addEventListener("seeked", emit);
    el.addEventListener("ended", emit);
  }

  function playingMarker() {
    const wraps = deepAll(".wa-t-wrap");
    for (const wrap of wraps) {
      const root = (wrap.dataset && wrap.dataset.xRow && extractRoot(wrap)) || wrap.parentElement || wrap;
      const play = findPlay(root);
      if (play && controlShowsPause(play)) return wrap.dataset.waTId || "";
    }
    return "";
  }

  function playerEl() {
    const els = allAudio();
    return (
      els.find((a) => usableSrc(a) && !a.paused && !a.ended) ||
      [...els].reverse().find((a) => usableSrc(a)) ||
      null
    );
  }

  function pressAt(el, x, y) {
    if (!el) return;
    const base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 1,
    };
    try {
      el.dispatchEvent(new PointerEvent("pointerdown", base));
      el.dispatchEvent(new MouseEvent("mousedown", base));
      el.dispatchEvent(new PointerEvent("pointerup", { ...base, buttons: 0 }));
      el.dispatchEvent(new MouseEvent("mouseup", { ...base, buttons: 0 }));
      el.dispatchEvent(new MouseEvent("click", { ...base, buttons: 0 }));
    } catch (_) {
      /* ignore */
    }
  }

  // WhatsApp owns the waveform. Setting currentTime alone gets written back
  // from the slider, so also press the slider at that fraction.
  function seekSlider(root, seconds, duration) {
    if (!root || !root.querySelector || !(duration > 0.2) || seconds > duration + 0.25) return;
    const slider = root.querySelector('[role="slider"], input[type="range"]');
    if (!slider || isOurUi(slider)) {
      if (!onXHost()) return;
      const wave = root.querySelector('[data-testid="audio-waveform"]');
      if (!wave || isOurUi(wave)) return;
      const frac = Math.min(0.995, Math.max(0.004, seconds / duration));
      const rect = wave.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 2) return;
      const x = rect.left + frac * rect.width;
      const y = rect.top + rect.height / 2;
      pressAt(wave, x, y);
      let inner = null;
      try {
        inner = document.elementFromPoint(x, y);
      } catch (_) {
        inner = null;
      }
      if (inner && inner !== wave && wave.contains(inner) && !isOurUi(inner)) pressAt(inner, x, y);
      return;
    }
    const frac = Math.min(0.995, Math.max(0.004, seconds / duration));
    if (String(slider.tagName).toUpperCase() === "INPUT") {
      const min = Number(slider.min) || 0;
      const max = Number(slider.max) || 100;
      slider.value = String(min + frac * (max - min));
      try {
        slider.dispatchEvent(new Event("input", { bubbles: true }));
        slider.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (_) {
        /* ignore */
      }
    }
    const rect = slider.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 2) return;
    const x = rect.left + frac * rect.width;
    const y = rect.top + rect.height / 2;
    pressAt(slider, x, y);
    let inner = null;
    try {
      inner = document.elementFromPoint(x, y);
    } catch (_) {
      inner = null;
    }
    if (inner && inner !== slider && slider.contains(inner) && !isOurUi(inner)) pressAt(inner, x, y);
  }

  let seekingNow = false;

  function applySeekTime(seconds) {
    if (seekingNow) return null;
    const el = playerEl();
    if (!el) return null;
    seekingNow = true;
    try {
      if (Math.abs((el.currentTime || 0) - seconds) > 0.08) el.currentTime = seconds;
      if (el.paused || el.ended) {
        const pendingPlay = origPlay.call(el);
        if (pendingPlay && pendingPlay.catch) pendingPlay.catch(() => {});
        queueMicrotask(() => {
          try {
            if (Math.abs((el.currentTime || 0) - seconds) > 0.08) el.currentTime = seconds;
          } catch (_) {
            /* ignore */
          }
        });
      }
    } catch (err) {
      log("seek failed", err && err.message);
    } finally {
      seekingNow = false;
    }
    return el;
  }

  function seekStillBehind() {
    if (!seekStick || Date.now() > seekStick.until) {
      seekStick = null;
      return false;
    }
    const el = playerEl();
    const now = el ? el.currentTime || 0 : 0;
    if (el && now >= seekStick.time - 0.25) {
      seekStick = null;
      return false;
    }
    return true;
  }

  function holdSeek(seconds) {
    seekStick = { time: seconds, until: Date.now() + 700 };
    applySeekTime(seconds);
    for (const delay of [70, 200, 420]) {
      setTimeout(() => {
        if (seekStick && seekStick.time === seconds && seekStillBehind()) applySeekTime(seconds);
      }, delay);
    }
  }

  function emitPlayback() {
    if (silent) return;
    if (seekStillBehind()) applySeekTime(seekStick.time);
    let current = 0;
    let playing = false;
    for (const el of allAudio()) {
      if (!usableSrc(el) || el.paused || el.ended) continue;
      current = el.currentTime || 0;
      playing = true;
      break;
    }
    window.postMessage({
      source: SOURCE,
      type: "playback",
      currentTime: current,
      playing,
      marker: playing ? playingMarker() : "",
    }, "*");
  }

  function thisNotePlaying(root, play, marker) {
    const again = findPlay(root) || play;
    if (again && controlShowsPause(again)) return true;
    if (isPlayingBubble(root)) return true;
    return playingMarker() === marker;
  }

  async function seekNote(marker, time) {
    const seconds = Number(time);
    if (!marker || !(seconds >= 0)) return;
    const marked = markerNode(marker);
    if (!marked) return;
    const root = extractRoot(marked);
    if (!root) return;
    const play = findPlay(root);
    const already = thisNotePlaying(root, play, marker);
    if (!already && play) {
      const beforeSrc = liveSrc() || residentSrc();
      realClick(play);
      await waitFor(() => {
        if (thisNotePlaying(root, play, marker)) return true;
        const src = liveSrc();
        if (src && src !== beforeSrc) return true;
        const el = playerEl();
        return !!(el && !el.paused && !el.ended && src && !otherBubblePlaying(root));
      }, 2500);
    }
    const el = playerEl();
    const dur = el && Number.isFinite(el.duration) ? el.duration : 0;
    seekSlider(root, seconds, dur);
    holdSeek(seconds);
  }

  let extractChain = Promise.resolve();

  function postExtract(requestId, payload) {
    window.postMessage({ source: SOURCE, type: "extract-result", requestId, ...payload }, "*");
  }

  async function runExtract(data) {
    try {
      const blob = await extract(data.marker);
      const base64 = await blobToBase64(blob);
      postExtract(data.requestId, {
        ok: true,
        base64,
        mimeType: blob.type || "audio/ogg",
        byteLength: blob.size,
      });
    } catch (err) {
      log("extract failed", err && err.message);
      postExtract(data.requestId, {
        ok: false,
        error: String(err && err.message ? err.message : err),
      });
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== SOURCE) return;
    if (data.type === "seek") {
      seekNote(data.marker, data.time);
      return;
    }
    if (data.type !== "extract") return;
    const run = extractChain.then(() => runExtract(data), () => runExtract(data));
    extractChain = run.then(
      () => {},
      () => {}
    );
  });

  document.documentElement.setAttribute("data-wa-t-hook", "1");
  log("page hook ready");
  }

  function onXHost() {
    return onXDocument();
  }

  function onChatPath() {
    return /^\/(i\/chat|messages|chat)(\/|$)/.test(String((location && location.pathname) || ""));
  }

  function chatDom() {
    if (!document.querySelector) return false;
    return !!deepQuery(
      "[data-dm-message-row], [data-testid='audio-waveform'], [data-testid='dm-message-list'], [data-testid='dm-container']"
    );
  }

  // WhatsApp and an X messages URL hook immediately. A chat panel on another
  // x.com page waits until the voice list exists, so the home timeline is left alone.
  if (!onXHost() || onChatPath()) {
    bootHook();
  } else {
    let obs = null;
    const kick = () => {
      if (document.documentElement && document.documentElement.getAttribute("data-wa-t-hook")) {
        if (obs) obs.disconnect();
        return;
      }
      if (!chatDom()) return;
      if (obs) obs.disconnect();
      bootHook();
    };
    const watch = () => {
      kick();
      if (document.documentElement && document.documentElement.getAttribute("data-wa-t-hook")) return;
      obs = new MutationObserver(kick);
      obs.observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch, { once: true });
    else watch();
  }
})();
