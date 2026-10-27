import XCTest
import Foundation
import NIOCore
import NIOPosix
import NIOHTTP1
import NIOSSL
import NIOTLS
import X509
import Crypto
@testable import KeepAnyMcpTransportCore

func mcpCoreCaseStage(_ phase: String, name: String) {
    // Write directly to stderr, independently of XCTest's suite/case stdout.
    // Only runner metadata is emitted; no fixture body, certificate or key.
    let line = "KeepAny Core case \(phase) pid=\(ProcessInfo.processInfo.processIdentifier) uptime=\(ProcessInfo.processInfo.systemUptime) name=\(name)\n"
    FileHandle.standardError.write(Data(line.utf8))
}

final class Events {
    private let condition = NSCondition()
    private var rows: [McpTransportEvent] = []
    func append(_ row: McpTransportEvent) { condition.lock(); rows.append(row); condition.broadcast(); condition.unlock() }
    func request(timeout: TimeInterval = 5) throws -> McpRequest {
        let end = Date().addingTimeInterval(timeout)
        condition.lock(); defer { condition.unlock() }
        while true {
            if let index = rows.firstIndex(where: { if case .request = $0 { return true }; return false }),
               case .request(let request) = rows.remove(at: index) { return request }
            if !condition.wait(until: end) { throw ProbeFailure.noRequest }
        }
    }
    func cancelled(_ id: String, timeout: TimeInterval = 5) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        condition.lock(); defer { condition.unlock() }
        while !rows.contains(where: { if case .cancelled(_, let request) = $0 { return request == id }; return false }) {
            if !condition.wait(until: end) { return false }
        }
        return true
    }
    func stopped(_ id: String, timeout: TimeInterval = 5) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        condition.lock(); defer { condition.unlock() }
        while !rows.contains(where: { if case .stopped(let instance) = $0 { return instance == id }; return false }) {
            if !condition.wait(until: end) { return false }
        }
        return true
    }
    func stoppedCount(_ id: String) -> Int {
        condition.lock(); defer { condition.unlock() }
        return rows.filter { if case .stopped(let instance) = $0 { return instance == id }; return false }.count
    }
}
private enum ProbeFailure: Error, Equatable { case noRequest, timeout, closed }

private final class ResponseBytes: ChannelInboundHandler {
    typealias InboundIn = ByteBuffer
    let promise: EventLoopPromise<Data>
    let handshake: EventLoopPromise<Void>
    private var bytes = Data(), done = false
    private var handshakeDone = false
    private var firstFailure: Error?
    private var progress = ["allocated"]
    private let lock = NSLock()
    private var observed = 0
    var observedBytes: Int { lock.lock(); defer { lock.unlock() }; return observed }
    init(_ promise: EventLoopPromise<Data>) {
        self.promise = promise
        handshake = promise.futureResult.eventLoop.makePromise(of: Void.self)
    }
    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        var buffer = unwrapInboundIn(data)
        let part = buffer.readBytes(length: buffer.readableBytes) ?? []
        bytes.append(contentsOf: part)
        lock.lock(); observed += part.count; lock.unlock()
    }
    func fail(_ error: Error) {
        promise.futureResult.eventLoop.preconditionInEventLoop()
        if firstFailure == nil { firstFailure = error }
        if !handshakeDone { handshakeDone = true; handshake.fail(error) }
        if !done { done = true; promise.fail(error) }
    }
    func originalFailure(or error: Error) -> Error {
        promise.futureResult.eventLoop.preconditionInEventLoop()
        return firstFailure ?? error
    }
    func mark(_ phase: String) { promise.futureResult.eventLoop.preconditionInEventLoop(); progress.append(phase) }
    func diagnostic() -> String { promise.futureResult.eventLoop.preconditionInEventLoop(); return progress.joined(separator: ">") }
    func channelRegistered(context: ChannelHandlerContext) { mark("registered"); context.fireChannelRegistered() }
    func channelActive(context: ChannelHandlerContext) { mark("tcp-active"); context.fireChannelActive() }
    func userInboundEventTriggered(context: ChannelHandlerContext, event: Any) {
        if let tls = event as? TLSUserEvent, case .handshakeCompleted = tls, !handshakeDone {
            handshakeDone = true
            mark("tls-authenticated")
            handshake.succeed(())
        }
        context.fireUserInboundEventTriggered(event)
    }
    func errorCaught(context: ChannelHandlerContext, error: Error) {
        mark("pipeline-error")
        fail(error)
        context.close(promise: nil)
    }
    func channelInactive(context: ChannelHandlerContext) {
        mark("inactive")
        if !handshakeDone { fail(ProbeFailure.closed) }
        else if !done { done = true; promise.succeed(bytes) }
        context.fireChannelInactive()
    }
}

