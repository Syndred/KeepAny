import Foundation
import Capacitor

private enum ConnectionFailure: Error { case failed, limit, timedOut }
private func aiFailureCode(_ error: Error) -> String {
    if let failure = error as? ConnectionFailure, case .timedOut = failure { return "TIMEOUT" }
    return "native-ai-failed"
}
private func failureCode(_ error: Error) -> String {
    if let failure = error as? ConnectionFailure, case .limit = failure { return "native-connections-limit" }
    return "native-connections-failed"
}
private let backupLimit = 100 * 1024 * 1024 + 1024
private let chunkSize = 256 * 1024
private func target(_ text: String) throws -> URL {
    guard text.count <= 8192, let url = URL(string: text), url.scheme == "https", url.host != nil, url.user == nil, url.password == nil, url.fragment == nil else { throw ConnectionFailure.failed }
    return url
}
private func origin(_ url: URL) -> String { var parts = URLComponents(url: url, resolvingAgainstBaseURL: false)!; parts.path = ""; parts.query = nil; parts.fragment = nil; if parts.port == 443 { parts.port = nil }; return parts.string! }
private func sessionRoute(_ path: String, _ method: String) -> Bool {
    if path == "/api/auth/get-session" || path == "/sync/devices" { return method == "GET" }
    if ["/api/auth/sign-in/email", "/api/auth/sign-up/email", "/api/auth/sign-out", "/sync/identity", "/sync/preflight", "/sync/push", "/sync/pull"].contains(path) { return method == "POST" }
    if path == "/workspaces" { return method == "GET" || method == "POST" }
    if path.range(of: "^/workspaces/[0-9a-fA-F-]{36}/attachments/[0-9a-fA-F-]{36}$", options: .regularExpression) != nil { return method == "GET" || method == "PUT" }
    if path.range(of: "^/workspaces/[0-9a-fA-F-]{36}/key-envelopes(?:/[0-9a-fA-F-]{36}(?:/revoke)?)?$", options: .regularExpression) != nil { return path.hasSuffix("/revoke") ? method == "POST" : method == "GET" || method == "POST" && path.hasSuffix("/key-envelopes") }
    return false
}
private final class MemorySession {
    let origin: String
    var cookies: [HTTPCookie] = []
    init(_ origin: String) { self.origin = origin }
}
private struct ConnectionReply { let status: Int; let headers: [String: String]; let size: Int; let data: Data? }

