import AppKit
import CompanionCore
import Foundation
import UserNotifications

enum UpdateDefaults {
    static let auto = "autoCheckUpdates"
    static let lastCheck = "lastUpdateCheck"
    static let skipped = "skippedUpdateVersion"
    static let notified = "notifiedUpdateVersion"
    static let etag = "updateETag"
    static let cachedBody = "updateCachedRelease"
}

enum InstallState: Equatable {
    case idle
    case downloading(Double?)
    case verifying
    case installing
    case failed(String)
}

extension AppModel {
    var currentVersion: String { BundleVersion.current() }

    /// The release to show in the banner and the menu: newer and not skipped.
    var offeredRelease: UpdateCheck.Release? {
        UpdateCheck.offer(latestRelease, current: currentVersion, skipped: skippedVersion)
    }

    /// The extension last said hello with an older version than this app. Both
    /// ship from the same release, so they should match.
    var extensionIsBehind: Bool {
        guard let version = extensionVersion, !version.isEmpty else { return false }
        return UpdateCheck.isNewer(currentVersion, than: version)
    }

    /// Runs the automatic check when it is on and a day has passed.
    func checkUpdatesIfDue(now: Date = Date()) {
        guard autoCheckUpdates, updateRepo != nil else { return }
        guard UpdateCheck.isDue(lastCheck: lastUpdateCheck, now: now) else { return }
        checkForUpdates(manual: false)
    }

    /// One request to the public GitHub releases API. A conditional request
    /// (ETag) answers 304 when nothing changed.
    func checkForUpdates(manual: Bool = true) {
        guard update != .checking else { return }
        guard let repo = updateRepo, let url = UpdateCheck.latestReleaseURL(repo: repo) else {
            update = .unavailable
            return
        }
        update = .checking
        let defaults = UserDefaults.standard
        var request = URLRequest(url: url, timeoutInterval: 15)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("TranscribeThem", forHTTPHeaderField: "User-Agent")
        let cached = defaults.data(forKey: UpdateDefaults.cachedBody)
        if cached != nil, let etag = defaults.string(forKey: UpdateDefaults.etag) {
            request.setValue(etag, forHTTPHeaderField: "If-None-Match")
        }
        Task {
            var release: UpdateCheck.Release?
            var ok = false
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                let http = response as? HTTPURLResponse
                if http?.statusCode == 200, let parsed = UpdateCheck.parseLatest(data) {
                    release = parsed
                    ok = true
                    defaults.set(data, forKey: UpdateDefaults.cachedBody)
                    if let etag = http?.value(forHTTPHeaderField: "ETag") {
                        defaults.set(etag, forKey: UpdateDefaults.etag)
                    } else {
                        defaults.removeObject(forKey: UpdateDefaults.etag)
                    }
                } else if http?.statusCode == 304, let cached, let parsed = UpdateCheck.parseLatest(cached) {
                    release = parsed
                    ok = true
                }
            } catch {
                ok = false
            }
            self.finishCheck(release: release, ok: ok, manual: manual)
        }
    }

    private func finishCheck(release: UpdateCheck.Release?, ok: Bool, manual: Bool) {
        guard ok, let release else {
            update = .failed
            return
        }
        let now = Date()
        lastUpdateCheck = now
        UserDefaults.standard.set(now, forKey: UpdateDefaults.lastCheck)
        latestRelease = release
        update = UpdateCheck.isNewer(release.version, than: currentVersion) ? .available(release) : .upToDate(currentVersion)
        publishOffer()
        refreshManagedExtensionIfNeeded()
        if !manual, let offer = offeredRelease { notifyOnce(offer) }
    }

    /// The last release seen survives a restart, so the banner shows before
    /// the next check.
    func restoreCachedRelease() {
        guard updateRepo != nil,
              let data = UserDefaults.standard.data(forKey: UpdateDefaults.cachedBody),
              let release = UpdateCheck.parseLatest(data) else { return }
        latestRelease = release
        if UpdateCheck.isNewer(release.version, than: currentVersion) {
            update = .available(release)
        }
        publishOffer()
        refreshManagedExtensionIfNeeded()
    }

    func skipOfferedVersion() {
        guard let offer = offeredRelease else { return }
        skippedVersion = offer.version
        UserDefaults.standard.set(offer.version, forKey: UpdateDefaults.skipped)
        publishOffer()
    }

    func openReleasePage() {
        if let url = (offeredRelease ?? latestRelease)?.pageURL {
            NSWorkspace.shared.open(url)
        }
    }

    func publishOffer() {
        service.updateOffer.set(offeredRelease)
    }

    /// One macOS notification per version, only from the automatic check.
    private func notifyOnce(_ release: UpdateCheck.Release) {
        let defaults = UserDefaults.standard
        guard defaults.string(forKey: UpdateDefaults.notified) != release.version else { return }
        // UserNotifications needs a real app bundle; `swift run` has none.
        guard Bundle.main.bundleURL.pathExtension == "app" else { return }
        defaults.set(release.version, forKey: UpdateDefaults.notified)
        let title = LF("TranscribeThem %@ está disponible", release.version)
        let body = L("Abrí la app para ver las novedades y actualizar.")
        let id = "update-\(release.version)"
        Task {
            let center = UNUserNotificationCenter.current()
            guard (try? await center.requestAuthorization(options: [.alert])) == true else { return }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            try? await center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
        }
    }
}
