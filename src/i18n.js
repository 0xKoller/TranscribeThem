/* TranscribeThem strings. Classic script.
   chrome.i18n.getMessage works in extension pages and content scripts.
   The service worker and the offscreen document await waI18nInit() and then
   use the same waT() against the packaged messages.json for the UI language. */

function waActiveLocale(lang) {
  const code = String(lang || "").toLowerCase().replace(/_/g, "-");
  return code.startsWith("es") ? "es" : "en";
}

function waUiLanguage() {
  try {
    if (typeof chrome !== "undefined" && chrome.i18n && typeof chrome.i18n.getUILanguage === "function") {
      return chrome.i18n.getUILanguage();
    }
  } catch (_) {}
  try {
    if (typeof navigator !== "undefined" && navigator.language) return navigator.language;
  } catch (_) {}
  return "en";
}

function waSubsList(substitutions) {
  if (substitutions == null) return [];
  const list = Array.isArray(substitutions) ? substitutions : [substitutions];
  return list.map((item) => (item == null ? "" : String(item)));
}

// Chrome substitutes $NAME$ from placeholders[].content ($1, $2, …).
function waFormatMessage(entry, substitutions) {
  const subs = waSubsList(substitutions);
  let message = String((entry && entry.message) || "");
  const placeholders = (entry && entry.placeholders) || {};
  message = message.replace(/\$\$/g, "\u0000");
  for (const name of Object.keys(placeholders)) {
    let value = String(placeholders[name] && placeholders[name].content != null ? placeholders[name].content : "");
    const index = /^\$(\d+)$/.exec(value);
    if (index) value = subs[Number(index[1]) - 1] || "";
    message = message.split("$" + name.toUpperCase() + "$").join(value);
  }
  return message.replace(/\u0000/g, "$");
}

let waI18nTable = null;
let waI18nLocale = "";
let waI18nPending = null;
let waI18nPendingLocale = "";

function waI18nInit(lang) {
  // Trust chrome.i18n only if it really answers here; in a context where the
  // function exists but returns nothing, load the packaged table instead.
  let native = "";
  try {
    if (typeof chrome !== "undefined" && chrome.i18n && typeof chrome.i18n.getMessage === "function") {
      native = chrome.i18n.getMessage("extName") || "";
    }
  } catch (_) {}
  if (native) {
    waI18nLocale = waActiveLocale(lang || waUiLanguage());
    return Promise.resolve(waI18nLocale);
  }
  const locale = waActiveLocale(lang || waUiLanguage());
  if (waI18nTable && waI18nLocale === locale) return Promise.resolve(locale);
  if (waI18nPending && waI18nPendingLocale === locale) return waI18nPending;
  waI18nPendingLocale = locale;
  const url = chrome.runtime.getURL("_locales/" + locale + "/messages.json");
  waI18nPending = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error("i18n " + res.status);
      return res.json();
    })
    .then((json) => {
      waI18nTable = json;
      waI18nLocale = locale;
      return locale;
    })
    .finally(() => {
      waI18nPending = null;
    });
  return waI18nPending;
}

function waT(key, substitutions) {
  const name = String(key || "");
  const subs = waSubsList(substitutions);
  let message = "";
  try {
    if (typeof chrome !== "undefined" && chrome.i18n && typeof chrome.i18n.getMessage === "function") {
      message = chrome.i18n.getMessage(name, subs.length ? subs : undefined) || "";
    }
  } catch (_) {}
  if (!message && waI18nTable && waI18nTable[name] && waI18nTable[name].message) {
    message = waFormatMessage(waI18nTable[name], subs);
  }
  return message || name;
}

function waApplyI18n(root) {
  const locale = waActiveLocale(waUiLanguage());
  const doc = root && root.nodeType === 9 ? root : typeof document !== "undefined" ? document : null;
  if (doc && doc.documentElement) doc.documentElement.lang = locale;
  const scope = root && root.querySelectorAll ? root : doc;
  if (!scope || !scope.querySelectorAll) return locale;
  scope.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = waT(key);
  });
  scope.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    const spec = el.getAttribute("data-i18n-attr") || "";
    for (const part of spec.split(/[;,]/)) {
      const idx = part.indexOf(":");
      if (idx <= 0) continue;
      const attr = part.slice(0, idx).trim();
      const attrKey = part.slice(idx + 1).trim();
      if (attr && attrKey) el.setAttribute(attr, waT(attrKey));
    }
  });
  return locale;
}

globalThis.waActiveLocale = waActiveLocale;
globalThis.waI18nInit = waI18nInit;
globalThis.waT = waT;
globalThis.waApplyI18n = waApplyI18n;
