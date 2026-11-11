/* Update checks: version comparison and which notice to show.
   Classic script shared by the service worker, the popup and Options. */
(function (g) {
  g.WA_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

  // "v0.5.0", "0.5", "1.2.3-beta" → [0, 5, 0] … null when it is not a version.
  g.waVersionParts = function waVersionParts(raw) {
    let text = String(raw == null ? "" : raw).trim();
    if (/^v/i.test(text)) text = text.slice(1);
    text = text.split(/[-+]/)[0];
    const parts = text.split(".");
    if (!text || parts.length > 4) return null;
    const out = [];
    for (const part of parts) {
      if (!/^\d+$/.test(part)) return null;
      out.push(Number(part));
    }
    return out;
  };

  g.waIsNewerVersion = function waIsNewerVersion(latest, current) {
    const a = g.waVersionParts(latest);
    const b = g.waVersionParts(current);
    if (!a || !b) return false;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i] || 0;
      const y = b[i] || 0;
      if (x !== y) return x > y;
    }
    return false;
  };

  // The GitHub repository this copy checks, from manifest "homepage_url".
  // Only the public build has one. A Chrome Web Store install (update_url)
  // is updated by Chrome and never checks on its own.
  g.waUpdateRepo = function waUpdateRepo(manifest) {
    if (!manifest || manifest.update_url) return null;
    const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)\/?$/.exec(manifest.homepage_url || "");
    if (!m || m[1].split("/").some((p) => p === "." || p === "..")) return null;
    return m[1];
  };

  g.waReleaseApiUrl = function waReleaseApiUrl(repo) {
    return "https://api.github.com/repos/" + repo + "/releases/latest";
  };

  // A release page link we are willing to open.
  g.waSafeReleaseUrl = function waSafeReleaseUrl(raw) {
    try {
      const url = new URL(String(raw));
      return url.protocol === "https:" && url.hostname === "github.com" ? url.href : null;
    } catch (_) {
      return null;
    }
  };

  // GitHub "latest release" JSON → { version, url }. Drafts and prereleases are ignored.
  g.waParseRelease = function waParseRelease(json) {
    if (!json || typeof json !== "object" || json.draft === true || json.prerelease === true) return null;
    const tag = typeof json.tag_name === "string" ? json.tag_name : "";
    const url = g.waSafeReleaseUrl(json.html_url);
    if (!g.waVersionParts(tag) || !url) return null;
    return { version: tag.replace(/^v/i, ""), url };
  };

  // What the app reported in GET /health → { version, url } or null.
  g.waNormalizeAppUpdate = function waNormalizeAppUpdate(raw) {
    if (!raw || typeof raw !== "object") return null;
    const url = g.waSafeReleaseUrl(raw.url);
    if (!g.waVersionParts(raw.version) || !url) return null;
    return { version: String(raw.version), url };
  };

  g.waUpdateDue = function waUpdateDue(lastCheckedAt, now, interval) {
    const last = typeof lastCheckedAt === "number" ? lastCheckedAt : 0;
    const every = typeof interval === "number" ? interval : g.WA_UPDATE_INTERVAL_MS;
    return !last || now - last >= every || now < last;
  };

  // The notice to show, if any.
  //   release: a newer TranscribeThem release (from our own check or the app).
  //   extensionBehind: the app is newer than this extension (same release ships both).
  g.waUpdateNotice = function waUpdateNotice(input) {
    const current = input.current;
    let release = null;
    for (const candidate of [input.own, input.fromApp]) {
      if (!candidate || !g.waIsNewerVersion(candidate.version, current)) continue;
      if (!release || g.waIsNewerVersion(candidate.version, release.version)) release = candidate;
    }
    const appVersion = input.appVersion;
    const extensionBehind = !!appVersion && g.waIsNewerVersion(appVersion, current);
    if (!release && !extensionBehind) return null;
    return { release, extensionBehind, appVersion: extensionBehind ? String(appVersion) : null };
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
