import CompanionCore
import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

enum OnDeviceTextActions {
    static var isReady: Bool {
        #if canImport(FoundationModels)
        if #available(macOS 26.0, *) {
            return SystemLanguageModel.default.isAvailable
        }
        #endif
        return false
    }

    static var features: (summarize: Bool, translate: Bool) {
        let ready = isReady
        return (ready, ready)
    }

    static func generate(_ prompt: TextPrompt) async throws -> String {
        #if canImport(FoundationModels)
        if #available(macOS 26.0, *) {
            return try await generateOnDevice(prompt)
        }
        #endif
        throw OnDeviceTextError.unavailable
    }

    #if canImport(FoundationModels)
    @available(macOS 26.0, *)
    private static func generateOnDevice(_ prompt: TextPrompt) async throws -> String {
        let session = LanguageModelSession(instructions: prompt.instructions)
        let response = try await session.respond(to: prompt.prompt)
        let text = response.content.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty {
            throw OnDeviceTextError.empty
        }
        return text
    }
    #endif
}

enum OnDeviceTextError: LocalizedError, Equatable {
    case unavailable
    case empty

    var errorDescription: String? {
        switch self {
        case .unavailable: TextRequests.unavailableMessage
        case .empty: TextRequests.emptyResultMessage
        }
    }
}
