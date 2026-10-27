import Foundation
import NIOCore
import NIOPosix
import NIOHTTP1
import NIOSSL

public struct McpEndpoint {
    public let instanceId: String, endpoint: String, certificatePem: String, spkiSha256: String
}
public struct McpRequest {
    public let instanceId: String, requestId: String, method: String, path: String, host: String, body: String
    public let headers: [String: String]
}
public enum McpTransportEvent {
    case request(McpRequest)
    case cancelled(instanceId: String, requestId: String)
    case stopped(instanceId: String)
}

/// Synchronous API is serialized off the NIO event loop by a lifecycle queue.
/// Callbacks are delivered on a separate serial queue and may safely call back
/// into this API. Construction/registration opens no listener.
public final class McpTransport {
    private let lifecycle = DispatchQueue(label: "keepany.mcp.lifecycle")
    private let callbacks = DispatchQueue(label: "keepany.mcp.events")
    private let event: (McpTransportEvent) -> Void
    private var active: TransportSession?
    private var prepared: PreparedSession?
    private let now: () -> UInt64

    public init(event: @escaping (McpTransportEvent) -> Void) { self.event = event; now = { DispatchTime.now().uptimeNanoseconds } }
    // Clock injection is internal to the core test target; the bridge always
    // uses the real monotonic clock and fixed 120-second lifetime.
    init(now: @escaping () -> UInt64, event: @escaping (McpTransportEvent) -> Void) { self.event = event; self.now = now }
    deinit { try? reset() }

