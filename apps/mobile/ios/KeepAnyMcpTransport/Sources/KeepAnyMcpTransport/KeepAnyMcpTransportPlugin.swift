#if os(iOS)
import Foundation
import UIKit
import Capacitor
import KeepAnyMcpTransportCore

@objc(KeepAnyMcpTransportPlugin)
public final class KeepAnyMcpTransportPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KeepAnyMcpTransportPlugin"
    public let jsName = "KeepAnyMcpTransport"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reset", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "responseStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "responseWrite", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "responseEnd", returnType: CAPPluginReturnPromise),
    ]
    private let worker = DispatchQueue(label: "keepany.mcp.bridge")
    private var observers: [NSObjectProtocol] = []
    private let activityLock = NSLock()
    private var foreground = false
    private lazy var transport = McpTransport { [weak self] event in
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            switch event {
            case .request(let row): self.notifyListeners("mcpRequest", data: ["instanceId": row.instanceId, "requestId": row.requestId, "method": row.method, "path": row.path, "host": row.host, "headers": row.headers, "body": row.body])
            case .cancelled(let instance, let request): self.notifyListeners("mcpCancelled", data: ["instanceId": instance, "requestId": request])
            case .stopped(let instance): self.notifyListeners("mcpStopped", data: ["instanceId": instance])
            }
        }
    }
    public override func load() {
        // Observing lifecycle does not initialize or start the lazy listener.
        setForeground(UIApplication.shared.applicationState == .active)
        for name in [UIApplication.willResignActiveNotification, UIApplication.didEnterBackgroundNotification, UIApplication.willTerminateNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                guard let self else { return }
                self.setForeground(false)
                self.worker.async { [weak self] in try? self?.transport.reset() }
            })
        }
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.setForeground(true) })
    }
    deinit {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        // Core deinit also resets. No private identity survives destruction.
    }
    private func setForeground(_ active: Bool) { activityLock.lock(); foreground = active; activityLock.unlock() }
    private func isForeground() -> Bool { activityLock.lock(); defer { activityLock.unlock() }; return foreground }
    private func exact(_ call: CAPPluginCall, _ keys: Set<String>) -> Bool {
        call.options.count == keys.count && call.options.keys.allSatisfy { ($0 as? String).map(keys.contains) == true }
    }
    private func invalidResponse(_ call: CAPPluginCall) {
        if let instance = id(call, "instanceId"), let request = id(call, "requestId") {
            worker.async { [self] in try? transport.cancel(instanceId: instance, requestId: request) }
        }
        call.reject("Invalid transport request", "native-mcp-transport")
    }
    private func id(_ call: CAPPluginCall, _ key: String) -> String? {
        guard let value = call.getString(key), value.count == 36, UUID(uuidString: value) != nil else { return nil }
        return value
    }
    private func perform(_ call: CAPPluginCall, _ operation: @escaping () throws -> JSObject) {
        worker.async {
            do { let result = try operation(); call.resolve(result) }
            catch { call.reject("Native MCP transport operation failed", "native-mcp-transport") }
        }
    }
    @objc public func start(_ call: CAPPluginCall) {
        guard exact(call, ["address"]), let address = call.getString("address") else { call.reject("Invalid transport request", "native-mcp-transport"); return }
        perform(call) { [self] in
            guard isForeground() else { throw McpTransportError.unavailable }
            let endpoint = try transport.start(address: address)
            guard isForeground() else { try? transport.stop(instanceId: endpoint.instanceId); throw McpTransportError.unavailable }
            return ["instanceId": endpoint.instanceId, "endpoint": endpoint.endpoint, "certificatePem": endpoint.certificatePem, "spkiSha256": endpoint.spkiSha256]
        }
    }
    @objc public func reset(_ call: CAPPluginCall) {
        guard exact(call, []) else { call.reject("Invalid transport request", "native-mcp-transport"); return }
        perform(call) { [self] in try transport.reset(); return [:] }
    }
    @objc public func stop(_ call: CAPPluginCall) {
        guard exact(call, ["instanceId"]), let instance = id(call, "instanceId") else { call.reject("Invalid transport request", "native-mcp-transport"); return }
        perform(call) { [self] in try transport.stop(instanceId: instance); return [:] }
    }
    @objc public func cancel(_ call: CAPPluginCall) {
        guard exact(call, ["instanceId", "requestId"]), let instance = id(call, "instanceId"), let request = id(call, "requestId") else { call.reject("Invalid transport request", "native-mcp-transport"); return }
        perform(call) { [self] in try transport.cancel(instanceId: instance, requestId: request); return [:] }
    }
    @objc public func responseStart(_ call: CAPPluginCall) {
        guard exact(call, ["instanceId", "requestId", "status", "headers"]), let instance = id(call, "instanceId"), let request = id(call, "requestId"), let status = call.getInt("status"), let headers = call.getObject("headers") as? [String: String] else { invalidResponse(call); return }
        perform(call) { [self] in try transport.responseStart(instanceId: instance, requestId: request, status: status, headers: headers); return [:] }
    }
    @objc public func responseWrite(_ call: CAPPluginCall) {
        guard exact(call, ["instanceId", "requestId", "chunkBase64"]), let instance = id(call, "instanceId"), let request = id(call, "requestId"), let chunk = call.getString("chunkBase64") else { invalidResponse(call); return }
        perform(call) { [self] in try transport.responseWrite(instanceId: instance, requestId: request, chunkBase64: chunk); return [:] }
    }
    @objc public func responseEnd(_ call: CAPPluginCall) {
        guard exact(call, ["instanceId", "requestId"]), let instance = id(call, "instanceId"), let request = id(call, "requestId") else { invalidResponse(call); return }
        perform(call) { [self] in try transport.responseEnd(instanceId: instance, requestId: request); return [:] }
    }
}
#endif
