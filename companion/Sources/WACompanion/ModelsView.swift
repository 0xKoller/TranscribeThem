import AppKit
import CompanionCore
import SwiftUI

struct ModelsView: View {
    @Bindable var model: AppModel
    @AppStorage("appLanguage") private var appLanguage = "system"
    @Environment(\.colorScheme) private var colorScheme
    private var palette: VoicePalette { VoicePalette(colorScheme) }

    var body: some View {
        Form {
            Section(L("Transcripción")) {
                Picker(L("Idioma del audio"), selection: languageBinding) {
                    Text("Español").tag("es")
                    Text("English").tag("en")
                    Text(L("Automático")).tag("auto")
                }
                .pickerStyle(.segmented)
                if model.settings.languageMode == "auto" {
                    Text(L("Parakeet detecta el idioma. Si transcribe el navegador, usa Español."))
                        .font(.callout)
                        .foregroundStyle(palette.secondary)
                }

                Picker(L("Motor"), selection: engineBinding) {
                    Text(L("Automático")).tag("auto")
                    Text(L("Solo esta app")).tag("companion")
                    Text(L("Solo el navegador")).tag("browser")
                }
                .pickerStyle(.radioGroup)
                Text(engineCaption)
                    .font(.callout)
                    .foregroundStyle(palette.secondary)

            }
            Section(L("Modelo de esta Mac")) {
                Picker(L("Modelo"), selection: $model.nativeSelection) {
                    ForEach(NativeModel.allCases) { choice in
                        Text(choice.name).tag(choice)
                    }
                }
                .disabled(model.nativeLoading)
                Text(model.nativeSelection == .v2 ? L("Solo inglés. Para español elegí v3 o Ultra.") : L("Multilingüe, incluido español. Procesamiento local con Core ML."))
                    .font(.callout).foregroundStyle(palette.secondary)
                LabeledContent(L("Estado"), value: model.nativeSelection.cached ? L("Descargado") : L("Sin descargar"))
                if !model.activeNativeName.isEmpty {
                    LabeledContent(L("Activo"), value: model.activeNativeName)
                }
                HStack {
                    Button(model.nativeSelection.cached ? L("Activar modelo") : L("Descargar y activar")) {
                        model.loadNativeModel()
                    }
                    Button(L("Usar carpeta local…")) { model.chooseLocalModel() }
                }
                .disabled(model.nativeLoading)
                if model.nativeLoading {
                    if let progress = model.nativeProgress {
                        ProgressView(value: progress)
                    } else {
                        ProgressView().controlSize(.small)
                    }
                    Text(L("Descargando o cargando el modelo…")).font(.caption)
                }
                if let error = model.nativeError {
                    Text(error).font(.caption).foregroundStyle(.red).textSelection(.enabled)
                }
                if !model.nativeLocalPath.isEmpty {
                    Text(model.nativeLocalPath).font(.caption).textSelection(.enabled)
                }
                Text(L("Carpeta local: componentes .mlmodelc y vocabulario compatibles con la variante seleccionada. No admite GGUF, ONNX ni archivos de modelos arbitrarios."))
                    .font(.caption).foregroundStyle(palette.secondary)
                Button(L("Mostrar modelos descargados en Finder")) {
                    NSWorkspace.shared.open(model.nativeSelection.cache.deletingLastPathComponent())
                }
            }
            Section(L("Modelo del navegador · Whisper")) {
                Picker(L("Modelo"), selection: modelBinding) {
                    Text("Small").tag(CompanionSettings.defaultModelId)
                    Text("Medium").tag("Xenova/whisper-medium")
                    Text("Turbo").tag("onnx-community/whisper-large-v3-turbo")
                }
                Text(L("La extensión descarga el modelo seleccionado cuando sincroniza con la app. Abrí WhatsApp Web o X para conectarla. Este modelo se utiliza en modo Navegador o como respaldo en Automático."))
                    .font(.callout).foregroundStyle(palette.secondary)
                Button(L("Abrir WhatsApp Web")) {
                    NSWorkspace.shared.open(URL(string: "https://web.whatsapp.com")!)
                }
            }
        }
        .formStyle(.grouped)
        .tint(palette.accent)
        .environment(\.locale, AppLanguage.locale(appLanguage))
    }

    private var engineCaption: String {
        switch model.settings.engineMode {
        case "companion":
            L("Si la app no responde, la nota falla y no usa el navegador.")
        case "browser":
            L("Siempre transcribe en el navegador.")
        default:
            L("Usa esta app. Si no está, transcribe en el navegador.")
        }
    }

    private var languageBinding: Binding<String> {
        Binding(get: { model.settings.languageMode }, set: { model.setLanguage($0) })
    }

    private var engineBinding: Binding<String> {
        Binding(get: { model.settings.engineMode }, set: { model.setEngine($0) })
    }

    private var modelBinding: Binding<String> {
        Binding(get: { model.settings.modelId }, set: { model.setModel($0) })
    }

}
