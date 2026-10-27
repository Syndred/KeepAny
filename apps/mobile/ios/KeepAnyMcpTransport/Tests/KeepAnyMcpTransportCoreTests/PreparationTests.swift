import XCTest
import Foundation
import NIOCore
import NIOPosix
@testable import KeepAnyMcpTransportCore

private final class TestClock {
    private let lock = NSLock()
    private var ticks: UInt64 = 1_000_000
    func now() -> UInt64 { lock.lock(); defer { lock.unlock() }; return ticks }
    func advance(seconds: UInt64) { lock.lock(); ticks += seconds * 1_000_000_000; lock.unlock() }
}
private final class WeakTransport {
    weak var value: McpTransport?
    init(_ value: McpTransport?) { self.value = value }
}
final class PreparationTests: XCTestCase {
    private func send(_ endpoint: McpEndpoint, events: Events, server: McpTransport) throws {
        let client = try TLSProbe(endpoint)
        try client.send("POST /pair HTTP/1.1\r\nHost: 127.0.0.1:\(URL(string: endpoint.endpoint)!.port!)\r\nContent-Length: 2\r\n\r\n{}")
        let request = try events.request()
        XCTAssertEqual(request.instanceId, endpoint.instanceId)
        try server.responseStart(instanceId: request.instanceId, requestId: request.requestId, status: 200, headers: [:])
        try server.responseWrite(instanceId: request.instanceId, requestId: request.requestId, chunkBase64: "e30=")
        try server.responseEnd(instanceId: request.instanceId, requestId: request.requestId)
        XCTAssertTrue(String(decoding: try client.reply(), as: UTF8.self).hasSuffix("\r\n\r\n{}"))
    }
    private func same(_ before: McpEndpoint, _ after: McpEndpoint, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(before.instanceId, after.instanceId, file: file, line: line)
        XCTAssertEqual(before.endpoint, after.endpoint, file: file, line: line)
        XCTAssertEqual(before.certificatePem, after.certificatePem, file: file, line: line)
        XCTAssertEqual(before.spkiSha256, after.spkiSha256, file: file, line: line)
    }
    func testPrepareDoesNotListenAndPausePreservesIdentityUntilExplicitActivate() throws {
        let events = Events(), server = McpTransport { events.append($0) }; defer { try? server.reset() }
        let prepared = try server.prepare(address: "127.0.0.1")
        XCTAssertThrowsError(try TLSProbe(prepared), "Prepare must not listen even before the system share UI")
        XCTAssertThrowsError(try server.prepare(address: "127.0.0.1"))
        XCTAssertThrowsError(try server.start(address: "127.0.0.1"))
        XCTAssertThrowsError(try server.activate(instanceId: UUID().uuidString))
        try server.pause()
        XCTAssertThrowsError(try TLSProbe(prepared), "Share/background never implicitly activates")
        let activated = try server.activate(instanceId: prepared.instanceId)
        same(prepared, activated)
        try send(activated, events: events, server: server)
        try server.pause()
        XCTAssertTrue(events.stopped(activated.instanceId))
        XCTAssertThrowsError(try TLSProbe(activated), "Active listener must stop on pause")
        XCTAssertThrowsError(try server.activate(instanceId: activated.instanceId))
    }
    func testOccupiedPreparedPortFailsWithoutReplacingExportedTuple() throws {
        let events = Events(), server = McpTransport { events.append($0) }; defer { try? server.reset() }
        let prepared = try server.prepare(address: "127.0.0.1")
        let group = MultiThreadedEventLoopGroup(numberOfThreads: 1)
        defer { try? group.syncShutdownGracefully() }
        let occupied = try ServerBootstrap(group: group).childChannelInitializer { $0.close() }
            .bind(host: "127.0.0.1", port: URL(string: prepared.endpoint)!.port!).wait()
        defer { try? occupied.close().wait() }
        XCTAssertThrowsError(try server.activate(instanceId: prepared.instanceId))
        XCTAssertTrue(events.stopped(prepared.instanceId))
        XCTAssertThrowsError(try server.activate(instanceId: prepared.instanceId), "Failed activation must be re-prepared and re-exported")
        let next = try server.prepare(address: "127.0.0.1")
        XCTAssertNotEqual(next.instanceId, prepared.instanceId)
        XCTAssertNotEqual(next.spkiSha256, prepared.spkiSha256)
        XCTAssertNoThrow(try server.stop(instanceId: prepared.instanceId), "A known stopped instance can be acknowledged without clearing the newly prepared identity")
        XCTAssertThrowsError(try server.stop(instanceId: UUID().uuidString))
        same(next, try server.activate(instanceId: next.instanceId))
        try send(next, events: events, server: server)
    }
    func testTwoMinuteTTLUsesMonotonicClockAndPauseDoesNotExtendIt() throws {
        let clock = TestClock(), events = Events()
        let server = McpTransport(now: { clock.now() }) { events.append($0) }; defer { try? server.reset() }
        let prepared = try server.prepare(address: "127.0.0.1")
        clock.advance(seconds: 119); try server.pause()
        clock.advance(seconds: 1)
        XCTAssertThrowsError(try server.activate(instanceId: prepared.instanceId))
        XCTAssertTrue(events.stopped(prepared.instanceId))
        XCTAssertNoThrow(try server.stop(instanceId: prepared.instanceId), "TTL may have stopped before the bridge acknowledged it")
        let next = try server.prepare(address: "127.0.0.1")
        same(next, try server.activate(instanceId: next.instanceId))
        try send(next, events: events, server: server)
        // This is a deterministic core clock-injection check of the fixed
        // production 120s boundary, not an actual two-minute device wait.
    }
    func testResetAndExplicitStopClearPreparedWithoutReplay() throws {
        let events = Events(), server = McpTransport { events.append($0) }; defer { try? server.reset() }
        let first = try server.prepare(address: "127.0.0.1")
        try server.reset(); XCTAssertTrue(events.stopped(first.instanceId))
        XCTAssertThrowsError(try server.activate(instanceId: first.instanceId))
        let second = try server.prepare(address: "127.0.0.1")
        try server.stop(instanceId: second.instanceId); XCTAssertTrue(events.stopped(second.instanceId))
        XCTAssertThrowsError(try server.activate(instanceId: second.instanceId))
        let third = try server.prepare(address: "127.0.0.1")
        XCTAssertNotEqual(first.spkiSha256, third.spkiSha256)
        same(third, try server.activate(instanceId: third.instanceId))
        try send(third, events: events, server: server)
        XCTAssertThrowsError(try events.request(timeout: 0.2), "Cleared preparations do not replay")
    }
    func testDestroyClearsPreparedAndNotifiesStopped() throws {
        let events = Events()
        var server: McpTransport? = McpTransport { events.append($0) }
        let prepared = try server!.prepare(address: "127.0.0.1")
        let released = WeakTransport(server)
        server = nil
        XCTAssertNil(released.value)
        XCTAssertTrue(events.stopped(prepared.instanceId))
        XCTAssertThrowsError(try TLSProbe(prepared))
    }
    func testLostStopAcknowledgementRetryCannotStopTheNewActiveInstance() throws {
        let events = Events(), server = McpTransport { events.append($0) }; defer { try? server.reset() }
        let first = try server.start(address: "127.0.0.1")
        try server.stop(instanceId: first.instanceId)
        XCTAssertTrue(events.stopped(first.instanceId))
        // The caller intentionally ignores the first completion/event, as if
        // the bridge reply was lost. An explicit retry must be confirmable.
        XCTAssertNoThrow(try server.stop(instanceId: first.instanceId))
        let next = try server.start(address: "127.0.0.1")
        XCTAssertNoThrow(try server.stop(instanceId: first.instanceId))
        XCTAssertThrowsError(try server.stop(instanceId: UUID().uuidString))
        try send(next, events: events, server: server)
        XCTAssertEqual(events.stoppedCount(first.instanceId), 1)
    }
    func testKnownStoppedIdentitiesAreBoundedAndDoNotAuthorizeUnknownStops() throws {
        let events = Events(), server = McpTransport { events.append($0) }; defer { try? server.reset() }
        var ids: [String] = []
        for _ in 0..<17 {
            let prepared = try server.prepare(address: "127.0.0.1")
            try server.stop(instanceId: prepared.instanceId); ids.append(prepared.instanceId)
        }
        XCTAssertThrowsError(try server.stop(instanceId: ids[0]), "Oldest confirmation must be evicted from the 16-ID bound")
        XCTAssertNoThrow(try server.stop(instanceId: ids[16]))
        let next = try server.start(address: "127.0.0.1")
        XCTAssertNoThrow(try server.stop(instanceId: ids[16]))
        XCTAssertThrowsError(try server.stop(instanceId: UUID().uuidString))
        try send(next, events: events, server: server)
    }
}
