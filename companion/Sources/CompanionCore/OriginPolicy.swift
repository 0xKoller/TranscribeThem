import Foundation

/// Decides which browser origins may call the local HTTP server.
///
/// A missing Origin (curl, the app itself) is allowed: the listener only
/// accepts loopback connections. A present Origin must be our Chrome
/// extension or a page served from the loopback host itself. Hosts are
/// compared exactly, so `http://localhost.evil.com` or
/// `http://127.0.0.1.nip.io` are rejected.
public enum OriginPolicy {
    /// The ID fixed by the `key` in manifest.json. It is the same for every
    /// unpacked copy, wherever it is loaded from.
    public static let extensionId = "bnmnjapomgkgljobkcalefbbnfcfjlmd"

    /// Builds we ship. Add the Chrome Web Store ID here once it exists.
    public static let knownExtensionIds: Set<String> = [extensionId]

    private static let loopbackHosts: Set<String> = ["127.0.0.1", "localhost", "::1", "[::1]"]

    /// Our extension plus any extra IDs in WA_COMPANION_EXTENSION_IDS
    /// (comma separated), for example a Chrome Web Store build.
    public static func allowedExtensionIds(environment: [String: String] = ProcessInfo.processInfo.environment) -> Set<String> {
        var ids = knownExtensionIds
        for raw in (environment["WA_COMPANION_EXTENSION_IDS"] ?? "").split(separator: ",") {
            let id = raw.trimmingCharacters(in: .whitespaces).lowercased()
            if isExtensionId(id) { ids.insert(id) }
        }
        return ids
    }

    public static func isTrusted(_ origin: String?, extensionIds: Set<String> = allowedExtensionIds()) -> Bool {
        guard let origin = origin?.trimmingCharacters(in: .whitespaces), !origin.isEmpty else {
            return true
        }
        guard let components = URLComponents(string: origin),
              let scheme = components.scheme?.lowercased(),
              let host = components.host?.lowercased(),
              components.path.isEmpty || components.path == "/",
              components.user == nil,
              components.password == nil
        else {
            return false
        }
        switch scheme {
        case "chrome-extension":
            return extensionIds.contains(host)
        case "http":
            return loopbackHosts.contains(host)
        default:
            return false
        }
    }

    /// Chrome extension IDs are 32 characters in the range a–p.
    public static func isExtensionId(_ id: String) -> Bool {
        id.count == 32 && id.allSatisfy { $0 >= "a" && $0 <= "p" }
    }
}
