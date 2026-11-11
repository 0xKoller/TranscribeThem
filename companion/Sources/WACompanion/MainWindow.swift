import Charts
import CompanionCore
import SwiftUI
import UniformTypeIdentifiers

enum AppSection: String, CaseIterable, Identifiable {
    case home
    case activity
    case models
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: L("Inicio")
        case .activity: L("Actividad")
        case .models: L("Motor y modelos")
        case .settings: L("Ajustes")
        }
    }

    var symbol: String {
        switch self {
        case .home: "waveform"
        case .activity: "chart.bar"
        case .models: "cpu"
        case .settings: "gearshape"
        }
    }
}

struct MainView: View {
    @Bindable var model: AppModel
    var onNavigate: (String) -> Void = { _ in }
    @AppStorage("appearance") private var appearance = "system"
    @AppStorage("appLanguage") private var appLanguage = "system"

    var body: some View {
        CompanionContent(model: model, appearance: $appearance, onNavigate: onNavigate)
            .environment(\.locale, AppLanguage.locale(appLanguage))
            .preferredColorScheme(appearance == "dark" ? .dark : appearance == "light" ? .light : nil)
    }
}

private struct CompanionContent: View {
    @Bindable var model: AppModel
    @Binding var appearance: String
    @AppStorage("appLanguage") private var appLanguage = "system"
    var onNavigate: (String) -> Void
    @Environment(\.colorScheme) private var colorScheme
    private var palette: VoicePalette { VoicePalette(colorScheme) }
    @Environment(\.openURL) private var openURL
    @State private var section: AppSection? = .home
    @State private var range: ActivityRange = .week
    @State private var activitySite = "all"
    @State private var activityQuery = ""
    @State private var exportFailed = false

