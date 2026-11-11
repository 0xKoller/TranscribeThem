import CompanionCore
import Foundation
import XCTest

final class UpdateInstallTests: XCTestCase {
    func testBlocker() {
        XCTAssertNil(UpdateInstall.blocker(bundlePath: "/Applications/TranscribeThem.app", parentIsWritable: true))
        XCTAssertEqual(UpdateInstall.blocker(bundlePath: "/Applications/TranscribeThem.app", parentIsWritable: false), .notWritable)
        XCTAssertEqual(UpdateInstall.blocker(bundlePath: "/Users/me/.build/debug", parentIsWritable: true), .notABundle)
        XCTAssertEqual(UpdateInstall.blocker(bundlePath: "/private/var/folders/x/AppTranslocation/ABC/d/TranscribeThem.app", parentIsWritable: true), .translocated)
        XCTAssertEqual(UpdateInstall.blocker(bundlePath: "/Volumes/TranscribeThem/TranscribeThem.app", parentIsWritable: true), .onDiskImage)
    }

    func testSHA256() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try Data("abc".utf8).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        XCTAssertEqual(try UpdateInstall.sha256Hex(fileAt: url), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }

    /// The key in manifest.json must give the pinned extension ID.
    func testExtensionIdFromRepoManifest() throws {
        let manifestURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("manifest.json")
        let data = try Data(contentsOf: manifestURL)
        let obj = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        let key = try XCTUnwrap(obj["key"] as? String)
        XCTAssertEqual(UpdateInstall.extensionId(fromManifestKey: key), OriginPolicy.extensionId)
        XCTAssertEqual(UpdateInstall.extensionVersion(manifest: data), obj["version"] as? String)
        XCTAssertNil(UpdateInstall.extensionVersion(manifest: Data(#"{"version":"1.0.0","key":"AAAA"}"#.utf8)), "another key is another extension")
        XCTAssertNil(UpdateInstall.extensionVersion(manifest: Data(#"{"version":"1.0.0"}"#.utf8)))
    }

    func testSwapScript() throws {
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent("swap-" + UUID().uuidString)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: dir) }
        let app = dir.appendingPathComponent("TranscribeThem.app")
        let staged = dir.appendingPathComponent(".TranscribeThem-update.app")
        try fm.createDirectory(at: app, withIntermediateDirectories: true)
        try fm.createDirectory(at: staged, withIntermediateDirectories: true)
        try Data("old".utf8).write(to: app.appendingPathComponent("v"))
        try Data("new".utf8).write(to: staged.appendingPathComponent("v"))
        let script = dir.appendingPathComponent("swap.sh")
        try UpdateInstall.swapScript.write(to: script, atomically: true, encoding: .utf8)

        // A process that is still running when the script starts: it must wait.
        let sleeper = Process()
        sleeper.executableURL = URL(fileURLWithPath: "/bin/sleep")
        sleeper.arguments = ["0.5"]
        try sleeper.run()

        let swap = Process()
        swap.executableURL = URL(fileURLWithPath: "/bin/sh")
        swap.arguments = [script.path, String(sleeper.processIdentifier), app.path, staged.path]
        swap.environment = ["TT_OPEN": "/usr/bin/true", "PATH": "/usr/bin:/bin"]
        try swap.run()
        Thread.sleep(forTimeInterval: 0.2)
        XCTAssertEqual(try String(contentsOf: app.appendingPathComponent("v"), encoding: .utf8), "old", "waits for the app to quit")
        swap.waitUntilExit()
        XCTAssertEqual(swap.terminationStatus, 0)
        XCTAssertEqual(try String(contentsOf: app.appendingPathComponent("v"), encoding: .utf8), "new")
        XCTAssertFalse(fm.fileExists(atPath: staged.path))
        XCTAssertFalse(fm.fileExists(atPath: app.path + ".previous"))
    }
}
