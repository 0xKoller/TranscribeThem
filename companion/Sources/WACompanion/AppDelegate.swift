import AppKit
import CompanionCore
import Foundation
import SwiftUI
import UserNotifications

@MainActor
public final class AppDelegate: NSObject, NSApplicationDelegate, NSToolbarDelegate, UNUserNotificationCenterDelegate {
    private var statusItem: NSStatusItem!
    private var statusMenuItem: NSMenuItem!
    private var countMenuItem: NSMenuItem!
    private var updateMenuItem: NSMenuItem!
    private var updateTimer: Timer?

    private var server: HTTPServer?
    private let transcriber = Transcriber.shared
    // WA_COMPANION_PORT lets a development build run next to the installed app.
    private let port: UInt16 = ProcessInfo.processInfo.environment["WA_COMPANION_PORT"].flatMap { UInt16($0) } ?? 8765
    private let service = CompanionService(directory: AppSupport.directory())
    private var model: AppModel!
    private var window: NSWindow?
    private var settingsWindow: NSWindow?
    private var refreshTimer: Timer?

    public func applicationDidFinishLaunching(_ notification: Notification) {
        model = AppModel(service: service)
        if Bundle.main.bundleURL.pathExtension == "app" {
            UNUserNotificationCenter.current().delegate = self
        }
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
        setupApplicationMenu()
        setupMenu()
        NotificationCenter.default.addObserver(self, selector: #selector(languageDidChange), name: .appLanguageChanged, object: nil)
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
        startUpdateSchedule()
    }

    /// The automatic check: at launch, every hour if a day has passed, and
    /// after the Mac wakes up.
    private func startUpdateSchedule() {
        model.checkUpdatesIfDue()
        updateTimer = Timer.scheduledTimer(withTimeInterval: 60 * 60, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.model.checkUpdatesIfDue() }
        }
        NSWorkspace.shared.notificationCenter.addObserver(
            self, selector: #selector(didWake), name: NSWorkspace.didWakeNotification, object: nil
        )
    }

