import XCTest
import CompanionCore

final class StoreTests: XCTestCase {
    private func tempDir() -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    func testSettingsRoundTripAndRejectsUnknownModel() throws {
        let dir = tempDir()
        let store = SettingsStore(directory: dir)
        XCTAssertTrue(store.fileWasMissing)
        XCTAssertEqual(store.current.languageMode, "es")
        XCTAssertEqual(store.current.modelId, CompanionSettings.defaultModelId)

        let now = Date(timeIntervalSince1970: 1_700_000_000)
        store.update(json: [
            "languageMode": "en",
            "modelId": "nope",
            "debugMode": true,
            "useCompanion": false,
        ], now: now)

        let again = SettingsStore(directory: dir)
        XCTAssertFalse(again.fileWasMissing)
        XCTAssertEqual(again.current.languageMode, "en")
        XCTAssertEqual(again.current.modelId, CompanionSettings.defaultModelId)
        XCTAssertEqual(again.current.debugMode, true)
        XCTAssertFalse(again.current.useCompanion)
        XCTAssertEqual(again.current.updatedAt.timeIntervalSince1970, now.timeIntervalSince1970, accuracy: 1)
    }

    func testXSiteSurvivesSettingsAndStatsRoundTrip() {
        let dir = tempDir()
        let settings = SettingsStore(directory: dir)
        settings.update(json: ["sites": ["x": false]])
        XCTAssertEqual(SettingsStore(directory: dir).current.sites["x"], false)
        let stats = StatsStore(directory: dir)
        stats.record(audioSeconds: 12, transcribeMs: 400, engine: "parakeet", model: "m", ok: true, site: "x")
        let snapshot = StatsStore(directory: dir).snapshot()
        XCTAssertEqual(snapshot.recent.first?.site, "x")
        XCTAssertEqual(snapshot.days.first?.bySite["x"], 1)
    }

    func testRecentActivityRespectsSelectedPeriod() {
        let store = StatsStore(directory: tempDir())
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        for age in [0, 2, 8] {
            store.record(audioSeconds: 12, transcribeMs: 400, engine: "parakeet", model: "m", ok: true,
                         site: "x", now: calendar.date(byAdding: .day, value: -age, to: now)!, calendar: calendar)
        }
        let snapshot = store.snapshot()
        XCTAssertEqual(snapshot.recentActivity(.today, now: now, calendar: calendar).count, 1)
        XCTAssertEqual(snapshot.recentActivity(.week, now: now, calendar: calendar).count, 2)
        XCTAssertEqual(snapshot.recentActivity(.all, now: now, calendar: calendar).count, 3)
    }

    func testTranscriptHistoryRequiresOptInAndCanBeCleared() throws {
        let dir = tempDir()
        let service = CompanionService(directory: dir)
        XCTAssertFalse(service.settings.current.saveTranscripts)
        service.recordJob(audioSeconds: 2, transcribeMs: 100, engine: "parakeet", model: "m", ok: true, transcript: "not retained")
        XCTAssertNil(StatsStore(directory: dir).snapshot().recent.first?.transcript)
        service.updateSettings(json: ["saveTranscripts": true])
        XCTAssertTrue(SettingsStore(directory: dir).current.saveTranscripts)
        for engine in ["parakeet", "whisper"] {
            service.recordJob(audioSeconds: 3, transcribeMs: 200, engine: engine, model: "m", ok: true, site: "x", transcript: "Texto completo de prueba")
        }
        XCTAssertEqual(StatsStore(directory: dir).snapshot().recent.filter { $0.transcript != nil }.count, 2)
        service.updateSettings(json: ["languageMode": "en"])
        XCTAssertTrue(service.settings.current.saveTranscripts, "Unrelated browser sync must preserve opt-in")
        service.updateSettings(json: ["saveTranscripts": false])
        service.recordJob(audioSeconds: 2, transcribeMs: 100, engine: "whisper", model: "m", ok: true, transcript: "not retained either")
        XCTAssertNil(service.stats.snapshot().recent.first?.transcript)
        XCTAssertEqual(service.stats.snapshot().recent.filter { $0.transcript != nil }.count, 2)
        try service.clearSavedTranscripts()
        let again = StatsStore(directory: dir).snapshot()
        XCTAssertTrue(again.recent.allSatisfy { $0.transcript == nil })
        XCTAssertEqual(again.processedCount, 4)
        XCTAssertEqual(again.totalAudioSeconds, 10)
        let stored = try String(contentsOf: dir.appendingPathComponent("stats.json"), encoding: .utf8)
        XCTAssertFalse(stored.contains("Texto completo"))
    }

