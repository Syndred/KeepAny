import XCTest
import Foundation
import NIOCore
import NIOPosix
import NIOHTTP1
import NIOSSL
@testable import KeepAnyMcpTransportCore

private final class WrongIpObservations {
    private let lock = NSLock()
    private var connections = 0, requests = 0
    func connected() { lock.lock(); connections += 1; lock.unlock() }
    func requested() { lock.lock(); requests += 1; lock.unlock() }
    var counts: (connections: Int, requests: Int) {
        lock.lock(); defer { lock.unlock() }; return (connections, requests)
    }
}

/// A healthy HTTP endpoint behind the deliberately wrong SAN: an accepted
/// handshake must produce an observable request and a response, not a reset.
private final class WrongIpHTTP: ChannelInboundHandler {
    typealias InboundIn = HTTPServerRequestPart
    typealias OutboundOut = HTTPServerResponsePart
    let observations: WrongIpObservations
    init(_ observations: WrongIpObservations) { self.observations = observations }
    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        switch unwrapInboundIn(data) {
        case .head: observations.requested()
        case .body: break
        case .end:
            let body = "{\"ok\":true}"
            let head = HTTPResponseHead(version: .http1_1, status: .ok,
                headers: HTTPHeaders([("content-type", "application/json"), ("content-length", String(body.utf8.count))]))
            context.write(wrapOutboundOut(.head(head)), promise: nil)
            var buffer = context.channel.allocator.buffer(capacity: body.utf8.count)
            buffer.writeString(body)
            context.write(wrapOutboundOut(.body(.byteBuffer(buffer))), promise: nil)
            context.writeAndFlush(wrapOutboundOut(.end(nil)), promise: nil)
        }
    }
    func errorCaught(context: ChannelHandlerContext, error: Error) { context.close(promise: nil) }
}

/// The production desktop client validates a live Swift-generated identity.
/// This runs independently of the BoringSSL TLSProbe's explicit-leaf policy.
final class NodeInteropTests: XCTestCase {
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

    func testProductionNodeClientStrictTLSWithSwiftIdentity() throws {
        guard let probePath = ProcessInfo.processInfo.environment["KEEPANY_NODE_MCP_PROBE_FILE"], probePath.hasPrefix("/") else {
            throw XCTSkip("The Node interoperability probe must be explicitly configured")
        }
        let events = Events()
        let server = McpTransport { events.append($0) }
        defer { try? server.reset() }
        let endpoint = try server.start(address: "127.0.0.1")
        let unrelated = try EphemeralIdentity(address: "127.0.0.1")
        let wrongIdentity = try EphemeralIdentity(address: "127.0.0.2")
        let wrongIp = WrongIpObservations()
        let group = MultiThreadedEventLoopGroup(numberOfThreads: 1)
        defer { try? group.syncShutdownGracefully() }
        let wrongServer = try ServerBootstrap(group: group).childChannelInitializer { channel in
            wrongIp.connected()
            do {
                try channel.pipeline.syncOperations.addHandler(NIOSSLServerHandler(context: wrongIdentity.context))
                try channel.pipeline.syncOperations.configureHTTPServerPipeline()
                try channel.pipeline.syncOperations.addHandler(WrongIpHTTP(wrongIp))
                return channel.eventLoop.makeSucceededFuture(())
            } catch { return channel.eventLoop.makeFailedFuture(error) }
        }.bind(host: "127.0.0.1", port: 0).wait()
        defer { try? wrongServer.close().wait() }
        let wrongEndpoint = McpEndpoint(instanceId: UUID().uuidString,
            endpoint: "https://127.0.0.1:\(wrongServer.localAddress!.port!)/mcp",
            certificatePem: wrongIdentity.certificatePem, spkiSha256: wrongIdentity.spkiSha256)
        func options(_ value: McpEndpoint) -> [String: String] {
            ["endpoint": value.endpoint, "certificatePem": value.certificatePem, "spkiSha256": value.spkiSha256]
        }
        let input: [String: Any] = ["trusted": options(endpoint), "unrelatedCertificatePem": unrelated.certificatePem,
                                    "wrongIp": options(wrongEndpoint)]
        // Resolve the already installed tsx loader from this repository, not a
        // downloaded executable or a global package at test execution time.
        let process = try NodeProbeProcess(executableURL: URL(fileURLWithPath: "/usr/bin/env"),
            arguments: ["node", "--import", "tsx", probePath],
            workingDirectory: URL(fileURLWithPath: probePath).deletingLastPathComponent().deletingLastPathComponent())
        defer { process.stop() }
        try process.writeInput(JSONSerialization.data(withJSONObject: input))
        let request = try events.request(timeout: 10)
        XCTAssertEqual(request.method, "POST"); XCTAssertEqual(request.path, "/mcp"); XCTAssertEqual(request.body, "{}")
        try server.responseStart(instanceId: request.instanceId, requestId: request.requestId, status: 200,
                                 headers: ["content-type": "application/json"])
        try server.responseWrite(instanceId: request.instanceId, requestId: request.requestId,
                                 chunkBase64: Data("{\"ok\":true}".utf8).base64EncodedString())
        try server.responseEnd(instanceId: request.instanceId, requestId: request.requestId)
        let result = try process.finish()
        XCTAssertEqual(result.status, 0, "The strict production Node probe must finish successfully")
        XCTAssertTrue(result.stderr.isEmpty, "The probe must not emit an error or a loader warning")
        let actual = try XCTUnwrap(JSONSerialization.jsonObject(with: result.stdout) as? [String: String])
        XCTAssertEqual(actual, ["trusted": "response-verified", "untrusted": "mobile-mcp-network",
                                "wrongPin": "mobile-mcp-network", "wrongIp": "mobile-mcp-network",
                                "wrongIpSan": "ERR_TLS_CERT_ALTNAME_INVALID"])
        XCTAssertGreaterThanOrEqual(wrongIp.counts.connections, 2, "Both wrong-IP probes must reach the actual TLS server")
        XCTAssertEqual(wrongIp.counts.requests, 0, "Wrong IP SAN must be rejected before HTTP")
        XCTAssertThrowsError(try events.request(timeout: 0.1), "Rejected TLS probes must not reach the bridge")
    }
}
