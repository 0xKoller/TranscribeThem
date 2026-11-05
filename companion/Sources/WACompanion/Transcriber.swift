import Foundation
import AVFoundation
import Darwin
import FluidAudio

public actor Transcriber {
    public static let shared = Transcriber()

    public struct TimedWord: Codable, Sendable {
        public let text: String
        public let start: Double
        public let end: Double
    }

    public struct Result: Codable, Sendable {
        public let text: String
        public let audioSeconds: Double
        public let transcribeMs: Int
        public let engine: String
        public let model: String
        public let decoder: String
        public let words: [TimedWord]
    }

    public struct Stats: Sendable {
        public var processedCount: Int = 0
        public var totalAudioSeconds: Double = 0
        public var lastAudioSeconds: Double = 0
        public var lastTranscribeMs: Int = 0
        public var lastTranscribedAt: Date? = nil
        public var lastText: String = ""
    }

    private var manager: AsrManager?
    private var isReady: Bool = false
    private var isLoading: Bool = false
    private var stats = Stats()

    public init() {}

    public var ready: Bool {
        return isReady
    }

    public var currentStats: Stats {
        return stats
    }

    nonisolated private func fetchAndLoadModels() async throws -> AsrManager {
        let models = try await AsrModels.downloadAndLoad(version: .v3)
        let asr = AsrManager(config: .default)
        try await asr.loadModels(models)
        return asr
    }

    public func loadModels() async throws {
        if isReady || isLoading {
            return
        }
        isLoading = true

        do {
            let t0 = ContinuousClock.now
            let asr = try await fetchAndLoadModels()

            let d = t0.duration(to: .now)
            let ms = Int(d.components.seconds * 1000 + d.components.attoseconds / 1_000_000_000_000_000)
            NSLog("[WACompanion] Parakeet v3 models loaded in %d ms", ms)

            self.manager = asr
            self.isReady = true
            self.isLoading = false
        } catch {
            self.isLoading = false
            NSLog("[WACompanion] Failed to load Parakeet models: %@", error.localizedDescription)
            throw error
        }
    }

    private func findFFmpeg() -> URL? {
        let candidates = [
            "/opt/homebrew/bin/ffmpeg",
            "/usr/local/bin/ffmpeg",
            "/usr/bin/ffmpeg"
        ]
        for c in candidates {
            if FileManager.default.isExecutableFile(atPath: c) {
                return URL(fileURLWithPath: c)
            }
        }
        return nil
    }

    private func convertViaFFmpeg(input: URL) throws -> URL {
        guard let ffmpeg = findFFmpeg() else {
            throw NSError(domain: "Transcriber", code: 2, userInfo: [NSLocalizedDescriptionKey: "ffmpeg not found for fallback decoding"])
        }
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("parakeet-conv-\(UUID().uuidString).wav")
        let p = Process()
        p.executableURL = ffmpeg
        p.arguments = ["-v", "error", "-y", "-i", input.path, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", out.path]
        try p.run()
        p.waitUntilExit()
        guard p.terminationStatus == 0 else {
            throw NSError(domain: "Transcriber", code: Int(p.terminationStatus), userInfo: [NSLocalizedDescriptionKey: "ffmpeg conversion failed"])
        }
        return out
    }

    public func transcribe(
        audioData: Data,
        mimeType: String? = nil,
        languageHint: String? = nil
    ) async throws -> Result {
        guard let asr = manager, isReady else {
            throw NSError(domain: "Transcriber", code: 1, userInfo: [NSLocalizedDescriptionKey: "Model not loaded yet"])
        }

        let mime = (mimeType ?? "").lowercased()
        let ext: String
        if mime.contains("ogg") || mime.contains("opus") {
            ext = "ogg"
        } else if mime.contains("m4a") || mime.contains("mp4") || mime.contains("aac") {
            ext = "m4a"
        } else if mime.contains("wav") {
            ext = "wav"
        } else if mime.contains("webm") {
            ext = "webm"
        } else {
            ext = "ogg"
        }

        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("wa-note-\(UUID().uuidString).\(ext)")
        try audioData.write(to: tempURL)
        defer { try? FileManager.default.removeItem(at: tempURL) }

        var targetURL = tempURL
        var convertedURL: URL? = nil
        var decoder = "AVFoundation-direct"

        // Verify if AVFoundation can read it directly
        do {
            _ = try AVAudioFile(forReading: tempURL)
            _ = try AudioConverter().resampleAudioFile(tempURL)
        } catch {
            // Fallback to ffmpeg
            let wavURL = try convertViaFFmpeg(input: tempURL)
            targetURL = wavURL
            convertedURL = wavURL
            decoder = "ffmpeg->wav16k"
        }
        defer {
            if let c = convertedURL {
                try? FileManager.default.removeItem(at: c)
            }
        }

        let lang: Language?
        let l = (languageHint ?? "es").lowercased()
        if l == "es" || l == "spanish" {
            lang = .spanish
        } else if l == "en" || l == "english" {
            lang = .english
        } else if l == "none" || l.isEmpty {
            lang = nil
        } else {
            lang = Language(rawValue: l)
        }

        var state = TdtDecoderState.make()
        let t0 = ContinuousClock.now
        let asrResult = try await asr.transcribe(targetURL, decoderState: &state, language: lang)
        let d = t0.duration(to: .now)
        let transcribeMs = Int(d.components.seconds * 1000 + d.components.attoseconds / 1_000_000_000_000_000)

        let words = buildWordTimings(from: asrResult.tokenTimings ?? []).map { timing in
            TimedWord(text: timing.word, start: timing.startTime, end: timing.endTime)
        }
        let result = Result(
            text: asrResult.text,
            audioSeconds: asrResult.duration,
            transcribeMs: transcribeMs,
            engine: "parakeet",
            model: "parakeet-tdt-0.6b-v3",
            decoder: decoder,
            words: words
        )

        stats.processedCount += 1
        stats.totalAudioSeconds += asrResult.duration
        stats.lastAudioSeconds = asrResult.duration
        stats.lastTranscribeMs = transcribeMs
        stats.lastTranscribedAt = Date()
        stats.lastText = asrResult.text

        return result
    }
}