/// Owned independently of TLSProbe's initialization state: an initializer can
/// fail before channel is initialized, or after all stored properties exist.
/// Both paths and deinit share this one cleanup, never a second post-shutdown
/// close/submit on an EventLoop which can no longer complete that promise.
private final class ProbeCleanup {
    private let group: MultiThreadedEventLoopGroup
    private let loop: EventLoop
    private let sink: ResponseBytes
    private let lock = NSLock()
    private var started = false
    private var connected: Channel?
    private let id = String(UUID().uuidString.prefix(8))

    init(group: MultiThreadedEventLoopGroup, loop: EventLoop, sink: ResponseBytes) {
        self.group = group; self.loop = loop; self.sink = sink
    }
    func stage(_ phase: String) {
        // stderr is written immediately, including during an eventual CI
        // timeout. No endpoint, certificate, payload or temporary key is logged.
        FileHandle.standardError.write(Data("KeepAny TLS probe [\(id)] \(phase)\n".utf8))
    }
    func attach(_ channel: Channel) { connected = channel; stage("tcp-connected") }
    func run(origin: String) {
        lock.lock()
        let shouldClean = !started
        started = true
        lock.unlock()
        guard shouldClean else { stage("\(origin).cleanup-already-started"); return }
        stage("\(origin).cleanup-begin")
        stage("settle-before")
        do { try loop.submit { self.sink.fail(ProbeFailure.closed) }.wait(); stage("settle-after") }
        catch { stage("settle-failed-\(type(of: error))"); XCTFail("Probe promise settlement failed during cleanup") }
        if let channel = connected {
            stage("close-before")
            do { try channel.close().wait(); stage("close-after") }
            catch { stage("close-failed-\(type(of: error))") }
        }
        stage("shutdown-before")
        do { try group.syncShutdownGracefully(); stage("shutdown-after") }
        catch { stage("shutdown-failed-\(type(of: error))"); XCTFail("Probe EventLoopGroup shutdown failed") }
        connected = nil
        stage("\(origin).cleanup-end")
    }
}