// Each task owns an ephemeral URLSession. Neither it nor its delegate uses the
// shared cookie store, URL credential storage, cache or redirect authentication.
private final class BoundedRequest: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
    let limit: Int
    let output: URL?
    let timeout: TimeInterval
    let completion: (Result<(ConnectionReply, [HTTPCookie]), Error>) -> Void
    var file: FileHandle?
    var data = Data()
    var size = 0
    var head: HTTPURLResponse?
    var failed = false
    private var limitExceeded = false
    var session: URLSession?
    private let taskLock = NSLock()
    private var task: URLSessionTask?
    init(limit: Int, output: URL?, timeout: TimeInterval = 30, completion: @escaping (Result<(ConnectionReply, [HTTPCookie]), Error>) -> Void) throws {
        self.limit = limit; self.output = output; self.timeout = timeout; self.completion = completion
        if let output { file = try FileHandle(forWritingTo: output); try file?.truncate(atOffset: 0) }
    }
    func start(_ request: URLRequest, upload: URL?) {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil; config.httpShouldSetCookies = false
        config.urlCredentialStorage = nil; config.urlCache = nil
        config.timeoutIntervalForRequest = timeout; config.timeoutIntervalForResource = timeout
        let queue = OperationQueue(); queue.maxConcurrentOperationCount = 1
        let session = URLSession(configuration: config, delegate: self, delegateQueue: queue); self.session = session
        let pending: URLSessionTask
        if let upload { pending = session.uploadTask(with: request, fromFile: upload) } else { pending = session.dataTask(with: request) }
        taskLock.lock(); task = pending; taskLock.unlock()
        pending.resume()
    }
    func cancel() {
        // Plugin cancellation and URLSession completion run on different queues.
        // Capture the task under the same lock used to publish/clear it, then
        // cancel outside the lock so Foundation callbacks cannot re-enter it.
        taskLock.lock(); let pending = task; taskLock.unlock()
        pending?.cancel()
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { failed = true; completionHandler(nil) }
    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust { completionHandler(.performDefaultHandling, nil) }
        else { completionHandler(.cancelAuthenticationChallenge, nil) }
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let head = response as? HTTPURLResponse, (200..<600).contains(head.statusCode), !(300..<400).contains(head.statusCode) else { failed = true; completionHandler(.cancel); return }
        if response.expectedContentLength > Int64(limit) { failed = true; limitExceeded = output != nil; completionHandler(.cancel); return }
        self.head = head; completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive bytes: Data) {
        guard !failed else { return }
        guard bytes.count <= limit - size else { failed = true; limitExceeded = output != nil; dataTask.cancel(); return }
        do { if let file { try file.write(contentsOf: bytes) } else { data.append(bytes) }; size += bytes.count }
        catch { failed = true; dataTask.cancel() }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        defer {
            try? file?.close(); session.finishTasksAndInvalidate(); self.session = nil
            taskLock.lock(); self.task = nil; taskLock.unlock()
        }
        // URLSession reports NSURLErrorCancelled after a delegate rejects an
        // oversized response. Preserve the checked cause across that callback.
        guard !limitExceeded else { completion(.failure(ConnectionFailure.limit)); return }
        if let failure = error as? URLError, failure.code == .timedOut { completion(.failure(ConnectionFailure.timedOut)); return }
        guard error == nil, !failed, let head, let url = head.url else { completion(.failure(ConnectionFailure.failed)); return }
        var headers: [String: String] = [:]
        for name in ["content-type", "content-length"] { if let value = head.value(forHTTPHeaderField: name) { headers[name] = value } }
        let raw = head.allHeaderFields.reduce(into: [String: String]()) { result, field in if let name = field.key as? String, let value = field.value as? String { result[name] = value } }
        let cookies = HTTPCookie.cookies(withResponseHeaderFields: raw, for: url)
        completion(.success((ConnectionReply(status: head.statusCode, headers: headers, size: size, data: output == nil ? data : nil), cookies)))
    }
}