    @objc private func didWake() {
        // Give the network a moment to come back.
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
            self?.model.checkUpdatesIfDue()
        }
    }

    @objc private func checkForUpdatesFromMenu() {
        model.checkForUpdates(manual: true)
        openSettings()
    }

    // Clicking the update notification opens the window with the banner.
    public nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        Task { @MainActor in self.openWindow() }
        completionHandler()
    }

    @objc private func languageDidChange() {
        setupApplicationMenu()
        if let statusItem { NSStatusBar.system.removeStatusItem(statusItem) }
        setupMenu()
        settingsWindow?.title = L("Ajustes")
        refreshUI()
    }

    private func setupMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        if let button = statusItem.button {
            let custom = Bundle.main.url(forResource: "MenuBarTemplate", withExtension: "png")
                .flatMap { NSImage(contentsOf: $0) }
            if let img = custom ?? NSImage(systemSymbolName: "waveform", accessibilityDescription: "TranscribeThem") {
                img.size = NSSize(width: 22, height: 22)
                img.accessibilityDescription = "TranscribeThem"
                img.isTemplate = true
                button.image = img
            } else {
                button.title = "TT"
            }
            button.toolTip = "TranscribeThem"
        }

        let menu = NSMenu()

        let titleItem = NSMenuItem(title: "TranscribeThem", action: nil, keyEquivalent: "")
        titleItem.isEnabled = false
        menu.addItem(titleItem)

        statusMenuItem = NSMenuItem(title: L("Cargando el modelo"), action: nil, keyEquivalent: "")
        statusMenuItem.isEnabled = false
        menu.addItem(statusMenuItem)

        countMenuItem = NSMenuItem(title: L("Hoy: todavía no hay notas"), action: nil, keyEquivalent: "")
        countMenuItem.isEnabled = false
        menu.addItem(countMenuItem)

        updateMenuItem = NSMenuItem(title: "", action: #selector(openWindow), keyEquivalent: "")
        updateMenuItem.target = self
        updateMenuItem.isHidden = true
        menu.addItem(updateMenuItem)

        menu.addItem(NSMenuItem.separator())

        let openItem = NSMenuItem(title: L("Abrir"), action: #selector(openWindow), keyEquivalent: "")
        openItem.target = self
        menu.addItem(openItem)

        let openWhatsAppItem = NSMenuItem(title: L("Abrir WhatsApp Web"), action: #selector(openWhatsAppWeb), keyEquivalent: "")
        openWhatsAppItem.target = self
        menu.addItem(openWhatsAppItem)

        menu.addItem(NSMenuItem.separator())

        let settingsItem = NSMenuItem(title: L("Ajustes…"), action: #selector(openSettings), keyEquivalent: ",")
        settingsItem.target = self
        menu.addItem(settingsItem)

        if model.updateRepo != nil {
            let checkItem = NSMenuItem(title: L("Buscar actualizaciones…"), action: #selector(checkForUpdatesFromMenu), keyEquivalent: "")
            checkItem.target = self
            menu.addItem(checkItem)
        }

        let quitItem = NSMenuItem(title: L("Salir"), action: #selector(quitApp), keyEquivalent: "q")
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
            statusMenuItem.title = L("Listo")
        } else if model.modelFailed {
            statusMenuItem.title = L("No se pudo cargar el modelo")
        } else {
            statusMenuItem.title = L("Cargando el modelo")
        }
        let today = model.stats.activity(.today)
        if today.notes == 0 && today.fails == 0 {
            countMenuItem.title = L("Hoy: todavía no hay notas")
        } else {
            countMenuItem.title = LF("Hoy: %ld notas · %@", today.notes, Self.menuAudio(today.audioSeconds))
        }
        if let offer = model.offeredRelease {
            updateMenuItem.title = LF("Hay una versión nueva (%@)…", offer.version)
            updateMenuItem.isHidden = false
        } else {
            updateMenuItem.isHidden = true
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
            let host = NSHostingController(rootView: MainView(model: model, onNavigate: { [weak self] title in self?.window?.title = title }))
            let win = NSWindow(contentViewController: host)
            win.title = L("Inicio")
            win.toolbarStyle = .unified
            let toolbar = NSToolbar(identifier: "TranscribeThem.main")
            toolbar.delegate = self
            toolbar.displayMode = .iconOnly
            win.toolbar = toolbar
            win.setContentSize(NSSize(width: 820, height: 560))
            win.minSize = NSSize(width: 720, height: 480)
            win.styleMask = [.titled, .closable, .miniaturizable, .resizable]
            win.isReleasedWhenClosed = false
            if !win.setFrameUsingName("TranscribeThem.main") { win.center() }
            win.setFrameAutosaveName("TranscribeThem.main")
            window = win
        }
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }

    public func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [.flexibleSpace, NSToolbarItem.Identifier("settings")]
    }

    public func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        toolbarDefaultItemIdentifiers(toolbar)
    }

    public func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier identifier: NSToolbarItem.Identifier,
                        willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        guard identifier.rawValue == "settings" else { return nil }
        let item = NSToolbarItem(itemIdentifier: identifier)
        item.label = L("Ajustes")
        item.toolTip = L("Ajustes (⌘,)")
        item.image = NSImage(systemSymbolName: "gearshape", accessibilityDescription: L("Ajustes"))
        item.target = self
        item.action = #selector(openSettings)
        return item
    }

    @objc private func openSettings() {
        if settingsWindow == nil {
            let host = NSHostingController(rootView: SettingsView(model: model))
            let win = NSWindow(contentViewController: host)
            win.title = L("Ajustes")
            win.styleMask = [.titled, .closable]
            win.isReleasedWhenClosed = false
            win.center()
            settingsWindow = win
        }
        NSApp.activate(ignoringOtherApps: true)
        settingsWindow?.makeKeyAndOrderFront(nil)
    }

    private func setupApplicationMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: "TranscribeThem")
        let about = NSMenuItem(title: L("Acerca de TranscribeThem"), action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(about)
        if model.updateRepo != nil {
            let check = NSMenuItem(title: L("Buscar actualizaciones…"), action: #selector(checkForUpdatesFromMenu), keyEquivalent: "")
            check.target = self
            appMenu.addItem(check)
        }
        appMenu.addItem(.separator())
        let settings = NSMenuItem(title: L("Ajustes…"), action: #selector(openSettings), keyEquivalent: ",")
        settings.target = self
        appMenu.addItem(settings)
        appMenu.addItem(.separator())
        let quit = NSMenuItem(title: L("Salir de TranscribeThem"), action: #selector(quitApp), keyEquivalent: "q")
        quit.target = self
        appMenu.addItem(quit)
        appItem.submenu = appMenu
        main.addItem(appItem)

        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: L("Ventana"))
        windowMenu.addItem(withTitle: L("Cerrar"), action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowMenu.addItem(withTitle: L("Minimizar"), action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowItem.submenu = windowMenu
        main.addItem(windowItem)
        NSApp.windowsMenu = windowMenu
        NSApp.mainMenu = main
    }

    private func loadModelInBackground() {
        let localURL = model.nativeLocalPath.isEmpty ? nil : URL(fileURLWithPath: model.nativeLocalPath)
        model.loadNativeModel(localURL: localURL)
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
