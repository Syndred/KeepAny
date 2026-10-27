import Foundation
import Security
import CryptoKit
import Capacitor

private struct IdentityFailure: Error {}
private final class IdentitySecureStore {
    private static let lock = NSLock()
    private let service = (Bundle.main.bundleIdentifier ?? "io.github.syndred.keepany") + ".binding.v1"
    private var tag: Data { Data((service + ".sign").utf8) }
    private let maximum = 256 * 1024
    private var stateQuery: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "state", kSecAttrSynchronizable as String: false] }
    private var keyQuery: [String: Any] { [kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: tag, kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom] }
    private func key() throws -> SecKey {
        var query = keyQuery; query[kSecReturnRef as String] = true; query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?; guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let result else { throw IdentityFailure() }
        return result as! SecKey
    }
    private func readUnlocked() throws -> [String: String] {
        var query = stateQuery; query[kSecReturnData as String] = true; query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data, data.count <= maximum * 2 + 4096,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: String], let revision = object["revision"], UUID(uuidString: revision) != nil,
              let payload = object["payload"], payload.utf8.count <= maximum else { throw IdentityFailure() }
        return object
    }
    private func writeUnlocked(_ object: [String: String]) throws {
        let data = try JSONSerialization.data(withJSONObject: object)
        let status = SecItemUpdate(stateQuery as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = stateQuery; item[kSecValueData as String] = data; item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw IdentityFailure() }
        } else if status != errSecSuccess { throw IdentityFailure() }
    }
    func initialize() throws {
        Self.lock.lock(); defer { Self.lock.unlock() }
        let folder = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("KeepAnyIdentity", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var excludedFolder = folder
        var excludedValues = URLResourceValues(); excludedValues.isExcludedFromBackup = true; try excludedFolder.setResourceValues(excludedValues)
        let marker = folder.appendingPathComponent("installation")
        if !FileManager.default.fileExists(atPath: marker.path) {
            // A missing marker alone cannot prove old credentials are safe to destroy.
            // New installations never adopt residual Keychain identities; explicit reset is a separate flow.
            guard SecItemCopyMatching(stateQuery as CFDictionary, nil) == errSecItemNotFound,
                  SecItemCopyMatching(keyQuery as CFDictionary, nil) == errSecItemNotFound else { throw IdentityFailure() }
            let attributes: [String: Any] = [kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom, kSecAttrKeySizeInBits as String: 256,
                kSecPrivateKeyAttrs as String: [kSecAttrIsPermanent as String: true, kSecAttrApplicationTag as String: tag, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]]
            do {
                var error: Unmanaged<CFError>?
                guard SecKeyCreateRandomKey(attributes as CFDictionary, &error) != nil else { throw IdentityFailure() }
                try writeUnlocked(["revision": UUID().uuidString.lowercased(), "payload": "{\"bindings\":[],\"credentials\":[]}"])
                try Data(UUID().uuidString.utf8).write(to: marker, options: .atomic)
            } catch {
                // This branch proved there were no prior Keychain items before our attempt.
                // Keep a valid committed state; clear only new, uncommitted initialization material.
                if (try? readUnlocked()) == nil {
                    _ = SecItemDelete(stateQuery as CFDictionary); _ = SecItemDelete(keyQuery as CFDictionary)
                }
                throw IdentityFailure()
            }
        }
        _ = try key(); _ = try readUnlocked()
    }
    func read() throws -> [String: String] { Self.lock.lock(); defer { Self.lock.unlock() }; return try readUnlocked() }
    func compareAndSet(_ expected: String?, _ payload: String) throws -> Bool {
        Self.lock.lock(); defer { Self.lock.unlock() }
        guard payload.utf8.count <= maximum, (try JSONSerialization.jsonObject(with: Data(payload.utf8))) is [String: Any] else { throw IdentityFailure() }
        let current = try readUnlocked(); guard expected == current["revision"] else { return false }
        try writeUnlocked(["revision": UUID().uuidString.lowercased(), "payload": payload]); return true
    }
    func publicKey() throws -> [String: String] {
        Self.lock.lock(); defer { Self.lock.unlock() }; _ = try readUnlocked()
        guard let publicKey = SecKeyCopyPublicKey(try key()), let data = SecKeyCopyExternalRepresentation(publicKey, nil) as Data?, data.count == 65, data.first == 4 else { throw IdentityFailure() }
        func encode(_ value: Data) -> String { value.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
        return ["kty": "EC", "crv": "P-256", "x": encode(data.subdata(in: 1..<33)), "y": encode(data.subdata(in: 33..<65))]
    }
    func sign(_ input: Data) throws -> Data {
        Self.lock.lock(); defer { Self.lock.unlock() }; _ = try readUnlocked()
        guard input.count <= 8192, let text = String(data: input, encoding: .ascii), text.range(of: "^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$", options: .regularExpression) != nil,
              let signature = SecKeyCreateSignature(try key(), .ecdsaSignatureMessageX962SHA256, input as CFData, nil) as Data? else { throw IdentityFailure() }
        return try P256.Signing.ECDSASignature(derRepresentation: signature).rawRepresentation
    }
}

@objc(KeepAnyIdentityPlugin)
public final class KeepAnyIdentityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KeepAnyIdentityPlugin"
    public let jsName = "KeepAnyIdentity"
    public let pluginMethods: [CAPPluginMethod] = ["initialize", "readState", "compareAndSet", "publicKey", "sign"].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    private static let store = IdentitySecureStore()
    private func run(_ call: CAPPluginCall, keys: Set<String>, action: @escaping () throws -> JSObject) {
        guard call.options.count == keys.count, call.options.keys.allSatisfy({ key in
            guard let name = key as? String else { return false }
            return keys.contains(name)
        }) else { call.reject("binding-native-unavailable", "binding-native-unavailable"); return }
        DispatchQueue.global(qos: .utility).async {
            do { call.resolve(try action()) } catch { call.reject("binding-native-unavailable", "binding-native-unavailable") }
        }
    }
    @objc public func initialize(_ call: CAPPluginCall) { run(call, keys: []) { try Self.store.initialize(); return [:] } }
    @objc public func readState(_ call: CAPPluginCall) { run(call, keys: []) { try Self.store.read() } }
    @objc public func publicKey(_ call: CAPPluginCall) { run(call, keys: []) { try Self.store.publicKey() } }
    @objc public func compareAndSet(_ call: CAPPluginCall) {
        run(call, keys: ["expectedRevision", "payload"]) {
            guard let payload = call.getString("payload") else { throw IdentityFailure() }
            return ["committed": try Self.store.compareAndSet(call.getString("expectedRevision"), payload)]
        }
    }
    @objc public func sign(_ call: CAPPluginCall) {
        run(call, keys: ["signingInputBase64"]) {
            guard let encoded = call.getString("signingInputBase64"), encoded.count <= 11000, let data = Data(base64Encoded: encoded) else { throw IdentityFailure() }
            return ["signatureBase64": try Self.store.sign(data).base64EncodedString()]
        }
    }
}
