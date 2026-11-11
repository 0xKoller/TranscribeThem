import Foundation

/// Compares the app version with the latest public GitHub release.
/// Pure parsing and comparison; the network calls live in the app.
public enum UpdateCheck {
    /// How often the automatic check runs.
    public static let interval: TimeInterval = 24 * 60 * 60
    /// Info.plist key that names the GitHub repository ("owner/name") releases come from.
    /// Only the public build sets it; without it the app never looks for updates.
    public static let repoInfoKey = "TTUpdateRepo"
    /// Overrides the Info.plist value, to try the flow with a development build.
    public static let repoEnvironmentKey = "WA_COMPANION_UPDATE_REPO"

    public struct Asset: Equatable, Sendable {
        public let name: String
        public let downloadURL: URL
        public let size: Int
        /// "sha256:<hex>" as GitHub reports it, when it does.
        public let digest: String?

        public init(name: String, downloadURL: URL, size: Int, digest: String?) {
            self.name = name
            self.downloadURL = downloadURL
            self.size = size
            self.digest = digest
        }
    }

    public struct Release: Equatable, Sendable {
        public let version: String
        public let pageURL: URL
        public let notes: String
        public let assets: [Asset]

        public init(version: String, pageURL: URL, notes: String = "", assets: [Asset] = []) {
            self.version = version
            self.pageURL = pageURL
            self.notes = notes
            self.assets = assets
        }

        public var dmg: Asset? { assets.first { $0.name == "TranscribeThem-\(version).dmg" } }
        public var extensionZip: Asset? { assets.first { $0.name == "TranscribeThem-extension-\(version).zip" } }
        public var checksums: Asset? { assets.first { $0.name == "SHA256SUMS.txt" } }
    }

    // MARK: Channel

    /// "owner/name" when it looks like a GitHub repository, nil otherwise.
    public static func validRepo(_ raw: String?) -> String? {
        guard let text = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        let parts = text.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 2 else { return nil }
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.")
        for part in parts {
            guard !part.isEmpty, part != ".", part != "..",
                  part.unicodeScalars.allSatisfy({ allowed.contains($0) }) else { return nil }
        }
        return text
    }

    /// The repository this build checks, or nil when it must not check at all
    /// (private and development builds).
    public static func repo(infoValue: Any?, environment: [String: String]) -> String? {
        if let override = environment[repoEnvironmentKey], !override.isEmpty {
            return validRepo(override)
        }
        return validRepo(infoValue as? String)
    }

    public static func latestReleaseURL(repo: String) -> URL? {
        guard let repo = validRepo(repo) else { return nil }
        return URL(string: "https://api.github.com/repos/\(repo)/releases/latest")
    }

    // MARK: Schedule

    /// True when the automatic check should run now. A last check in the
    /// future (the clock moved back) counts as due.
    public static func isDue(lastCheck: Date?, now: Date, interval: TimeInterval = interval) -> Bool {
        guard let lastCheck else { return true }
        let elapsed = now.timeIntervalSince(lastCheck)
        return elapsed < 0 || elapsed >= interval
    }

    /// The release worth telling the user about: newer than this build and
    /// not the version they chose to skip.
    public static func offer(_ release: Release?, current: String, skipped: String?) -> Release? {
        guard let release, isNewer(release.version, than: current) else { return nil }
        if let skipped, isSame(skipped, release.version) { return nil }
        return release
    }

    // MARK: Versions