@objc(KeepAnyConnectionsPlugin)
public final class KeepAnyConnectionsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KeepAnyConnectionsPlugin"
    public let jsName = "KeepAnyConnections"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "openSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "closeSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sessionRequest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "backupWrite", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "backupRequest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "backupRead", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "aiOpen", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "aiWrite", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "aiRequest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "aiRead", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "aiCancel", returnType: CAPPluginReturnPromise)
    ]
    private let queue = DispatchQueue(label: "KeepAny.Connections")
    private var sessions: [String: MemorySession] = [:]
    private var files: [String: URL] = [:]
    private var sealed: Set<String> = []
    private var active: [String: BoundedRequest] = [:]
    private var owners: [String: String] = [:]
    private var cancelled: [String: Date] = [:]
    private final class AiTransfer {
        let id: String, url: URL, headers: [String: String], deadline: Date
        var input = Data(), response: Data?, job: BoundedRequest?, expiry: DispatchWorkItem?, sealed = false, closed = false, timedOut = false
        init(_ id: String, _ url: URL, _ headers: [String: String], _ timeout: Int) { self.id = id; self.url = url; self.headers = headers; deadline = Date().addingTimeInterval(Double(timeout) / 1000) }
        func clear() { input.resetBytes(in: 0..<input.count); input = Data(); if var response { response.resetBytes(in: 0..<response.count) }; response = nil; expiry?.cancel(); expiry = nil }
    }
    private var ai: AiTransfer?
    private var aiExpiredId: String?
    private var aiCancelled: [String: Date] = [:]
    private let aiInputLimit = 16 * 1024 * 1024, aiOutputLimit = 8 * 1024 * 1024
    private lazy var root = FileManager.default.temporaryDirectory.appendingPathComponent("KeepAnyConnections", isDirectory: true)
    public override func load() { queue.async { if let old = try? FileManager.default.contentsOfDirectory(at: self.root, includingPropertiesForKeys: nil) { for url in old where url.lastPathComponent.range(of: "^transfer-[0-9a-fA-F-]{36}\\.bin$", options: .regularExpression) != nil { try? FileManager.default.removeItem(at: url) } } } }
    private func fields(_ call: CAPPluginCall, _ names: [String]) throws {
        guard call.options.count == names.count, call.options.keys.allSatisfy({ ($0 as? String).map(names.contains) == true }) else { throw ConnectionFailure.failed }
    }
    private func string(_ call: CAPPluginCall, _ key: String) throws -> String { guard let value = call.getString(key) else { throw ConnectionFailure.failed }; return value }
    private func live(_ id: String) throws {
        guard UUID(uuidString: id) != nil else { throw ConnectionFailure.failed }
        cancelled = cancelled.filter { $0.value > Date() }
        guard cancelled[id] == nil else { throw ConnectionFailure.failed }
    }
    private func bytes(_ call: CAPPluginCall, _ limit: Int) throws -> Data {
        let text = try string(call, "bodyBase64")
        guard text.count <= 4 * ((limit + 2) / 3), let data = Data(base64Encoded: text), data.count <= limit else { throw ConnectionFailure.failed }; return data
    }
    private func file(_ id: String) throws -> URL {
        try live(id); if let value = files[id] { return value }
        guard files.count < 2 else { throw ConnectionFailure.failed }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let url = root.appendingPathComponent("transfer-\(id).bin")
        guard !FileManager.default.fileExists(atPath: url.path), FileManager.default.createFile(atPath: url.path, contents: nil, attributes: [.protectionKey: FileProtectionType.complete]) else { throw ConnectionFailure.failed }
        files[id] = url; return url
    }
    private func invoke(_ call: CAPPluginCall, _ action: @escaping () throws -> Void) {
        queue.async { do { try action() } catch { let code = failureCode(error); call.reject(code, code) } }
    }
    @objc public func openSession(_ call: CAPPluginCall) { invoke(call) {
        try self.fields(call, ["origin"]); let text = try self.string(call, "origin"), url = try target(text)
        guard text == origin(url), self.sessions.count < 4, !self.sessions.values.contains(where: { $0.origin == text }) else { throw ConnectionFailure.failed }
        let id = UUID().uuidString; self.sessions[id] = MemorySession(text); call.resolve(["sessionId": id])
    } }
    @objc public func closeSession(_ call: CAPPluginCall) { invoke(call) {
        try self.fields(call, ["sessionId"]); let id = try self.string(call, "sessionId"); self.sessions[id]?.cookies.removeAll(); self.sessions.removeValue(forKey: id); for (request, owner) in self.owners where owner == id { self.active[request]?.cancel() }; call.resolve()
    } }
    private func request(_ call: CAPPluginCall, backup: Bool) throws {
        try fields(call, backup ? ["requestId", "url", "method", "headers"] : ["requestId", "sessionId", "url", "method", "headers", "bodyBase64"])
        let id = try string(call, "requestId"), url = try target(string(call, "url")), method = try string(call, "method")
        try live(id); guard active.count < 4, active[id] == nil else { throw ConnectionFailure.failed }
        let sessionId = backup ? "" : try string(call, "sessionId"), owner = sessions[sessionId]
        if backup {
            guard ["GET", "PUT"].contains(method), let host = url.host, host.contains("."), host.range(of: "^[0-9.]+$", options: .regularExpression) == nil, ![".localhost", ".local", ".internal"].contains(where: host.hasSuffix) else { throw ConnectionFailure.failed }
        } else { guard let owner, origin(url) == owner.origin, url.query == nil, sessionRoute(URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath ?? "", method) else { throw ConnectionFailure.failed } }
        guard let supplied = call.getObject("headers") else { throw ConnectionFailure.failed }
        let allowed = backup ? ["authorization", "content-type"] : ["accept", "content-type", "x-keepany-account-id", "x-ciphertext-sha256"]
        var request = URLRequest(url: url); request.httpMethod = method; request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        for (key, raw) in supplied { guard allowed.contains(key), let value = raw as? String, value.count <= 16384, value.rangeOfCharacter(from: .newlines) == nil, !value.contains("\0") else { throw ConnectionFailure.failed }; request.setValue(value, forHTTPHeaderField: key) }
        if let owner {
            request.setValue(owner.origin, forHTTPHeaderField: "Origin")
            owner.cookies.removeAll { ($0.expiresDate ?? .distantFuture) <= Date() }
            let values = owner.cookies.filter { cookie in let domain = cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")); return (url.host == domain || url.host?.hasSuffix(".\(domain)") == true) && (url.path == cookie.path || url.path.hasPrefix(cookie.path.hasSuffix("/") ? cookie.path : cookie.path + "/")) && (!cookie.isSecure || url.scheme == "https") }
            for (name, value) in HTTPCookie.requestHeaderFields(with: values) { request.setValue(value, forHTTPHeaderField: name) }
        }
        var upload: URL?, output: URL?
        let limit: Int
        if backup { let local = try file(id); guard !sealed.contains(id) else { throw ConnectionFailure.failed }; sealed.insert(id); if method == "PUT" { let size = (try FileManager.default.attributesOfItem(atPath: local.path)[.size] as? NSNumber)?.intValue ?? 0; guard size > 0 else { throw ConnectionFailure.failed }; guard size <= backupLimit else { throw ConnectionFailure.limit } }; upload = method == "PUT" ? local : nil; output = method == "GET" ? local : nil; limit = method == "GET" ? backupLimit : 8192 }
        else { limit = url.path.contains("/attachments/") ? 4 * 1024 * 1024 : 8 * 1024 * 1024; let data = try bytes(call, limit); guard method != "GET" || data.isEmpty else { throw ConnectionFailure.failed }; if method != "GET" { request.httpBody = data } }
        let job = try BoundedRequest(limit: limit, output: output) { result in self.queue.async {
            self.active.removeValue(forKey: id)
            self.owners.removeValue(forKey: id)
            guard self.cancelled[id] == nil, backup || self.sessions[sessionId] === owner else { call.reject("native-connections-failed", "native-connections-failed"); return }
            switch result {
            case .failure(let error): let code = backup ? failureCode(error) : "native-connections-failed"; call.reject(code, code)
            case .success(let (reply, cookies)):
                if let owner { for cookie in cookies { owner.cookies.removeAll { $0.name == cookie.name && $0.domain == cookie.domain && $0.path == cookie.path }; if (cookie.expiresDate ?? .distantFuture) > Date() { owner.cookies.append(cookie) } }; if owner.cookies.count > 256 { owner.cookies.removeAll() } }
                var value: [String: Any] = ["status": reply.status, "headers": reply.headers, "size": reply.size]
                if let data = reply.data { value["bodyBase64"] = data.base64EncodedString() }; call.resolve(value)
            }
        } }
        active[id] = job; if !backup { owners[id] = sessionId }; job.start(request, upload: upload)
    }
    @objc public func sessionRequest(_ call: CAPPluginCall) { invoke(call) { try self.request(call, backup: false) } }
    @objc public func backupRequest(_ call: CAPPluginCall) { invoke(call) { try self.request(call, backup: true) } }
    @objc public func backupWrite(_ call: CAPPluginCall) { invoke(call) {
        try self.fields(call, ["requestId", "bodyBase64"]); let id = try self.string(call, "requestId"), data = try self.bytes(call, chunkSize)
        guard !data.isEmpty, !self.sealed.contains(id) else { throw ConnectionFailure.failed }
        let url = try self.file(id), handle = try FileHandle(forWritingTo: url); defer { try? handle.close() }
        let length = try handle.seekToEnd(); guard length + UInt64(data.count) <= UInt64(backupLimit) else { throw ConnectionFailure.limit }; try handle.write(contentsOf: data); call.resolve()
    } }
    @objc public func backupRead(_ call: CAPPluginCall) { invoke(call) {
        try self.fields(call, ["requestId", "offset"]); let id = try self.string(call, "requestId"); try self.live(id)
        guard let offset = call.getInt("offset"), offset >= 0, let url = self.files[id], self.active[id] == nil else { throw ConnectionFailure.failed }
        let handle = try FileHandle(forReadingFrom: url); defer { try? handle.close() }; try handle.seek(toOffset: UInt64(offset)); let data = try handle.read(upToCount: chunkSize) ?? Data(); call.resolve(["bodyBase64": data.base64EncodedString()])
    } }
    @objc public func cancel(_ call: CAPPluginCall) { invoke(call) {
        try self.fields(call, ["requestId"]); let id = try self.string(call, "requestId"); self.cancelled[id] = Date().addingTimeInterval(120); self.active[id]?.cancel(); self.sealed.remove(id); if let file = self.files.removeValue(forKey: id) { try? FileManager.default.removeItem(at: file) }; call.resolve()
    } }
    private func aiEndpoint(_ provider: String, _ base: String, _ model: String) throws -> URL {
        guard ["openai", "anthropic", "google", "deepseek", "qwen", "doubao", "moonshot", "minimax", "openrouter", "ollama", "compatible"].contains(provider), base.count <= 2048,
            let url = URL(string: base), url.host != nil, url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
            url.scheme == "https" || url.scheme == "http" && ["localhost", "127.0.0.1", "[::1]", "::1"].contains(url.host ?? ""),
            !model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, model.count <= 200 else { throw ConnectionFailure.failed }
        var value = base; while value.hasSuffix("/") { value.removeLast() }
        if ["anthropic", "minimax"].contains(provider) { value += "/messages" }
        else if provider == "google" {
            let path = model.contains("/") ? model : "models/" + model
            guard path.range(of: "^[A-Za-z0-9_./-]+$", options: .regularExpression) != nil, path.split(separator: "/", omittingEmptySubsequences: false).allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else { throw ConnectionFailure.failed }
            value += "/" + path + ":generateContent"
        } else { if value.hasSuffix("/chat/completions") { value = String(value.dropLast("/chat/completions".count)) }; value += "/chat/completions" }
        guard let endpoint = URL(string: value), origin(endpoint) == origin(url) else { throw ConnectionFailure.failed }; return endpoint
    }
    private func aiLive(_ id: String) throws -> AiTransfer {
        if aiExpiredId == id { throw ConnectionFailure.timedOut }
        try aiId(id); guard let ai, ai.id == id, !ai.closed else { throw ConnectionFailure.failed }
        guard ai.deadline > Date() else { throw ConnectionFailure.timedOut }; return ai
    }
    private func aiId(_ id: String) throws {
        guard UUID(uuidString: id) != nil else { throw ConnectionFailure.failed }; aiCancelled = aiCancelled.filter { $0.value > Date() }; guard aiCancelled[id] == nil else { throw ConnectionFailure.failed }
    }
    private func invokeAi(_ call: CAPPluginCall, _ action: @escaping () throws -> Void) { queue.async { do { try action() } catch { let code = aiFailureCode(error); call.reject(code, code) } } }
    @objc public func aiOpen(_ call: CAPPluginCall) { invokeAi(call) {
        try self.fields(call, ["requestId", "provider", "baseURL", "model", "headers", "timeoutMs"])
        let id = try self.string(call, "requestId"); try self.aiId(id)
        guard self.ai == nil, self.files[id] == nil, self.active[id] == nil, let timeout = call.getInt("timeoutMs"), timeout >= 1, timeout <= 120000, let supplied = call.getObject("headers") else { throw ConnectionFailure.failed }
        let allowed = ["accept", "content-type", "user-agent", "authorization", "x-api-key", "x-goog-api-key", "anthropic-version", "anthropic-beta", "openai-organization", "openai-project", "http-referer", "x-title", "x-openrouter-title"]
        var headers: [String: String] = [:], total = 0
        for (key, raw) in supplied { guard allowed.contains(key), let value = raw as? String, value.count <= 16384, value.rangeOfCharacter(from: .newlines) == nil, !value.contains("\0") else { throw ConnectionFailure.failed }; total += (key + value).utf8.count; headers[key] = value }
        guard total <= 65536, headers["content-type"]?.range(of: "^application/json(?:\\s*;.*)?$", options: [.regularExpression, .caseInsensitive]) != nil else { throw ConnectionFailure.failed }
        let entry = AiTransfer(id, try self.aiEndpoint(self.string(call, "provider"), self.string(call, "baseURL"), self.string(call, "model")), headers, timeout); self.ai = entry
        if self.aiExpiredId == id { self.aiExpiredId = nil }
        let expiry = DispatchWorkItem { [weak self, weak entry] in
            guard let self, let entry, self.ai === entry else { return }; self.aiExpiredId = entry.id; self.aiCancelled[entry.id] = Date().addingTimeInterval(120)
            entry.closed = true; entry.timedOut = true; entry.clear(); entry.job?.cancel(); if entry.job == nil { self.ai = nil }
        }
        entry.expiry = expiry; self.queue.asyncAfter(deadline: .now() + .milliseconds(timeout), execute: expiry); call.resolve()
    } }
    @objc public func aiWrite(_ call: CAPPluginCall) { invokeAi(call) {
        try self.fields(call, ["requestId", "bodyBase64"]); let entry = try self.aiLive(self.string(call, "requestId")), bytes = try self.bytes(call, chunkSize)
        guard !entry.sealed, !bytes.isEmpty, entry.input.count + bytes.count <= self.aiInputLimit else { throw ConnectionFailure.failed }; entry.input.append(bytes); call.resolve()
    } }
    @objc public func aiRequest(_ call: CAPPluginCall) { invokeAi(call) {
        try self.fields(call, ["requestId"]); let entry = try self.aiLive(self.string(call, "requestId")); guard !entry.sealed, !entry.input.isEmpty else { throw ConnectionFailure.failed }; entry.sealed = true
        var request = URLRequest(url: entry.url); request.httpMethod = "POST"; request.httpBody = entry.input; entry.input = Data()
        for (name, value) in entry.headers { request.setValue(value, forHTTPHeaderField: name) }
        let job = try BoundedRequest(limit: self.aiOutputLimit, output: nil, timeout: max(0.001, entry.deadline.timeIntervalSinceNow)) { result in self.queue.async {
            entry.job = nil
            guard self.ai === entry, !entry.closed else { let code = entry.timedOut ? "TIMEOUT" : "native-ai-failed"; call.reject(code, code); if self.ai === entry { self.ai = nil }; return }
            guard entry.deadline > Date() else { entry.clear(); self.ai = nil; call.reject("TIMEOUT", "TIMEOUT"); return }
            switch result {
            case .failure(let error): entry.clear(); self.ai = nil; let code = aiFailureCode(error); call.reject(code, code)
            case .success(let (reply, _)): entry.response = reply.data; call.resolve(["status": reply.status, "headers": reply.headers, "size": reply.size])
            }
        } }
        entry.job = job; job.start(request, upload: nil)
    } }
    @objc public func aiRead(_ call: CAPPluginCall) { invokeAi(call) {
        try self.fields(call, ["requestId", "offset"]); let entry = try self.aiLive(self.string(call, "requestId"))
        guard let data = entry.response, let offset = call.getInt("offset"), offset >= 0, offset < data.count else { throw ConnectionFailure.failed }
        call.resolve(["bodyBase64": data.subdata(in: offset..<min(offset + chunkSize, data.count)).base64EncodedString()])
    } }
    @objc public func aiCancel(_ call: CAPPluginCall) { invokeAi(call) {
        try self.fields(call, ["requestId"]); let id = try self.string(call, "requestId"); if self.aiExpiredId == id { self.aiExpiredId = nil }; self.aiCancelled[id] = Date().addingTimeInterval(120)
        if let entry = self.ai, entry.id == id { entry.closed = true; entry.clear(); entry.job?.cancel(); if entry.job == nil { self.ai = nil } }; call.resolve()
    } }
}
