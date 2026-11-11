import CryptoKit
import Foundation

/// The parts of installing an update that can be checked without the network:
/// where the app may replace itself, file hashes, and what a downloaded
/// extension must look like.
public enum UpdateInstall {
    public enum Blocker: Equatable, Sendable {
        /// Running from `swift run` or a bare binary.
        case notABundle
        /// macOS runs it from a randomized read-only copy (App Translocation).
        case translocated
        /// Running straight from the mounted DMG.
        case onDiskImage
        /// The folder that holds the app is not writable for this user.
        case notWritable
    }

    /// Why the app cannot replace itself in place, or nil when it can.
    public static func blocker(bundlePath: String, parentIsWritable: Bool) -> Blocker? {
        guard bundlePath.hasSuffix(".app") else { return .notABundle }
        if bundlePath.contains("/AppTranslocation/") { return .translocated }
        if bundlePath.hasPrefix("/Volumes/") { return .onDiskImage }
        if !parentIsWritable { return .notWritable }
        return nil
    }

    /// SHA-256 of a file, read in chunks, as lowercase hex.
    public static func sha256Hex(fileAt url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        return hex(hasher.finalize())
    }

    public static func hex<D: Sequence>(_ digest: D) -> String where D.Element == UInt8 {
        digest.map { String(format: "%02x", $0) }.joined()
    }

    /// Chrome's extension ID for a manifest `key`: the first 128 bits of the
    /// SHA-256 of the public key, written with the letters a–p.
    public static func extensionId(fromManifestKey key: String) -> String? {
        guard let der = Data(base64Encoded: key.trimmingCharacters(in: .whitespacesAndNewlines)), !der.isEmpty else { return nil }
        let digest = SHA256.hash(data: der)
        let letters = Array("abcdefghijklmnop")
        var id = ""
        for byte in digest.prefix(16) {
            id.append(letters[Int(byte >> 4)])
            id.append(letters[Int(byte & 0x0f)])
        }
        return id
    }

    /// The version of an unpacked extension's manifest.json, only when it is
    /// our extension (its `key` gives the pinned ID).
    public static func extensionVersion(manifest data: Data, expectedId: String = OriginPolicy.extensionId) -> String? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let version = obj["version"] as? String, UpdateCheck.components(version) != nil,
              let key = obj["key"] as? String, extensionId(fromManifestKey: key) == expectedId
        else { return nil }
        return version
    }

    /// Replaces the app after it quits, then opens the new copy. Arguments:
    /// the app's PID, the installed bundle, the staged bundle. If the swap
    /// fails, the old app is put back and opened.
    public static let swapScript = """
    #!/bin/sh
    pid="$1"; app="$2"; staged="$3"; backup="$app.previous"; opener="${TT_OPEN:-open}"
    i=0
    while kill -0 "$pid" 2>/dev/null; do
      i=$((i + 1)); [ "$i" -gt 600 ] && exit 1
      sleep 0.1
    done
    rm -rf "$backup"
    if ! mv "$app" "$backup"; then rm -rf "$staged"; "$opener" "$app"; exit 1; fi
    if mv "$staged" "$app"; then
      rm -rf "$backup"
      xattr -dr com.apple.quarantine "$app" 2>/dev/null
      "$opener" "$app"
    else
      mv "$backup" "$app"
      "$opener" "$app"
      exit 1
    fi
    """
}

public enum InstallError: Error, Equatable {
    case missingAsset
    case checksum
    case badDownload
    case wrongApp
    case command(String)
}

/// Disk steps of an install: stage the app from the DMG, swap the managed
/// extension folder, start the swap script.
public enum UpdateDisk {
    /// Mounts the DMG, checks the app inside (bundle ID, version, signature)
    /// and copies it next to the installed one, so the final swap is a rename
    /// on the same volume.
    public static func stageApp(dmg: URL, version: String, installedApp: URL, bundleId: String, workDirectory: URL) throws -> URL {
        let fm = FileManager.default
        let mount = workDirectory.appendingPathComponent("mount", isDirectory: true)
        try fm.createDirectory(at: mount, withIntermediateDirectories: true)
        try Shell.run("/usr/bin/hdiutil", ["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mount.path, dmg.path], name: "hdiutil")
        defer { try? Shell.run("/usr/bin/hdiutil", ["detach", mount.path, "-force"], name: "hdiutil") }

        guard let found = try fm.contentsOfDirectory(at: mount, includingPropertiesForKeys: nil)
            .first(where: { $0.pathExtension == "app" }) else { throw InstallError.wrongApp }
        let info = NSDictionary(contentsOf: found.appendingPathComponent("Contents/Info.plist"))
        guard info?["CFBundleIdentifier"] as? String == bundleId,
              let foundVersion = info?["CFBundleShortVersionString"] as? String,
              UpdateCheck.isSame(foundVersion, version) else { throw InstallError.wrongApp }
        try Shell.run("/usr/bin/codesign", ["--verify", "--deep", "--strict", found.path], name: "codesign")

        let staged = installedApp.deletingLastPathComponent().appendingPathComponent(".TranscribeThem-update.app")
        try? fm.removeItem(at: staged)
        try Shell.run("/usr/bin/ditto", [found.path, staged.path], name: "ditto")
        return staged
    }

    /// Unzips the extension, checks it is ours at `version`, and swaps it into `target`.
    public static func installExtension(zip: URL, version: String, target: URL, workDirectory: URL) throws {
        let fm = FileManager.default
        let unpacked = workDirectory.appendingPathComponent("extension", isDirectory: true)
        try? fm.removeItem(at: unpacked)
        try Shell.run("/usr/bin/ditto", ["-x", "-k", zip.path, unpacked.path], name: "ditto")
        let candidates = [unpacked] + ((try? fm.contentsOfDirectory(at: unpacked, includingPropertiesForKeys: nil)) ?? [])
        guard let root = candidates.first(where: { dir in
            guard let data = try? Data(contentsOf: dir.appendingPathComponent("manifest.json")),
                  let found = UpdateInstall.extensionVersion(manifest: data) else { return false }
            return UpdateCheck.isSame(found, version)
        }) else { throw InstallError.wrongApp }

        let parent = target.deletingLastPathComponent()
        try fm.createDirectory(at: parent, withIntermediateDirectories: true)
        let next = parent.appendingPathComponent(target.lastPathComponent + ".new", isDirectory: true)
        let old = parent.appendingPathComponent(target.lastPathComponent + ".old", isDirectory: true)
        try? fm.removeItem(at: next)
        try? fm.removeItem(at: old)
        try fm.moveItem(at: root, to: next)
        if fm.fileExists(atPath: target.path) { try fm.moveItem(at: target, to: old) }
        do {
            try fm.moveItem(at: next, to: target)
        } catch {
            if fm.fileExists(atPath: old.path) { try? fm.moveItem(at: old, to: target) }
            throw error
        }
        try? fm.removeItem(at: old)
    }

    /// Starts the script that swaps the app once this process quits.
    public static func launchSwap(installedApp: URL, staged: URL, workDirectory: URL) throws {
        let script = workDirectory.appendingPathComponent("swap.sh")
        try UpdateInstall.swapScript.write(to: script, atomically: true, encoding: .utf8)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = [script.path, String(ProcessInfo.processInfo.processIdentifier), installedApp.path, staged.path]
        try process.run()
    }
}

public enum Shell {
    public static func run(_ tool: String, _ args: [String], name: String) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: tool)
        process.arguments = args
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw InstallError.command(name) }
    }
}