    var body: some View {
        NavigationSplitView {
            List(AppSection.allCases, selection: $section) { item in
                Label {
                    Text(item.title)
                } icon: {
                    Image(systemName: item.symbol)
                        .symbolRenderingMode(.hierarchical)
                }
                .tag(item)
            }
            .listStyle(.sidebar)
            .navigationSplitViewColumnWidth(min: 168, ideal: 196, max: 230)
        } detail: {
            Group {
                switch section ?? .home {
                case .home:
                    ScrollView { homeView().frame(maxWidth: 680).padding(24).frame(maxWidth: .infinity) }
                case .activity:
                    ScrollView { activityView().padding(24) }
                case .models:
                    ModelsView(model: model)
                case .settings:
                    SettingsContent(model: model, appearance: $appearance)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .foregroundStyle(palette.text)
            .background(palette.canvas)
            .navigationTitle((section ?? .home).title)

        }
        .onChange(of: appLanguage) { _, _ in onNavigate((section ?? .home).title) }
        .environment(\.locale, AppLanguage.locale(appLanguage))
        .onChange(of: section) { _, value in onNavigate((value ?? .home).title) }
        .tint(palette.accent)
        .frame(minWidth: 720, minHeight: 480)
    }

    private var today: ActivitySummary {
        model.stats.activity(.today)
    }

    private func homeView() -> some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(alignment: .top, spacing: 16) {
                BrandIcon()
                    .frame(width: 64, height: 64)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 6) {
                    Text(headline)
                        .font(.title2.weight(.semibold))
                    Text(homeSubtitle)
                        .font(.callout)
                        .foregroundStyle(palette.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    if !model.modelReady && !model.modelFailed {
                        ProgressView().controlSize(.small)
                            .accessibilityLabel(L("Cargando el modelo local"))
                    }
                    Button(L("Abrir WhatsApp Web"), systemImage: "arrow.up.right") {
                        if let url = URL(string: "https://web.whatsapp.com") { openURL(url) }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.regular)
                    .padding(.top, 6)
                }
                Spacer(minLength: 0)
            }

            if let offer = model.offeredRelease {
                UpdateBanner(model: model, release: offer)
            }

            if model.extensionIsBehind, let version = model.extensionVersion {
                Label(LF("La extensión está en la v%@ y la app en la v%@. Actualizá la extensión desde la misma versión.", version, model.currentVersion), systemImage: "exclamationmark.triangle")
                    .font(.callout)
                    .foregroundStyle(palette.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Divider()

            todayStrip

            DisclosureGroup(L("Detalles de conexión")) {
                HStack(spacing: 10) {
                    StatusChip(ok: model.modelReady, title: L("Modelo"), value: modelValue)
                    StatusChip(ok: model.serverReady, title: L("Servidor"), value: model.serverReady ? L("En línea") : L("Detenido"))
                    StatusChip(ok: model.extensionConnected, title: L("Extensión"), value: extensionValue)
                }
                .padding(.top, 8)
            }
            .font(.callout)

            Label(model.settings.saveTranscripts ? L("Procesamiento local · Historial de texto activado") : L("Procesamiento local · Guardado de texto desactivado"), systemImage: "lock")
                .font(.caption)
                .foregroundStyle(palette.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var headline: String {
        if !model.serverReady {
            return L("Otra copia de la app está usando el puerto.")
        }
        if model.modelFailed {
            return L("No se pudo cargar el modelo.")
        }
        if !model.modelReady {
            return L("Está bajando el modelo. La primera vez tarda.")
        }
        if model.extensionSeenAt == nil {
            return L("Tu Mac está lista.")
        }
        if !model.extensionConnected {
            return L("Conectá el navegador.")
        }
        return L("Lista para transcribir")
    }

    private var homeSubtitle: String {
        if !model.serverReady {
            return L("Cerrá la otra copia y volvé a abrir esta.")
        }
        if model.modelFailed {
            return L("Cerrá la app desde la barra de menú y volvé a abrirla.")
        }
        if !model.modelReady {
            return L("La primera descarga queda en esta Mac.")
        }
        if model.extensionSeenAt == nil {
            return L("Abrí WhatsApp Web en Chrome. Si no aparece el botón, instalá la extensión.")
        }
        if !model.extensionConnected {
            return L("Sin señal reciente de la extensión. Abrí WhatsApp Web para volver a conectarla.")
        }
        return L("El botón está en las notas de voz.")
    }

    private var modelValue: String {
        if model.modelReady { return L("Listo") }
        if model.modelFailed { return L("No se pudo cargar") }
        return L("Cargando")
    }

    private var extensionValue: String {
        guard model.extensionSeenAt != nil else { return L("Sin conexión") }
        let version = model.extensionVersion.flatMap { $0.isEmpty ? nil : $0 }
        let state = model.extensionConnected ? L("Conectada") : L("Sin señal reciente")
        if let version { return "\(state) · v\(version)" }
        return state
    }

    private var todayStrip: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Metric(title: L("Notas hoy"), value: "\(today.notes)")
                Metric(title: L("Audio"), value: formatAudio(today.audioSeconds))
            }
            if today.notes == 0 && today.fails == 0 {
                Text(L("Todavía no hay notas hoy."))
                    .font(.callout)
                    .foregroundStyle(palette.secondary)
            } else if today.fails > 0 {
                Text(LF("%ld fallidas", today.fails))
                    .font(.callout)
                    .foregroundStyle(palette.secondary)
            }
        }
    }

    private func activityView() -> some View {
        let summary = model.stats.activity(range)
        let bars = model.stats.weekBars()
        let empty = model.stats.processedCount == 0 && model.stats.failCount == 0
        return VStack(alignment: .leading, spacing: 18) {
            Picker("Rango", selection: $range) {
                Text(L("Hoy")).tag(ActivityRange.today)
                Text(L("7 días")).tag(ActivityRange.week)
                Text(L("Todo")).tag(ActivityRange.all)
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 360)
            .labelsHidden()

            HStack(spacing: 12) {
                Metric(title: L("Notas"), value: "\(summary.notes)")
                Metric(title: L("Audio"), value: formatAudio(summary.audioSeconds))
                Metric(title: L("Velocidad"), value: formatFactor(summary.speed), caption: speedCaption(summary))
            }
            HStack(spacing: 12) {
                Metric(title: L("Completadas"), value: successRate(summary), caption: L("Del período seleccionado"))
                Metric(title: L("Fallidas"), value: "\(summary.fails)")
                Metric(title: L("Latencia mediana"), value: summary.medianMs.map(formatMs) ?? "—", caption: L("De las notas recientes"))
            }
            if range == .all {
                Text(L("La velocidad y la mediana salen de las notas con tiempo guardado, no de todo el historial."))
                    .font(.callout)
                    .foregroundStyle(palette.secondary)
            }

            Text(L("Últimos 7 días"))
                .font(.headline)
            weekChart(bars, height: 140)

            if empty {
                Text(L("Todavía no hay notas. Transcribí una en WhatsApp Web."))
                    .foregroundStyle(palette.secondary)
            } else {
                HStack(spacing: 16) {
                    Text(LF("En la app %ld", summary.parakeet))
                    Text(LF("En el navegador %ld", summary.whisper))
                }
                .font(.callout)
                .foregroundStyle(palette.secondary)

                if summary.shortNotes + summary.mediumNotes + summary.longNotes > 0 {
                    Text(LF("Cortas %ld · medias %ld · largas %ld", summary.shortNotes, summary.mediumNotes, summary.longNotes))
                        .font(.callout)
                        .foregroundStyle(palette.secondary)
                    Text(L("Cortas, menos de 15 s. Medias, hasta 45 s. Largas, el resto."))
                        .font(.caption)
                        .foregroundStyle(palette.secondary)
                }

                recentList
            }
            Text(L("El audio no se guarda. El historial de texto es opcional y se configura en Ajustes."))
                .font(.callout)
                .foregroundStyle(palette.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .alert(L("No se pudo exportar"), isPresented: $exportFailed) {
            Button(L("Cerrar"), role: .cancel) {}
        } message: {
            Text(L("No se pudo escribir el archivo."))
        }
    }

    private var recentList: some View {
        let scoped = model.stats.recentActivity(range).filter { activitySite == "all" || $0.site == activitySite }
        let jobs = ActivityHistory.filter(scoped, query: activityQuery, siteLabel: siteLabel)
        let groups = grouped(jobs)
        let canExport = !ActivityHistory.exportable(jobs).isEmpty
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(L("Transcripciones recientes")).font(.headline)
                Spacer()
                Picker(L("Sitio"), selection: $activitySite) {
                    Text(L("Todos los sitios")).tag("all")
                    Text("WhatsApp").tag("whatsapp")
                    Text("X").tag("x")
                    Text(L("Otro")).tag("unknown")
                }
                .frame(maxWidth: 200)
            }
            HStack(spacing: 8) {
                TextField(L("Buscar en el texto o el sitio"), text: $activityQuery)
                    .textFieldStyle(.roundedBorder)
                Button(L("Exportar")) {
                    exportTranscripts(jobs)
                }
                .disabled(!canExport)
            }
            Text(LF("Se conservan detalles de las últimas %ld notas. El filtro se aplica a ese historial.", StatsStore.recentLimit))
                .font(.caption)
                .foregroundStyle(palette.secondary)
            if jobs.isEmpty {
                Text(activityQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                     ? L("No hay notas guardadas para este período y sitio.")
                     : L("No hay notas que coincidan con la búsqueda."))
                    .foregroundStyle(palette.secondary)
            }
            ForEach(groups, id: \.day) { group in
                Text(dayTitle(group.day)).font(.subheadline.weight(.semibold))
                ForEach(group.jobs) { job in
                    DisclosureGroup {
                        Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 8) {
                            GridRow { Text(L("Sitio")); Text(siteLabel(job.site)) }
                            GridRow { Text(L("Fecha")); Text(job.at.formatted(date: .abbreviated, time: .standard)) }
                            GridRow { Text(L("Duración del audio")); Text(formatAudio(job.audioSeconds)) }
                            GridRow { Text(L("Procesamiento")); Text(formatMs(job.transcribeMs)) }
                            GridRow { Text(L("Motor")); Text(job.engine == "parakeet" ? L("Parakeet · App") : job.engine == "whisper" ? L("Whisper · Navegador") : job.engine) }
                            GridRow { Text(L("Modelo")); Text(job.model.isEmpty ? L("Sin datos") : job.model).textSelection(.enabled) }
                            GridRow { Text(L("Resultado")); Text(job.ok ? L("Completada") : errorLabel(job.errorCode)) }
                        }
                        .font(.callout)
                        .padding(.vertical, 10)
                        if let transcript = job.transcript {
                            HStack {
                                Text(L("Transcripción")).font(.headline)
                                Spacer()
                                Button(L("Copiar"), systemImage: "doc.on.doc") {
                                    NSPasteboard.general.clearContents()
                                    NSPasteboard.general.setString(transcript, forType: .string)
                                }
                            }
                            ScrollView {
                                Text(transcript)
                                    .font(.body)
                                    .textSelection(.enabled)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .frame(minHeight: 60, maxHeight: 240)
                        } else {
                            Text(L("El texto de esta nota no se guardó. Activá el historial local en Ajustes para las próximas notas."))
                                .font(.caption)
                                .foregroundStyle(palette.secondary)
                        }
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: job.ok ? "checkmark.circle" : "exclamationmark.circle")
                                .foregroundStyle(job.ok ? palette.jade : .red)
                                .accessibilityLabel(job.ok ? L("Completada") : L("Fallida"))
                            Text(job.at.formatted(date: .omitted, time: .shortened)).monospacedDigit()
                            Text(siteLabel(job.site)).frame(width: 76, alignment: .leading)
                            Text(formatAudio(job.audioSeconds))
                            Spacer()
                            Text(jobLine(job)).foregroundStyle(palette.secondary).monospacedDigit()
                        }
                        .font(.callout)
                    }
                    .padding(12)
                    .background(palette.surface, in: RoundedRectangle(cornerRadius: 10))
                }
            }
        }
    }

