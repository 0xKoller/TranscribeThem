// A small fake DOM and fake chrome API, enough to run the content scripts in a
// node vm context. Not a browser: layout is all zeros and selectors are simple
// compounds (tag, #id, .class, [attr], [attr="v"], [attr*="v"]) joined by commas.
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromeI18n } from "./i18n-chrome.mjs";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function parseCompound(sel) {
  const s = sel.trim();
  if (!s || /[\s>+~:]/.test(s.replace(/\[[^\]]*\]/g, ""))) return null;
  const out = { tag: "", id: "", classes: [], attrs: [] };
  const re = /^([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:(\*?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*)))?(?:\s+i)?\]/y;
  let at = 0;
  while (at < s.length) {
    re.lastIndex = at;
    const m = re.exec(s);
    if (!m) return null;
    if (m[1]) out.tag = m[1].toUpperCase();
    else if (m[2]) out.id = m[2];
    else if (m[3]) out.classes.push(m[3]);
    else out.attrs.push({ name: m[4], op: m[5] || "", value: m[6] ?? m[7] ?? m[8] ?? "", ci: /\si\]$/.test(m[0]) });
    at = re.lastIndex;
  }
  return out;
}

function splitList(selector) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of String(selector)) {
    if (ch === "[") depth += 1;
    if (ch === "]") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  return parts.map(parseCompound).filter(Boolean);
}

function matchesCompound(el, c) {
  if (c.tag && el.tagName !== c.tag) return false;
  if (c.id && el.id !== c.id) return false;
  for (const cls of c.classes) if (!el.classList.contains(cls)) return false;
  for (const a of c.attrs) {
    if (!el.hasAttribute(a.name)) return false;
    if (!a.op) continue;
    let have = String(el.getAttribute(a.name));
    let want = a.value;
    if (a.ci) {
      have = have.toLowerCase();
      want = want.toLowerCase();
    }
    if (a.op === "=" && have !== want) return false;
    if (a.op === "*=" && !have.includes(want)) return false;
  }
  return true;
}

const kebab = (name) => "data-" + String(name).replace(/[A-Z]/g, (ch) => "-" + ch.toLowerCase());

