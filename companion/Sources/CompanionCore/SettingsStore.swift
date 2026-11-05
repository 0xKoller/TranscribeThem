import Foundation

public enum CompanionJSON {
    public static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    public static let apiEncoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    public static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}

public struct CompanionSettings: Codable, Equatable, Sendable {
    public var languageMode: String
    public var modelId: String
    public var useCompanion: Bool
    public var debugMode: Bool
    public var polishEnabled: Bool
    public var launchAtLogin: Bool
    public var updatedAt: Date
    public var engineMode: String
    public var sites: [String: Bool]
    public var openAtLaunch: Bool
    public var highlightWords: Bool

    public static let defaultModelId = "onnx-community/whisper-small"
    public static let allowedModelIds: Set<String> = [
        "onnx-community/whisper-small",
        "Xenova/whisper-medium",
        "onnx-community/whisper-large-v3-turbo",
    ]
    public static let modelAliases = [
        "onnx-community/whisper-medium": "Xenova/whisper-medium",
    ]
    public static let engineModes: Set<String> = ["auto", "companion", "browser"]
    public static let siteCatalog = ["whatsapp"]

    public init(
        languageMode: String,
        modelId: String,
        useCompanion: Bool,
        debugMode: Bool,
        polishEnabled: Bool,
        launchAtLogin: Bool,
        updatedAt: Date,
        engineMode: String = "auto",
        sites: [String: Bool] = ["whatsapp": true],
        openAtLaunch: Bool = false,
        highlightWords: Bool = true
    ) {
        self.languageMode = languageMode
        self.modelId = modelId
        self.useCompanion = useCompanion
        self.debugMode = debugMode
        self.polishEnabled = polishEnabled
        self.launchAtLogin = launchAtLogin
        self.updatedAt = updatedAt
        self.engineMode = engineMode
        self.sites = sites
        self.openAtLaunch = openAtLaunch
        self.highlightWords = highlightWords
    }

    public static func fresh(now: Date = Date()) -> CompanionSettings {
        CompanionSettings(
            languageMode: "es",
            modelId: defaultModelId,
            useCompanion: true,
            debugMode: false,
            polishEnabled: false,
            launchAtLogin: false,
            updatedAt: now
        )
    }

    public func sanitized() -> CompanionSettings {
        var copy = self
        if copy.languageMode != "en" && copy.languageMode != "auto" {
            copy.languageMode = "es"
        }
        if let alias = Self.modelAliases[copy.modelId] {
            copy.modelId = alias
        }
        if !Self.allowedModelIds.contains(copy.modelId) {
            copy.modelId = Self.defaultModelId
        }
        if !Self.engineModes.contains(copy.engineMode) {
            copy.engineMode = copy.useCompanion ? "auto" : "browser"
        }
        copy.useCompanion = copy.engineMode != "browser"
        var clean: [String: Bool] = [:]
        for id in Self.siteCatalog {
            clean[id] = copy.sites[id] ?? true
        }
        copy.sites = clean
        return copy
    }

    private enum CodingKeys: String, CodingKey {
        case languageMode, modelId, useCompanion, debugMode, polishEnabled, launchAtLogin, updatedAt
        case engineMode, sites, openAtLaunch, highlightWords
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let language = try c.decodeIfPresent(String.self, forKey: .languageMode) ?? "es"
        let model = try c.decodeIfPresent(String.self, forKey: .modelId) ?? Self.defaultModelId
        let companion = try c.decodeIfPresent(Bool.self, forKey: .useCompanion) ?? true
        let rawEngine = try c.decodeIfPresent(String.self, forKey: .engineMode)
        let engine = Self.engineModes.contains(rawEngine ?? "")
            ? rawEngine!
            : (companion ? "auto" : "browser")
        let rawSites = try c.decodeIfPresent([String: Bool].self, forKey: .sites) ?? [:]
        var sites: [String: Bool] = [:]
        for id in Self.siteCatalog {
            sites[id] = rawSites[id] ?? true
        }
        self.init(
            languageMode: language,
            modelId: model,
            useCompanion: companion,
            debugMode: try c.decodeIfPresent(Bool.self, forKey: .debugMode) ?? false,
            polishEnabled: try c.decodeIfPresent(Bool.self, forKey: .polishEnabled) ?? false,
            launchAtLogin: try c.decodeIfPresent(Bool.self, forKey: .launchAtLogin) ?? false,
            updatedAt: try c.decodeIfPresent(Date.self, forKey: .updatedAt) ?? Date(),
            engineMode: engine,
            sites: sites,
            openAtLaunch: try c.decodeIfPresent(Bool.self, forKey: .openAtLaunch) ?? false,
            highlightWords: try c.decodeIfPresent(Bool.self, forKey: .highlightWords) ?? true
        )
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(languageMode, forKey: .languageMode)
        try c.encode(modelId, forKey: .modelId)
        try c.encode(useCompanion, forKey: .useCompanion)
        try c.encode(debugMode, forKey: .debugMode)
        try c.encode(polishEnabled, forKey: .polishEnabled)
        try c.encode(launchAtLogin, forKey: .launchAtLogin)
        try c.encode(updatedAt, forKey: .updatedAt)
        try c.encode(engineMode, forKey: .engineMode)
        try c.encode(sites, forKey: .sites)
        try c.encode(openAtLaunch, forKey: .openAtLaunch)
        try c.encode(highlightWords, forKey: .highlightWords)
    }
}