    private func exportTranscripts(_ jobs: [JobRecord]) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.plainText]
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        panel.nameFieldStringValue = "transcripciones.txt"
        panel.title = L("Exportar")
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let formatter = DateFormatter()
        formatter.locale = AppLanguage.currentLocale
        formatter.dateStyle = .medium
        formatter.timeStyle = .medium
        let text = ActivityHistory.exportText(jobs, formatDate: { formatter.string(from: $0) }, siteLabel: siteLabel)
        do {
            try text.write(to: url, atomically: true, encoding: .utf8)
        } catch {
            exportFailed = true
        }
    }

    private func successRate(_ summary: ActivitySummary) -> String {
        let attempts = summary.notes + summary.fails
        guard attempts > 0 else { return "—" }
        return String(format: "%.0f%%", Double(summary.notes) / Double(attempts) * 100)
    }

    private func speedCaption(_ summary: ActivitySummary) -> String? {
        var parts: [String] = []
        if let median = medianCaption(summary.medianMs) {
            parts.append(median)
        }
        if range == .all, let slow = summary.slowMs {
            parts.append(LF("la más lenta del grupo reciente: %@", formatMs(slow)))
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func medianCaption(_ value: Int?) -> String? {
        guard let value else { return nil }
        return LF("mediana %@", formatMs(value))
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

    private func weekChart(_ bars: [WeekBar], height: CGFloat) -> some View {
        let peak = Double(max(bars.map(\.notes).max() ?? 0, 1))
        return Chart(bars) { bar in
            BarMark(
                x: .value(L("Día"), shortDay(bar.day)),
                y: .value(L("Notas"), bar.notes)
            )
            .foregroundStyle(palette.blue.gradient)
            .cornerRadius(3)
        }
        .chartYScale(domain: 0...peak)
        .chartYAxis {
            AxisMarks(position: .leading)
        }
        .frame(height: height)
    }
}

private struct UpdateBanner: View {
    @Bindable var model: AppModel
    let release: UpdateCheck.Release
    @Environment(\.colorScheme) private var colorScheme
    private var palette: VoicePalette { VoicePalette(colorScheme) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(LF("Hay una versión nueva: %@", release.version), systemImage: "arrow.down.circle.fill")
                .font(.headline)
            Text(LF("Tenés la v%@.", model.currentVersion))
                .font(.callout)
                .foregroundStyle(palette.secondary)
            let summary = UpdateCheck.summary(release.notes)
            if !summary.isEmpty {
                Text(summary)
                    .font(.callout)
                    .fixedSize(horizontal: false, vertical: true)
                    .lineLimit(6)
            }
            HStack(spacing: 10) {
                if canInstall {
                    Button(L("Instalar y reiniciar")) { model.installOfferedUpdate() }
                        .buttonStyle(.borderedProminent)
                        .disabled(model.installing)
                    Button(L("Ver novedades")) { model.openReleasePage() }
                        .buttonStyle(.bordered)
                } else {
                    Button(L("Descargar")) { model.openReleasePage() }
                        .buttonStyle(.borderedProminent)
                }
                Button(L("Omitir esta versión")) { model.skipOfferedVersion() }
                    .buttonStyle(.borderless)
                    .disabled(model.installing)
            }
            .padding(.top, 4)
            installStatus
            if !canInstall, let blocker = model.installBlocker, release.dmg != nil {
                Text(blocker).font(.caption).foregroundStyle(palette.secondary)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(palette.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .contain)
    }

    private var canInstall: Bool {
        model.installBlocker == nil && release.dmg != nil && release.checksums != nil
    }

    @ViewBuilder
    private var installStatus: some View {
        switch model.installState {
        case .idle:
            EmptyView()
        case .downloading(let fraction):
            if let fraction {
                ProgressView(value: fraction) { Text(L("Descargando…")).font(.caption) }
            } else {
                ProgressView { Text(L("Descargando…")).font(.caption) }
            }
        case .verifying, .installing:
            ProgressView { Text(L("Instalando. La app se va a reiniciar…")).font(.caption) }
        case .failed(let message):
            Text(message).font(.caption).foregroundStyle(.red)
        }
    }
}

private struct StatusChip: View {
    @Environment(\.colorScheme) private var colorScheme
    private var palette: VoicePalette { VoicePalette(colorScheme) }
    var ok: Bool
    var title: String
    var value: String

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(ok ? palette.jade : palette.secondary)
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption)
                    .foregroundStyle(palette.secondary)
                Text(value)
                    .font(.callout.weight(.medium))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: 10))
    }
}

private struct Metric: View {
    @Environment(\.colorScheme) private var colorScheme
    private var palette: VoicePalette { VoicePalette(colorScheme) }
    var title: String
    var value: String
    var caption: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(palette.secondary)
            Text(value)
                .font(.title2.monospacedDigit())
            if let caption {
                Text(caption)
                    .font(.caption)
                    .foregroundStyle(palette.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: 10))
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
    return date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).locale(AppLanguage.currentLocale))
}

private func siteLabel(_ id: String) -> String {
    id == "whatsapp" ? "WhatsApp" : id == "x" ? "X" : L("Otro")
}

private func errorLabel(_ code: String) -> String {
    switch code {
    case "timeout": L("Tardó demasiado")
    case "no_audio": L("Sin audio")
    case "model_loading": L("Modelo cargando")
    case "decode": L("No se pudo leer")
    case "http": L("La app no respondió")
    default: L("Falló")
    }
}
