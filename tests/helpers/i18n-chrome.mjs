// chrome.i18n.getMessage backed by a packaged messages.json. Tests have no Chrome.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function format(entry, substitutions) {
  const list = substitutions == null ? [] : [].concat(substitutions).map((item) => (item == null ? "" : String(item)));
  let message = String(entry.message || "");
  const placeholders = entry.placeholders || {};
  for (const name of Object.keys(placeholders)) {
    let value = String(placeholders[name].content ?? "");
    const index = /^\$(\d+)$/.exec(value);
    if (index) value = list[Number(index[1]) - 1] || "";
    message = message.split("$" + name.toUpperCase() + "$").join(value);
  }
  return message;
}

export function chromeI18n(locale = "es") {
  const messages = JSON.parse(readFileSync(join(root, "_locales", locale, "messages.json"), "utf8"));
  return {
    getUILanguage: () => (locale === "es" ? "es-AR" : "en"),
    getMessage(key, substitutions) {
      const entry = messages[key];
      if (!entry || !entry.message) return "";
      return format(entry, substitutions);
    },
  };
}
