import Foundation
import AsyncHTTPClient
import NIOCore
import NIOHTTP1
import NIOPosix

struct MetadataResult: Sendable {
    let url: String
    let contentType: String
    let bytes: Data
}

final class MetadataBudget: @unchecked Sendable {
    let deadline: UInt64 = DispatchTime.now().uptimeNanoseconds + MetadataPolicy.timeoutNanoseconds
    private let lock = NSLock()
    private var cancelled = false
    private var cancelTransport: (() -> Void)?
    func remaining() throws -> Int64 {
        lock.lock(); defer { lock.unlock() }
        let now = DispatchTime.now().uptimeNanoseconds
        guard !cancelled, now < deadline else { throw MetadataFailure.code("metadata-timeout") }
        return Int64(deadline - now)
    }
    func attach(_ cancel: (() -> Void)?) {
        lock.lock(); cancelTransport = cancel; let shouldCancel = cancelled; lock.unlock()
        if shouldCancel { cancel?() }
    }
    func cancel() {
        lock.lock(); cancelled = true; let cancel = cancelTransport; lock.unlock()
        cancel?()
    }
}

// All callbacks run on one event loop. No response bytes or URLs are logged.
private final class MetadataDelegate: HTTPClientResponseDelegate, @unchecked Sendable {
    typealias Response = MetadataResult
    let url: String
    let budget: MetadataBudget
    private var type = ""
    private var data = Data()
    init(url: String, budget: MetadataBudget) { self.url = url; self.budget = budget }
    func didReceiveHead(task: HTTPClient.Task<MetadataResult>, _ head: HTTPResponseHead) -> EventLoopFuture<Void> {
        do {
            _ = try budget.remaining()
            let status = head.status.code
            if [301, 302, 303, 307, 308].contains(status) {
                guard let location = head.headers.first(name: "location"), !location.isEmpty else { throw MetadataFailure.code("metadata-redirect") }
                // Failing the delegate stops reading the redirect body. The outer
                // loop validates DNS again and creates a distinct client/pool.
                throw MetadataFailure.redirect(location)
            }
            guard (200..<300).contains(status) else { throw MetadataFailure.code("metadata-http") }
            type = head.headers.first(name: "content-type") ?? ""
            guard head.headers["content-type"].count == 1,
                  type.range(of: "^(?:text/html|application/xhtml\\+xml)(?:\\s*;|\\s*$)", options: [.regularExpression, .caseInsensitive]) != nil else { throw MetadataFailure.code("metadata-type") }
            guard head.headers["content-encoding"].count <= 1, head.headers["content-length"].count <= 1 else { throw MetadataFailure.code("metadata-limit") }
            if let encoding = head.headers.first(name: "content-encoding"), encoding != "identity" { throw MetadataFailure.code("metadata-limit") }
            if let length = head.headers.first(name: "content-length") {
                guard length.range(of: "^[0-9]+$", options: .regularExpression) != nil,
                      let bytes = UInt64(length), bytes <= UInt64(MetadataPolicy.maxBytes) else { throw MetadataFailure.code("metadata-limit") }
            }
            return task.eventLoop.makeSucceededFuture(())
        } catch { return task.eventLoop.makeFailedFuture(error) }
    }
    func didReceiveBodyPart(task: HTTPClient.Task<MetadataResult>, _ buffer: ByteBuffer) -> EventLoopFuture<Void> {
        do {
            _ = try budget.remaining()
            guard data.count + buffer.readableBytes <= MetadataPolicy.maxBytes else { throw MetadataFailure.code("metadata-limit") }
            data.append(contentsOf: buffer.readableBytesView)
            return task.eventLoop.makeSucceededFuture(())
        } catch { return task.eventLoop.makeFailedFuture(error) }
    }
    func didFinishRequest(task: HTTPClient.Task<MetadataResult>) throws -> MetadataResult {
        _ = try budget.remaining()
        return MetadataResult(url: url, contentType: type, bytes: data)
    }
}

enum MetadataFetcher {
    // POSIX NIO guarantees numeric dnsOverride is used instead of allowing
    // Network.framework to perform a second hostname resolution.
    private static let loops = MultiThreadedEventLoopGroup(numberOfThreads: 1)
    static func read(_ input: String, budget: MetadataBudget) throws -> MetadataResult {
        var url = try MetadataPolicy.target(input)
        for redirects in 0...4 {
            _ = try budget.remaining()
            let request = try HTTPClient.Request(url: url.absoluteString, method: .GET, headers: HTTPHeaders([
                ("Accept", "text/html, application/xhtml+xml"),
                ("Accept-Encoding", "identity"),
                ("User-Agent", "KeepAny-Metadata/1.0")
            ]))
            // Use the exact parsed host that AHC uses as its dnsOverride key.
            let hostname = request.host
            guard !hostname.isEmpty else { throw MetadataFailure.code("metadata-url") }
            let address = try MetadataPolicy.address(hostname)
            let remaining = try budget.remaining()
            var configuration = HTTPClient.Configuration(
                redirectConfiguration: .disallow,
                timeout: .init(connect: .nanoseconds(remaining), read: .nanoseconds(remaining)),
                proxy: nil,
                decompression: .disabled
            )
            configuration.dnsOverride = [hostname: address]
            let client = HTTPClient(eventLoopGroupProvider: .shared(loops), configuration: configuration)
            defer { try? client.syncShutdown() }
            let task = client.execute(request: request, delegate: MetadataDelegate(url: url.absoluteString, budget: budget), eventLoop: .indifferent, deadline: .now() + .nanoseconds(remaining))
            budget.attach { task.cancel() }
            do {
                let result = try task.futureResult.wait()
                budget.attach(nil)
                _ = try budget.remaining()
                return result
            } catch MetadataFailure.redirect(let location) {
                budget.attach(nil)
                _ = try budget.remaining()
                guard redirects < 4, let next = URL(string: location, relativeTo: url)?.absoluteURL else { throw MetadataFailure.code("metadata-redirect") }
                url = try MetadataPolicy.target(next.absoluteString)
            } catch {
                budget.attach(nil)
                _ = try budget.remaining()
                if let known = error as? MetadataFailure { throw known }
                throw MetadataFailure.code("metadata-network")
            }
        }
        throw MetadataFailure.code("metadata-redirect")
    }
}