export function makeDom() {
  let documentElement = null;

  class FakeText {
    constructor(text) {
      this.nodeType = 3;
      this.textContent = String(text);
      this.parentElement = null;
    }
    remove() {
      if (this.parentElement) this.parentElement._drop(this);
    }
  }

  class FakeElement {
    constructor(tag) {
      this.nodeType = 1;
      this.tagName = String(tag).toUpperCase();
      this.childNodes = [];
      this.parentElement = null;
      this._attrs = new Map();
      this._listeners = new Map();
      this._classes = new Set();
      this.style = {
        setProperty(name, value) {
          this[name] = value;
        },
      };
      this.hidden = false;
      this.disabled = false;
      const el = this;
      this.classList = {
        add: (...names) => names.forEach((n) => el._classes.add(n)),
        remove: (...names) => names.forEach((n) => el._classes.delete(n)),
        contains: (name) => el._classes.has(name),
        toggle(name, force) {
          const on = force === undefined ? !el._classes.has(name) : !!force;
          if (on) el._classes.add(name);
          else el._classes.delete(name);
          return on;
        },
      };
      this.dataset = new Proxy(
        {},
        {
          get: (_t, name) => (typeof name === "string" && el._attrs.has(kebab(name)) ? el._attrs.get(kebab(name)) : undefined),
          set: (_t, name, value) => {
            el._attrs.set(kebab(name), String(value));
            return true;
          },
          deleteProperty: (_t, name) => {
            el._attrs.delete(kebab(name));
            return true;
          },
          has: (_t, name) => el._attrs.has(kebab(name)),
        }
      );
    }
    get className() {
      return [...this._classes].join(" ");
    }
    set className(value) {
      this._classes = new Set(String(value).split(/\s+/).filter(Boolean));
    }
    get id() {
      return this._attrs.get("id") || "";
    }
    set id(value) {
      this._attrs.set("id", String(value));
    }
    get children() {
      return this.childNodes.filter((n) => n.nodeType === 1);
    }
    get childElementCount() {
      return this.children.length;
    }
    get firstElementChild() {
      return this.children[0] || null;
    }
    get lastElementChild() {
      const kids = this.children;
      return kids[kids.length - 1] || null;
    }
    _sibling(step, elementsOnly) {
      const list = this.parentElement ? (elementsOnly ? this.parentElement.children : this.parentElement.childNodes) : [];
      const at = list.indexOf(this);
      return at < 0 ? null : list[at + step] || null;
    }
    get nextSibling() {
      return this._sibling(1, false);
    }
    get previousSibling() {
      return this._sibling(-1, false);
    }
    get nextElementSibling() {
      return this._sibling(1, true);
    }
    get previousElementSibling() {
      return this._sibling(-1, true);
    }
    get isConnected() {
      let n = this;
      while (n) {
        if (n === documentElement) return true;
        n = n.parentElement;
      }
      return false;
    }
    get textContent() {
      return this.childNodes.map((n) => n.textContent).join("");
    }
    set textContent(value) {
      this.replaceChildren();
      if (value !== "" && value != null) this.append(String(value));
    }
    get scrollHeight() {
      return 0;
    }
    getRootNode() {
      let n = this;
      while (n.parentElement) n = n.parentElement;
      return n;
    }
    getAttribute(name) {
      if (name === "class") return this.className;
      return this._attrs.has(name) ? this._attrs.get(name) : null;
    }
    setAttribute(name, value) {
      if (name === "class") this.className = value;
      else this._attrs.set(name, String(value));
    }
    hasAttribute(name) {
      return name === "class" ? this._classes.size > 0 : this._attrs.has(name);
    }
    removeAttribute(name) {
      this._attrs.delete(name);
    }
    _drop(node) {
      const at = this.childNodes.indexOf(node);
      if (at >= 0) this.childNodes.splice(at, 1);
      node.parentElement = null;
    }
    _adopt(node) {
      const item = node && node.nodeType ? node : new FakeText(node);
      if (item.parentElement) item.parentElement._drop(item);
      item.parentElement = this;
      return item;
    }
    append(...nodes) {
      for (const node of nodes) this.childNodes.push(this._adopt(node));
    }
    appendChild(node) {
      this.append(node);
      return node;
    }
    prepend(...nodes) {
      const items = nodes.map((n) => this._adopt(n));
      this.childNodes.unshift(...items);
    }
    insertBefore(node, ref) {
      if (!ref) return this.appendChild(node);
      const item = this._adopt(node);
      const at = this.childNodes.indexOf(ref);
      if (at < 0) throw new Error("insertBefore: reference is not a child");
      this.childNodes.splice(at, 0, item);
      return node;
    }
    replaceChild(node, old) {
      this.insertBefore(node, old);
      this._drop(old);
      return old;
    }
    replaceChildren(...nodes) {
      for (const child of [...this.childNodes]) this._drop(child);
      this.append(...nodes);
    }
    remove() {
      if (this.parentElement) this.parentElement._drop(this);
    }
    contains(node) {
      let n = node;
      while (n) {
        if (n === this) return true;
        n = n.parentElement;
      }
      return false;
    }
    matches(selector) {
      return splitList(selector).some((c) => matchesCompound(this, c));
    }
    closest(selector) {
      let n = this;
      while (n) {
        if (n.matches(selector)) return n;
        n = n.parentElement;
      }
      return null;
    }
    querySelectorAll(selector) {
      const list = splitList(selector);
      const out = [];
      const walk = (el) => {
        for (const child of el.children) {
          if (list.some((c) => matchesCompound(child, c))) out.push(child);
          walk(child);
        }
      };
      walk(this);
      return out;
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, []);
      this._listeners.get(type).push(fn);
    }
    removeEventListener(type, fn) {
      const list = this._listeners.get(type) || [];
      const at = list.indexOf(fn);
      if (at >= 0) list.splice(at, 1);
    }
    // Test helper: run this element's own listeners (no bubbling).
    fire(type, extra) {
      const ev = Object.assign({ type, target: this, preventDefault() {}, stopPropagation() {} }, extra || {});
      for (const fn of [...(this._listeners.get(type) || [])]) fn(ev);
    }
    getBoundingClientRect() {
      return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
    }
    click() {
      this.fire("click");
    }
  }

  documentElement = new FakeElement("html");
  const body = new FakeElement("body");
  documentElement.append(body);
  const listeners = new Map();
  const document = {
    nodeType: 9,
    readyState: "complete",
    documentElement,
    body,
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    createTextNode: (text) => new FakeText(text),
    getElementById: (id) => documentElement.querySelector("#" + id),
    querySelector: (sel) => documentElement.querySelector(sel),
    querySelectorAll: (sel) => documentElement.querySelectorAll(sel),
    addEventListener(type, fn) {
      listeners.set(type, (listeners.get(type) || []).concat(fn));
    },
  };
  return { document, FakeElement };
}

// One manifest content_scripts entry, by the host of its first match pattern.
export function manifestEntry(host) {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  const entry = manifest.content_scripts.find(
    (item) => item.world !== "MAIN" && item.matches.some((pattern) => pattern.includes("://" + host + "/"))
  );
  if (!entry) throw new Error("no isolated-world content script entry for " + host);
  return entry.js;
}

