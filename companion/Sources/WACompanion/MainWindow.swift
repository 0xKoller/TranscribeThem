import Charts
import CompanionCore
import SwiftUI

enum AppSection: String, CaseIterable, Identifiable {
    case home
    case activity
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: "Inicio"
        case .activity: "Actividad"
        case .settings: "Ajustes"
        }
    }

    var symbol: String {
        switch self {
        case .home: "waveform"
        case .activity: "chart.bar"
        case .settings: "gearshape"
        }
    }
}

struct MainView: View {
    @Bindable var model: AppModel
    @Environment(\.openURL) private var openURL
    @State private var section: AppSection? = .home
    @State private var range: ActivityRange = .week

    var body: some View {
        NavigationSplitView {
            List(AppSection.allCases, selection: $section) { item in
                Label(item.title, systemImage: item.symbol)
            }
            .listStyle(.sidebar)
            .navigationSplitViewColumnWidth(min: 168, ideal: 196, max: 230)
        } detail: {
            Group {
                switch section ?? .home {
                case .home:
                    ScrollView { homeView().padding(28) }
                case .activity:
                    ScrollView { activityView().padding(28) }
                case .settings:
                    settings
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .navigationTitle((section ?? .home).title)
        }
        .frame(minWidth: 720, minHeight: 480)
    }

    private var today: ActivitySummary {
        model.stats.activity(.today)
    }

    private func homeView() -> some View {
        let bars = model.stats.weekBars()
        return VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 6) {
                Text(headline)
                    .font(.title2.weight(.semibold))
                Text(homeSubtitle)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 10) {
                StatusChip(ok: model.modelReady, title: "Modelo", value: modelValue)
                StatusChip(ok: model.serverReady, title: "Servidor", value: model.serverReady ? "En línea" : "Detenido")
                StatusChip(ok: model.extensionConnected, title: "Extensión", value: extensionValue)
            }

            todayStrip

            VStack(alignment: .leading, spacing: 8) {
                Text("Últimos 7 días")
                    .font(.headline)
                weekChart(bars, height: 112)
            }
            .padding(14)
            .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 12))