    func testTranscriptHistoryUsesExistingRetentionLimit() {
        let service = CompanionService(directory: tempDir())
        service.updateSettings(json: ["saveTranscripts": true])
        for i in 0...StatsStore.recentLimit {
            service.recordJob(audioSeconds: 1, transcribeMs: 10, engine: "whisper", model: "m", ok: true, transcript: "note-\(i)")
        }
        let jobs = service.stats.snapshot().recent
        XCTAssertEqual(jobs.count, StatsStore.recentLimit)
        XCTAssertFalse(jobs.contains { $0.transcript == "note-0" })
    }

    func testModelAlias() {
        let store = SettingsStore(directory: tempDir())
        store.update(json: ["modelId": "onnx-community/whisper-medium"])
        XCTAssertEqual(store.current.modelId, "Xenova/whisper-medium")
    }

    func testPartialUpdateKeepsLaunchAtLogin() {
        let store = SettingsStore(directory: tempDir())
        store.update(json: ["launchAtLogin": true])
        store.update(json: ["debugMode": true])
        XCTAssertTrue(store.current.launchAtLogin)
        XCTAssertTrue(store.current.debugMode)
    }

    func testStatsTrimAndPercentiles() {
        XCTAssertEqual(StatsStore.percentile([100, 200, 300, 400, 500], 0.5), 300)
        XCTAssertEqual(StatsStore.percentile([100, 200, 300, 400, 500], 0.95), 500)
        XCTAssertNil(StatsStore.percentile([], 0.5))

        XCTAssertEqual(StatsStore.recentLimit, 500)
        let store = StatsStore(directory: tempDir())
        let kept = StatsStore.recentLimit + 5
        for i in 0..<kept {
            store.record(audioSeconds: 1.5, transcribeMs: 100 + i, engine: i.isMultiple(of: 2) ? "parakeet" : "whisper", model: "m", ok: true)
        }
        store.record(audioSeconds: 9, transcribeMs: 10, engine: "whisper", model: "secret text should not exist", ok: false)
        let snap = store.snapshot()
        XCTAssertEqual(snap.processedCount, kept)
        XCTAssertEqual(snap.failCount, 1)
        XCTAssertEqual(snap.recent.count, StatsStore.recentLimit)
        XCTAssertEqual(snap.okCount, kept)
        XCTAssertEqual(snap.totalAudioSeconds, Double(kept) * 1.5, accuracy: 0.001)
        XCTAssertEqual(snap.parakeetCount + snap.whisperCount, kept)
        XCTAssertFalse(snap.recent.contains { $0.model.contains("secret text") && $0.ok })
        XCTAssertNotNil(snap.medianMs)
        XCTAssertNotNil(snap.p95Ms)
    }

    func testJobRecordHasNoTranscriptField() {
        let job = JobRecord(at: Date(), audioSeconds: 1, transcribeMs: 20, engine: "parakeet", model: "parakeet-tdt-0.6b-v3", ok: true)
        let data = try? CompanionJSON.encoder.encode(job)
        let text = String(data: data ?? Data(), encoding: .utf8) ?? ""
        XCTAssertFalse(text.contains("transcript"))
        XCTAssertFalse(text.contains("\"text\""))
    }

    func testOldSettingsFileKeepsValuesAndFillsDefaults() throws {
        let dir = tempDir()
        let url = dir.appendingPathComponent("settings.json")
        let old = """
        {
          "debugMode": true,
          "languageMode": "en",
          "launchAtLogin": false,
          "modelId": "Xenova/whisper-medium",
          "polishEnabled": false,
          "updatedAt": "2023-11-14T22:13:20Z",
          "useCompanion": false
        }
        """
        try old.write(to: url, atomically: true, encoding: .utf8)
        let store = SettingsStore(directory: dir)
        XCTAssertFalse(store.fileWasMissing)
        XCTAssertEqual(store.current.languageMode, "en")
        XCTAssertEqual(store.current.modelId, "Xenova/whisper-medium")
        XCTAssertTrue(store.current.debugMode)
        XCTAssertFalse(store.current.useCompanion)
        XCTAssertEqual(store.current.engineMode, "browser")
        XCTAssertEqual(store.current.sites["whatsapp"], true)
        XCTAssertFalse(store.current.saveTranscripts)
        XCTAssertFalse(store.current.openAtLaunch)
        XCTAssertTrue(store.current.highlightWords)
    }

