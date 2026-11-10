import XCTest
import CompanionCore

final class OriginPolicyTests: XCTestCase {
    private let ours = "chrome-extension://" + OriginPolicy.extensionId

    func testAllowsMissingOrigin() {
        XCTAssertTrue(OriginPolicy.isTrusted(nil))
        XCTAssertTrue(OriginPolicy.isTrusted(""))
    }

    func testAllowsOurExtensionAndLoopback() {
        XCTAssertTrue(OriginPolicy.isTrusted(ours))
        XCTAssertTrue(OriginPolicy.isTrusted("http://127.0.0.1:8765"))
        XCTAssertTrue(OriginPolicy.isTrusted("http://localhost"))
        XCTAssertTrue(OriginPolicy.isTrusted("http://[::1]:3000"))
    }

    func testRejectsOtherExtensions() {
        XCTAssertFalse(OriginPolicy.isTrusted("chrome-extension://abcdefghijklmnopabcdefghijklmnop"))
        XCTAssertFalse(OriginPolicy.isTrusted("chrome-extension://evil"))
    }

    func testExtraIdsFromEnvironment() {
        let extra = "abcdefghijklmnopabcdefghijklmnop"
        let ids = OriginPolicy.allowedExtensionIds(environment: ["WA_COMPANION_EXTENSION_IDS": " \(extra.uppercased()) , nope"])
        XCTAssertEqual(ids, [OriginPolicy.extensionId, extra])
        XCTAssertTrue(OriginPolicy.isTrusted("chrome-extension://" + extra, extensionIds: ids))
    }

    func testRejectsLookalikeHosts() {
        XCTAssertFalse(OriginPolicy.isTrusted("http://localhost.evil.com"))
        XCTAssertFalse(OriginPolicy.isTrusted("http://127.0.0.1.nip.io"))
        XCTAssertFalse(OriginPolicy.isTrusted("http://localhost@evil.com"))
        XCTAssertFalse(OriginPolicy.isTrusted("https://web.whatsapp.com"))
        XCTAssertFalse(OriginPolicy.isTrusted("null"))
    }
}
