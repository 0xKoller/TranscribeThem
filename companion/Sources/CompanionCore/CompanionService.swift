import Foundation

public struct ExtensionHello: Equatable, Sendable {
    public var version: String
    public var browser: String
    public var seenAt: Date

    public init(version: String, browser: String, seenAt: Date) {
        self.version = version
        self.browser = browser
        self.seenAt = seenAt
    }
}

public final class CompanionService: @unchecked Sendable {
    public let settings: SettingsStore
    public let stats: StatsStore
    /// The update the app is offering, if any. GET /health passes it on.
    public let updateOffer = UpdateOffer()
    public var onChange: (@Sendable () -> Void)?
    public var onOpen: (@Sendable () -> Void)?

    private let historyLock = NSLock()
    private let helloLock = NSLock()
    private var helloValue: ExtensionHello?

    public init(directory: URL) {
        settings = SettingsStore(directory: directory)
        stats = StatsStore(directory: directory)
    }

    public var hello: ExtensionHello? {
        helloLock.lock()
        defer { helloLock.unlock() }
        return helloValue
    }

    public func noteHello(version: String, browser: String, now: Date = Date()) {
        let cleanVersion = String(version.prefix(40))
        let cleanBrowser = String(browser.prefix(40)).trimmingCharacters(in: .whitespacesAndNewlines)
        helloLock.lock()
        helloValue = ExtensionHello(
            version: cleanVersion,
            browser: cleanBrowser.isEmpty ? "chrome" : cleanBrowser,
            seenAt: now
        )
        helloLock.unlock()
        onChange?()
    }

    @discardableResult
    public func updateSettings(json: [String: Any], now: Date = Date()) -> CompanionSettings {
        historyLock.lock()
        defer { historyLock.unlock() }
        let next = settings.update(json: json, now: now)
        onChange?()
        return next
    }

    public func recordJob(
        audioSeconds: Double,
        transcribeMs: Int,
        engine: String,
        model: String,
        ok: Bool,
        site: String = "whatsapp",
        errorCode: String = "",
        transcript: String? = nil,
        now: Date = Date()
    ) {
        historyLock.lock()
        defer { historyLock.unlock() }
        stats.record(
            audioSeconds: audioSeconds,
            transcribeMs: transcribeMs,
            engine: engine,
            model: model,
            ok: ok,
            site: site,
            errorCode: errorCode,
            transcript: settings.current.saveTranscripts && ok ? transcript : nil,
            now: now
        )
        onChange?()
    }

    public func clearSavedTranscripts() throws {
        historyLock.lock()
        defer { historyLock.unlock() }
        try stats.clearTranscripts()
        onChange?()
    }

    public func requestOpen() {
        onOpen?()
    }
}