final class TLSProbe {
    let group = MultiThreadedEventLoopGroup(numberOfThreads: 1)
    let channel: Channel
    let result: EventLoopFuture<Data>
    private let received: ResponseBytes
    private let cleanup: ProbeCleanup
    var observedBytes: Int { received.observedBytes }
    init(_ endpoint: McpEndpoint, trusted: Bool = true, hostname: String? = nil, timeout: Int64 = 5, maximumTLSVersion: TLSVersion? = nil) throws {
        let loop = group.next(), reply = loop.makePromise(of: Data.self)
        result = reply.futureResult
        received = ResponseBytes(reply)
        // A local owner remains usable in catch even when self.channel has not
        // been initialized. Do not call an instance helper on partial self.
        let resources = ProbeCleanup(group: group, loop: loop, sink: received)
        cleanup = resources
        resources.stage("init-begin")
        do {
            var config = TLSConfiguration.makeClientConfiguration()
            config.minimumTLSVersion = maximumTLSVersion == .tlsv11 ? .tlsv1 : .tlsv12
            config.maximumTLSVersion = maximumTLSVersion
            // Actual chain + hostname verification, never a custom accept-all
            // callback. A single session certificate is trusted for this probe.
            config.certificateVerification = .fullVerification
            if trusted { config.trustRoots = .certificates([try NIOSSLCertificate(bytes: Array(endpoint.certificatePem.utf8), format: .pem)]) }
            let tls = try NIOSSLContext(configuration: config)
            let sink = received
            channel = try ClientBootstrap(group: group).connectTimeout(.seconds(3)).channelInitializer { channel in
                do {
                    // NIOSSL rejects IP literals in SNI. With nil SNI, its
                    // fullVerification still checks the actual peer IP SAN.
                    let pipeline = channel.pipeline.syncOperations
                    sink.mark("initializing")
                    try pipeline.addHandler(NIOSSLClientHandler(context: tls, serverHostname: hostname))
                    try pipeline.addHandler(sink)
                    sink.mark("pipeline-installed")
                    return channel.eventLoop.makeSucceededFuture(())
                } catch {
                    sink.fail(error)
                    return channel.eventLoop.makeFailedFuture(error)
                }
            // This fixture has one exact IP, not DNS/IPv4-v6 racing candidates.
            // A stateful response sink must belong to this single channel.
            }.connect(to: SocketAddress(ipAddress: "127.0.0.1", port: URL(string: endpoint.endpoint)!.port!)).wait()
            resources.attach(channel)
            let connected = channel
            let deadline = loop.scheduleTask(in: .seconds(timeout)) { sink.fail(ProbeFailure.timeout); connected.close(promise: nil) }
            result.whenComplete { _ in deadline.cancel() }
            // TCP connect is not an authenticated TLS connection. Surface the
            // original handshake error before a later write says AlreadyClosed.
            resources.stage("handshake-wait-before")
            try sink.handshake.futureResult.wait()
            resources.stage("handshake-wait-after")
        } catch {
            // Configuration or handler construction can fail before the sink
            // is installed, so channelInactive cannot own completion there.
            // Settle on its event loop before destroying the group/promise.
            resources.stage("init.catch-before-diagnostic")
            let sink = received
            let cause = (try? loop.submit { sink.fail(error); return sink.originalFailure(or: error) }.wait()) ?? error
            let phases = (try? loop.submit { sink.diagnostic() }.wait()) ?? "loop-unavailable"
            // Test fixtures contain no user data, tokens or request bodies.
            // Preserve the first typed TLS/initializer cause, not a secondary
            // close error, and leave useful phase evidence for Apple CI.
            print("KeepAny TLS probe failed [\(phases)] \(type(of: cause)): \(cause)")
            resources.stage("init.catch-before-cleanup")
            resources.run(origin: "init.catch")
            resources.stage("init.catch-after-cleanup")
            throw cause
        }
    }
    func send(_ data: Data) throws {
        var bytes = channel.allocator.buffer(capacity: data.count); bytes.writeBytes(data)
        cleanup.stage("write-before")
        do { try channel.writeAndFlush(bytes).wait(); cleanup.stage("write-after") }
        catch {
            cleanup.stage("write-failed-before-diagnostic")
            let sink = received
            let cause = try channel.eventLoop.submit { sink.originalFailure(or: error) }.wait()
            let phases = try channel.eventLoop.submit { sink.diagnostic() }.wait()
            print("KeepAny TLS probe write failed [\(phases)] \(type(of: cause)): \(cause)")
            throw cause
        }
    }
    func send(_ text: String) throws { try send(Data(text.utf8)) }
    func reply() throws -> Data {
        cleanup.stage("reply-before")
        do { let bytes = try result.wait(); cleanup.stage("reply-after"); return bytes }
        catch { cleanup.stage("reply-failed-\(type(of: error))"); throw error }
    }
    func assertNoBytes(file: StaticString = #filePath, line: UInt = #line) {
        do {
            // Evaluate outside XCTest's throwing autoclosure: otherwise XCTest
            // consumes the error and makes the surrounding catch unreachable.
            let bytes = try reply()
            XCTAssertTrue(bytes.isEmpty, file: file, line: line)
        }
        catch { XCTAssertFalse(error is ProbeFailure, "Must close, not hang", file: file, line: line) }
        XCTAssertEqual(observedBytes, 0, file: file, line: line)
    }
    deinit {
        cleanup.stage("deinit-enter")
        cleanup.run(origin: "deinit")
        cleanup.stage("deinit-exit")
    }
}

