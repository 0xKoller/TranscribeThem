import CompanionCore
import Foundation
import XCTest

/// Real hdiutil, codesign and ditto on throwaway files.
final class UpdateDiskTests: XCTestCase {
    private var dir: URL!
    private let fm = FileManager.default
    private let bundleId = "com.koller.wa-local-transcribe"

    override func setUpWithError() throws {
        dir = fm.temporaryDirectory.appendingPathComponent("disk-" + UUID().uuidString)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? fm.removeItem(at: dir)
    }

    private func makeApp(at url: URL, bundleId: String, version: String) throws {
        let macos = url.appendingPathComponent("Contents/MacOS")
        try fm.createDirectory(at: macos, withIntermediateDirectories: true)
        try fm.copyItem(atPath: "/usr/bin/true", toPath: macos.appendingPathComponent("WACompanion").path)
        let info: NSDictionary = [
            "CFBundleIdentifier": bundleId, "CFBundleShortVersionString": version,
            "CFBundleExecutable": "WACompanion", "CFBundlePackageType": "APPL",
        ]
        info.write(to: url.appendingPathComponent("Contents/Info.plist"), atomically: true)
        try Shell.run("/usr/bin/codesign", ["--force", "-s", "-", url.path], name: "codesign")
    }

    private func makeDMG(bundleId: String, version: String) throws -> URL {
        let src = dir.appendingPathComponent("dmg-src-" + UUID().uuidString)
        try makeApp(at: src.appendingPathComponent("TranscribeThem.app"), bundleId: bundleId, version: version)
        let dmg = dir.appendingPathComponent("TranscribeThem-\(version)-\(UUID().uuidString).dmg")
        try Shell.run("/usr/bin/hdiutil", ["create", "-quiet", "-srcfolder", src.path, "-format", "UDZO", "-volname", "TranscribeThem", dmg.path], name: "hdiutil")
        return dmg
    }

    func testStageApp() throws {
        let installed = dir.appendingPathComponent("Applications/TranscribeThem.app")
        try makeApp(at: installed, bundleId: bundleId, version: "0.5.0")
        let work = dir.appendingPathComponent("work")
        try fm.createDirectory(at: work, withIntermediateDirectories: true)

        let staged = try UpdateDisk.stageApp(dmg: try makeDMG(bundleId: bundleId, version: "0.6.0"), version: "0.6.0",
                                             installedApp: installed, bundleId: bundleId, workDirectory: work)
        XCTAssertEqual(staged.deletingLastPathComponent(), installed.deletingLastPathComponent(), "staged next to the app")
        let info = NSDictionary(contentsOf: staged.appendingPathComponent("Contents/Info.plist"))
        XCTAssertEqual(info?["CFBundleShortVersionString"] as? String, "0.6.0")

        XCTAssertThrowsError(try UpdateDisk.stageApp(dmg: try makeDMG(bundleId: "com.evil.app", version: "0.6.0"), version: "0.6.0",
                                                     installedApp: installed, bundleId: bundleId, workDirectory: work)) { error in
            XCTAssertEqual(error as? InstallError, .wrongApp)
        }
        XCTAssertThrowsError(try UpdateDisk.stageApp(dmg: try makeDMG(bundleId: bundleId, version: "0.5.9"), version: "0.6.0",
                                                     installedApp: installed, bundleId: bundleId, workDirectory: work)) { error in
            XCTAssertEqual(error as? InstallError, .wrongApp, "the DMG must hold the version it claims")
        }
    }

    private func makeExtensionZip(version: String) throws -> URL {
        let repoManifest = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("manifest.json")
        var manifest = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(contentsOf: repoManifest)) as? [String: Any])
        manifest["version"] = version
        let src = dir.appendingPathComponent("zip-src-" + UUID().uuidString + "/TranscribeThem")
        try fm.createDirectory(at: src, withIntermediateDirectories: true)
        try JSONSerialization.data(withJSONObject: manifest).write(to: src.appendingPathComponent("manifest.json"))
        try Data(version.utf8).write(to: src.appendingPathComponent("marker.txt"))
        let zip = dir.appendingPathComponent("ext-\(UUID().uuidString).zip")
        try Shell.run("/usr/bin/ditto", ["-c", "-k", "--keepParent", src.path, zip.path], name: "ditto")
        return zip
    }

    func testInstallExtensionReplacesFolder() throws {
        let target = dir.appendingPathComponent("Support/Extension")
        let work = dir.appendingPathComponent("work")
        try fm.createDirectory(at: work, withIntermediateDirectories: true)

        try UpdateDisk.installExtension(zip: try makeExtensionZip(version: "0.6.0"), version: "0.6.0", target: target, workDirectory: work)
        XCTAssertEqual(try String(contentsOf: target.appendingPathComponent("marker.txt"), encoding: .utf8), "0.6.0")

        try UpdateDisk.installExtension(zip: try makeExtensionZip(version: "0.7.0"), version: "0.7.0", target: target, workDirectory: work)
        XCTAssertEqual(try String(contentsOf: target.appendingPathComponent("marker.txt"), encoding: .utf8), "0.7.0")
        XCTAssertFalse(fm.fileExists(atPath: target.path + ".old"))
        XCTAssertFalse(fm.fileExists(atPath: target.path + ".new"))

        XCTAssertThrowsError(try UpdateDisk.installExtension(zip: try makeExtensionZip(version: "0.8.0"), version: "0.9.0", target: target, workDirectory: work))
        XCTAssertEqual(try String(contentsOf: target.appendingPathComponent("marker.txt"), encoding: .utf8), "0.7.0", "a bad ZIP leaves the folder alone")
    }
}