            VStack(alignment: .leading, spacing: 12) {
                Text("Personalización")
                    .font(.headline)
                ForEach(CompanionSettings.siteCatalog, id: \.self) { id in
                    Toggle(
                        id == "whatsapp" ? "Mostrar el botón en WhatsApp Web" : siteLabel(id),
                        isOn: siteBinding(id)
                    )
                }
                Text("Idioma")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Picker("Idioma", selection: languageBinding) {
                    Text("Español").tag("es")
                    Text("English").tag("en")
                    Text("Automático").tag("auto")
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                Text("Motor")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Picker("Motor", selection: engineBinding) {
                    Text("Automático").tag("auto")
                    Text("Esta app").tag("companion")
                    Text("Navegador").tag("browser")
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                Text(engineCaption)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if model.settings.languageMode == "auto" {
                    Text("Parakeet detecta el idioma. Si transcribe el navegador, usa Español.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(14)
            .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 12))

            Button("Abrir WhatsApp Web") {
                if let url = URL(string: "https://web.whatsapp.com") {
                    openURL(url)
                }
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var headline: String {
        if !model.serverReady {
            return "Otra copia de la app está usando el puerto."
        }
        if model.modelFailed {
            return "No se pudo cargar el modelo."
        }
        if !model.modelReady {
            return "Está bajando el modelo. La primera vez tarda."
        }
        if model.extensionSeenAt == nil {
            return "Lista en esta Mac. Chrome todavía no se conectó."
        }
        if !model.extensionConnected {
            return "La extensión no avisa hace un rato. Abrí WhatsApp Web."
        }
        return "Lista para transcribir en WhatsApp Web."
    }

    private var homeSubtitle: String {
        if !model.serverReady {
            return "Cerrá la otra copia y volvé a abrir esta."
        }
        if model.modelFailed {
            return "Cerrá la app desde la barra de menú y volvé a abrirla."
        }
        if !model.modelReady {
            return "La primera descarga queda en esta Mac."
        }
        if model.extensionSeenAt == nil {
            return "Abrí WhatsApp Web en Chrome. Si no aparece el botón, instalá la extensión."
        }
        if !model.extensionConnected {
            return "Abrí WhatsApp Web para que la extensión vuelva a avisar."
        }
        return "El botón está en las notas de voz."
    }

    private var modelValue: String {
        if model.modelReady { return "Listo" }
        if model.modelFailed { return "No se pudo cargar" }
        return "Cargando"
    }

    private var extensionValue: String {
        guard model.extensionSeenAt != nil else { return "Sin conexión" }
        let version = model.extensionVersion.flatMap { $0.isEmpty ? nil : $0 }
        let state = model.extensionConnected ? "Conectada" : "Sin señal reciente"
        if let version { return "\(state) · v\(version)" }
        return state
    }

    private var todayStrip: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Metric(title: "Notas hoy", value: "\(today.notes)")
                Metric(title: "Audio", value: formatAudio(today.audioSeconds))
                Metric(title: "Velocidad", value: formatFactor(today.speed), caption: medianCaption(today.medianMs))
            }
            if today.notes == 0 && today.fails == 0 {
                Text("Todavía no hay notas hoy.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else if today.fails > 0 {
                Text("\(today.fails) fallidas")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func activityView() -> some View {
        let summary = model.stats.activity(range)
        let bars = model.stats.weekBars()
        let empty = model.stats.processedCount == 0 && model.stats.failCount == 0
        return VStack(alignment: .leading, spacing: 18) {
            Picker("Rango", selection: $range) {
                Text("Hoy").tag(ActivityRange.today)
                Text("7 días").tag(ActivityRange.week)
                Text("Todo").tag(ActivityRange.all)
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 360)
            .labelsHidden()

            HStack(spacing: 12) {
                Metric(title: "Notas", value: "\(summary.notes)")
                Metric(title: "Audio", value: formatAudio(summary.audioSeconds))
                Metric(title: "Velocidad", value: formatFactor(summary.speed), caption: speedCaption(summary))
            }
            if summary.fails > 0 {
                Text("\(summary.fails) fallidas")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            if range == .all {
                Text("La velocidad y la mediana salen de las notas con tiempo guardado, no de todo el historial.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            Text("Últimos 7 días")
                .font(.headline)
            weekChart(bars, height: 140)

            if empty {
                Text("Todavía no hay notas. Transcribí una en WhatsApp Web.")
                    .foregroundStyle(.secondary)
            } else {
                HStack(spacing: 16) {
                    Text("En la app \(summary.parakeet)")
                    Text("En el navegador \(summary.whisper)")
                }
                .font(.callout)
                .foregroundStyle(.secondary)

                if summary.shortNotes + summary.mediumNotes + summary.longNotes > 0 {
                    Text("Cortas \(summary.shortNotes) · medias \(summary.mediumNotes) · largas \(summary.longNotes)")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                    Text("Cortas, menos de 15 s. Medias, hasta 45 s. Largas, el resto.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                recentList
            }
            Text("Se guardan duración, motor y latencia. El texto y el audio no.")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var recentList: some View {
        let groups = grouped(model.stats.recent)
        return VStack(alignment: .leading, spacing: 12) {
            ForEach(groups, id: \.day) { group in
                Text(dayTitle(group.day))
                    .font(.headline)
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(group.jobs) { job in
                        HStack {
                            Text(job.at.formatted(date: .omitted, time: .shortened))
                                .frame(width: 64, alignment: .leading)
                                .foregroundStyle(.secondary)
                            Text(siteLabel(job.site))
                                .frame(width: 88, alignment: .leading)
                            Text(job.ok ? formatAudio(job.audioSeconds) : "—")
                                .frame(width: 88, alignment: .leading)
                            Spacer()
                            Text(jobLine(job))
                                .foregroundStyle(job.ok ? AnyShapeStyle(.secondary) : AnyShapeStyle(.red))
                                .monospacedDigit()
                        }
                        .font(.callout)
                        .padding(.vertical, 6)
                        Divider()
                    }
                }
            }
        }
    }

    private var settings: some View {
        Form {
            Section("Dónde aparece") {
                ForEach(CompanionSettings.siteCatalog, id: \.self) { id in
                    Toggle(siteLabel(id) == "WhatsApp" ? "WhatsApp Web" : siteLabel(id), isOn: siteBinding(id))
                }
                Text("Si lo apagás, el botón desaparece en ese sitio.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            Section("Cómo transcribe") {
                Picker("Idioma", selection: languageBinding) {
                    Text("Español").tag("es")
                    Text("English").tag("en")
                    Text("Automático").tag("auto")
                }
                .pickerStyle(.segmented)
                if model.settings.languageMode == "auto" {
                    Text("Parakeet detecta el idioma. Si transcribe el navegador, usa Español.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                Picker("Motor", selection: engineBinding) {
                    Text("Automático").tag("auto")
                    Text("Solo esta app").tag("companion")
                    Text("Solo el navegador").tag("browser")
                }
                .pickerStyle(.radioGroup)
                Text(engineCaption)
                    .font(.callout)
                    .foregroundStyle(.secondary)

                Picker("Modelo del navegador", selection: modelBinding) {
                    Text("Small").tag(CompanionSettings.defaultModelId)
                    Text("Medium").tag("Xenova/whisper-medium")
                    Text("Turbo").tag("onnx-community/whisper-large-v3-turbo")
                }
                .pickerStyle(.radioGroup)
                .disabled(model.settings.engineMode == "companion")
                Text(model.settings.engineMode == "companion"
                    ? "No se usa mientras el motor sea solo esta app."
                    : "Whisper en el navegador, cuando esta app no transcribe.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            Section("En la nota") {
                Toggle("Mostrar el tiempo de cada nota", isOn: debugBinding)
                Toggle("Resaltar la palabra mientras suena", isOn: highlightBinding)
            }

            Section("Esta app") {
                Toggle("Abrir al iniciar sesión", isOn: launchBinding)
                Text(model.loginError ?? model.loginDetail)
                    .font(.callout)
                    .foregroundStyle(model.loginError == nil ? AnyShapeStyle(.secondary) : AnyShapeStyle(.red))
                Toggle("Abrir la ventana al iniciar", isOn: openAtLaunchBinding)
            }

            DisclosureGroup("Avanzado") {
                Text("Puerto local: 8765")
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }

    private var engineCaption: String {
        switch model.settings.engineMode {
        case "companion":
            "Si la app no responde, la nota falla y no usa el navegador."
        case "browser":
            "Siempre transcribe en el navegador."
        default:
            "Usa esta app. Si no está, transcribe en el navegador."
        }
    }

    private func speedCaption(_ summary: ActivitySummary) -> String? {
        var parts: [String] = []
        if let median = medianCaption(summary.medianMs) {
            parts.append(median)
        }
        if range == .all, let slow = summary.slowMs {
            parts.append("la más lenta del grupo reciente: \(formatMs(slow))")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func medianCaption(_ value: Int?) -> String? {
        guard let value else { return nil }
        return "mediana \(formatMs(value))"
    }

    private func jobLine(_ job: JobRecord) -> String {
        guard job.ok else { return errorLabel(job.errorCode) }
        let factor = job.transcribeMs > 0 ? job.audioSeconds / (Double(job.transcribeMs) / 1000) : nil
        if let factor {
            return "\(formatMs(job.transcribeMs)) · \(formatFactor(factor))"
        }
        return formatMs(job.transcribeMs)
    }

    private func grouped(_ jobs: [JobRecord]) -> [(day: String, jobs: [JobRecord])] {
        var order: [String] = []
        var buckets: [String: [JobRecord]] = [:]
        for job in jobs {
            let key = StatsStore.dayKey(job.at)
            if buckets[key] == nil { order.append(key) }
            buckets[key, default: []].append(job)
        }
        return order.map { (day: $0, jobs: buckets[$0] ?? []) }
    }

    private var languageBinding: Binding<String> {
        Binding(get: { model.settings.languageMode }, set: { model.setLanguage($0) })
    }

    private var debugBinding: Binding<Bool> {
        Binding(get: { model.settings.debugMode }, set: { model.setDebug($0) })
    }

    private var engineBinding: Binding<String> {
        Binding(get: { model.settings.engineMode }, set: { model.setEngine($0) })
    }

    private var modelBinding: Binding<String> {
        Binding(get: { model.settings.modelId }, set: { model.setModel($0) })
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

    private func weekChart(_ bars: [WeekBar], height: CGFloat) -> some View {
        let peak = Double(max(bars.map(\.notes).max() ?? 0, 1))
        return Chart(bars) { bar in
            BarMark(
                x: .value("Día", shortDay(bar.day)),
                y: .value("Notas", bar.notes)
            )
            .foregroundStyle(Color.accentColor)
            .cornerRadius(3)
        }
        .chartYScale(domain: 0...peak)
        .chartYAxis {
            AxisMarks(position: .leading)
        }
        .frame(height: height)
    }
}

private struct StatusChip: View {
    var ok: Bool
    var title: String
    var value: String

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(ok ? Color.green : Color.orange)
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.callout.weight(.medium))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
        .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 10))
    }
}

private struct Metric: View {
    var title: String
    var value: String
    var caption: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.title2.monospacedDigit())
            if let caption {
                Text(caption)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 10))
    }
}

private func formatMs(_ value: Int) -> String {
    if value >= 1000 {
        return String(format: "%.1f s", Double(value) / 1000)
    }
    return "\(value) ms"
}

private func formatFactor(_ value: Double?) -> String {
    guard let value, value.isFinite, value > 0 else { return "—" }
    if value >= 10 {
        return "\(Int(value.rounded()))×"
    }
    return String(format: "%.1f×", value)
}

private func formatAudio(_ value: Double) -> String {
    if value < 60 {
        return String(format: "%.0f s", value)
    }
    let minutes = Int(value / 60)
    let seconds = Int(value.truncatingRemainder(dividingBy: 60))
    if seconds == 0 { return "\(minutes) min" }
    return "\(minutes) min \(seconds) s"
}

private func shortDay(_ key: String) -> String {
    let parts = key.split(separator: "-")
    guard parts.count == 3 else { return key }
    return "\(Int(parts[2]) ?? 0)/\(Int(parts[1]) ?? 0)"
}

private func dayTitle(_ key: String) -> String {
    let parts = key.split(separator: "-")
    guard parts.count == 3,
          let year = Int(parts[0]),
          let month = Int(parts[1]),
          let day = Int(parts[2]) else { return key }
    var components = DateComponents()
    components.year = year
    components.month = month
    components.day = day
    let date = Calendar.current.date(from: components) ?? Date()
    return date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
}

private func siteLabel(_ id: String) -> String {
    id == "whatsapp" ? "WhatsApp" : "Otro"
}

private func errorLabel(_ code: String) -> String {
    switch code {
    case "timeout": "Tardó demasiado"
    case "no_audio": "Sin audio"
    case "model_loading": "Modelo cargando"
    case "decode": "No se pudo leer"
    case "http": "La app no respondió"
    default: "Falló"
    }
}
