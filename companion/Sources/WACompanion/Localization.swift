import Foundation

enum AppLanguage {
    static var code: String {
        let selected = UserDefaults.standard.string(forKey: "appLanguage") ?? "system"
        if selected == "es" || selected == "en" { return selected }
        return Locale.preferredLanguages.first?.hasPrefix("es") == true ? "es" : "en"
    }
    static func locale(_ selection: String) -> Locale {
        Locale(identifier: selection == "system" ? code : selection)
    }
    static var currentLocale: Locale { Locale(identifier: code) }
    static var bundle: Bundle {
        guard let path = Bundle.main.path(forResource: code, ofType: "lproj"), let bundle = Bundle(path: path) else { return .main }
        return bundle
    }
}
func L(_ key: String) -> String {
    AppLanguage.bundle.localizedString(forKey: key, value: key, table: nil)
}
func LF(_ key: String, _ arguments: CVarArg...) -> String {
    String(format: L(key), locale: AppLanguage.currentLocale, arguments: arguments)
}
extension Notification.Name {
    static let appLanguageChanged = Notification.Name("TranscribeThem.appLanguageChanged")
}
