import XCTest
import CompanionCore

final class UpdateCheckTests: XCTestCase {
    func testComponents() {
        XCTAssertEqual(UpdateCheck.components("v0.5.0"), [0, 5, 0])
        XCTAssertEqual(UpdateCheck.components("1.2"), [1, 2])
        XCTAssertEqual(UpdateCheck.components("1.2.3-beta"), [1, 2, 3])
        XCTAssertNil(UpdateCheck.components("dev"))
        XCTAssertNil(UpdateCheck.components(""))
        XCTAssertNil(UpdateCheck.components("1..2"))
    }

    func testIsNewer() {
        XCTAssertTrue(UpdateCheck.isNewer("0.5.0", than: "0.4.0"))
        XCTAssertTrue(UpdateCheck.isNewer("v0.10.0", than: "0.9.9"))
        XCTAssertTrue(UpdateCheck.isNewer("1.0.1", than: "1.0"))
        XCTAssertFalse(UpdateCheck.isNewer("0.4.0", than: "0.4"))
        XCTAssertFalse(UpdateCheck.isNewer("0.4.0", than: "0.5.0"))
        XCTAssertFalse(UpdateCheck.isNewer("0.5.0", than: "dev"))
    }

    func testParseLatest() {
        let json = #"{"tag_name":"v0.5.0","html_url":"https://github.com/0xKoller/TranscribeThem/releases/tag/v0.5.0","draft":false,"prerelease":false}"#
        let release = UpdateCheck.parseLatest(Data(json.utf8))
        XCTAssertEqual(release?.version, "0.5.0")
        XCTAssertEqual(release?.pageURL.absoluteString, "https://github.com/0xKoller/TranscribeThem/releases/tag/v0.5.0")
        XCTAssertNil(UpdateCheck.parseLatest(Data(#"{"tag_name":"v1.0.0","html_url":"https://github.com/x","prerelease":true}"#.utf8)))
        XCTAssertNil(UpdateCheck.parseLatest(Data(#"{"tag_name":"v1.0.0","html_url":"https://evil.example/x"}"#.utf8)))
        XCTAssertNil(UpdateCheck.parseLatest(Data("nope".utf8)))
    }

    func testRepoChannel() {
        XCTAssertEqual(UpdateCheck.repo(infoValue: "0xKoller/TranscribeThem", environment: [:]), "0xKoller/TranscribeThem")
        // Private and development builds have no key and never check.
        XCTAssertNil(UpdateCheck.repo(infoValue: nil, environment: [:]))
        XCTAssertNil(UpdateCheck.repo(infoValue: "", environment: [:]))
        XCTAssertEqual(UpdateCheck.repo(infoValue: nil, environment: ["WA_COMPANION_UPDATE_REPO": "me/fork"]), "me/fork")
        XCTAssertNil(UpdateCheck.repo(infoValue: "a/b/c", environment: [:]))
        XCTAssertNil(UpdateCheck.repo(infoValue: "../x", environment: [:]))
        XCTAssertNil(UpdateCheck.repo(infoValue: "a b/c", environment: [:]))
        XCTAssertEqual(UpdateCheck.latestReleaseURL(repo: "a/b")?.absoluteString, "https://api.github.com/repos/a/b/releases/latest")
    }

    func testIsDue() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        XCTAssertTrue(UpdateCheck.isDue(lastCheck: nil, now: now))
        XCTAssertFalse(UpdateCheck.isDue(lastCheck: now.addingTimeInterval(-3600), now: now))
        XCTAssertTrue(UpdateCheck.isDue(lastCheck: now.addingTimeInterval(-UpdateCheck.interval), now: now))
        XCTAssertTrue(UpdateCheck.isDue(lastCheck: now.addingTimeInterval(60), now: now), "a check in the future is due")
    }

    func testOfferRespectsSkip() {
        let release = UpdateCheck.Release(version: "0.6.0", pageURL: URL(string: "https://github.com/a/b")!)
        XCTAssertEqual(UpdateCheck.offer(release, current: "0.5.0", skipped: nil), release)
        XCTAssertNil(UpdateCheck.offer(release, current: "0.5.0", skipped: "0.6.0"))
        XCTAssertNil(UpdateCheck.offer(release, current: "0.5.0", skipped: "v0.6"))
        XCTAssertEqual(UpdateCheck.offer(release, current: "0.5.0", skipped: "0.5.1"), release)
        XCTAssertNil(UpdateCheck.offer(release, current: "0.6.0", skipped: nil))
        XCTAssertNil(UpdateCheck.offer(nil, current: "0.5.0", skipped: nil))
    }

    func testParseAssetsAndNotes() {
        let json = #"""
        {"tag_name":"v0.6.0","html_url":"https://github.com/a/b/releases/tag/v0.6.0","body":"## New\n- **Updates** every day\n- `fix`","assets":[
          {"name":"TranscribeThem-0.6.0.dmg","browser_download_url":"https://github.com/a/b/releases/download/v0.6.0/TranscribeThem-0.6.0.dmg","size":123,"digest":"sha256:ABCD"},
          {"name":"TranscribeThem-extension-0.6.0.zip","browser_download_url":"https://github.com/a/b/releases/download/v0.6.0/TranscribeThem-extension-0.6.0.zip","size":45},
          {"name":"SHA256SUMS.txt","browser_download_url":"https://github.com/a/b/releases/download/v0.6.0/SHA256SUMS.txt","size":1},
          {"name":"evil.dmg","browser_download_url":"https://evil.example/x.dmg","size":1}
        ]}
        """#
        let release = UpdateCheck.parseLatest(Data(json.utf8))
        XCTAssertEqual(release?.assets.count, 3, "assets off github.com are dropped")
        XCTAssertEqual(release?.dmg?.size, 123)
        XCTAssertEqual(release?.dmg?.digest, "sha256:abcd")
        XCTAssertNotNil(release?.extensionZip)
        XCTAssertNotNil(release?.checksums)
        XCTAssertEqual(UpdateCheck.summary(release?.notes ?? ""), "New\n• Updates every day\n• fix")
    }

    func testChecksums() {
        let hex = String(repeating: "a", count: 64)
        let other = String(repeating: "b", count: 64)
        let sums = UpdateCheck.parseChecksums("\(hex)  TranscribeThem-0.6.0.dmg\n\(other) *TranscribeThem-extension-0.6.0.zip\nnope\n")
        XCTAssertEqual(sums["TranscribeThem-0.6.0.dmg"], hex)
        XCTAssertEqual(sums["TranscribeThem-extension-0.6.0.zip"], other)
        XCTAssertEqual(sums.count, 2)

        let url = URL(string: "https://github.com/a/b/x.dmg")!
        let plain = UpdateCheck.Asset(name: "TranscribeThem-0.6.0.dmg", downloadURL: url, size: 1, digest: nil)
        XCTAssertEqual(UpdateCheck.expectedSHA256(for: plain, checksums: sums), hex)
        let agreeing = UpdateCheck.Asset(name: plain.name, downloadURL: url, size: 1, digest: "sha256:" + hex)
        XCTAssertEqual(UpdateCheck.expectedSHA256(for: agreeing, checksums: sums), hex)
        let disagreeing = UpdateCheck.Asset(name: plain.name, downloadURL: url, size: 1, digest: "sha256:" + other)
        XCTAssertNil(UpdateCheck.expectedSHA256(for: disagreeing, checksums: sums))
        let unlisted = UpdateCheck.Asset(name: "other.dmg", downloadURL: url, size: 1, digest: nil)
        XCTAssertNil(UpdateCheck.expectedSHA256(for: unlisted, checksums: sums))
    }

    func testUpdateOffer() {
        let offer = UpdateOffer()
        XCTAssertNil(offer.current)
        let release = UpdateCheck.Release(version: "1.0.0", pageURL: URL(string: "https://github.com/a/b")!)
        offer.set(release)
        XCTAssertEqual(offer.current, release)
        offer.set(nil)
        XCTAssertNil(offer.current)
    }
}