    public func start(address: String) throws -> McpEndpoint {
        try lifecycle.sync {
            let endpoint = try prepareLocked(address: address)
            return try activateLocked(instanceId: endpoint.instanceId)
        }
    }
    public func prepare(address: String) throws -> McpEndpoint { try lifecycle.sync { try prepareLocked(address: address) } }
    public func activate(instanceId: String) throws -> McpEndpoint { try lifecycle.sync { try activateLocked(instanceId: instanceId) } }
    private func prepareLocked(address: String) throws -> McpEndpoint {
        expirePrepared()
        guard active == nil, prepared == nil else { throw McpTransportError.unavailable }
        try AddressPolicy.requireLocal(address)
        let identity = try EphemeralIdentity(address: address)
        let port = try AddressPolicy.unusedPort(address)
        let value = PreparedSession(address: address, port: port, identity: identity, deadline: now() + 120_000_000_000)
        let timer = DispatchSource.makeTimerSource(queue: lifecycle)
        let id = value.id
        timer.schedule(deadline: .now() + .seconds(120))
        timer.setEventHandler { [weak self] in
            guard let self, self.prepared?.id == id else { return }
            self.clearPrepared()
        }
        value.timer = timer
        prepared = value
        timer.resume()
        return value.endpoint
    }
    private func expirePrepared() { if let prepared, now() >= prepared.deadline { clearPrepared() } }
    private func clearPrepared() {
        guard let value = prepared else { return }
        let id = value.id
        prepared = nil; value.timer?.cancel(); value.timer = nil
        callbacks.async { [event] in event(.stopped(instanceId: id)) }
    }
    private func activateLocked(instanceId: String) throws -> McpEndpoint {
        expirePrepared()
        guard active == nil, let value = prepared, value.id == instanceId else { throw McpTransportError.stale }
        prepared = nil; value.timer?.cancel(); value.timer = nil
        // Interface removal or occupied port requires a fresh prepare/export;
        // never replace the endpoint or pin already exported by the caller.
        do { try AddressPolicy.requireLocal(value.address) }
        catch {
            callbacks.async { [event] in event(.stopped(instanceId: instanceId)) }
            throw McpTransportError.unavailable
        }
            let group = MultiThreadedEventLoopGroup(numberOfThreads: 1)
            let session = TransportSession(id: value.id, group: group, identity: value.identity) { [callbacks, event] value in
                callbacks.async { event(value) }
            }
            do {
                let bootstrap = ServerBootstrap(group: group)
                    .serverChannelOption(ChannelOptions.backlog, value: 8)
                    .childChannelOption(ChannelOptions.socketOption(.tcp_nodelay), value: 1)
                    .childChannelOption(ChannelOptions.maxMessagesPerRead, value: 1)
                    .childChannelInitializer { [weak session] channel in
                        guard let session, let tls = session.tls, let request = session.admit(channel) else { return channel.close() }
                        let ssl = NIOSSLServerHandler(context: tls)
                        var limits = NIOHTTPDecoderLimitConfiguration()
                        limits.maxHeaderFieldSize = HTTPPolicy.headerLimit
                        limits.maxHeaderListSize = HTTPPolicy.headerLimit
                        limits.maxHeaderFieldCount = HTTPPolicy.headerCount
                        return channel.pipeline.addHandler(ssl).flatMap {
                            channel.pipeline.configureHTTPServerPipeline(
                                withPipeliningAssistance: false,
                                withErrorHandling: false,
                                withDecoderLimitConfiguration: limits
                            )
                        }.flatMap {
                            channel.pipeline.addHandler(RequestHandler(session: session, request: request))
                        }.flatMapError { error in
                            session.cancel(request.id)
                            return channel.eventLoop.makeFailedFuture(error)
                        }
                    }
                let server = try bootstrap.bind(host: value.address, port: value.port).wait()
                guard server.localAddress?.port == value.port else { try? server.close().wait(); throw McpTransportError.unavailable }
                session.listener = server
                active = session
                return value.endpoint
            } catch {
                try? session.loop.submit { session.stop() }.wait()
                try? group.syncShutdownGracefully()
                throw McpTransportError.unavailable
            }
    }
    public func stop(instanceId: String) throws {
        try lifecycle.sync {
            expirePrepared()
            if let session = active, session.id == instanceId { try shutdown(session) }
            else if prepared?.id == instanceId { clearPrepared() }
            else { throw McpTransportError.stale }
        }
    }
    /// Reset is intentionally unscoped for the earliest new-WebView bootstrap.
    /// It shares the exact same queue as start, so no old start resurrects later.
    public func reset() throws {
        try lifecycle.sync { clearPrepared(); if let session = active { try shutdown(session) } }
    }
    /// System export/share may pause the UI. Only a prepared identity survives;
    /// an active listener always stops and requires a new pairing export.
    public func pause() throws { try lifecycle.sync { expirePrepared(); if let session = active { try shutdown(session) } } }
    private func shutdown(_ session: TransportSession) throws {
        active = nil
        var failure: Error?
        do { try session.loop.submit { session.stop() }.wait() } catch { failure = error }
        if let listener = session.listener { do { try listener.close().wait() } catch { failure = failure ?? error } }
        session.listener = nil
        do { try session.group.syncShutdownGracefully() } catch { failure = failure ?? error }
        if let failure { throw failure }
    }
    private func withSession<T>(_ id: String, _ operation: (TransportSession) throws -> T) throws -> T {
        try lifecycle.sync {
            guard let session = active, session.id == id else { throw McpTransportError.stale }
            return try operation(session)
        }
    }
    public func cancel(instanceId: String, requestId: String) throws {
        try withSession(instanceId) { session in try session.loop.submit { session.cancel(requestId) }.wait() }
    }
    public func responseStart(instanceId: String, requestId: String, status: Int, headers: [String: String]) throws {
        try withSession(instanceId) { session in
            try session.loop.submit {
                do {
                    let request = try session.request(requestId)
                    guard request.emitted, request.status == nil else { throw McpTransportError.invalid }
                    try HTTPPolicy.response(status: status, headers: headers)
                    request.status = status; request.responseHeaders = headers
                } catch { session.cancel(requestId); throw error }
            }.wait()
        }
    }
    public func responseWrite(instanceId: String, requestId: String, chunkBase64: String) throws {
        try withSession(instanceId) { session in
            try session.loop.submit {
                do {
                    let request = try session.request(requestId)
                    guard request.status != nil, !request.flushing,
                          chunkBase64.utf8.count <= ((HTTPPolicy.chunkLimit + 2) / 3) * 4,
                          let data = Data(base64Encoded: chunkBase64), data.base64EncodedString() == chunkBase64,
                          data.count <= HTTPPolicy.chunkLimit,
                          request.response.count + data.count <= HTTPPolicy.responseLimit else { throw McpTransportError.limit }
                    request.response.append(data)
                } catch { session.cancel(requestId); throw error }
            }.wait()
        }
    }
    public func responseEnd(instanceId: String, requestId: String) throws {
        try withSession(instanceId) { session in
            try session.loop.submit {
                // Acknowledge enqueueing, not a slow peer's network drain. This
                // keeps the lifecycle queue available for immediate cancel/reset.
                do { _ = try session.finish(requestId) }
                catch { session.cancel(requestId); throw error }
            }.wait()
        }
    }
}

private final class PreparedSession {
    let id = UUID().uuidString
    let address: String, port: Int, identity: EphemeralIdentity, deadline: UInt64
    var timer: DispatchSourceTimer?
    var endpoint: McpEndpoint { McpEndpoint(instanceId: id, endpoint: "https://\(address):\(port)/mcp", certificatePem: identity.certificatePem, spkiSha256: identity.spkiSha256) }
    init(address: String, port: Int, identity: EphemeralIdentity, deadline: UInt64) {
        self.address = address; self.port = port; self.identity = identity; self.deadline = deadline
    }
}

private final class PendingRequest {
    let id = UUID().uuidString
    let channel: Channel
    var deadline: Scheduled<Void>?
    var emitted = false, flushing = false
    var status: Int?
    var responseHeaders: [String: String] = [:]
    var response = Data()
    init(channel: Channel) { self.channel = channel }
}

