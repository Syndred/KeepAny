import Capacitor
import Foundation

@objc(KeepAnyMcpAuthorityPlugin)
public final class KeepAnyMcpAuthorityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KeepAnyMcpAuthorityPlugin"
    public let jsName = "KeepAnyMcpAuthority"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "compareAndSet", returnType: CAPPluginReturnPromise)
    ]
    private static let store = McpAuthoritySecureStore()
    private let worker = DispatchQueue(label: "KeepAny.McpAuthority")
    private func string(_ call: CAPPluginCall, _ key: String) throws -> String { guard let text = call.getString(key) else { throw McpAuthorityFailure() }; return text }
    private func run(_ call: CAPPluginCall, _ stage: McpAuthorityDiagnostics.Stage, _ expected: Set<String>, _ action: @escaping () throws -> JSObject) {
        guard call.options.count == expected.count, call.options.keys.allSatisfy({ ($0 as? String).map(expected.contains) == true }) else { McpAuthorityDiagnostics.mark(stage, .rejected); call.reject("mcp-native-unavailable", "mcp-native-unavailable"); return }
        worker.async {
            McpAuthorityDiagnostics.mark(stage)
            do { let result = try action(); McpAuthorityDiagnostics.mark(stage, .complete); call.resolve(result) }
            catch { McpAuthorityDiagnostics.mark(stage, .failed); call.reject("mcp-native-unavailable", "mcp-native-unavailable") }
        }
    }
    @objc public func initialize(_ call: CAPPluginCall) { run(call, .bridgeInitialize, ["scope"]) { try Self.store.initialize(self.string(call, "scope")); return [:] } }
    @objc public func readState(_ call: CAPPluginCall) { run(call, .bridgeRead, ["scope"]) { let state = try Self.store.read(self.string(call, "scope")); return ["revision": state.revision, "payload": state.payload] } }
    @objc public func compareAndSet(_ call: CAPPluginCall) { run(call, .bridgeCompareAndSet, ["scope", "expectedRevision", "payload"]) { ["committed": try Self.store.compareAndSet(self.string(call, "scope"), self.string(call, "expectedRevision"), self.string(call, "payload"))] } }
}
