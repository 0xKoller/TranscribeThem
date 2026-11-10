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
}