    /// "v0.5.0", "0.5", "1.2.3-beta" → [0, 5, 0] … Nil when it is not a version.
    public static func components(_ raw: String) -> [Int]? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.hasPrefix("v") || text.hasPrefix("V") { text.removeFirst() }
        if let dash = text.firstIndex(where: { $0 == "-" || $0 == "+" }) { text = String(text[..<dash]) }
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        guard !parts.isEmpty, parts.count <= 4 else { return nil }
        var numbers: [Int] = []
        for part in parts {
            guard let n = Int(part), n >= 0 else { return nil }
            numbers.append(n)
        }
        return numbers
    }

    /// True when `latest` is a higher version than `current`. A development
    /// build ("dev") never asks to update.
    public static func isNewer(_ latest: String, than current: String) -> Bool {
        guard let a = components(latest), let b = components(current) else { return false }
        for i in 0..<max(a.count, b.count) {
            let x = i < a.count ? a[i] : 0
            let y = i < b.count ? b[i] : 0
            if x != y { return x > y }
        }
        return false
    }

    /// "0.6" and "v0.6.0" are the same version.
    public static func isSame(_ a: String, _ b: String) -> Bool {
        guard components(a) != nil, components(b) != nil else { return false }
        return !isNewer(a, than: b) && !isNewer(b, than: a)
    }

    // MARK: Parsing

    /// Reads the GitHub "latest release" JSON. Drafts and prereleases are ignored.
    public static func parseLatest(_ data: Data) -> Release? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let tag = obj["tag_name"] as? String,
              components(tag) != nil,
              (obj["draft"] as? Bool) != true,
              (obj["prerelease"] as? Bool) != true,
              let page = (obj["html_url"] as? String).flatMap(URL.init(string:)),
              page.scheme == "https", page.host == "github.com"
        else { return nil }
        let version = tag.hasPrefix("v") || tag.hasPrefix("V") ? String(tag.dropFirst()) : tag
        let notes = String(((obj["body"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines).prefix(4000))
        let assets = ((obj["assets"] as? [[String: Any]]) ?? []).compactMap(parseAsset)
        return Release(version: version, pageURL: page, notes: notes, assets: assets)
    }

    static func parseAsset(_ obj: [String: Any]) -> Asset? {
        guard let name = obj["name"] as? String, !name.isEmpty, !name.contains("/"),
              let url = (obj["browser_download_url"] as? String).flatMap(URL.init(string:)),
              url.scheme == "https", url.host == "github.com"
        else { return nil }
        let size = (obj["size"] as? Int) ?? (obj["size"] as? NSNumber)?.intValue ?? 0
        let digest = (obj["digest"] as? String).flatMap { $0.hasPrefix("sha256:") ? $0.lowercased() : nil }
        return Asset(name: name, downloadURL: url, size: size, digest: digest)
    }

    /// A few short lines of release notes, without Markdown markup, for the banner.
    public static func summary(_ notes: String, maxLines: Int = 4) -> String {
        var lines: [String] = []
        for raw in notes.components(separatedBy: .newlines) {
            var line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("```") || line.hasPrefix("|") || line.hasPrefix("<!--") { continue }
            while line.hasPrefix("#") { line.removeFirst() }
            if line.hasPrefix("- ") || line.hasPrefix("* ") { line = "• " + line.dropFirst(2) }
            line = line.replacingOccurrences(of: "**", with: "").replacingOccurrences(of: "`", with: "")
            line = line.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }
            lines.append(line)
            if lines.count == maxLines { break }
        }
        return lines.joined(separator: "\n")
    }

    /// Reads `shasum -a 256` output: "<hex>  <name>" per line → [name: hex].
    public static func parseChecksums(_ text: String) -> [String: String] {
        var out: [String: String] = [:]
        for line in text.components(separatedBy: .newlines) {
            let parts = line.split(whereSeparator: { $0 == " " || $0 == "\t" })
            guard parts.count == 2 else { continue }
            let hex = parts[0].lowercased()
            var name = String(parts[1])
            if name.hasPrefix("*") { name.removeFirst() }
            guard hex.count == 64, hex.allSatisfy({ $0.isHexDigit }) else { continue }
            out[name] = hex
        }
        return out
    }

    /// The expected SHA-256 for an asset. The checksums file is required; when
    /// GitHub also reports a digest, both must agree. Nil means "do not install".
    public static func expectedSHA256(for asset: Asset, checksums: [String: String]) -> String? {
        guard let listed = checksums[asset.name] else { return nil }
        if let digest = asset.digest, digest != "sha256:" + listed { return nil }
        return listed
    }
}

/// The release the app is offering right now, shared with the local server so
/// the extension can show it too.
public final class UpdateOffer: @unchecked Sendable {
    private let lock = NSLock()
    private var value: UpdateCheck.Release?

    public init() {}

    public var current: UpdateCheck.Release? {
        lock.lock()
        defer { lock.unlock() }
        return value
    }

    public func set(_ release: UpdateCheck.Release?) {
        lock.lock()
        value = release
        lock.unlock()
    }
}
