import AppKit
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
                if model.updateRepo == nil {
                    Text(L("Esta copia de la app no busca actualizaciones."))
                        .foregroundStyle(palette.secondary)
                } else {
                    Toggle(L("Buscar actualizaciones automáticamente"), isOn: Binding(
                        get: { model.autoCheckUpdates }, set: { model.autoCheckUpdates = $0 }
                    ))
                    HStack {
                        Button(L("Buscar ahora")) { model.checkForUpdates(manual: true) }
                            .disabled(model.update == .checking)
                        updateStatus
                    }
                    if let last = model.lastUpdateCheck {
                        Text(LF("Última búsqueda: %@", last.formatted(Date.RelativeFormatStyle(presentation: .named).locale(AppLanguage.currentLocale))))
                            .font(.caption).foregroundStyle(palette.secondary)
                    }
                    Text(L("Una vez por día consulta la última versión publicada en GitHub. No envía datos tuyos."))
                        .font(.caption).foregroundStyle(palette.secondary)
                }
            }

            if model.updateRepo != nil {
                Section(L("Extensión")) {
                    if let version = model.managedExtensionVersion {
                        Text(LF("La app mantiene la extensión al día (v%@) en esta carpeta:", version))
                        Text(ManagedExtension.folder.path)
                            .font(.caption.monospaced())
                            .textSelection(.enabled)
                            .foregroundStyle(palette.secondary)
                        Button(L("Mostrar en Finder")) {
                            NSWorkspace.shared.activateFileViewerSelecting([ManagedExtension.folder])
                        }
                        Text(L("Si Chrome todavía usa otra carpeta, quitá esa extensión en chrome://extensions y cargá esta con Cargar descomprimida."))
                            .font(.caption).foregroundStyle(palette.secondary)
                    } else {
                        Text(L("La app puede guardar la extensión en una carpeta y actualizarla junto con la app. La cargás una vez en Chrome y después se recarga sola."))
                            .font(.callout).foregroundStyle(palette.secondary)
                        HStack {
                            Button(L("Preparar la carpeta…")) { model.setUpManagedExtension() }
                                .disabled(model.extensionInstalling)
                            if model.extensionInstalling { ProgressView().controlSize(.small) }
                        }
                        Text(L("Después, en chrome://extensions: activá Modo de desarrollador, quitá la extensión anterior, tocá Cargar descomprimida y elegí la carpeta Extension que se abre en Finder."))
                            .font(.caption).foregroundStyle(palette.secondary)
                    }
                    if let error = model.extensionInstallError {
                        Text(error).font(.caption).foregroundStyle(.red)
                    }
                }
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
            Button(LF("Ver la versión %@", release.version)) { NSWorkspace.shared.open(release.pageURL) }
                .buttonStyle(.link)
        case .failed:
            Text(L("No se pudo consultar. Revisá la conexión.")).foregroundStyle(.red)
        case .unavailable:
            EmptyView()
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
