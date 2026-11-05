import CompanionCore
import Foundation
import Network

public final class HTTPServer: @unchecked Sendable {
    public let port: UInt16
    private var listener: NWListener?
    private let transcriber: Transcriber
    private let service: CompanionService
    private var onActivity: (@Sendable () -> Void)?

    public init(
        port: UInt16 = 8765,
        transcriber: Transcriber = .shared,
        service: CompanionService,
        onActivity: (@Sendable () -> Void)? = nil
    ) {
        self.port = port
        self.transcriber = transcriber
        self.service = service
        self.onActivity = onActivity
    }

    private let serverQueue = DispatchQueue(label: "wa.server")
    private var activeHandlers: [UUID: ConnectionHandler] = [:]
    private let handlersLock = NSLock()

    private func addHandler(_ h: ConnectionHandler) {
        handlersLock.lock()
        activeHandlers[h.id] = h
        handlersLock.unlock()
    }

    private func removeHandler(_ id: UUID) {
        handlersLock.lock()
        activeHandlers.removeValue(forKey: id)
        handlersLock.unlock()
    }

    public func start() throws {
        let params = NWParameters.tcp
        let nwPort = NWEndpoint.Port(rawValue: port) ?? 8765
        let l = try NWListener(using: params, on: nwPort)
        self.listener = l

        l.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                NSLog("[WACompanion] HTTP Server listening on 127.0.0.1:%d", self?.port ?? 0)
            case .failed(let err):
                NSLog("[WACompanion] HTTP Server failed: %@", err.localizedDescription)
            default:
                break
            }
        }

        l.newConnectionHandler = { [weak self] connection in
            guard let self = self else { return }

            // Verify connection is from loopback
            if case .hostPort(let host, _) = connection.endpoint {
                let hostStr = "\(host)"
                if !hostStr.contains("127.0.0.1") && !hostStr.contains("::1") && !hostStr.contains("localhost") {
                    NSLog("[WACompanion] Rejected non-loopback connection from %@", hostStr)
                    connection.cancel()
                    return
                }
            }

            let id = UUID()
            let handler = ConnectionHandler(
                id: id,
                connection: connection,
                onRequest: { [weak self] req in
                    guard let self = self else {
                        return HTTPResponse(statusCode: 500, statusText: "Internal Error", headers: [:], body: Data())
                    }
                    let resp = await self.handleRequest(req)
                    self.onActivity?()
                    return resp
                },
                onFinish: { [weak self] connId in
                    self?.removeHandler(connId)
                }
            )
            self.addHandler(handler)
            handler.start()
        }

        l.start(queue: serverQueue)
    }

    public func stop() {
        listener?.cancel()
        listener = nil
    }

    private func handleRequest(_ req: HTTPRequest) async -> HTTPResponse {
        let origin = req.headers["origin"]

        // Cross-Origin / Security Check:
        // Reject arbitrary web pages calling localhost from regular web contexts
        if let origin = origin, !origin.isEmpty {
            let isExtension = origin.starts(with: "chrome-extension://")
            let isLocal = origin.starts(with: "http://127.0.0.1") || origin.starts(with: "http://localhost")
            if !isExtension && !isLocal {
                NSLog("[WACompanion] Blocked untrusted origin: %@", origin)
                let body = Data("{\"ok\":false,\"error\":\"Forbidden: untrusted origin\"}".utf8)
                return HTTPResponse(statusCode: 403, statusText: "Forbidden", headers: ["Content-Type": "application/json"], body: body)
            }
        }

        let allowOrigin = origin ?? "*"
        var corsHeaders = [
            "Access-Control-Allow-Origin": allowOrigin,
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, X-WA-Token, X-Language",
            "Access-Control-Max-Age": "86400"
        ]

        if req.method == "OPTIONS" {
            return HTTPResponse(statusCode: 204, statusText: "No Content", headers: corsHeaders, body: Data())
        }

        let path = req.path.components(separatedBy: "?").first ?? req.path

        if req.method == "GET" && (path == "/health" || path == "/status" || path == "/") {
            let stats = service.stats.snapshot()
            let isReady = await transcriber.ready
            let respObj: [String: Any] = [
                "ok": true,
                "status": "ok",
                "ready": isReady,
                "engine": "parakeet",
                "model": "parakeet-tdt-0.6b-v3",
                "version": "0.2.0",
                "processedCount": stats.processedCount,
                "totalAudioSeconds": stats.totalAudioSeconds
            ]
            return json(respObj, status: 200, text: "OK", headers: corsHeaders)
        }

        if path == "/v1/settings" && (req.method == "GET" || req.method == "POST") {
            let settings: CompanionSettings
            if req.method == "POST" {
                let obj = (try? JSONSerialization.jsonObject(with: req.body)) as? [String: Any] ?? [:]
                settings = service.updateSettings(json: obj)
            } else {
                settings = service.settings.current
            }
            return jsonEncodable(SettingsBody(ok: true, settings: settings), status: 200, text: "OK", headers: corsHeaders)
        }

        if req.method == "POST" && path == "/v1/hello" {
            let obj = (try? JSONSerialization.jsonObject(with: req.body)) as? [String: Any] ?? [:]
            let version = obj["version"] as? String ?? ""
            let browser = obj["browser"] as? String ?? "chrome"
            service.noteHello(version: version, browser: browser)
            return json(["ok": true], status: 200, text: "OK", headers: corsHeaders)
        }

        if req.method == "POST" && path == "/v1/jobs" {
            let obj = (try? JSONSerialization.jsonObject(with: req.body)) as? [String: Any] ?? [:]
            service.recordJob(
                audioSeconds: Self.double(obj["audioSeconds"]),
                transcribeMs: Self.int(obj["transcribeMs"]),
                engine: obj["engine"] as? String ?? "whisper",
                model: obj["model"] as? String ?? "",
                ok: Self.bool(obj["ok"]) ?? false,
                site: obj["site"] as? String ?? "whatsapp",
                errorCode: obj["errorCode"] as? String ?? ""
            )
            let stats = service.stats.snapshot()
            return json([
                "ok": true,
                "processedCount": stats.processedCount,
            ], status: 200, text: "OK", headers: corsHeaders)
        }

        if req.method == "POST" && path == "/v1/open" {
            service.requestOpen()
            return json(["ok": true], status: 200, text: "OK", headers: corsHeaders)
        }

        if req.method == "POST" && path == "/transcribe" {
            let isReady = await transcriber.ready
            guard isReady else {
                let errObj: [String: Any] = ["ok": false, "error": "Model still loading, please retry in a moment"]
                let data = (try? JSONSerialization.data(withJSONObject: errObj)) ?? Data()
                corsHeaders["Content-Type"] = "application/json; charset=utf-8"
                return HTTPResponse(statusCode: 503, statusText: "Service Unavailable", headers: corsHeaders, body: data)
            }

            var audioData: Data? = nil
            var mimeType: String? = req.headers["content-type"]
            var languageHint: String? = req.headers["x-language"]
            var site = "whatsapp"

            let cType = (req.headers["content-type"] ?? "").lowercased()
            if cType.contains("application/json") {
                if let json = try? JSONSerialization.jsonObject(with: req.body) as? [String: Any] {
                    if let b64 = json["audioBase64"] as? String {
                        audioData = Data(base64Encoded: b64)
                    }
                    if let mime = json["mimeType"] as? String {
                        mimeType = mime
                    }
                    if let lang = json["language"] as? String {
                        languageHint = lang
                    }
                    if let rawSite = json["site"] as? String {
                        site = rawSite
                    }
                }
            } else {
                // Raw binary body
                audioData = req.body
            }

            guard let rawAudio = audioData, !rawAudio.isEmpty else {
                let errObj: [String: Any] = ["ok": false, "error": "Missing or empty audio data"]
                let data = (try? JSONSerialization.data(withJSONObject: errObj)) ?? Data()
                corsHeaders["Content-Type"] = "application/json; charset=utf-8"
                return HTTPResponse(statusCode: 400, statusText: "Bad Request", headers: corsHeaders, body: data)
            }

            do {
                let result = try await transcriber.transcribe(
                    audioData: rawAudio,
                    mimeType: mimeType,
                    languageHint: languageHint
                )
                let wordObjs: [[String: Any]] = result.words.map { word in
                    ["text": word.text, "start": word.start, "end": word.end]
                }
                let respObj: [String: Any] = [
                    "ok": true,
                    "text": result.text,
                    "audioSeconds": result.audioSeconds,
                    "transcribeMs": result.transcribeMs,
                    "engine": result.engine,
                    "model": result.model,
                    "decoder": result.decoder,
                    "words": wordObjs
                ]
                service.recordJob(
                    audioSeconds: result.audioSeconds,
                    transcribeMs: result.transcribeMs,
                    engine: result.engine,
                    model: result.model,
                    ok: true,
                    site: site
                )
                let data = (try? JSONSerialization.data(withJSONObject: respObj, options: [.sortedKeys])) ?? Data()
                corsHeaders["Content-Type"] = "application/json; charset=utf-8"
                return HTTPResponse(statusCode: 200, statusText: "OK", headers: corsHeaders, body: data)
            } catch {
                NSLog("[WACompanion] Transcribe error: %@", error.localizedDescription)
                let errObj: [String: Any] = ["ok": false, "error": error.localizedDescription]
                let data = (try? JSONSerialization.data(withJSONObject: errObj)) ?? Data()
                corsHeaders["Content-Type"] = "application/json; charset=utf-8"
                return HTTPResponse(statusCode: 500, statusText: "Internal Server Error", headers: corsHeaders, body: data)
            }
        }

        let notFound = Data("{\"ok\":false,\"error\":\"Not Found\"}".utf8)
        corsHeaders["Content-Type"] = "application/json; charset=utf-8"
        return HTTPResponse(statusCode: 404, statusText: "Not Found", headers: corsHeaders, body: notFound)
    }

    private func json(_ obj: [String: Any], status: Int, text: String, headers: [String: String]) -> HTTPResponse {
        var headers = headers
        headers["Content-Type"] = "application/json; charset=utf-8"
        let data = (try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])) ?? Data()
        return HTTPResponse(statusCode: status, statusText: text, headers: headers, body: data)
    }

    private func jsonEncodable(_ body: SettingsBody, status: Int, text: String, headers: [String: String]) -> HTTPResponse {
        var headers = headers
        headers["Content-Type"] = "application/json; charset=utf-8"
        let data = (try? CompanionJSON.apiEncoder.encode(body)) ?? Data("{}".utf8)
        return HTTPResponse(statusCode: status, statusText: text, headers: headers, body: data)
    }

    private static func bool(_ value: Any?) -> Bool? {
        if let value = value as? Bool { return value }
        if let value = value as? NSNumber { return value.boolValue }
        return nil
    }

    private static func double(_ value: Any?) -> Double {
        if let value = value as? Double { return value }
        if let value = value as? Int { return Double(value) }
        if let value = value as? NSNumber { return value.doubleValue }
        return 0
    }

    private static func int(_ value: Any?) -> Int {
        if let value = value as? Int { return value }
        if let value = value as? Double { return Int(value) }
        if let value = value as? NSNumber { return value.intValue }
        return 0
    }
}