public enum AppSupport {
    public static func directory() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        let dir = base.appendingPathComponent("WA Local Transcribe", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
}

public final class SettingsStore: @unchecked Sendable {
    private let lock = NSLock()
    private var settings: CompanionSettings
    private let fileURL: URL
    public let fileWasMissing: Bool

    public init(directory: URL) {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        fileURL = directory.appendingPathComponent("settings.json")
        if let data = try? Data(contentsOf: fileURL),
           let decoded = try? CompanionJSON.decoder.decode(CompanionSettings.self, from: data) {
            settings = decoded.sanitized()
            fileWasMissing = false
        } else {
            settings = .fresh()
            fileWasMissing = true
        }
    }

    public var current: CompanionSettings {
        lock.lock()
        defer { lock.unlock() }
        return settings
    }

    @discardableResult
    public func update(json: [String: Any], now: Date = Date()) -> CompanionSettings {
        lock.lock()
        defer { lock.unlock() }
        if let lang = json["languageMode"] as? String {
            if lang == "en" || lang == "auto" {
                settings.languageMode = lang
            } else {
                settings.languageMode = "es"
            }
        }
        if let rawModel = json["modelId"] as? String {
            let aliased = CompanionSettings.modelAliases[rawModel] ?? rawModel
            if CompanionSettings.allowedModelIds.contains(aliased) {
                settings.modelId = aliased
            }
        }
        if let mode = json["engineMode"] as? String, CompanionSettings.engineModes.contains(mode) {
            settings.engineMode = mode
            settings.useCompanion = mode != "browser"
        } else if let value = Self.bool(json["useCompanion"]) {
            settings.useCompanion = value
            if !value {
                settings.engineMode = "browser"
            } else if settings.engineMode == "browser" {
                settings.engineMode = "auto"
            }
        }
        if let rawSites = json["sites"] {
            mergeSitesLocked(rawSites)
        }
        if let value = Self.bool(json["debugMode"]) {
            settings.debugMode = value
        }
        if let value = Self.bool(json["polishEnabled"]) {
            settings.polishEnabled = value
        }
        if let value = Self.bool(json["launchAtLogin"]) {
            settings.launchAtLogin = value
        }
        if let value = Self.bool(json["openAtLaunch"]) {
            settings.openAtLaunch = value
        }
        if let value = Self.bool(json["highlightWords"]) {
            settings.highlightWords = value
        }
        settings.updatedAt = now
        settings = settings.sanitized()
        persistLocked()
        return settings
    }

    public func save(_ next: CompanionSettings) {
        lock.lock()
        defer { lock.unlock() }
        settings = next.sanitized()
        persistLocked()
    }

    private func mergeSitesLocked(_ raw: Any) {
        let pairs: [(String, Bool)]
        if let typed = raw as? [String: Bool] {
            pairs = typed.map { ($0.key, $0.value) }
        } else if let typed = raw as? [String: Any] {
            pairs = typed.compactMap { key, value in
                guard let flag = Self.bool(value) else { return nil }
                return (key, flag)
            }
        } else {
            return
        }
        for (key, value) in pairs where CompanionSettings.siteCatalog.contains(key) {
            settings.sites[key] = value
        }
    }

    private func persistLocked() {
        guard let data = try? CompanionJSON.encoder.encode(settings) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    private static func bool(_ value: Any?) -> Bool? {
        if let value = value as? Bool { return value }
        if let value = value as? NSNumber { return value.boolValue }
        return nil
    }
}
