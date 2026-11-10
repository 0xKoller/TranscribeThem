import CompanionCore
import SwiftUI

struct SettingsView: View {
    @Bindable var model: AppModel
    @AppStorage("appearance") private var appearance = "system"
    @AppStorage("appLanguage") private var appLanguage = "system"

    var body: some View {
        TabView {
            SettingsContent(model: model, appearance: $appearance)
                .tabItem { Label(L("General"), systemImage: "gearshape") }
            ModelsView(model: model)
                .tabItem { Label(L("Motor y modelos"), systemImage: "cpu") }
        }
            .frame(width: 620, height: 660)
            .environment(\.locale, AppLanguage.locale(appLanguage))
            .preferredColorScheme(appearance == "dark" ? .dark : appearance == "light" ? .light : nil)
    }
}

struct SettingsContent: View {
    @Bindable var model: AppModel
    @Binding var appearance: String
    @State private var confirmClear = false
    @AppStorage("appLanguage") private var appLanguage = "system"
    @Environment(\.colorScheme) private var colorScheme
    private var palette: VoicePalette { VoicePalette(colorScheme) }

    var body: some View {
        Form {
            Section(L("Idioma de la app")) {
                Picker(L("Idioma de la interfaz"), selection: $appLanguage) {
                    Text(L("Sistema")).tag("system")
                    Text("Español").tag("es")
                    Text("English").tag("en")
                }
                Text(L("No cambia el idioma del audio. Configuralo en Motor y modelos."))
                    .font(.caption).foregroundStyle(palette.secondary)
            }
            Section(L("Apariencia")) {
                Picker(L("Tema"), selection: $appearance) {
                    Text(L("Sistema")).tag("system")
                    Text(L("Claro")).tag("light")
                    Text(L("Oscuro")).tag("dark")
                }
                .pickerStyle(.segmented)
            }
            Section(L("Dónde aparece")) {
                ForEach(CompanionSettings.siteCatalog, id: \.self) { id in
                    Toggle(siteLabel(id) == "WhatsApp" ? "WhatsApp Web" : siteLabel(id), isOn: siteBinding(id))
                }
                Text(L("Si lo apagás, el botón desaparece en ese sitio."))
                    .font(.callout)
                    .foregroundStyle(palette.secondary)
            }

            Section(L("En la nota")) {
                Toggle(L("Mostrar el tiempo de cada nota"), isOn: debugBinding)
                Toggle(L("Resaltar la palabra mientras suena"), isOn: highlightBinding)
            }

            Section(L("Historial local")) {
                Toggle(L("Guardar el texto de las transcripciones"), isOn: Binding(
                    get: { model.settings.saveTranscripts }, set: { model.setSaveTranscripts($0) }
                ))
                Text(LF("Solo notas nuevas, en esta Mac, dentro de las últimas %ld entradas de actividad. No guarda audio. Si transcribe el navegador, la app debe estar abierta para recibir el texto.", StatsStore.recentLimit))
                    .font(.callout).foregroundStyle(palette.secondary)
                Text(L("Desactivar esta opción detiene el guardado; no borra los textos anteriores."))
                    .font(.caption).foregroundStyle(palette.secondary)
                Button(L("Borrar textos guardados…"), role: .destructive) { confirmClear = true }
                    .disabled(!model.stats.recent.contains { $0.transcript != nil })
                if let error = model.historyError { Text(error).foregroundStyle(.red) }
            }

            Section(L("Esta app")) {
                Toggle(L("Abrir al iniciar sesión"), isOn: launchBinding)
                Text(model.loginError ?? model.loginDetail)
                    .font(.callout)
                    .foregroundStyle(model.loginError == nil ? AnyShapeStyle(.secondary) : AnyShapeStyle(.red))
                Toggle(L("Abrir la ventana al iniciar"), isOn: openAtLaunchBinding)
            }

            Section(L("Actualizaciones")) {
                Toggle(L("Buscar actualizaciones al abrir la app"), isOn: Binding(
                    get: { model.checkUpdatesAtLaunch }, set: { model.checkUpdatesAtLaunch = $0 }
                ))
                HStack {
                    Button(L("Buscar ahora")) { model.checkForUpdates() }
                        .disabled(model.update == .checking)
                    updateStatus
                }
                Text(L("Consulta la última versión publicada en GitHub. No envía datos tuyos."))
                    .font(.caption).foregroundStyle(palette.secondary)
            }

            DisclosureGroup(L("Avanzado")) {
                Text(L("Puerto local: 8765"))
                    .foregroundStyle(palette.secondary)
            }
        }
        .onChange(of: appLanguage) { _, _ in
            NotificationCenter.default.post(name: .appLanguageChanged, object: nil)
        }
        .confirmationDialog(L("¿Borrar todos los textos guardados?"), isPresented: $confirmClear) {
            Button(L("Borrar textos"), role: .destructive) { model.clearSavedTranscripts() }
        } message: {
            Text(L("Se conservarán las estadísticas. Esta acción no se puede deshacer."))
        }
        .formStyle(.grouped)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .tint(palette.accent)
    }

    @ViewBuilder
    private var updateStatus: some View {
        switch model.update {
        case .idle:
            EmptyView()
        case .checking:
            ProgressView().controlSize(.small)
        case .upToDate(let version):
            Text(LF("Estás al día (v%@).", version)).foregroundStyle(palette.secondary)
        case .available(let release):
            Link(LF("Descargar la versión %@", release.version), destination: release.pageURL)
        case .failed:
            Text(L("No se pudo consultar. Revisá la conexión.")).foregroundStyle(.red)
        }
    }

    private var debugBinding: Binding<Bool> {
        Binding(get: { model.settings.debugMode }, set: { model.setDebug($0) })
    }

    private var launchBinding: Binding<Bool> {
        Binding(get: { model.settings.launchAtLogin }, set: { model.setLaunchAtLogin($0) })
    }

    private var openAtLaunchBinding: Binding<Bool> {
        Binding(get: { model.settings.openAtLaunch }, set: { model.setOpenAtLaunch($0) })
    }

    private var highlightBinding: Binding<Bool> {
        Binding(get: { model.settings.highlightWords }, set: { model.setHighlight($0) })
    }

    private func siteBinding(_ id: String) -> Binding<Bool> {
        Binding(
            get: { model.settings.sites[id] ?? true },
            set: { model.setSite(id, $0) }
        )
    }

}

private func siteLabel(_ id: String) -> String {
    id == "whatsapp" ? "WhatsApp" : id == "x" ? "X" : L("Otro")
}
