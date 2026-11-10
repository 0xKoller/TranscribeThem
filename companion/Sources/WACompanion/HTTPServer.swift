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
        guard let nwPort = NWEndpoint.Port(rawValue: port) else {
            throw NSError(domain: "HTTPServer", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid port"])
        }
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: nwPort)
        let l = try NWListener(using: params)
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
            let features = OnDeviceTextActions.features
            let respObj: [String: Any] = [
                "ok": true,
                "status": "ok",
                "ready": isReady,
                "engine": "parakeet",
                "model": await transcriber.modelIdentifier,
                "version": BundleVersion.current(),
                "processedCount": stats.processedCount,
                "totalAudioSeconds": stats.totalAudioSeconds,
                "features": [
                    "summarize": features.summarize,
                    "translate": features.translate,
                ],
            ]
            return json(respObj, status: 200, text: "OK", headers: corsHeaders)
        }

        if req.method == "POST" && path == "/v1/text" {
            return await handleText(req, headers: corsHeaders)
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
                errorCode: obj["errorCode"] as? String ?? "",
                transcript: obj["transcript"] as? String
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
                    site: site,
                    transcript: result.text
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

    private func handleText(_ req: HTTPRequest, headers: [String: String]) async -> HTTPResponse {
        guard let obj = try? JSONSerialization.jsonObject(with: req.body) as? [String: Any] else {
            return textFailure(code: .badRequest, message: "El cuerpo JSON no es válido.", status: 400, headers: headers)
        }
        let action = obj["action"] as? String
        let text = obj["text"] as? String
        let language = obj["targetLanguage"] as? String
        switch TextRequests.validate(action: action, text: text, targetLanguage: language) {
        case .rejected(_, let message):
            return textFailure(code: .badRequest, message: message, status: 400, headers: headers)
        case .ready(let action, let prompt):
            guard OnDeviceTextActions.isReady else {
                return textFailure(code: .unavailable, message: TextRequests.unavailableMessage, status: 501, headers: headers)
            }
            do {
                let result = try await OnDeviceTextActions.generate(prompt)
                return json([
                    "ok": true,
                    "text": result,
                    "action": action.rawValue,
                ], status: 200, text: "OK", headers: headers)
            } catch let error as OnDeviceTextError where error == .unavailable {
                return textFailure(code: .unavailable, message: TextRequests.unavailableMessage, status: 501, headers: headers)
            } catch {
                let message = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
                return textFailure(
                    code: .failed,
                    message: message.isEmpty ? TextRequests.emptyResultMessage : message,
                    status: 500,
                    headers: headers
                )
            }
        }
    }

    private func textFailure(
        code: TextActionFailureCode,
        message: String,
        status: Int,
        headers: [String: String]
    ) -> HTTPResponse {
        let statusText: String
        switch status {
        case 400: statusText = "Bad Request"
        case 501: statusText = "Not Implemented"
        default: statusText = "Internal Server Error"
        }
        return json([
            "ok": false,
            "error": message,
            "code": code.rawValue,
        ], status: status, text: statusText, headers: headers)
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
    static let maxHeaderBytes = 64 * 1024
    static let maxBodyBytes = 64 * 1024 * 1024

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
    private var stopped = false

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
            if self.stopped || self.isFinished { return }
            if let data = content, !data.isEmpty {
                self.receivedData.append(data)
                self.processData()
            }
            if self.stopped || self.isFinished { return }
            if error != nil {
                self.finish()
            } else if isComplete {
                // The peer closed its sending side. A full request is already
                // being answered, so keep the connection for the response;
                // only a truncated request is dropped here.
                if !self.isComplete() { self.finish() }
            } else if !self.isComplete() {
                self.readNext()
            }
        }
    }

    private func corsHeaders(for origin: String?) -> [String: String] {
        let allowOrigin = (origin?.isEmpty == false) ? origin! : "*"
        return [
            "Access-Control-Allow-Origin": allowOrigin,
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, X-WA-Token, X-Language",
        ]
    }

    private func reject(status: Int, statusText: String, error: String, headers: [String: String] = [:]) {
        guard !stopped, !isFinished else { return }
        stopped = true
        receivedData.removeAll(keepingCapacity: false)
        let body = (try? JSONSerialization.data(withJSONObject: ["ok": false, "error": error], options: [.sortedKeys]))
            ?? Data("{\"ok\":false,\"error\":\"request rejected\"}".utf8)
        var headers = headers
        headers["Content-Type"] = "application/json; charset=utf-8"
        let response = HTTPResponse(
            statusCode: status,
            statusText: statusText,
            headers: headers,
            body: body
        )
        connection.send(content: response.serialize(), completion: .contentProcessed { [weak self] _ in
            self?.finish()
        })
    }

    private func isComplete() -> Bool {
        if !parsedHeaders { return false }
        return receivedData.count >= (headerEndOffset + expectedBodyLength)
    }

    private func processData() {
        if stopped || isFinished { return }
        if !parsedHeaders {
            let delimiter = Data([13, 10, 13, 10])
            if let range = receivedData.range(of: delimiter) {
                if range.lowerBound > Self.maxHeaderBytes {
                    reject(status: 431, statusText: "Request Header Fields Too Large", error: "Los encabezados superan los 64 KB.")
                    return
                }
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
                    if cl > Self.maxBodyBytes {
                        reject(
                            status: 413,
                            statusText: "Payload Too Large",
                            error: "El cuerpo supera los 64 MB.",
                            headers: corsHeaders(for: self.headers["origin"])
                        )
                        return
                    }
                    expectedBodyLength = max(0, cl)
                } else {
                    expectedBodyLength = 0
                }
            } else if receivedData.count > Self.maxHeaderBytes {
                reject(status: 431, statusText: "Request Header Fields Too Large", error: "Los encabezados superan los 64 KB.")
                return
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
