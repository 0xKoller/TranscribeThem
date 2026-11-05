import AppKit
import CompanionCore
import Foundation
import SwiftUI

@MainActor
public final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var statusMenuItem: NSMenuItem!
    private var countMenuItem: NSMenuItem!

    private var server: HTTPServer?
    private let transcriber = Transcriber.shared
    private let port: UInt16 = 8765
    private let service = CompanionService(directory: AppSupport.directory())
    private var model: AppModel!
    private var window: NSWindow?
    private var refreshTimer: Timer?

    public func applicationDidFinishLaunching(_ notification: Notification) {
        model = AppModel(service: service)
        service.onChange = { [weak self] in
            Task { @MainActor in
                self?.refreshUI()
            }
        }
        service.onOpen = { [weak self] in
            Task { @MainActor in
                self?.openWindow()
            }
        }
        setupMenu()
        startServer()
        loadModelInBackground()
        model.applyLaunchAtLoginIfNeeded()
        refreshUI()
        if service.settings.fileWasMissing || service.settings.current.openAtLaunch {
            openWindow()
        }
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.refreshUI()
            }
        }
    }

    private func setupMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        if let button = statusItem.button {
            if let img = NSImage(systemSymbolName: "waveform", accessibilityDescription: "TranscribeThem") {
                img.isTemplate = true
                button.image = img
            } else {
                button.title = "WA"
            }
            button.toolTip = "TranscribeThem (Parakeet v3)"
        }

        let menu = NSMenu()

        let titleItem = NSMenuItem(title: "TranscribeThem", action: nil, keyEquivalent: "")
        titleItem.isEnabled = false
        menu.addItem(titleItem)

        statusMenuItem = NSMenuItem(title: "Cargando el modelo", action: nil, keyEquivalent: "")
        statusMenuItem.isEnabled = false
        menu.addItem(statusMenuItem)

        countMenuItem = NSMenuItem(title: "Hoy: todavía no hay notas", action: nil, keyEquivalent: "")
        countMenuItem.isEnabled = false
        menu.addItem(countMenuItem)

        menu.addItem(NSMenuItem.separator())

        let openItem = NSMenuItem(title: "Abrir", action: #selector(openWindow), keyEquivalent: "")
        openItem.target = self
        menu.addItem(openItem)

        let openWhatsAppItem = NSMenuItem(title: "Abrir WhatsApp Web", action: #selector(openWhatsAppWeb), keyEquivalent: "")
        openWhatsAppItem.target = self
        menu.addItem(openWhatsAppItem)

        menu.addItem(NSMenuItem.separator())

        let quitItem = NSMenuItem(title: "Salir", action: #selector(quitApp), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem.menu = menu
    }

    private func startServer() {
        do {
            server = HTTPServer(port: port, transcriber: transcriber, service: service) { [weak self] in
                Task { @MainActor [weak self] in
                    self?.refreshUI()
                }
            }
            try server?.start()
            model.serverReady = true
            model.serverLine = "En línea · 127.0.0.1:\(port)"
        } catch {
            model.serverReady = false
            model.serverLine = "No pudo abrir el puerto \(port)"
            NSLog("[WACompanion] Could not start server: %@", error.localizedDescription)
        }
    }

    private func refreshUI() {
        guard model != nil else { return }
        model.refresh()
        if model.modelReady {
            statusMenuItem.title = "Listo"
        } else if model.modelFailed {
            statusMenuItem.title = "No se pudo cargar el modelo"
        } else {
            statusMenuItem.title = "Cargando el modelo"
        }
        let today = model.stats.activity(.today)
        if today.notes == 0 && today.fails == 0 {
            countMenuItem.title = "Hoy: todavía no hay notas"
        } else {
            countMenuItem.title = "Hoy: \(today.notes) notas · \(Self.menuAudio(today.audioSeconds))"
        }
    }

    private static func menuAudio(_ seconds: Double) -> String {
        if seconds < 60 {
            return "\(Int(seconds.rounded())) s"
        }
        let minutes = Int(seconds / 60)
        return "\(minutes) min"
    }

    @objc private func openWindow() {
        if window == nil {
            let host = NSHostingController(rootView: MainView(model: model))
            let win = NSWindow(contentViewController: host)
            win.title = "TranscribeThem"
            win.setContentSize(NSSize(width: 820, height: 560))
            win.minSize = NSSize(width: 720, height: 480)
            win.styleMask = [.titled, .closable, .miniaturizable, .resizable]
            win.isReleasedWhenClosed = false
            win.center()
            window = win
        }
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }

    private func loadModelInBackground() {
        Task.detached { [transcriber] in
            do {
                try await transcriber.loadModels()
                await MainActor.run { [weak self] in
                    self?.model.modelFailed = false
                    self?.model.modelReady = true
                    self?.model.modelLine = "Listo"
                    self?.refreshUI()
                    if let button = self?.statusItem.button {
                        button.toolTip = "TranscribeThem: Listo (Parakeet v3)"
                    }
                }
            } catch {
                await MainActor.run { [weak self] in
                    self?.model.modelFailed = true
                    self?.model.modelReady = false
                    self?.model.modelLine = "No se pudo cargar el modelo"
                    self?.refreshUI()
                    NSLog("[WACompanion] Background load model failed: %@", error.localizedDescription)
                }
            }
        }
    }

    @objc private func openWhatsAppWeb() {
        if let url = URL(string: "https://web.whatsapp.com") {
            NSWorkspace.shared.open(url)
        }
    }

    @objc private func quitApp() {
        server?.stop()
        NSApplication.shared.terminate(nil)
    }
}
