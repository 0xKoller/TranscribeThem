import Foundation

public enum TextActionKind: String, Equatable, Sendable {
    case summarize
    case translate
}

public enum TextActionFailureCode: String, Equatable, Sendable {
    case unavailable
    case badRequest = "bad_request"
    case failed
}

public struct TextPrompt: Equatable, Sendable {
    public var instructions: String
    public var prompt: String

    public init(instructions: String, prompt: String) {
        self.instructions = instructions
        self.prompt = prompt
    }
}

public enum TextActionValidation: Equatable, Sendable {
    case ready(action: TextActionKind, prompt: TextPrompt)
    case rejected(code: TextActionFailureCode, message: String)
}

public enum TextRequests {
    public static let maxCharacters = 20_000

    public static let unavailableMessage = "El modelo de lenguaje en el dispositivo no está disponible en esta Mac."
    public static let emptyResultMessage = "El modelo en el dispositivo no devolvió texto."

    public static func validate(
        action rawAction: String?,
        text rawText: String?,
        targetLanguage rawLanguage: String?
    ) -> TextActionValidation {
        guard let rawAction, let action = TextActionKind(rawValue: rawAction) else {
            return .rejected(code: .badRequest, message: "La acción debe ser summarize o translate.")
        }
        guard let rawText else {
            return .rejected(code: .badRequest, message: "Falta el texto.")
        }
        if rawText.count > maxCharacters {
            return .rejected(code: .badRequest, message: "El texto supera los 20000 caracteres.")
        }
        let text = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty {
            return .rejected(code: .badRequest, message: "El texto está vacío.")
        }

        switch action {
        case .summarize:
            return .ready(action: action, prompt: summarizePrompt(text))
        case .translate:
            guard let language = normalizedLanguage(rawLanguage) else {
                return .rejected(code: .badRequest, message: "targetLanguage debe ser es o en.")
            }
            return .ready(action: action, prompt: translatePrompt(text, language: language))
        }
    }

    public static func summarizePrompt(_ text: String) -> TextPrompt {
        TextPrompt(
            instructions: "Resume la transcripción en una o dos frases cortas, mucho más breves que el original: solo lo esencial, sin repetir los detalles. Usa el mismo idioma que el texto de entrada. Devuelve solo el resumen, sin título ni preámbulo.",
            prompt: text
        )
    }

    public static func translatePrompt(_ text: String, language: String) -> TextPrompt {
        let name = language == "en" ? "inglés" : "español"
        return TextPrompt(
            instructions: "Traduce la transcripción al \(name). Devuelve solo la traducción, sin notas ni preámbulo.",
            prompt: "Idioma de destino: \(language)\n\n\(text)"
        )
    }

    private static func normalizedLanguage(_ raw: String?) -> String? {
        switch raw?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "es": return "es"
        case "en": return "en"
        default: return nil
        }
    }
}
