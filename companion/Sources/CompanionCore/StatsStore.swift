import Foundation

public struct JobRecord: Codable, Equatable, Sendable, Identifiable {
    public var id: UUID
    public var at: Date
    public var audioSeconds: Double
    public var transcribeMs: Int
    public var engine: String
    public var model: String
    public var ok: Bool
    public var site: String
    public var errorCode: String
    public var transcript: String?

    public init(
        id: UUID = UUID(),
        at: Date,
        audioSeconds: Double,
        transcribeMs: Int,
        engine: String,
        model: String,
        ok: Bool,
        site: String = "whatsapp",
        errorCode: String = "",
        transcript: String? = nil
    ) {
        self.id = id
        self.at = at
        self.audioSeconds = audioSeconds
        self.transcribeMs = transcribeMs
        self.engine = engine
        self.model = model
        self.ok = ok
        self.site = site
        self.errorCode = errorCode
        self.transcript = transcript
    }

    private enum CodingKeys: String, CodingKey {
        case id, at, audioSeconds, transcribeMs, engine, model, ok, site, errorCode, transcript
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            id: try c.decodeIfPresent(UUID.self, forKey: .id) ?? UUID(),
            at: try c.decode(Date.self, forKey: .at),
            audioSeconds: try c.decode(Double.self, forKey: .audioSeconds),
            transcribeMs: try c.decode(Int.self, forKey: .transcribeMs),
            engine: try c.decode(String.self, forKey: .engine),
            model: try c.decode(String.self, forKey: .model),
            ok: try c.decode(Bool.self, forKey: .ok),
            site: try c.decodeIfPresent(String.self, forKey: .site) ?? "whatsapp",
            errorCode: try c.decodeIfPresent(String.self, forKey: .errorCode) ?? "",
            transcript: try c.decodeIfPresent(String.self, forKey: .transcript)
        )
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(at, forKey: .at)
        try c.encode(audioSeconds, forKey: .audioSeconds)
        try c.encode(transcribeMs, forKey: .transcribeMs)
        try c.encode(engine, forKey: .engine)
        try c.encode(model, forKey: .model)
        try c.encode(ok, forKey: .ok)
        try c.encode(site, forKey: .site)
        try c.encode(errorCode, forKey: .errorCode)
        try c.encodeIfPresent(transcript, forKey: .transcript)
    }
}

public struct DayRollup: Codable, Equatable, Sendable {
    public var day: String
    public var audioSeconds: Double
    public var transcribeMs: Int
    public var ok: Int
    public var fail: Int
    public var parakeet: Int
    public var whisper: Int
    public var bySite: [String: Int]
    public var shortNotes: Int
    public var mediumNotes: Int
    public var longNotes: Int

    public static func empty(day: String) -> DayRollup {
        DayRollup(
            day: day,
            audioSeconds: 0,
            transcribeMs: 0,
            ok: 0,
            fail: 0,
            parakeet: 0,
            whisper: 0,
            bySite: [:],
            shortNotes: 0,
            mediumNotes: 0,
            longNotes: 0
        )
    }
}

public struct WeekBar: Equatable, Sendable, Identifiable {
    public var day: String
    public var notes: Int
    public var id: String { day }
}

public enum ActivityRange: String, Sendable {
    case today
    case week
    case all
}

public struct ActivitySummary: Equatable, Sendable {
    public var notes: Int
    public var fails: Int
    public var audioSeconds: Double
    public var speed: Double?
    public var medianMs: Int?
    public var slowMs: Int?
    public var parakeet: Int
    public var whisper: Int
    public var shortNotes: Int
    public var mediumNotes: Int
    public var longNotes: Int
}

public struct StatsSnapshot: Equatable, Sendable {
    public var processedCount: Int
    public var totalAudioSeconds: Double
    public var okCount: Int
    public var failCount: Int
    public var parakeetCount: Int
    public var whisperCount: Int
    public var medianMs: Int?
    public var p95Ms: Int?
    public var recent: [JobRecord]
    public var days: [DayRollup]

    public static let empty = StatsSnapshot(
        processedCount: 0,
        totalAudioSeconds: 0,
        okCount: 0,
        failCount: 0,
        parakeetCount: 0,
        whisperCount: 0,
        medianMs: nil,
        p95Ms: nil,
        recent: [],
        days: []
    )