final class TransportTests: XCTestCase {
    override class func setUp() {
        mcpCoreCaseStage("class-setup-before", name: "TransportTests")
        super.setUp()
        mcpCoreCaseStage("class-setup-after", name: "TransportTests")
    }
    override func setUpWithError() throws {
        mcpCoreCaseStage("case-start", name: name)
        try super.setUpWithError()
        mcpCoreCaseStage("case-setup-complete", name: name)
    }
    override func tearDownWithError() throws {
        mcpCoreCaseStage("case-teardown-before", name: name)
        defer { mcpCoreCaseStage("case-teardown-after", name: name) }
        try super.tearDownWithError()
    }
    private func raw(_ endpoint: McpEndpoint, path: String = "/mcp", body: String = "{}", extra: String = "") -> String {
        "POST \(path) HTTP/1.1\r\nHost: 127.0.0.1:\(URL(string: endpoint.endpoint)!.port!)\r\nContent-Type: application/json\r\nContent-Length: \(body.utf8.count)\r\n\(extra)\r\n\(body)"
    }
    private func respond(_ server: McpTransport, _ request: McpRequest, text: String = "{\"ok\":true}") throws {
        try server.responseStart(instanceId: request.instanceId, requestId: request.requestId, status: 200, headers: ["content-type": "application/json"])
        try server.responseWrite(instanceId: request.instanceId, requestId: request.requestId, chunkBase64: Data(text.utf8).base64EncodedString())
        try server.responseEnd(instanceId: request.instanceId, requestId: request.requestId)
    }
    func testAddressPolicyAndEphemeralIdentity() throws {
        for address in ["0.0.0.0", "127.0.0.2", "127.000.0.1", "::1", "localhost", "8.8.8.8", "169.254.1.2", "172.32.0.1", "10.2.3.256"] {
            XCTAssertFalse(AddressPolicy.allowed(address), address)
        }
        try AddressPolicy.requireLocal("127.0.0.1")
        let first = try EphemeralIdentity(address: "127.0.0.1"), second = try EphemeralIdentity(address: "127.0.0.1")
        XCTAssertNotEqual(first.spkiSha256, second.spkiSha256)
        XCTAssertEqual(first.spkiSha256.count, 64)
        XCTAssertEqual(first.certificatePem.components(separatedBy: "BEGIN CERTIFICATE").count, 2)
        let cert = try Certificate(pemEncoded: first.certificatePem)
        let key = try P256.Signing.PublicKey(derRepresentation: Data(try cert.publicKey.serializeAsPEM().derBytes))
        XCTAssertEqual(SHA256.hash(data: key.derRepresentation).map { String(format: "%02x", $0) }.joined(), first.spkiSha256)
        XCTAssertTrue(String(describing: try cert.extensions.subjectAlternativeNames).contains("IPAddress([127, 0, 0, 1])"))
    }
    func testRealStrictTLSAndAtomicResponseAndRestart() throws {
        let events = Events(), server = McpTransport { events.append($0) }
        defer { try? server.reset() }
        let endpoint = try server.start(address: "127.0.0.1")
        XCTAssertThrowsError(try server.start(address: "127.0.0.1"))
        let client = try TLSProbe(endpoint, maximumTLSVersion: .tlsv12)
        try client.send(raw(endpoint, extra: "Cookie: synthetic=value\r\nOrigin: https://example.test\r\n"))
        let request = try events.request()
        XCTAssertEqual(request.host, "127.0.0.1:\(URL(string: endpoint.endpoint)!.port!)")
        XCTAssertEqual(request.headers["cookie"], "synthetic=value")
        XCTAssertEqual(request.headers["origin"], "https://example.test")
        XCTAssertEqual(request.method, "POST"); XCTAssertEqual(request.body, "{}")
        XCTAssertEqual(request.path, "/mcp")
        try server.responseStart(instanceId: request.instanceId, requestId: request.requestId, status: 200, headers: ["content-type": "application/json"])
        try server.responseWrite(instanceId: request.instanceId, requestId: request.requestId, chunkBase64: Data("done".utf8).base64EncodedString())
        Thread.sleep(forTimeInterval: 0.1)
        XCTAssertEqual(client.observedBytes, 0, "No response bytes before End")
        try server.responseEnd(instanceId: request.instanceId, requestId: request.requestId)
        let reply = String(decoding: try client.reply(), as: UTF8.self)
        XCTAssertTrue(reply.hasPrefix("HTTP/1.1 200")); XCTAssertTrue(reply.hasSuffix("\r\n\r\ndone"))
        try server.stop(instanceId: endpoint.instanceId)
        XCTAssertTrue(events.stopped(endpoint.instanceId))
        let next = try server.start(address: "127.0.0.1")
        XCTAssertNotEqual(endpoint.instanceId, next.instanceId); XCTAssertNotEqual(endpoint.spkiSha256, next.spkiSha256)
        XCTAssertNoThrow(try server.stop(instanceId: endpoint.instanceId), "Known stopped ID can be acknowledged again without stopping the new session")
        XCTAssertThrowsError(try server.stop(instanceId: UUID().uuidString))
        let nextClient = try TLSProbe(next); try nextClient.send(raw(next, path: "/pair"))
        let nextRequest = try events.request(); try respond(server, nextRequest)
        XCTAssertFalse(try nextClient.reply().isEmpty)
        try server.reset()
        XCTAssertTrue(events.stopped(next.instanceId))
        XCTAssertThrowsError(try server.responseStart(instanceId: next.instanceId, requestId: nextRequest.requestId, status: 200, headers: [:]))
    }
    func testUntrustedAndWrongIPIdentityAreTLSFailures() throws {
        let server = McpTransport { _ in }; defer { try? server.reset() }
        let endpoint = try server.start(address: "127.0.0.1")
        XCTAssertThrowsError(try TLSProbe(endpoint, trusted: false)) { error in
            XCTAssertTrue(error is NIOSSLError || error is NIOSSLExtraError, "Must be TLS failure, not DNS/timeout: \(type(of: error))")
        }
        // The transport only publishes IP endpoints. NIOSSL checks remote IP
        // SAN even when a DNS SNI was provided, so a made-up DNS name would not
        // actually prove IP identity rejection. Serve a trusted certificate for
        // a different IP on 127.0.0.1 instead; retain fullVerification.
        let wrongIdentity = try EphemeralIdentity(address: "127.0.0.2")
        let group = MultiThreadedEventLoopGroup(numberOfThreads: 1)
        defer { try? group.syncShutdownGracefully() }
        let wrongServer = try ServerBootstrap(group: group).childChannelInitializer { channel in
            do {
                try channel.pipeline.syncOperations.addHandler(NIOSSLServerHandler(context: wrongIdentity.context))
                return channel.eventLoop.makeSucceededFuture(())
            } catch { return channel.eventLoop.makeFailedFuture(error) }
        }.bind(host: "127.0.0.1", port: 0).wait()
        defer { try? wrongServer.close().wait() }
        let wrongEndpoint = McpEndpoint(instanceId: UUID().uuidString, endpoint: "https://127.0.0.1:\(wrongServer.localAddress!.port!)/mcp", certificatePem: wrongIdentity.certificatePem, spkiSha256: wrongIdentity.spkiSha256)
        XCTAssertThrowsError(try TLSProbe(wrongEndpoint)) { error in
            XCTAssertEqual(error as? NIOSSLExtraError, .failedToValidateHostname, "Trusted chain must fail the actual IP SAN check")
        }
        XCTAssertThrowsError(try TLSProbe(endpoint, maximumTLSVersion: .tlsv11)) { error in
            XCTAssertTrue(error is NIOSSLError || error is NIOSSLExtraError, "Legacy TLS must fail at TLS, not a generic timeout")
        }
    }
    func testInitializerFailuresCompletePromiseBeforeShutdownAndNextProbeConnects() throws {
        let events = Events(), server = McpTransport { events.append($0) }; defer { try? server.reset() }
        let endpoint = try server.start(address: "127.0.0.1")
        // Reproduce the initializer branch which previously leaked line74's
        // promise and trapped before the intended SNI error could surface.
        XCTAssertThrowsError(try TLSProbe(endpoint, hostname: "127.0.0.1")) { error in
            XCTAssertEqual(error as? NIOSSLExtraError, .cannotUseIPAddressInSNI)
        }
        let invalidCertificate = McpEndpoint(instanceId: endpoint.instanceId, endpoint: endpoint.endpoint, certificatePem: "invalid PEM", spkiSha256: endpoint.spkiSha256)
        XCTAssertThrowsError(try TLSProbe(invalidCertificate))
        // A genuine verification failure occurs after TCP/channel assignment,
        // unlike the invalid SNI/PEM branches above. It must clean up exactly
        // once even if failed initialization also invokes deinit, then allow
        // the following fully verified probe to succeed.
        XCTAssertThrowsError(try TLSProbe(endpoint, trusted: false)) { error in
            XCTAssertTrue(error is NIOSSLError || error is NIOSSLExtraError, "Late initializer failure must retain its TLS type")
        }
        let client = try TLSProbe(endpoint)
        try client.send(raw(endpoint)); try respond(server, events.request())
        XCTAssertFalse(try client.reply().isEmpty)
    }
    func testMalformedAndDuplicateHTTPNeverReachBridge() throws {
        let events = Events(), server = McpTransport { events.append($0) }; defer { try? server.reset() }
        let endpoint = try server.start(address: "127.0.0.1")
        let port = URL(string: endpoint.endpoint)!.port!
        let invalid = [
            raw(endpoint, path: "https://127.0.0.1:\(port)/mcp"),
            raw(endpoint, extra: "Host: 127.0.0.1:\(port)\r\n"),
            raw(endpoint, extra: "Authorization: a\r\nAuthorization: b\r\n"),
            raw(endpoint, extra: "Content-Type: application/json\r\n"),
            raw(endpoint, extra: "Origin: a\r\nOrigin: b\r\n"),
            raw(endpoint, extra: "Content-Length: 2\r\n"),
            raw(endpoint, extra: "Transfer-Encoding: chunked\r\n"),
            "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:\(port)\r\nTransfer-Encoding: chunked\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n",
            raw(endpoint, extra: "X-Size: \(String(repeating: "a", count: 16385))\r\n"),
            raw(endpoint, extra: (0..<65).map { "X-\($0): a\r\n" }.joined()),
        ]
        for text in invalid {
            let client = try TLSProbe(endpoint); try? client.send(text)
            client.assertNoBytes()
        }
        let malformed = try TLSProbe(endpoint)
        var bytes = Data("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:\(port)\r\nContent-Length: 1\r\n\r\n".utf8); bytes.append(0xff)
        try malformed.send(bytes); malformed.assertNoBytes()
        XCTAssertThrowsError(try events.request(timeout: 0.2))
    }
    func testCancellationDiscardsAllChunksAndReleasesSlot() throws {
        let events = Events(), server = McpTransport { events.append($0) }; defer { try? server.reset() }
        let endpoint = try server.start(address: "127.0.0.1")
        let client = try TLSProbe(endpoint); try client.send(raw(endpoint))
        let request = try events.request()
        try server.responseStart(instanceId: request.instanceId, requestId: request.requestId, status: 200, headers: [:])
        try server.responseWrite(instanceId: request.instanceId, requestId: request.requestId, chunkBase64: Data("must never be sent".utf8).base64EncodedString())
        try server.cancel(instanceId: request.instanceId, requestId: request.requestId)
        client.assertNoBytes(); XCTAssertTrue(events.cancelled(request.requestId))
        XCTAssertThrowsError(try server.responseEnd(instanceId: request.instanceId, requestId: request.requestId))
        let nextClient = try TLSProbe(endpoint); try nextClient.send(raw(endpoint))
        try respond(server, events.request()); XCTAssertFalse(try nextClient.reply().isEmpty)
    }
    func testInvalidResponseAndBridgeBudgetDiscardBufferedBytes() throws {
        let events = Events(), server = McpTransport { events.append($0) }; defer { try? server.reset() }
        let endpoint = try server.start(address: "127.0.0.1")
        for headers in [["set-cookie": "x=y"], ["location": "https://example.test"], ["content-type": "text/plain\r\nx: y"]] {
            let client = try TLSProbe(endpoint); try client.send(raw(endpoint)); let request = try events.request()
            XCTAssertThrowsError(try server.responseStart(instanceId: request.instanceId, requestId: request.requestId, status: 200, headers: headers))
            client.assertNoBytes()
        }
        let redirect = try TLSProbe(endpoint); try redirect.send(raw(endpoint)); let redirectRequest = try events.request()
        XCTAssertThrowsError(try server.responseStart(instanceId: redirectRequest.instanceId, requestId: redirectRequest.requestId, status: 307, headers: [:]))
        redirect.assertNoBytes()
        for mode in ["chunk", "total", "base64"] {
            let client = try TLSProbe(endpoint); try client.send(raw(endpoint)); let request = try events.request()
            try server.responseStart(instanceId: request.instanceId, requestId: request.requestId, status: 200, headers: [:])
            let full = Data(repeating: 65, count: 256 * 1024).base64EncodedString()
            if mode == "total" { for _ in 0..<32 { try server.responseWrite(instanceId: request.instanceId, requestId: request.requestId, chunkBase64: full) } }
            let invalid = mode == "chunk" ? Data(repeating: 65, count: 256 * 1024 + 1).base64EncodedString() : mode == "total" ? "QQ==" : "%%%"
            XCTAssertThrowsError(try server.responseWrite(instanceId: request.instanceId, requestId: request.requestId, chunkBase64: invalid))
            client.assertNoBytes()
        }
    }
    func testExactBodyAndResponseBudgetsAndRequestOversize() throws {
        let events = Events(), server = McpTransport { events.append($0) }; defer { try? server.reset() }
        let endpoint = try server.start(address: "127.0.0.1")
        let client = try TLSProbe(endpoint, timeout: 15)
        try client.send(raw(endpoint, body: String(repeating: "x", count: 1_000_000)))
        let request = try events.request()
        XCTAssertEqual(request.body.utf8.count, 1_000_000)
        try server.responseStart(instanceId: request.instanceId, requestId: request.requestId, status: 200, headers: [:])
        let chunk = Data(repeating: 65, count: 256 * 1024).base64EncodedString()
        for _ in 0..<32 { try server.responseWrite(instanceId: request.instanceId, requestId: request.requestId, chunkBase64: chunk) }
        XCTAssertEqual(client.observedBytes, 0)
        try server.responseEnd(instanceId: request.instanceId, requestId: request.requestId)
        let reply = try client.reply()
        let boundary = try XCTUnwrap(reply.range(of: Data("\r\n\r\n".utf8)))
        XCTAssertEqual(reply.count - boundary.upperBound, 8 * 1024 * 1024)
        XCTAssertEqual(reply.suffix(64), Data(repeating: 65, count: 64))
        let oversized = try TLSProbe(endpoint)
        try? oversized.send(raw(endpoint, body: String(repeating: "x", count: 1_000_001)))
        oversized.assertNoBytes()
        XCTAssertThrowsError(try events.request(timeout: 0.2))
    }
    func testFourSlotsAndRealThirtySecondTotalDeadline() throws {
        let events = Events(), server = McpTransport { events.append($0) }; defer { try? server.reset() }
        let endpoint = try server.start(address: "127.0.0.1")
        var clients: [TLSProbe] = [], requests: [McpRequest] = []
        for _ in 0..<4 {
            let client = try TLSProbe(endpoint, timeout: 35); try client.send(raw(endpoint))
            clients.append(client); requests.append(try events.request())
        }
        do { let fifth = try TLSProbe(endpoint); try? fifth.send(raw(endpoint)); fifth.assertNoBytes() }
        catch { XCTAssertNotEqual(error as? ProbeFailure, .timeout, "Fifth admission must close rather than hang") }
        XCTAssertThrowsError(try events.request(timeout: 0.2))
        let start = Date()
        clients[0].assertNoBytes()
        XCTAssertGreaterThan(Date().timeIntervalSince(start), 25)
        XCTAssertTrue(events.cancelled(requests[0].requestId))
        let next = try TLSProbe(endpoint); try next.send(raw(endpoint))
        try respond(server, events.request()); XCTAssertFalse(try next.reply().isEmpty)
    }
    func testResetClosesBufferedSessionAndDoesNotReplay() throws {
        let events = Events(), server = McpTransport { events.append($0) }; defer { try? server.reset() }
        let endpoint = try server.start(address: "127.0.0.1")
        let client = try TLSProbe(endpoint); try client.send(raw(endpoint)); let request = try events.request()
        try server.responseStart(instanceId: request.instanceId, requestId: request.requestId, status: 200, headers: [:])
        try server.responseWrite(instanceId: request.instanceId, requestId: request.requestId, chunkBase64: "QQ==")
        try server.reset()
        client.assertNoBytes()
        XCTAssertTrue(events.cancelled(request.requestId)); XCTAssertTrue(events.stopped(endpoint.instanceId))
        XCTAssertThrowsError(try server.responseEnd(instanceId: request.instanceId, requestId: request.requestId))
        XCTAssertThrowsError(try TLSProbe(endpoint), "Reset must close the old actual listening port")
        let next = try server.start(address: "127.0.0.1")
        XCTAssertNotEqual(endpoint.spkiSha256, next.spkiSha256)
        let nextClient = try TLSProbe(next); try nextClient.send(raw(next)); let nextRequest = try events.request()
        XCTAssertNotEqual(nextRequest.requestId, request.requestId)
        try respond(server, nextRequest); XCTAssertFalse(try nextClient.reply().isEmpty)
        XCTAssertThrowsError(try events.request(timeout: 0.2), "No automatic replay after reset")
    }
}
