/* X message voice notes. Classic script, loaded before content-core.js. */
(function (g) {
  const COMPOSER_IDS = {
    "dm-composer-form": 1,
    "dm-composer-container": 1,
    "dm-composer-textarea": 1,
    "dm-composer-input-container": 1,
    dmComposerTextInput: 1,
    dmComposerSendButton: 1,
    voiceMessageButton: 1,
    voiceMessageStop: 1,
    voiceMessageSend: 1,
  };
  const STOP_IDS = {
    "dm-message-list": 1,
    "dm-message-list-container": 1,
    "dm-conversation-panel": 1,
    "dm-conversation-content": 1,
    "dm-container": 1,
  };

  const RECORD_RE =
    /record|grabar|enviar (?:un |el )?mensaje de voz|send voice|stop recording|detener grab|cancelar grab|discard recording|voiceMessage(?:Button|Stop|Send)/i;
  const VOICE_RE = /mensaje de voz|nota de voz|voice message|voice note|audio message/i;
  const PLAY_RE = /\b(play|pause|reproducir|pausar|escuchar)\b/i;
  const VIDEO_RE = /\b(video|gif|foto|photo|image|imagen)\b/i;
  const TIME_RE = /\b\d{1,2}:\d{2}\b/;

  function attr(el, name) {
    if (!el || typeof el.getAttribute !== "function") return "";
    return el.getAttribute(name) || "";
  }

  function tag(el) {
    return String((el && el.tagName) || "").toUpperCase();
  }

  function testId(el) {
    return attr(el, "data-testid");
  }

  function hasClass(el, name) {
    if (!el) return false;
    if (el.classList && typeof el.classList.contains === "function") {
      try {
        if (el.classList.contains(name)) return true;
      } catch (_) {
        /* ignore */
      }
    }
    return String(el.className || "")
      .split(/\s+/)
      .includes(name);
  }

  function parentEl(n) {
    if (!n) return null;
    if (n.parentElement) return n.parentElement;
    try {
      const root = typeof n.getRootNode === "function" ? n.getRootNode() : null;
      if (root && root.host && root.host !== n) return root.host;
    } catch (_) {
      /* stay in this tree */
    }
    return null;
  }

  function isOurUi(el) {
    let n = el;
    while (n) {
      if (
        hasClass(n, "wa-t-wrap") ||
        hasClass(n, "wa-t-foot") ||
        hasClass(n, "wa-t-x-tools") ||
        hasClass(n, "wa-t-btn")
      ) {
        return true;
      }
      n = parentEl(n);
    }
    return false;
  }

  function inboxId(id) {
    return id === "dm-inbox-panel" || id.startsWith("dm-conversation-item-") || id.startsWith("dm-message-request-item-");
  }

  function ancestorKind(el) {
    let n = el;
    while (n) {
      const id = testId(n);
      if (COMPOSER_IDS[id]) return "composer";
      if (inboxId(id)) return "inbox";
      n = parentEl(n);
    }
    return "";
  }

  function isMessageTestId(id) {
    if (!id) return false;
    if (id === "messageEntry") return true;
    return id.startsWith("message-") && !id.startsWith("message-text-");
  }

  function eachDesc(el, visit) {
    const kids = el && el.children;
    if (kids) {
      for (const child of kids) {
        visit(child);
        eachDesc(child, visit);
      }
    }
    // X Chat renders the message list inside an open shadow root.
    const shadow = el && el.shadowRoot;
    if (shadow) eachDesc(shadow, visit);
  }

  function labelOf(el) {
    return `${attr(el, "aria-label")} ${attr(el, "title")} ${testId(el)}`.trim();
  }

  function isVoiceControl(el) {
    if (!el || isOurUi(el)) return false;
    if (tag(el) === "AUDIO") return true;
    if (tag(el) === "VIDEO") return false;
    const t = tag(el);
    if (t !== "BUTTON" && attr(el, "role") !== "button") return false;
    const label = labelOf(el);
    if (VIDEO_RE.test(label) && !VOICE_RE.test(label)) return false;
    if (RECORD_RE.test(label) && !PLAY_RE.test(label)) return false;
    if (VOICE_RE.test(label) || PLAY_RE.test(label)) return true;
    if (/icon-play|icon-pause/i.test(attr(el, "data-icon"))) return true;
    let icon = false;
    eachDesc(el, (child) => {
      if (/icon-play|icon-pause/i.test(attr(child, "data-icon"))) icon = true;
    });
    if (icon) return true;
    return /voice|audio|ptt/i.test(testId(el));
  }

  function voiceControls(el) {
    const out = [];
    if (isVoiceControl(el)) out.push(el);
    eachDesc(el, (child) => {
      if (isVoiceControl(child)) out.push(child);
    });
    return out;
  }

  function hasMedia(el, kind) {
    if (tag(el) === kind) return true;
    let found = false;
    eachDesc(el, (child) => {
      if (found) return;
      if (tag(child) === kind) found = true;
      if (kind === "VIDEO" && /video/i.test(testId(child))) found = true;
    });
    return found;
  }

  function textIsMostlyDuration(text) {
    const t = String(text || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!t || t.length > 32) return false;
    return TIME_RE.test(t);
  }

  function classifyXSnapshot(s) {
    if (!s || s.inComposer || s.inInbox) return false;
    if (s.hasVideo && !s.voiceLabel) return false;
    const labels = (s.labels || []).join(" \n ");
    const ids = s.testIds || [];
    if (ids.some((id) => COMPOSER_IDS[id] || /voiceMessage(?:Button|Stop|Send)/i.test(id))) return false;
    if (VIDEO_RE.test(labels) && !VOICE_RE.test(labels)) return false;
    if (RECORD_RE.test(labels) && !PLAY_RE.test(labels) && !s.hasAudio) return false;
    if (s.hasAudio && !s.hasVideo) return true;
    if (ids.some((id) => /voice|audio|ptt/i.test(id) && !/video/i.test(id) && !COMPOSER_IDS[id])) return true;
    const voice = VOICE_RE.test(labels);
    const play = PLAY_RE.test(labels);
    const timed = textIsMostlyDuration(s.text);
    if (voice && (play || timed)) return true;
    if (play && timed && !s.hasVideo) return true;
    return false;
  }

  function snapshotFromElement(el) {
    const labels = [];
    const testIds = [];
    const push = (node) => {
      const label = `${attr(node, "aria-label")} ${attr(node, "title")}`.trim();
      if (label) labels.push(label);
      const id = testId(node);
      if (id) testIds.push(id);
    };
    push(el);
    eachDesc(el, push);
    const kind = ancestorKind(el);
    return {
      inComposer: kind === "composer",
      inInbox: kind === "inbox",
      hasAudio: hasMedia(el, "AUDIO"),
      hasVideo: hasMedia(el, "VIDEO"),
      voiceLabel: labels.some((label) => VOICE_RE.test(label)),
      labels,
      testIds,
      text: (el && el.textContent) || "",
    };
  }

  function isXVoiceMessage(el) {
    if (!el || el.nodeType !== 1 || isOurUi(el)) return false;
    const kind = ancestorKind(el);
    if (kind === "composer" || kind === "inbox") return false;
    if (voiceControls(el).length > 1) return false;
    return classifyXSnapshot(snapshotFromElement(el));
  }

  function containsEl(a, b) {
    if (!a || !b || a === b) return false;
    if (typeof a.contains === "function") {
      try {
        return a.contains(b);
      } catch (_) {
        /* walk */
      }
    }
    let n = parentEl(b);
    while (n) {
      if (n === a) return true;
      n = parentEl(n);
    }
    return false;
  }

  function boundary(el) {
    const body = typeof document !== "undefined" ? document.body : null;
    const root = typeof document !== "undefined" ? document.documentElement : null;
    return !el || el === body || el === root;
  }

  function climbVoice(control) {
    if (!control || isOurUi(control)) return null;
    const kind = ancestorKind(control);
    if (kind === "composer" || kind === "inbox") return null;
    let n = control.nodeType === 1 ? control : parentEl(control);
    let best = null;
    for (let i = 0; i < 18 && n && !boundary(n); i++) {
      if (STOP_IDS[testId(n)]) break;
      if (isXVoiceMessage(n)) best = n;
      n = parentEl(n);
    }
    return best;
  }

  function messageHostFrom(node) {
    let n = node;
    for (let i = 0; i < 24 && n && !boundary(n); i++) {
      if (STOP_IDS[testId(n)]) break;
      if (isMessageTestId(testId(n))) return n;
      n = parentEl(n);
    }
    return climbVoice(node);
  }

  function dedupeHosts(list) {
    const uniq = [];
    for (const el of list) {
      if (el && !uniq.includes(el)) uniq.push(el);
    }
    return uniq.filter((a) => !uniq.some((b) => containsEl(a, b)));
  }

  function findVoiceHosts(root) {
    const scope = root && (root.children || root.nodeType === 1) ? root : typeof document !== "undefined" ? document : null;
    if (!scope) return [];
    const fromWave = [];
    const takeWave = (el) => {
      if (!el || testId(el) !== "audio-waveform" || isOurUi(el)) return;
      const host = messageHostFrom(el);
      if (host && !isOurUi(host)) fromWave.push(host);
    };
    if (typeof scope.querySelectorAll === "function") {
      try {
        scope.querySelectorAll("[data-testid='audio-waveform']").forEach(takeWave);
      } catch (_) {
        /* walk */
      }
    }
    // querySelectorAll stays in the light tree. The shadow walk still runs when
    // that list is empty, which is the X Chat case.
    if (!fromWave.length) {
      if (scope.nodeType === 1) takeWave(scope);
      eachDesc(scope, takeWave);
    } else {
      const seenShadow = new Set();
      const enter = (el) => {
        const shadow = el && el.shadowRoot;
        if (!shadow || seenShadow.has(shadow)) return;
        seenShadow.add(shadow);
        eachDesc(shadow, (node) => {
          takeWave(node);
          enter(node);
        });
      };
      enter(scope);
      eachDesc(scope, enter);
    }
    if (fromWave.length) return dedupeHosts(fromWave);
    const tagged = [];
    const considerTagged = (el) => {
      if (el && el.nodeType === 1 && isMessageTestId(testId(el)) && isXVoiceMessage(el)) tagged.push(el);
    };
    if (scope.nodeType === 1) considerTagged(scope);
    eachDesc(scope, considerTagged);
    const pool = tagged.slice();
    if (!pool.length) {
      const grab = (el) => {
        if (tag(el) === "AUDIO" || tag(el) === "BUTTON" || attr(el, "role") === "button") {
          const host = climbVoice(el);
          if (host) pool.push(host);
        }
      };
      if (scope.nodeType === 1) grab(scope);
      eachDesc(scope, grab);
    }
    return dedupeHosts(pool);
  }

  function hasSvg(el) {
    if (!el) return false;
    if (tag(el) === "SVG") return true;
    if (typeof el.querySelector === "function") {
      try {
        if (el.querySelector("svg")) return true;
      } catch (_) {
        /* walk */
      }
    }
    let found = false;
    eachDesc(el, (child) => {
      if (tag(child) === "SVG") found = true;
    });
    return found;
  }

  function xPlayControl(el) {
    if (!el) return null;
    const controls = voiceControls(el).filter((c) => tag(c) !== "AUDIO");
    if (controls.length === 1) return controls[0];
    if (controls.length > 1) {
      const play = controls.find((c) => PLAY_RE.test(labelOf(c)) && !/pause|pausar/i.test(labelOf(c)));
      return play || controls[0];
    }
    const buttons = [];
    const grab = (node) => {
      if (isOurUi(node)) return;
      if (tag(node) === "BUTTON" || attr(node, "role") === "button") buttons.push(node);
    };
    grab(el);
    eachDesc(el, grab);
    const icons = buttons.filter((b) => {
      const label = labelOf(b);
      if (RECORD_RE.test(label)) return false;
      if (VIDEO_RE.test(label) && !VOICE_RE.test(label)) return false;
      return hasSvg(b);
    });
    return icons.length === 1 ? icons[0] : null;
  }

  // Reply, download, and more. Localized labels and icon names both count.
  const ACTION_RE =
    /reply|responder|respond[eé]|download|descargar|guardar|\bsave\b|\bmore\b|m[aá]s|ellipsis|opciones|\boptions\b|forward|reenviar|\breact\b|reacci[oó]n|compartir|\bshare\b|\blike\b|gusta|heart|favorit|icon-reply|icon-download|icon-ellipsis|icon-more|icon-share|icon-forward|icon-heart|icon-like/i;

  function iconBlob(el) {
    let blob = attr(el, "data-icon");
    eachDesc(el, (child) => {
      const icon = attr(child, "data-icon");
      if (icon) blob += " " + icon;
    });
    return blob;
  }

  function isXActionButton(el) {
    if (!el || isOurUi(el) || isVoiceControl(el)) return false;
    const kind = tag(el);
    if (kind !== "BUTTON" && attr(el, "role") !== "button") return false;
    const blob = `${labelOf(el)} ${iconBlob(el)}`;
    if (RECORD_RE.test(blob)) return false;
    return ACTION_RE.test(blob);
  }

  function isXBarIcon(el) {
    if (!el || isOurUi(el) || isVoiceControl(el)) return false;
    const kind = tag(el);
    if (kind !== "BUTTON" && attr(el, "role") !== "button") return false;
    if (RECORD_RE.test(labelOf(el))) return false;
    return hasSvg(el);
  }

  function withinNode(node, ancestor) {
    let n = node;
    while (n) {
      if (n === ancestor) return true;
      n = parentEl(n);
    }
    return false;
  }

  function barsFrom(buttons) {
    const bars = [];
    const seen = new Set();
    for (const btn of buttons) {
      let n = parentEl(btn);
      for (let i = 0; i < 8 && n; i++) {
        let count = 0;
        for (const other of buttons) if (withinNode(other, n)) count++;
        if (count >= 2) {
          if (!seen.has(n)) {
            seen.add(n);
            bars.push(n);
          }
          break;
        }
        n = parentEl(n);
      }
    }
    return bars;
  }

  // One bounded pass. Walking every X node on each mutation freezes the tab.
  // `budget` counts elements. Shadows that contain a note are returned so the
  // caller can observe those roots only.
  function xDiscoverWaves(root, budget) {
    const cap = budget > 0 ? budget : 800;
    const hosts = [];
    const shadows = [];
    const seenHost = new Set();
    const seenShadow = new Set();
    const entered = new Set();
    let visited = 0;
    let truncated = false;
    const stack = [{ node: root, shadow: null }];

    const addHost = (host, shadow) => {
      if (!host || isOurUi(host) || seenHost.has(host)) return;
      seenHost.add(host);
      hosts.push(host);
      if (shadow && !seenShadow.has(shadow)) {
        seenShadow.add(shadow);
        shadows.push(shadow);
      }
    };

    const addWave = (el, shadow) => {
      if (!el || testId(el) !== "audio-waveform" || isOurUi(el)) return;
      addHost(messageHostFrom(el), shadow);
    };

    while (stack.length) {
      const frame = stack.pop();
      const el = frame && frame.node;
      if (!el) continue;
      const shadow = frame.shadow;
      const isFrag = el.nodeType === 11;
      if (!isFrag && el.nodeType === 1) {
        if (visited >= cap) {
          truncated = true;
          break;
        }
        visited += 1;
        addWave(el, shadow);
      }
      const scope = isFrag ? el : el;
      if ((isFrag || el === root) && scope && typeof scope.querySelectorAll === "function") {
        let list = null;
        try {
          list = scope.querySelectorAll("[data-testid='audio-waveform']");
        } catch (_) {
          list = null;
        }
        if (list) for (const wave of list) addWave(wave, isFrag ? el : shadow);
      }
      const nested = !isFrag && el.shadowRoot;
      if (nested && !entered.has(nested)) {
        entered.add(nested);
        let known = false;
        let chat = false;
        if (typeof nested.querySelector === "function") {
          known = true;
          try {
            chat = !!nested.querySelector(
              "[data-testid='audio-waveform'], [data-dm-message-row], [data-testid^='message-']"
            );
          } catch (_) {
            chat = false;
          }
        }
        // A timeline shadow is not the chat. Walking it burns the budget and,
        // if observed, freezes X on every React commit.
        if (!(known && !chat)) {
          if (chat && !seenShadow.has(nested)) {
            seenShadow.add(nested);
            shadows.push(nested);
          }
          stack.push({ node: nested, shadow: nested });
        }
      }
      const kids = el.children;
      if (!kids || !kids.length) continue;
      const later = [];
      const first = [];
      for (let i = 0; i < kids.length; i++) {
        const kid = kids[i];
        if (kid && kid.shadowRoot) first.push(kid);
        else later.push(kid);
      }
      for (let i = later.length - 1; i >= 0; i--) stack.push({ node: later[i], shadow });
      for (let i = first.length - 1; i >= 0; i--) stack.push({ node: first[i], shadow });
    }

    return { hosts, shadows, visited, truncated };
  }

  // The hover toolbar next to a message. Not the message itself, and not Play.
  function xActionBars(root) {
    if (!root) return [];
    const labeled = [];
    const icons = [];
    const take = (node) => {
      if (isXActionButton(node)) labeled.push(node);
      else if (isXBarIcon(node)) icons.push(node);
    };
    take(root);
    eachDesc(root, take);
    const labeledBars = barsFrom(labeled);
    if (labeledBars.length) return labeledBars;
    return barsFrom(icons);
  }

  g.WaXFind = {
    classifyXSnapshot,
    isXVoiceMessage,
    findVoiceHosts,
    xDiscoverWaves,
    xPlayControl,
    xActionBars,
    textIsMostlyDuration,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