    public func activity(
        _ range: ActivityRange,
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> ActivitySummary {
        let keys = Self.dayKeys(range, now: now, calendar: calendar)
        let chosen = keys == nil ? days : days.filter { keys!.contains($0.day) }
        let jobs = keys == nil ? recent : recent.filter { keys!.contains(StatsStore.dayKey($0.at, calendar: calendar)) }
        let okJobs = jobs.filter { $0.ok && $0.transcribeMs > 0 }
        let samples = okJobs.map(\.transcribeMs)

        if range == .all {
            let measuredMs = days.reduce(0) { $0 + $1.transcribeMs }
            let measuredAudio = days.reduce(0.0) { $0 + ($1.transcribeMs > 0 ? $1.audioSeconds : 0) }
            let speed = Self.speed(audio: measuredAudio, ms: measuredMs)
                ?? Self.speed(audio: okJobs.reduce(0) { $0 + $1.audioSeconds }, ms: samples.reduce(0, +))
            return ActivitySummary(
                notes: processedCount,
                fails: failCount,
                audioSeconds: totalAudioSeconds,
                speed: speed,
                medianMs: StatsStore.percentile(samples, 0.5),
                slowMs: StatsStore.percentile(samples, 0.95),
                parakeet: parakeetCount,
                whisper: whisperCount,
                shortNotes: days.reduce(0) { $0 + $1.shortNotes },
                mediumNotes: days.reduce(0) { $0 + $1.mediumNotes },
                longNotes: days.reduce(0) { $0 + $1.longNotes }
            )
        }

        let audio = chosen.reduce(0.0) { $0 + $1.audioSeconds }
        let ms = chosen.reduce(0) { $0 + $1.transcribeMs }
        return ActivitySummary(
            notes: chosen.reduce(0) { $0 + $1.ok },
            fails: chosen.reduce(0) { $0 + $1.fail },
            audioSeconds: audio,
            speed: Self.speed(audio: audio, ms: ms),
            medianMs: StatsStore.percentile(samples, 0.5),
            slowMs: nil,
            parakeet: chosen.reduce(0) { $0 + $1.parakeet },
            whisper: chosen.reduce(0) { $0 + $1.whisper },
            shortNotes: chosen.reduce(0) { $0 + $1.shortNotes },
            mediumNotes: chosen.reduce(0) { $0 + $1.mediumNotes },
            longNotes: chosen.reduce(0) { $0 + $1.longNotes }
        )
    }

    public func recentActivity(
        _ range: ActivityRange,
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> [JobRecord] {
        guard let keys = Self.dayKeys(range, now: now, calendar: calendar) else { return recent }
        return recent.filter { keys.contains(StatsStore.dayKey($0.at, calendar: calendar)) }
    }

    public func weekBars(now: Date = Date(), calendar: Calendar = .current) -> [WeekBar] {
        guard let keys = Self.dayKeys(.week, now: now, calendar: calendar) else { return [] }
        return keys.map { key in
            WeekBar(day: key, notes: days.first { $0.day == key }?.ok ?? 0)
        }
    }

    private static func speed(audio: Double, ms: Int) -> Double? {
        guard ms > 0, audio > 0 else { return nil }
        return audio / (Double(ms) / 1000)
    }

    private static func dayKeys(_ range: ActivityRange, now: Date, calendar: Calendar) -> [String]? {
        if range == .all { return nil }
        let count = range == .today ? 1 : 7
        let start = calendar.startOfDay(for: now)
        var keys: [String] = []
        for offset in stride(from: -(count - 1), through: 0, by: 1) {
            guard let date = calendar.date(byAdding: .day, value: offset, to: start) else { continue }
            keys.append(StatsStore.dayKey(date, calendar: calendar))
        }
        return keys
    }
}

private struct StatsFile: Codable {
    var processedCount: Int = 0
    var totalAudioSeconds: Double = 0
    var okCount: Int = 0
    var failCount: Int = 0
    var parakeetCount: Int = 0
    var whisperCount: Int = 0
    var jobs: [JobRecord] = []
    var days: [DayRollup] = []

    private enum CodingKeys: String, CodingKey {
        case processedCount, totalAudioSeconds, okCount, failCount, parakeetCount, whisperCount, jobs, days
    }

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        processedCount = try c.decodeIfPresent(Int.self, forKey: .processedCount) ?? 0
        totalAudioSeconds = try c.decodeIfPresent(Double.self, forKey: .totalAudioSeconds) ?? 0
        okCount = try c.decodeIfPresent(Int.self, forKey: .okCount) ?? 0
        failCount = try c.decodeIfPresent(Int.self, forKey: .failCount) ?? 0
        parakeetCount = try c.decodeIfPresent(Int.self, forKey: .parakeetCount) ?? 0
        whisperCount = try c.decodeIfPresent(Int.self, forKey: .whisperCount) ?? 0
        jobs = try c.decodeIfPresent([JobRecord].self, forKey: .jobs) ?? []
        days = try c.decodeIfPresent([DayRollup].self, forKey: .days) ?? []
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(processedCount, forKey: .processedCount)
        try c.encode(totalAudioSeconds, forKey: .totalAudioSeconds)
        try c.encode(okCount, forKey: .okCount)
        try c.encode(failCount, forKey: .failCount)
        try c.encode(parakeetCount, forKey: .parakeetCount)
        try c.encode(whisperCount, forKey: .whisperCount)
        try c.encode(jobs, forKey: .jobs)
        try c.encode(days, forKey: .days)
    }
}

public final class StatsStore: @unchecked Sendable {
    public static let recentLimit = 500
    public static let dayLimit = 400
    public static let knownSites: Set<String> = Set(CompanionSettings.siteCatalog)
    public static let errorCodes: Set<String> = [
        "timeout", "no_audio", "model_loading", "decode", "http", "generic",
    ]

