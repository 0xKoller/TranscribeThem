import XCTest
import CompanionCore

final class HistoryAndTextTests: XCTestCase {
    private func job(
        site: String,
        transcript: String?,
        at: Date = Date(timeIntervalSince1970: 1_700_000_000)
    ) -> JobRecord {
        JobRecord(
            at: at,
            audioSeconds: 3,
            transcribeMs: 100,
            engine: "parakeet",
            model: "secret-model",
            ok: true,
            site: site,
            transcript: transcript
        )
    }

    func testFilterMatchesTranscriptAndSiteWithoutCaseOrDiacritics() {
        let jobs = [
            job(site: "whatsapp", transcript: "El árbol está en el jardín"),
            job(site: "x", transcript: "Hello there"),
            job(site: "unknown", transcript: nil),
        ]
        XCTAssertEqual(ActivityHistory.filter(jobs, query: "   ").count, 3)
        XCTAssertEqual(ActivityHistory.filter(jobs, query: "ARBOL").map(\.site), ["whatsapp"])
        XCTAssertEqual(ActivityHistory.filter(jobs, query: "árbol").map(\.site), ["whatsapp"])
        XCTAssertEqual(ActivityHistory.filter(jobs, query: "WHATSAPP").map(\.site), ["whatsapp"])
        XCTAssertEqual(ActivityHistory.filter(jobs, query: "hello").map(\.site), ["x"])
        XCTAssertEqual(
            ActivityHistory.filter(jobs, query: "otro", siteLabel: { $0 == "unknown" ? "Otro" : $0 }).map(\.site),
            ["unknown"]
        )
        XCTAssertTrue(ActivityHistory.filter(jobs, query: "secret-model").isEmpty)
    }

    func testExportSkipsEntriesWithoutTranscript() {
        let first = Date(timeIntervalSince1970: 1_700_000_000)
        let second = Date(timeIntervalSince1970: 1_700_000_100)
        let jobs = [
            job(site: "whatsapp", transcript: "  Hola café  ", at: first),
            job(site: "x", transcript: "   ", at: second),
            job(site: "x", transcript: nil, at: second),
            job(site: "unknown", transcript: "Segunda línea\nmás texto", at: second),
        ]
        let text = ActivityHistory.exportText(jobs, formatDate: { date in
            date == first ? "FECHA-1" : "FECHA-2"
        }, siteLabel: { $0 == "unknown" ? "Otro" : $0 })
        XCTAssertEqual(
            text,
            """
            FECHA-1
            whatsapp
            Hola café

            FECHA-2
            Otro
            Segunda línea
            más texto
            """
        )
        XCTAssertEqual(ActivityHistory.exportable(jobs).count, 2)
        XCTAssertTrue(ActivityHistory.exportText([job(site: "x", transcript: nil)], formatDate: { _ in "x" }).isEmpty)
    }

    func testTextRequestValidationAndPrompts() {
        switch TextRequests.validate(action: "summarize", text: "  El árbol creció.  ", targetLanguage: nil) {
        case .ready(let action, let prompt):
            XCTAssertEqual(action, .summarize)
            XCTAssertEqual(prompt.prompt, "El árbol creció.")
            XCTAssertTrue(prompt.instructions.contains("mismo idioma"))
        default:
            XCTFail("summarize should be accepted")
        }

        switch TextRequests.validate(action: "translate", text: "Hola", targetLanguage: "EN") {
        case .ready(let action, let prompt):
            XCTAssertEqual(action, .translate)
            XCTAssertTrue(prompt.instructions.contains("inglés"))
            XCTAssertTrue(prompt.prompt.hasPrefix("Idioma de destino: en\n\nHola"))
        default:
            XCTFail("translate should be accepted")
        }

        let empty = TextRequests.validate(action: "summarize", text: " \n ", targetLanguage: nil)
        guard case .rejected(let emptyCode, _) = empty else { return XCTFail("empty") }
        XCTAssertEqual(emptyCode, .badRequest)

        let missing = TextRequests.validate(action: "translate", text: "Hola", targetLanguage: "fr")
        guard case .rejected(let missingCode, let missingMessage) = missing else { return XCTFail("language") }
        XCTAssertEqual(missingCode, .badRequest)
        XCTAssertTrue(missingMessage.contains("targetLanguage"))

        let unknown = TextRequests.validate(action: "rewrite", text: "Hola", targetLanguage: nil)
        guard case .rejected(let unknownCode, _) = unknown else { return XCTFail("action") }
        XCTAssertEqual(unknownCode, .badRequest)

        let tooLong = String(repeating: "á", count: TextRequests.maxCharacters + 1)
        let limited = TextRequests.validate(action: "summarize", text: tooLong, targetLanguage: nil)
        guard case .rejected(let limitCode, _) = limited else { return XCTFail("length") }
        XCTAssertEqual(limitCode, .badRequest)

        let exact = String(repeating: "a", count: TextRequests.maxCharacters)
        guard case .ready = TextRequests.validate(action: "summarize", text: exact, targetLanguage: nil) else {
            return XCTFail("exact limit should pass")
        }
    }

    func testBundleVersionFallsBackWhenMissing() {
        XCTAssertEqual(BundleVersion.shortString(infoValue: nil), "dev")
        XCTAssertEqual(BundleVersion.shortString(infoValue: "  "), "dev")
        XCTAssertEqual(BundleVersion.shortString(infoValue: "0.1.57"), "0.1.57")
    }

    func testRaisedRetentionStillLoadsAnOlderFiftyEntryFile() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var jobs: [[String: Any]] = []
        for index in 0..<50 {
            jobs.append([
                "at": "2023-11-14T22:13:20Z",
                "audioSeconds": 1,
                "engine": "parakeet",
                "id": UUID().uuidString,
                "model": "m",
                "ok": true,
                "site": "whatsapp",
                "transcribeMs": 10,
                "transcript": "nota-\(index)",
            ])
        }
        let payload: [String: Any] = [
            "jobs": jobs,
            "processedCount": 50,
            "okCount": 50,
            "failCount": 0,
            "parakeetCount": 50,
            "whisperCount": 0,
            "totalAudioSeconds": 50,
            "days": [],
        ]
        let data = try JSONSerialization.data(withJSONObject: payload)
        try data.write(to: dir.appendingPathComponent("stats.json"))
        let loaded = StatsStore(directory: dir).snapshot()
        XCTAssertEqual(loaded.recent.count, 50)
        XCTAssertEqual(loaded.processedCount, 50)
        let store = StatsStore(directory: dir)
        store.record(audioSeconds: 1, transcribeMs: 10, engine: "parakeet", model: "m", ok: true, transcript: "nueva")
        XCTAssertEqual(store.snapshot().recent.count, 51)
        XCTAssertEqual(store.snapshot().recent.first?.transcript, "nueva")
    }
}
