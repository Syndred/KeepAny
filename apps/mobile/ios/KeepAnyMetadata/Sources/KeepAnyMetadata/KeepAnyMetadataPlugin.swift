import Foundation
import Capacitor

@objc(KeepAnyMetadataPlugin)
public final class KeepAnyMetadataPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KeepAnyMetadataPlugin"
    public let jsName = "KeepAnyMetadata"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]
    // Shared across plugin/controller recreation. A timed-out getaddrinfo still
    // owns its slot until the original worker returns.
    private static let coordinator = MetadataCoordinator()

    @objc public func read(_ call: CAPPluginCall) {
        guard Set(call.options.keys) == Set(["requestId", "url"]),
              let id = call.getString("requestId"), UUID(uuidString: id) != nil,
              let url = call.getString("url") else { call.reject("metadata-body", "metadata-body"); return }
        Self.coordinator.read(id: id, url: url) { result in
            switch result {
            case .success(let value): call.resolve(["url": value.url, "contentType": value.contentType, "bodyBase64": value.bytes.base64EncodedString()])
            case .failure(let code): call.reject(code.value, code.value)
            }
        }
    }
    @objc public func cancel(_ call: CAPPluginCall) {
        guard Set(call.options.keys) == Set(["requestId"]),
              let id = call.getString("requestId"), UUID(uuidString: id) != nil else { call.reject("metadata-body", "metadata-body"); return }
        Self.coordinator.cancel(id: id); call.resolve()
    }
}

private struct SafeMetadataError: Error { let value: String }
private final class MetadataJob: @unchecked Sendable {
    let budget = MetadataBudget()
    private let lock = NSLock()
    private var complete = false
    private let reply: (Result<MetadataResult, SafeMetadataError>) -> Void
    init(reply: @escaping (Result<MetadataResult, SafeMetadataError>) -> Void) { self.reply = reply }
    func finish(_ result: Result<MetadataResult, SafeMetadataError>) {
        lock.lock(); let settled = complete; complete = true; lock.unlock()
        if !settled { reply(result) }
    }
    func cancel() { budget.cancel(); finish(.failure(SafeMetadataError(value: "metadata-timeout"))) }
}
private final class MetadataCoordinator: @unchecked Sendable {
    private let lock = NSLock()
    private var active: [String: MetadataJob] = [:]
    private let workers = DispatchQueue(label: "KeepAny.Metadata", attributes: .concurrent)
    func read(id: String, url: String, reply: @escaping (Result<MetadataResult, SafeMetadataError>) -> Void) {
        lock.lock()
        guard active.count < 4, active[id] == nil else { lock.unlock(); reply(.failure(SafeMetadataError(value: "metadata-busy"))); return }
        let job = MetadataJob(reply: reply)
        active[id] = job
        lock.unlock()
        let timeout = DispatchWorkItem { job.cancel() }
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + .nanoseconds(Int(MetadataPolicy.timeoutNanoseconds)), execute: timeout)
        workers.async {
            defer {
                timeout.cancel()
                self.lock.lock(); self.active.removeValue(forKey: id); self.lock.unlock()
            }
            do { job.finish(.success(try MetadataFetcher.read(url, budget: job.budget))) }
            catch {
                let expired = (try? job.budget.remaining()) == nil
                job.finish(.failure(SafeMetadataError(value: expired ? "metadata-timeout" : (error as? MetadataFailure)?.safeCode ?? "metadata-network")))
            }
        }
    }
    func cancel(id: String) {
        lock.lock(); let job = active[id]; lock.unlock()
        job?.cancel()
    }
}