    func testEngineModeSyncsUseCompanionAndIgnoresUnknownSites() {
        let store = SettingsStore(directory: tempDir())
        store.update(json: ["engineMode": "companion"])
        XCTAssertEqual(store.current.engineMode, "companion")
        XCTAssertTrue(store.current.useCompanion)

        store.update(json: ["useCompanion": true])
        XCTAssertEqual(store.current.engineMode, "companion")

        store.update(json: ["useCompanion": false])
        XCTAssertEqual(store.current.engineMode, "browser")
        XCTAssertFalse(store.current.useCompanion)

        store.update(json: ["useCompanion": true])
        XCTAssertEqual(store.current.engineMode, "auto")

        store.update(json: ["sites": ["whatsapp": false, "evil": true], "languageMode": "auto", "highlightWords": false])
        XCTAssertEqual(store.current.sites, ["whatsapp": false, "x": true])
        XCTAssertEqual(store.current.languageMode, "auto")
        XCTAssertFalse(store.current.highlightWords)
    }

    func testDayRollupSpeedAndUnknownSite() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let dir = tempDir()
        let store = StatsStore(directory: dir)
        store.record(
            audioSeconds: 30,
            transcribeMs: 1000,
            engine: "parakeet",
            model: "parakeet-tdt-0.6b-v3",
            ok: true,
            site: "whatsapp",
            now: now,
            calendar: calendar
        )
        store.record(
            audioSeconds: 4,
            transcribeMs: 10,
            engine: "whisper",
            model: "m",
            ok: false,
            site: "https://chat.example/secret",
            errorCode: "transcript",
            now: now,
            calendar: calendar
        )
        let snap = store.snapshot()
        let today = snap.activity(.today, now: now, calendar: calendar)
        XCTAssertEqual(today.notes, 1)
        XCTAssertEqual(today.fails, 1)
        XCTAssertEqual(today.mediumNotes, 1)
        XCTAssertEqual(today.speed ?? 0, 30, accuracy: 0.01)
        XCTAssertNil(today.slowMs)
        XCTAssertEqual(snap.recent[0].site, "unknown")
        XCTAssertEqual(snap.recent[0].errorCode, "generic")
        XCTAssertEqual(snap.days[0].bySite["whatsapp"], 1)
        XCTAssertNil(snap.days[0].bySite["unknown"])
        let all = snap.activity(.all, now: now, calendar: calendar)
        XCTAssertEqual(all.notes, 1)
        XCTAssertEqual(all.fails, 1)
        XCTAssertNotNil(all.slowMs)
        XCTAssertEqual(snap.weekBars(now: now, calendar: calendar).count, 7)
        XCTAssertEqual(snap.weekBars(now: now, calendar: calendar).filter { $0.notes == 1 }.count, 1)

        let saved = try String(contentsOf: dir.appendingPathComponent("stats.json"), encoding: .utf8)
        XCTAssertFalse(saved.contains("transcript"))
        XCTAssertFalse(saved.contains("chat.example"))
        XCTAssertFalse(saved.contains("\"text\""))
    }

    func testDayRollupKeepsFourHundredDays() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let store = StatsStore(directory: tempDir())
        for i in 0..<401 {
            let now = Date(timeIntervalSince1970: TimeInterval(i * 86_400 + 12 * 3_600))
            store.record(
                audioSeconds: 1,
                transcribeMs: 10,
                engine: "parakeet",
                model: "m",
                ok: true,
                now: now,
                calendar: calendar
            )
        }
        let days = store.snapshot().days
        XCTAssertEqual(days.count, StatsStore.dayLimit)
        let first = Date(timeIntervalSince1970: 1 * 86_400 + 12 * 3_600)
        let last = Date(timeIntervalSince1970: 400 * 86_400 + 12 * 3_600)
        XCTAssertEqual(days.first?.day, StatsStore.dayKey(first, calendar: calendar))
        XCTAssertEqual(days.last?.day, StatsStore.dayKey(last, calendar: calendar))
    }

    func testOldStatsFileWithoutDays() throws {
        let dir = tempDir()
        let url = dir.appendingPathComponent("stats.json")
        let old = """
        {
          "failCount": 0,
          "jobs": [{
            "at": "2023-11-14T22:13:20Z",
            "audioSeconds": 2,
            "engine": "parakeet",
            "id": "11111111-1111-1111-1111-111111111111",
            "model": "m",
            "ok": true,
            "transcribeMs": 20
          }],
          "okCount": 1,
          "parakeetCount": 1,
          "processedCount": 1,
          "totalAudioSeconds": 2,
          "whisperCount": 0
        }
        """
        try old.write(to: url, atomically: true, encoding: .utf8)
        let store = StatsStore(directory: dir)
        let snap = store.snapshot()
        XCTAssertEqual(snap.processedCount, 1)
        XCTAssertTrue(snap.days.isEmpty)
        XCTAssertEqual(snap.recent[0].site, "whatsapp")
        XCTAssertEqual(snap.recent[0].errorCode, "")
        XCTAssertEqual(snap.activity(.today).notes, 0)
        XCTAssertEqual(snap.activity(.all).notes, 1)
    }
}