private struct SettingsBody: Encodable {
    var ok: Bool
    var settings: CompanionSettings
}

// MARK: - Internal HTTP Types & Connection Handling

struct HTTPRequest: Sendable {
    var method: String
    var path: String
    var headers: [String: String]
    var body: Data
}

struct HTTPResponse: Sendable {
    var statusCode: Int
    var statusText: String
    var headers: [String: String]
    var body: Data

    func serialize() -> Data {
        var str = "HTTP/1.1 \(statusCode) \(statusText)\r\n"
        var h = headers
        h["Content-Length"] = "\(body.count)"
        h["Connection"] = "close"
        for (k, v) in h {
            str += "\(k): \(v)\r\n"
        }
        str += "\r\n"
        var data = Data(str.utf8)
        data.append(body)
        return data
    }
}

private final class ConnectionHandler: @unchecked Sendable {
    let id: UUID
    let connection: NWConnection
    let onRequest: @Sendable (HTTPRequest) async -> HTTPResponse
    let onFinish: @Sendable (UUID) -> Void
    private let queue = DispatchQueue(label: "wa.conn")
    var receivedData = Data()
    var parsedHeaders = false
    var expectedBodyLength = 0
    var headerEndOffset = 0
    var method = ""
    var path = ""
    var headers: [String: String] = [:]
    private var isFinished = false

