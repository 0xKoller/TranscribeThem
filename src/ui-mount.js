/* Where the note's buttons go. Classic script, before content.js. */
(function (g) {
  function isSlider(node) {
    if (!node) return false;
    if (node.slider) return true;
    try {
      if (typeof node.matches === "function" && node.matches('[role="slider"], input[type="range"]')) return true;
    } catch (_) {
      /* ignore */
    }
    return false;
  }

  function eachChild(node, visit) {
    const kids = node && node.children;
    if (!kids) return;
    for (const child of kids) visit(child);
  }

  function findDesc(node, pred) {
    let found = null;
    eachChild(node, (child) => {
      if (found) return;
      if (pred(child)) {
        found = child;
        return;
      }
      found = findDesc(child, pred);
    });
    return found;
  }

  function sliderCount(node) {
    if (!node) return 0;
    if (typeof node.querySelectorAll === "function") {
      try {
        return node.querySelectorAll('[role="slider"], input[type="range"]').length;
      } catch (_) {
        /* walk */
      }
    }
    let n = 0;
    const walk = (el) => {
      if (!el) return;
      if (el.slider) n += 1;
      eachChild(el, walk);
    };
    walk(node);
    return n;
  }

  function looksLikeSpeed(node) {
    if (!node) return false;
    if (node.speed) return true;
    let label = node.textContent || "";
    if (typeof node.getAttribute === "function") {
      label += ` ${node.getAttribute("aria-label") || ""} ${node.getAttribute("data-icon") || ""}`;
    }
    return /(?:^|\s)(?:1|1\.5|2)(?:\.0)?\s*[x×]|velocidad|playback speed/i.test(label);
  }

  function findSlider(playEl, shell) {
    let n = playEl || null;
    while (n) {
      if (isSlider(n)) return n;
      const found = findDesc(n, isSlider);
      if (found) return found;
      if (n === shell) break;
      n = n.parentElement || null;
    }
    return shell ? findDesc(shell, isSlider) : null;
  }

  // The speed chip is centered on the row that holds it. That row is the one
  // the transcript must not grow. Nearest flex row that contains the chip.
  function findSpeedRow(playEl, shell, flex) {
    const slider = findSlider(playEl, shell);
    if (!slider) return null;
    const body = typeof document !== "undefined" && document.body ? document.body : null;
    let n = slider.parentElement || null;
    for (let i = 0; i < 12 && n; i++) {
      if (body && n === body) break;
      if (sliderCount(n) > 1) break;
      if (flex(n) && findDesc(n, looksLikeSpeed)) return n;
      n = n.parentElement || null;
    }
    return null;
  }

  function chooseMount(playEl, shell, isFlexRow) {
    const flex = typeof isFlexRow === "function" ? isFlexRow : function () { return false; };
    const speedRow = findSpeedRow(playEl, shell, flex);
    if (speedRow && speedRow.parentElement && sliderCount(speedRow.parentElement) === 1) {
      const parent = speedRow.parentElement;
      return {
        parent: parent,
        before: speedRow.nextSibling || null,
        bubble: parent,
        player: speedRow,
        inRow: flex(parent),
      };
    }

    // The play row is a horizontal flex. Putting our block inside it parks the
    // triangle and the speed chip on either side of the transcript. Mount outside
    // that row, as the next sibling of the colored bubble when we can.
    let player = null;
    let n = playEl || null;
    while (n && n !== shell) {
      if (flex(n)) {
        player = n;
        break;
      }
      n = n.parentElement || null;
    }
    if (!player) {
      const parent = (playEl && playEl.parentElement) || shell || playEl;
      return { parent: parent, before: null, bubble: parent, player: null, inRow: !!(parent && flex(parent)) };
    }
    const bubble = player.parentElement || player;
    const outside = bubble.parentElement || null;
    const outsideOk = !!(
      outside &&
      (!shell || outside === shell || (typeof shell.contains === "function" && shell.contains(outside)))
    );
    if (outsideOk && !flex(bubble)) {
      return {
        parent: outside,
        before: bubble.nextSibling || null,
        bubble: bubble,
        player: player,
        inRow: flex(outside),
      };
    }
    return {
      parent: bubble,
      before: null,
      bubble: bubble,
      player: player,
      inRow: flex(bubble),
    };
  }

  g.WaUiMount = { chooseMount: chooseMount };
})(typeof globalThis !== "undefined" ? globalThis : this);
