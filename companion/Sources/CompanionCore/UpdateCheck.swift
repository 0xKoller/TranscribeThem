import Foundation

/// Compares the app version with the latest public GitHub release.
/// Pure parsing and comparison; the network call lives in the app.
public enum UpdateCheck {
    public static let latestReleaseURL = URL(string: "https://api.github.com/repos/0xKoller/TranscribeThem/releases/latest")!

    public struct Release: Equatable, Sendable {
        public let version: String
        public let pageURL: URL
    }

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

    /// Reads the GitHub "latest release" JSON. Drafts and prereleases are ignored.
    public static func parseLatest(_ data: Data) -> Release? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let tag = obj["tag_name"] as? String,
              components(tag) != nil,
              (obj["draft"] as? Bool) != true,
              (obj["prerelease"] as? Bool) != true,
              let page = (obj["html_url"] as? String).flatMap(URL.init(string:)),
              page.host == "github.com"
        else { return nil }
        let version = tag.hasPrefix("v") ? String(tag.dropFirst()) : tag
        return Release(version: version, pageURL: page)
    }
}