    init(
        id: UUID,
        connection: NWConnection,
        onRequest: @escaping @Sendable (HTTPRequest) async -> HTTPResponse,
        onFinish: @escaping @Sendable (UUID) -> Void
    ) {
        self.id = id
        self.connection = connection
        self.onRequest = onRequest
        self.onFinish = onFinish
    }

    func start() {
        connection.start(queue: queue)
        readNext()
    }

    private func finish() {
        queue.async { [weak self] in
            guard let self = self, !self.isFinished else { return }
            self.isFinished = true
            self.connection.cancel()
            self.onFinish(self.id)
        }
    }

    private func readNext() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] content, _, isComplete, error in
            guard let self = self else { return }
            if let data = content, !data.isEmpty {
                self.receivedData.append(data)
                self.processData()
            }
            if error != nil {
                self.finish()
            } else if isComplete {
                if !self.parsedHeaders {
                    self.finish()
                }
            } else {
                if !self.isComplete() {
                    self.readNext()
                }
            }
        }
    }

    private func isComplete() -> Bool {
        if !parsedHeaders { return false }
        return receivedData.count >= (headerEndOffset + expectedBodyLength)
    }

    private func processData() {
        if !parsedHeaders {
            // Search for \r\n\r\n delimiter
            let delimiter = Data([13, 10, 13, 10])
            if let range = receivedData.range(of: delimiter) {
                let headerData = receivedData.subdata(in: 0..<range.lowerBound)
                headerEndOffset = range.upperBound
                parsedHeaders = true

                if let headerStr = String(data: headerData, encoding: .utf8) {
                    let lines = headerStr.components(separatedBy: "\r\n")
                    if let firstLine = lines.first {
                        let parts = firstLine.components(separatedBy: " ")
                        if parts.count >= 2 {
                            self.method = parts[0].uppercased()
                            self.path = parts[1]
                        }
                    }
                    for line in lines.dropFirst() {
                        if let colon = line.firstIndex(of: ":") {
                            let key = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
                            let val = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
                            self.headers[key] = val
                        }
                    }
                }

                if let clStr = headers["content-length"], let cl = Int(clStr) {
                    expectedBodyLength = cl
                } else {
                    expectedBodyLength = 0
                }
            }
        }

        if isComplete() && !isFinished {
            let body: Data
            if expectedBodyLength > 0 && receivedData.count >= (headerEndOffset + expectedBodyLength) {
                body = receivedData.subdata(in: headerEndOffset..<(headerEndOffset + expectedBodyLength))
            } else {
                body = Data()
            }

            let request = HTTPRequest(
                method: self.method,
                path: self.path,
                headers: self.headers,
                body: body
            )

            Task { [weak self] in
                guard let self = self else { return }
                let resp = await self.onRequest(request)
                let respData = resp.serialize()
                self.queue.async { [weak self] in
                    guard let self = self else { return }
                    self.connection.send(content: respData, completion: .contentProcessed { [weak self] _ in
                        self?.finish()
                    })
                }
            }
        }
    }
}
