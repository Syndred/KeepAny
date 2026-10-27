import XCTest
import Foundation
import NIOCore
import NIOPosix
import NIOHTTP1
import NIOSSL
import X509
import Crypto
@testable import KeepAnyMcpTransportCore

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
}
private enum ProbeFailure: Error { case noRequest, timeout }

private final class ResponseBytes: ChannelInboundHandler {
    typealias InboundIn = ByteBuffer
    let promise: EventLoopPromise<Data>
    private var bytes = Data(), done = false
    private let lock = NSLock()
    private var observed = 0
    var observedBytes: Int { lock.lock(); defer { lock.unlock() }; return observed }
    init(_ promise: EventLoopPromise<Data>) { self.promise = promise }
    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        var buffer = unwrapInboundIn(data)
        let part = buffer.readBytes(length: buffer.readableBytes) ?? []
        bytes.append(contentsOf: part)
        lock.lock(); observed += part.count; lock.unlock()
    }
    func fail(_ error: Error) { if !done { done = true; promise.fail(error) } }
    func errorCaught(context: ChannelHandlerContext, error: Error) {
        fail(error)
        context.close(promise: nil)
    }
    func channelInactive(context: ChannelHandlerContext) {
        if !done { done = true; promise.succeed(bytes) }
        context.fireChannelInactive()
    }
}
final class TLSProbe {
    let group = MultiThreadedEventLoopGroup(numberOfThreads: 1)
    let channel: Channel
    let result: EventLoopFuture<Data>
    private let received: ResponseBytes
    var observedBytes: Int { received.observedBytes }
    init(_ endpoint: McpEndpoint, trusted: Bool = true, hostname: String = "127.0.0.1", timeout: Int64 = 5, maximumTLSVersion: TLSVersion? = nil) throws {
        let loop = group.next(), reply = loop.makePromise(of: Data.self)
        result = reply.futureResult
        received = ResponseBytes(reply)
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
                    return channel.pipeline.addHandlers(try NIOSSLClientHandler(context: tls, serverHostname: hostname), sink)
                } catch { return channel.eventLoop.makeFailedFuture(error) }
            }.connect(host: "127.0.0.1", port: URL(string: endpoint.endpoint)!.port!).wait()
            let connected = channel
            let deadline = loop.scheduleTask(in: .seconds(timeout)) { sink.fail(ProbeFailure.timeout); connected.close(promise: nil) }
            result.whenComplete { _ in deadline.cancel() }
        } catch { try? group.syncShutdownGracefully(); throw error }
    }
    func send(_ data: Data) throws {
        var bytes = channel.allocator.buffer(capacity: data.count); bytes.writeBytes(data)
        try channel.writeAndFlush(bytes).wait()
    }
    func send(_ text: String) throws { try send(Data(text.utf8)) }
    func reply() throws -> Data { try result.wait() }
    func assertNoBytes(file: StaticString = #filePath, line: UInt = #line) {
        do { XCTAssertTrue(try reply().isEmpty, file: file, line: line) }
        catch { XCTAssertFalse(error is ProbeFailure, "Must close, not hang", file: file, line: line) }
        XCTAssertEqual(observedBytes, 0, file: file, line: line)
    }
    deinit { try? channel.close().wait(); try? group.syncShutdownGracefully() }
}

final class TransportTests: XCTestCase {
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
        XCTAssertThrowsError(try server.stop(instanceId: endpoint.instanceId))
        let nextClient = try TLSProbe(next); try nextClient.send(raw(next, path: "/pair"))
        let nextRequest = try events.request(); try respond(server, nextRequest)
        XCTAssertFalse(try nextClient.reply().isEmpty)
        try server.reset()
        XCTAssertTrue(events.stopped(next.instanceId))
        XCTAssertThrowsError(try server.responseStart(instanceId: next.instanceId, requestId: nextRequest.requestId, status: 200, headers: [:]))
    }
    func testUntrustedAndWrongHostnameAreTLSFailures() throws {
        let server = McpTransport { _ in }; defer { try? server.reset() }
        let endpoint = try server.start(address: "127.0.0.1")
        for options in [(false, "127.0.0.1"), (true, "wrong.keepany.test")] {
            let client = try TLSProbe(endpoint, trusted: options.0, hostname: options.1)
            do {
                try? client.send(raw(endpoint)); _ = try client.reply()
                XCTFail("Invalid trust or hostname unexpectedly passed")
            } catch {
                XCTAssertTrue(error is NIOSSLError || error is NIOSSLExtraError, "Must be TLS failure, not DNS/timeout: \(type(of: error))")
            }
        }
        let legacy = try TLSProbe(endpoint, maximumTLSVersion: .tlsv11)
        try? legacy.send(raw(endpoint))
        XCTAssertThrowsError(try legacy.reply()) { error in
            XCTAssertTrue(error is NIOSSLError || error is NIOSSLExtraError, "Legacy TLS must fail at TLS, not a generic timeout")
        }
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
        catch { XCTAssertFalse(error is ProbeFailure) }
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
