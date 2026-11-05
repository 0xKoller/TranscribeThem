import CompanionCore
import Foundation
import Observation
import ServiceManagement

@MainActor
@Observable
final class AppModel {
    private let service: CompanionService

    var settings: CompanionSettings
    var stats: StatsSnapshot
    var modelReady = false
    var modelLine = "Cargando modelo Parakeet v3…"
    var serverReady = false
    var serverLine = "Iniciando…"
    var extensionVersion: String?
    var extensionBrowser: String?
    var extensionSeenAt: Date?
    var loginDetail = ""
    var loginError: String?
    var modelFailed = false

    init(service: CompanionService) {
        self.service = service
        settings = service.settings.current
        stats = service.stats.snapshot()
        loginDetail = LoginItem.detail
    }

    var extensionConnected: Bool {
        guard let seen = extensionSeenAt else { return false }
        return Date().timeIntervalSince(seen) < 15 * 60
    }

    func refresh() {
        settings = service.settings.current
        stats = service.stats.snapshot()
        if let hello = service.hello {
            extensionVersion = hello.version
            extensionBrowser = hello.browser
            extensionSeenAt = hello.seenAt
        }
        loginDetail = LoginItem.detail
    }

    func setLanguage(_ value: String) {
        service.updateSettings(json: ["languageMode": value])
        refresh()
    }

    func setDebug(_ value: Bool) {
        service.updateSettings(json: ["debugMode": value])
        refresh()
    }

    func setUseCompanion(_ value: Bool) {
        service.updateSettings(json: ["useCompanion": value])
        refresh()
    }

    func setModel(_ value: String) {
        service.updateSettings(json: ["modelId": value])
        refresh()
    }

    func setEngine(_ value: String) {
        service.updateSettings(json: ["engineMode": value])
        refresh()
    }

    func setSite(_ id: String, _ enabled: Bool) {
        service.updateSettings(json: ["sites": [id: enabled]])
        refresh()
    }

    func setOpenAtLaunch(_ value: Bool) {
        service.updateSettings(json: ["openAtLaunch": value])
        refresh()
    }

    func setHighlight(_ value: Bool) {
        service.updateSettings(json: ["highlightWords": value])
        refresh()
    }

    func setLaunchAtLogin(_ value: Bool) {
        service.updateSettings(json: ["launchAtLogin": value])
        loginError = LoginItem.apply(value)
        refresh()
    }

    func applyLaunchAtLoginIfNeeded() {
        guard settings.launchAtLogin else { return }
        loginError = LoginItem.apply(true)
        loginDetail = LoginItem.detail
    }
}

enum LoginItem {
    static func apply(_ enabled: Bool) -> String? {
        do {
            let service = SMAppService.mainApp
            if enabled {
                if service.status != .enabled {
                    try service.register()
                }
            } else if service.status == .enabled {
                try service.unregister()
            }
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    static var detail: String {
        switch SMAppService.mainApp.status {
        case .enabled:
            return "Se abre al iniciar sesión."
        case .requiresApproval:
            return "Aceptala en Ajustes del Sistema → General → Ítems de inicio."
        case .notRegistered:
            return "No se abre sola al iniciar sesión."
        case .notFound:
            return "Para el inicio de sesión, mové la app a Aplicaciones."
        default:
            return ""
        }
    }
}
