import AppKit
import CompanionCore
import Foundation

/// The unpacked extension folder the app keeps up to date. Chrome loads it
/// once with "Load unpacked"; after that the app replaces its files and the
/// extension reloads itself when it sees a newer version on disk.
enum ManagedExtension {
    static var folder: URL { AppSupport.directory().appendingPathComponent("Extension", isDirectory: true) }

    /// The installed version, or nil when the folder is not there.
    static var version: String? {
        guard let data = try? Data(contentsOf: folder.appendingPathComponent("manifest.json")) else { return nil }
        return UpdateInstall.extensionVersion(manifest: data)
    }
}

extension InstallError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .missingAsset: L("La versión publicada no trae los archivos para instalarla desde la app.")
        case .checksum: L("El archivo descargado no coincide con el publicado. No se instaló nada.")
        case .badDownload: L("No se pudo descargar la actualización. Revisá la conexión.")
        case .wrongApp: L("El archivo descargado no es esta app. No se instaló nada.")
        case .command(let name): LF("Falló %@. No se instaló nada.", name)
        }
    }
}

/// Network and disk work for one install. Nothing here touches the UI.
struct UpdateWork: Sendable {
    let release: UpdateCheck.Release
    let directory: URL

    static func make(_ release: UpdateCheck.Release) throws -> UpdateWork {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("TranscribeThem-update-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return UpdateWork(release: release, directory: dir)
    }

    func cleanUp() {
        try? FileManager.default.removeItem(at: directory)
    }

    func checksums() async throws -> [String: String] {
        guard let asset = release.checksums else { throw InstallError.missingAsset }
        let (data, response) = try await URLSession.shared.data(from: asset.downloadURL)
        guard (response as? HTTPURLResponse)?.statusCode == 200, data.count < 64 * 1024,
              let text = String(data: data, encoding: .utf8) else { throw InstallError.badDownload }
        return UpdateCheck.parseChecksums(text)
    }

    /// Downloads an asset and checks its SHA-256 against the published list.
    func fetch(_ asset: UpdateCheck.Asset, checksums: [String: String], progress: @escaping @Sendable (Double) -> Void) async throws -> URL {
        guard let expected = UpdateCheck.expectedSHA256(for: asset, checksums: checksums) else { throw InstallError.checksum }
        let observer = ProgressRelay(progress)
        let (temp, response) = try await URLSession.shared.download(from: asset.downloadURL, delegate: observer)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw InstallError.badDownload }
        let file = directory.appendingPathComponent(asset.name)
        try? FileManager.default.removeItem(at: file)
        try FileManager.default.moveItem(at: temp, to: file)
        guard try UpdateInstall.sha256Hex(fileAt: file) == expected else { throw InstallError.checksum }
        return file
    }

    func stageApp(dmg: URL, installedApp: URL, bundleId: String) throws -> URL {
        try UpdateDisk.stageApp(dmg: dmg, version: release.version, installedApp: installedApp, bundleId: bundleId, workDirectory: directory)
    }

    func installExtension(zip: URL) throws {
        try UpdateDisk.installExtension(zip: zip, version: release.version, target: ManagedExtension.folder, workDirectory: directory)
    }

    func launchSwap(installedApp: URL, staged: URL) throws {
        try UpdateDisk.launchSwap(installedApp: installedApp, staged: staged, workDirectory: directory)
    }
}

/// Passes a download's progress on as a fraction.
private final class ProgressRelay: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let onProgress: @Sendable (Double) -> Void
    private var observation: NSKeyValueObservation?

    init(_ onProgress: @escaping @Sendable (Double) -> Void) {
        self.onProgress = onProgress
    }

    func urlSession(_ session: URLSession, didCreateTask task: URLSessionTask) {
        observation = task.progress.observe(\.fractionCompleted) { [onProgress] progress, _ in
            onProgress(progress.fractionCompleted)
        }
    }
}