private final class TransportSession {
    let id: String
    let group: MultiThreadedEventLoopGroup
    let loop: EventLoop
    var tls: NIOSSLContext?
    var listener: Channel?
    let event: (McpTransportEvent) -> Void
    private var requests: [String: PendingRequest] = [:]
    private var stopped = false
    init(id: String, group: MultiThreadedEventLoopGroup, identity: EphemeralIdentity, event: @escaping (McpTransportEvent) -> Void) {
        self.id = id; self.group = group; loop = group.next(); tls = identity.context; self.event = event
    }
    func admit(_ channel: Channel) -> PendingRequest? {
        loop.preconditionInEventLoop()
        guard !stopped, requests.count < 4 else { return nil }
        let request = PendingRequest(channel: channel)
        requests[request.id] = request
        // Total deadline includes TLS handshake, slow headers, body, JS and IO.
        request.deadline = loop.scheduleTask(in: .seconds(30)) { [weak self] in self?.cancel(request.id) }
        channel.closeFuture.whenComplete { [weak self] _ in self?.cancel(request.id) }
        return request
    }
    func request(_ id: String) throws -> PendingRequest {
        loop.preconditionInEventLoop()
        guard !stopped, let request = requests[id] else { throw McpTransportError.stale }
        return request
    }
    func cancel(_ id: String) {
        loop.preconditionInEventLoop()
        guard let request = requests.removeValue(forKey: id) else { return }
        request.deadline?.cancel(); request.deadline = nil
        request.response.removeAll(keepingCapacity: false); request.responseHeaders.removeAll()
        request.channel.close(promise: nil)
        event(.cancelled(instanceId: self.id, requestId: id))
    }
    func complete(_ id: String) {
        guard let request = requests.removeValue(forKey: id) else { return }
        request.deadline?.cancel(); request.deadline = nil
        request.response.removeAll(keepingCapacity: false); request.responseHeaders.removeAll()
        request.channel.close(promise: nil)
    }
    func stop() {
        loop.preconditionInEventLoop()
        guard !stopped else { return }
        stopped = true
        for id in Array(requests.keys) { cancel(id) }
        tls = nil
        event(.stopped(instanceId: id))
    }
    func finish(_ id: String) throws -> EventLoopFuture<Void> {
        let request = try self.request(id)
        guard let status = request.status, !request.flushing,
              !(status == 204 || status == 205 || status == 304) || request.response.isEmpty else { throw McpTransportError.invalid }
        request.flushing = true
        var headers = HTTPHeaders()
        for (name, value) in request.responseHeaders { headers.add(name: name, value: value) }
        headers.add(name: "content-length", value: String(request.response.count))
        headers.add(name: "connection", value: "close")
        let head = HTTPResponseHead(version: .http1_1, status: HTTPResponseStatus(statusCode: status), headers: headers)
        var bytes = request.channel.allocator.buffer(capacity: request.response.count)
        bytes.writeBytes(request.response)
        let written = request.channel.eventLoop.makePromise(of: Void.self)
        request.channel.write(HTTPServerResponsePart.head(head), promise: nil)
        if bytes.readableBytes > 0 { request.channel.write(HTTPServerResponsePart.body(.byteBuffer(bytes)), promise: nil) }
        request.channel.writeAndFlush(HTTPServerResponsePart.end(nil), promise: written)
        written.futureResult.whenComplete { [weak self] result in
            switch result { case .success: self?.complete(id); case .failure: self?.cancel(id) }
        }
        return written.futureResult
    }
}

private final class RequestHandler: ChannelInboundHandler {
    typealias InboundIn = HTTPServerRequestPart
    private weak var session: TransportSession?
    private let request: PendingRequest
    private var head: HTTPRequestHead?
    private var checked: (host: String, headers: [String: String], length: Int?)?
    private var body = Data()
    private var ended = false
    init(session: TransportSession, request: PendingRequest) { self.session = session; self.request = request }
    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        guard let session else { context.close(promise: nil); return }
        do {
            _ = try session.request(request.id)
            switch unwrapInboundIn(data) {
            case .head(let head):
                guard self.head == nil, !ended else { throw McpTransportError.invalid }
                checked = try HTTPPolicy.request(head); self.head = head
            case .body(var bytes):
                guard head != nil, !ended, body.count + bytes.readableBytes <= HTTPPolicy.requestLimit else { throw McpTransportError.limit }
                body.append(contentsOf: bytes.readBytes(length: bytes.readableBytes) ?? [])
            case .end(let trailers):
                guard !ended, let head, let checked, trailers == nil || trailers!.isEmpty,
                      checked.length == nil || checked.length == body.count,
                      let text = String(data: body, encoding: .utf8) else { throw McpTransportError.invalid }
                ended = true; request.emitted = true
                session.event(.request(McpRequest(instanceId: session.id, requestId: request.id, method: "POST", path: head.uri, host: checked.host, body: text, headers: checked.headers)))
                body.removeAll(keepingCapacity: false)
            }
        } catch { body.removeAll(keepingCapacity: false); session.cancel(request.id) }
    }
    func errorCaught(context: ChannelHandlerContext, error: Error) { session?.cancel(request.id); context.close(promise: nil) }
}