// A vm context that looks like a tab on `href`, with the scripts of `files`
// evaluated in order (the way Chrome runs one content_scripts entry).
export function loadContentScripts(files, href, options = {}) {
  const { document, FakeElement } = makeDom();
  const url = new URL(href);
  const logs = [];
  const timers = [];
  const store = Object.assign({}, options.storage);
  const storageListeners = [];
  const runtimeListeners = [];
  const sent = [];
  const observers = [];
  const windowListeners = [];
  const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

  class FakeIntersectionObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Set();
      observers.push(this);
    }
    observe(target) {
      this.targets.add(target);
    }
    unobserve(target) {
      this.targets.delete(target);
    }
    disconnect() {
      this.targets.clear();
      this.dead = true;
    }
  }
  class FakeMutationObserver {
    observe() {}
    disconnect() {}
  }

  const chrome = {
    i18n: chromeI18n("es"),
    runtime: {
      id: "test-extension",
      lastError: undefined,
      getManifest: () => ({ version: "0.0.0" }),
      onMessage: { addListener: (fn) => runtimeListeners.push(fn) },
      // options.respond(message) returns the reply, or undefined for none.
      sendMessage(message, callback) {
        sent.push(message);
        const reply = options.respond ? options.respond(message) : undefined;
        if (callback) Promise.resolve().then(() => callback(reply));
        return Promise.resolve(reply);
      },
    },
    storage: {
      local: {
        async get(keys) {
          const names = keys == null ? Object.keys(store) : [].concat(keys);
          const out = {};
          for (const name of names) if (name in store) out[name] = clone(store[name]);
          return out;
        },
        async set(partial) {
          const changes = {};
          for (const [name, value] of Object.entries(partial)) {
            if (JSON.stringify(store[name]) === JSON.stringify(value)) continue;
            changes[name] = { oldValue: clone(store[name]), newValue: clone(value) };
            store[name] = clone(value);
          }
          if (Object.keys(changes).length) for (const fn of storageListeners) fn(changes, "local");
        },
      },
      onChanged: { addListener: (fn) => storageListeners.push(fn) },
    },
  };

  const window = {
    addEventListener: (type, fn) => windowListeners.push({ type, fn }),
    removeEventListener() {},
    postMessage() {},
  };
  window.top = window;

  const sandbox = {
    document,
    window,
    chrome,
    location: { href: url.href, hostname: url.hostname, origin: url.origin, protocol: url.protocol, pathname: url.pathname },
    navigator: { clipboard: { writeText: async () => {} } },
    console: {
      log: (...args) => logs.push(args.map((a) => (a && a.stack) || String(a)).join(" ")),
      warn: (...args) => logs.push(args.map((a) => (a && a.stack) || String(a)).join(" ")),
      error: (...args) => logs.push(args.map((a) => (a && a.stack) || String(a)).join(" ")),
    },
    // Timers are held until the test runs them.
    setTimeout(fn, ms) {
      timers.push({ fn, ms: ms || 0 });
      return timers.length;
    },
    clearTimeout(id) {
      if (id > 0 && timers[id - 1]) timers[id - 1].fn = null;
    },
    setInterval: () => 0,
    clearInterval() {},
    requestAnimationFrame(fn) {
      timers.push({ fn, ms: 0 });
      return timers.length;
    },
    getComputedStyle: () => ({ display: "block", position: "static", flexDirection: "row" }),
    MutationObserver: FakeMutationObserver,
    IntersectionObserver: FakeIntersectionObserver,
    CSS: { escape: (value) => String(value) },
    URL,
  };
  const ctx = createContext(sandbox);
  ctx.globalThis = ctx;
  for (const file of files) {
    runInContext(readFileSync(join(root, file), "utf8"), ctx, { filename: file });
  }
  return {
    ctx,
    document,
    FakeElement,
    chrome,
    store,
    logs,
    sent,
    observers,
    // Evaluate an expression in the content scripts' global scope (reaches
    // top-level let/const, which are not properties of the global object).
    evaluate: (code) => runInContext(code, ctx),
    deliver: (message) => runtimeListeners.forEach((fn) => fn(message)),
    // Run held timers no longer than maxMs. Timers they start run too.
    runTimers(maxMs = 1000) {
      for (let i = 0; i < timers.length; i++) {
        const timer = timers[i];
        if (!timer.fn || timer.ms > maxMs) continue;
        const fn = timer.fn;
        timer.fn = null;
        fn();
      }
    },
    settle: async () => {
      for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve));
    },
  };
}
