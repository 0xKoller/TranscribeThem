import Foundation
import FluidAudio

enum NativeModel: String, CaseIterable, Identifiable, Sendable {
    case v3, v2, ultra
    var id: String { rawValue }
    var name: String {
        switch self {
        case .v3: "Parakeet v3"
        case .v2: "Parakeet v2"
        case .ultra: "Parakeet Ultra"
        }
    }
    var version: AsrModelVersion {
        switch self {
        case .v3: .v3
        case .v2: .v2
        case .ultra: .ultra
        }
    }
    var identifier: String {
        switch self {
        case .v3: "parakeet-tdt-0.6b-v3"
        case .v2: "parakeet-tdt-0.6b-v2"
        case .ultra: "parakeet-ultra"
        }
    }
    var cache: URL { AsrModels.defaultCacheDirectory(for: version) }
    var cached: Bool { AsrModels.modelsExist(at: cache, version: version) }
}