extension AppModel {
    /// Why "Install and restart" cannot run here, or nil when it can.
    var installBlocker: String? {
        let app = Bundle.main.bundleURL
        let writable = FileManager.default.isWritableFile(atPath: app.deletingLastPathComponent().path)
        switch UpdateInstall.blocker(bundlePath: app.path, parentIsWritable: writable) {
        case nil: return nil
        case .notABundle: return L("Esta copia no se puede actualizar sola.")
        case .translocated, .onDiskImage: return L("Mové la app a Aplicaciones para poder actualizarla desde acá.")
        case .notWritable: return L("No hay permiso para reemplazar la app en su carpeta. Descargala y reemplazala a mano.")
        }
    }

    var installing: Bool {
        switch installState {
        case .downloading, .verifying, .installing: true
        case .idle, .failed: false
        }
    }

    /// Downloads the offered release, checks it, refreshes the managed
    /// extension folder if there is one, replaces the app and restarts it.
    func installOfferedUpdate() {
        guard !installing, installBlocker == nil, let release = offeredRelease ?? availableRelease,
              release.dmg != nil, let bundleId = Bundle.main.bundleIdentifier else { return }
        let installedApp = Bundle.main.bundleURL
        let refreshExtension = managedExtensionVersion != nil
        installState = .downloading(nil)
        Task {
            var work: UpdateWork?
            do {
                let job = try UpdateWork.make(release)
                work = job
                let sums = try await job.checksums()
                guard let dmgAsset = release.dmg else { throw InstallError.missingAsset }
                let dmg = try await job.fetch(dmgAsset, checksums: sums) { fraction in
                    Task { @MainActor in
                        if case .downloading = self.installState { self.installState = .downloading(fraction) }
                    }
                }
                var zip: URL?
                if refreshExtension {
                    guard let zipAsset = release.extensionZip else { throw InstallError.missingAsset }
                    zip = try await job.fetch(zipAsset, checksums: sums) { _ in }
                }
                installState = .installing
                let staged = try await Task.detached {
                    if let zip { try job.installExtension(zip: zip) }
                    return try job.stageApp(dmg: dmg, installedApp: installedApp, bundleId: bundleId)
                }.value
                try job.launchSwap(installedApp: installedApp, staged: staged)
                NSApplication.shared.terminate(nil)
            } catch {
                work?.cleanUp()
                installState = .failed(error.localizedDescription)
            }
        }
    }

    /// A release newer than this app, even if the user skipped it.
    var availableRelease: UpdateCheck.Release? {
        guard let latestRelease, UpdateCheck.isNewer(latestRelease.version, than: currentVersion) else { return nil }
        return latestRelease
    }

    /// Creates or refreshes the managed extension folder from `release`.
    func installManagedExtension(from release: UpdateCheck.Release, reveal: Bool) {
        guard !installing, release.extensionZip != nil else { return }
        extensionInstallError = nil
        extensionInstalling = true
        Task {
            var work: UpdateWork?
            do {
                let job = try UpdateWork.make(release)
                work = job
                let sums = try await job.checksums()
                guard let asset = release.extensionZip else { throw InstallError.missingAsset }
                let zip = try await job.fetch(asset, checksums: sums) { _ in }
                try await Task.detached { try job.installExtension(zip: zip) }.value
                job.cleanUp()
                if reveal { NSWorkspace.shared.activateFileViewerSelecting([ManagedExtension.folder]) }
            } catch {
                work?.cleanUp()
                extensionInstallError = error.localizedDescription
            }
            extensionInstalling = false
            managedExtensionVersion = ManagedExtension.version
        }
    }

    /// After the app itself was updated by hand, bring the managed folder to
    /// the same version when the release for this version is known.
    func refreshManagedExtensionIfNeeded() {
        guard let installed = managedExtensionVersion, let release = latestRelease,
              UpdateCheck.isSame(release.version, currentVersion),
              UpdateCheck.isNewer(release.version, than: installed), !extensionInstalling else { return }
        installManagedExtension(from: release, reveal: false)
    }

    func setUpManagedExtension() {
        if let release = latestRelease, release.extensionZip != nil, !UpdateCheck.isNewer(currentVersion, than: release.version) {
            installManagedExtension(from: release, reveal: true)
        } else {
            extensionInstallError = L("Primero buscá actualizaciones para saber qué versión instalar.")
        }
    }
}