    private let lock = NSLock()
    private var file: StatsFile
    private let fileURL: URL

    public init(directory: URL) {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        fileURL = directory.appendingPathComponent("stats.json")
        if let data = try? Data(contentsOf: fileURL),
           let decoded = try? CompanionJSON.decoder.decode(StatsFile.self, from: data) {
            file = decoded
        } else {
            file = StatsFile()
        }
    }

    public func snapshot() -> StatsSnapshot {
        lock.lock()
        defer { lock.unlock() }
        return makeSnapshotLocked()
    }

    @discardableResult
    public func record(
        audioSeconds: Double,
        transcribeMs: Int,
        engine: String,
        model: String,
        ok: Bool,
        site: String = "whatsapp",
        errorCode: String = "",
        transcript: String? = nil,
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> StatsSnapshot {
        lock.lock()
        defer { lock.unlock() }
        let seconds = max(0, audioSeconds)
        let ms = max(0, transcribeMs)
        let cleanEngine = String(engine.prefix(40)).trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let cleanModel = String(model.prefix(120))
        let cleanSite = Self.cleanSite(site)
        let cleanError = ok ? "" : Self.cleanError(errorCode)
        let job = JobRecord(
            at: now,
            audioSeconds: seconds,
            transcribeMs: ms,
            engine: cleanEngine.isEmpty ? "whisper" : cleanEngine,
            model: cleanModel,
            ok: ok,
            site: cleanSite,
            errorCode: cleanError,
            transcript: ok ? transcript : nil
        )
        file.jobs.insert(job, at: 0)
        if file.jobs.count > Self.recentLimit {
            file.jobs.removeLast(file.jobs.count - Self.recentLimit)
        }
        let key = Self.dayKey(now, calendar: calendar)
        var day = file.days.first { $0.day == key } ?? DayRollup.empty(day: key)
        if ok {
            file.okCount += 1
            file.processedCount += 1
            file.totalAudioSeconds += seconds
            day.ok += 1
            day.audioSeconds += seconds
            day.transcribeMs += ms
            if cleanEngine == "parakeet" {
                file.parakeetCount += 1
                day.parakeet += 1
            } else if cleanEngine == "whisper" {
                file.whisperCount += 1
                day.whisper += 1
            }
            switch Self.lengthBucket(seconds) {
            case "short": day.shortNotes += 1
            case "medium": day.mediumNotes += 1
            default: day.longNotes += 1
            }
            if Self.knownSites.contains(cleanSite) {
                day.bySite[cleanSite, default: 0] += 1
            }
        } else {
            file.failCount += 1
            day.fail += 1
        }
        if let index = file.days.firstIndex(where: { $0.day == key }) {
            file.days[index] = day
        } else {
            file.days.append(day)
        }
        file.days.sort { $0.day < $1.day }
        if file.days.count > Self.dayLimit {
            file.days.removeFirst(file.days.count - Self.dayLimit)
        }
        if let data = try? CompanionJSON.encoder.encode(file) {
            try? data.write(to: fileURL, options: .atomic)
        }
        return makeSnapshotLocked()
    }

    public static func dayKey(_ date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /// Removes saved text while preserving activity and aggregate statistics.
    public func clearTranscripts() throws {
        lock.lock()
        defer { lock.unlock() }
        var next = file
        for index in next.jobs.indices { next.jobs[index].transcript = nil }
        let data = try CompanionJSON.encoder.encode(next)
        try data.write(to: fileURL, options: .atomic)
        file = next
    }

    public static func cleanSite(_ raw: String) -> String {
        let id = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return knownSites.contains(id) ? id : "unknown"
    }

    public static func cleanError(_ raw: String) -> String {
        let code = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return errorCodes.contains(code) ? code : "generic"
    }

    public static func lengthBucket(_ seconds: Double) -> String {
        if seconds < 15 { return "short" }
        if seconds <= 45 { return "medium" }
        return "long"
    }

    public static func percentile(_ values: [Int], _ p: Double) -> Int? {
        guard !values.isEmpty else { return nil }
        let sorted = values.sorted()
        let rank = (Double(sorted.count - 1) * p).rounded()
        let index = min(sorted.count - 1, max(0, Int(rank)))
        return sorted[index]
    }

    private func makeSnapshotLocked() -> StatsSnapshot {
        let samples = file.jobs.filter { $0.ok && $0.transcribeMs > 0 }.map(\.transcribeMs)
        return StatsSnapshot(
            processedCount: file.processedCount,
            totalAudioSeconds: file.totalAudioSeconds,
            okCount: file.okCount,
            failCount: file.failCount,
            parakeetCount: file.parakeetCount,
            whisperCount: file.whisperCount,
            medianMs: Self.percentile(samples, 0.5),
            p95Ms: Self.percentile(samples, 0.95),
            recent: file.jobs,
            days: file.days
        )
    }
}
