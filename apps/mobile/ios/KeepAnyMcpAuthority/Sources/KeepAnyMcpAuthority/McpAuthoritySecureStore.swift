import Foundation
import CryptoKit
import Security

// Diagnostics accept only compile-time stages and numeric Security status codes.
// Never pass scope, paths, key material, payloads, or Error descriptions here.
enum McpAuthorityDiagnostics {
    enum Stage: String {
        case bridgeInitialize, bridgeRead, bridgeCompareAndSet
        case rootDirectory, rootProtection, hasFile, keyExists, keyRead, keyAdd, freshKeyDelete
        case initializeScope, initializePresence, initializeFresh, initializeReadback
        case readPresence, readAttributes, readEnvelope, readDecrypt, readDecode
        case writeFrame, writeSeal, writeTemporary, writeReplace, writeReadback
    }
    enum Event: String { case begin, complete, rejected, failed }
    static func mark(_ stage: Stage, _ event: Event = .begin) {
        #if DEBUG
        NSLog("KeepAnyMcpAuthority stage=%@ event=%@", stage.rawValue, event.rawValue)
        #endif
    }
    static func status(_ stage: Stage, _ status: OSStatus) {
        #if DEBUG
        NSLog("KeepAnyMcpAuthority stage=%@ osStatus=%d", stage.rawValue, status)
        #endif
    }
}

final class McpAuthoritySecureStore {
    private static let lock = NSLock()
    private let service = (Bundle.main.bundleIdentifier ?? "io.github.syndred.keepany") + ".mcp-authority.v1"
    private let files = FileManager.default
    private func root() throws -> URL {
        McpAuthorityDiagnostics.mark(.rootDirectory)
        let folder = try files.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("KeepAnyMcpAuthority-v1", isDirectory: true)
        try files.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700, .protectionKey: FileProtectionType.complete])
        guard try folder.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else { throw McpAuthorityFailure() }
        McpAuthorityDiagnostics.mark(.rootProtection)
        var protected = folder, values = URLResourceValues(); values.isExcludedFromBackup = true; try protected.setResourceValues(values); return folder
    }
    private func file(_ scope: String) throws -> URL { try McpAuthorityState.scope(scope); return try root().appendingPathComponent(scope + ".enc") }
    private func query(_ scope: String) throws -> [String: Any] {
        try McpAuthorityState.scope(scope); return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: scope, kSecAttrSynchronizable as String: false]
    }
    private func hasKey(_ scope: String) throws -> Bool {
        McpAuthorityDiagnostics.mark(.keyExists)
        let status = SecItemCopyMatching(try query(scope) as CFDictionary, nil)
        McpAuthorityDiagnostics.status(.keyExists, status)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw McpAuthorityFailure() }; return status == errSecSuccess
    }
    private func key(_ scope: String) throws -> SymmetricKey {
        var request = try query(scope); request[kSecReturnData as String] = true; request[kSecMatchLimit as String] = kSecMatchLimitOne
        McpAuthorityDiagnostics.mark(.keyRead)
        var value: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &value)
        McpAuthorityDiagnostics.status(.keyRead, status)
        guard status == errSecSuccess, let bytes = value as? Data, bytes.count == 32 else { throw McpAuthorityFailure() }; return SymmetricKey(data: bytes)
    }
    private func createKey(_ scope: String) throws {
        guard try !hasKey(scope) else { throw McpAuthorityFailure() }; let key = SymmetricKey(size: .bits256)
        var item = try query(scope); item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly; item[kSecValueData as String] = key.withUnsafeBytes { Data($0) }
        McpAuthorityDiagnostics.mark(.keyAdd)
        let status = SecItemAdd(item as CFDictionary, nil)
        McpAuthorityDiagnostics.status(.keyAdd, status)
        guard status == errSecSuccess else { throw McpAuthorityFailure() }
    }
    private func hasFile(_ scope: String) throws -> Bool {
        McpAuthorityDiagnostics.mark(.hasFile)
        let destination = try file(scope); if files.fileExists(atPath: destination.path) { return true }
        return try files.contentsOfDirectory(at: root(), includingPropertiesForKeys: nil).contains(where: { $0.lastPathComponent.hasPrefix(".new-" + scope + "-") })
    }
    private func aad(_ scope: String) throws -> Data { try McpAuthorityState.scope(scope); return Data(("KeepAny/MCP/authority/v1/" + scope).utf8) }
    private func readUnlocked(_ scope: String) throws -> McpAuthoritySnapshot {
        McpAuthorityDiagnostics.mark(.readPresence)
        guard try hasFile(scope), try hasKey(scope) else { throw McpAuthorityFailure() }
        McpAuthorityDiagnostics.mark(.readAttributes)
        let location = try file(scope), attributes = try location.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard attributes.isRegularFile == true, attributes.isSymbolicLink != true, let size = attributes.fileSize, size >= 32, size <= McpAuthorityState.envelopeMaximum + 32 else { throw McpAuthorityFailure() }
        McpAuthorityDiagnostics.mark(.readEnvelope)
        let encrypted = try Data(contentsOf: location)
        guard encrypted.count <= McpAuthorityState.envelopeMaximum + 32, encrypted.prefix(4) == Data("KMA1".utf8) else { throw McpAuthorityFailure() }
        let box = try AES.GCM.SealedBox(combined: encrypted.dropFirst(4))
        McpAuthorityDiagnostics.mark(.readDecrypt)
        var plain = try AES.GCM.open(box, using: key(scope), authenticating: aad(scope)); defer { plain.resetBytes(in: 0..<plain.count) }
        McpAuthorityDiagnostics.mark(.readDecode)
        return try McpAuthorityState.unpack(plain)
    }
    private func writeUnlocked(_ scope: String, _ state: McpAuthoritySnapshot) throws {
        McpAuthorityDiagnostics.mark(.writeFrame)
        var plain = try McpAuthorityState.frame(state); defer { plain.resetBytes(in: 0..<plain.count) }
        McpAuthorityDiagnostics.mark(.writeSeal)
        guard plain.count <= McpAuthorityState.envelopeMaximum, let box = try AES.GCM.seal(plain, using: key(scope), authenticating: aad(scope)).combined else { throw McpAuthorityFailure() }
        let ciphertext = Data("KMA1".utf8) + box, destination = try file(scope), temporary = try root().appendingPathComponent(".new-" + scope + "-" + UUID().uuidString.lowercased())
        McpAuthorityDiagnostics.mark(.writeTemporary)
        guard files.createFile(atPath: temporary.path, contents: nil, attributes: [.posixPermissions: 0o600, .protectionKey: FileProtectionType.complete]) else { throw McpAuthorityFailure() }
        do {
            let output = try FileHandle(forWritingTo: temporary)
            do { try output.write(contentsOf: ciphertext); try output.synchronize(); try output.close() } catch { try? output.close(); throw error }
            McpAuthorityDiagnostics.mark(.writeReplace)
            if files.fileExists(atPath: destination.path) { _ = try files.replaceItemAt(destination, withItemAt: temporary) }
            else { try files.moveItem(at: temporary, to: destination) }
        } catch { if files.fileExists(atPath: temporary.path) { try? files.removeItem(at: temporary) }; throw McpAuthorityFailure() }
        McpAuthorityDiagnostics.mark(.writeReadback)
        guard try readUnlocked(scope).revision == state.revision else { throw McpAuthorityFailure() }
    }
    func initialize(_ scope: String) throws {
        Self.lock.lock(); defer { Self.lock.unlock() }
        McpAuthorityDiagnostics.mark(.initializeScope)
        try McpAuthorityState.scope(scope)
        let file = try hasFile(scope), key = try hasKey(scope)
        McpAuthorityDiagnostics.mark(.initializePresence)
        guard file == key else { throw McpAuthorityFailure() }
        if !file {
            McpAuthorityDiagnostics.mark(.initializeFresh)
            do { try createKey(scope); try writeUnlocked(scope, McpAuthorityState.snapshot(UUID().uuidString.lowercased(), McpAuthorityState.empty)) }
            catch {
                McpAuthorityDiagnostics.mark(.initializeFresh, .failed)
                // Only this branch proved there was no previous file or key.
                // Never erase existing grants, nor a readable commit after an acknowledgement failure.
                if (try? readUnlocked(scope)) == nil { let location = try self.file(scope); if files.fileExists(atPath: location.path) { try? files.removeItem(at: location) }; let status = SecItemDelete(try query(scope) as CFDictionary); McpAuthorityDiagnostics.status(.freshKeyDelete, status) }
                throw McpAuthorityFailure()
            }
        }
        McpAuthorityDiagnostics.mark(.initializeReadback)
        _ = try readUnlocked(scope)
    }
    func read(_ scope: String) throws -> McpAuthoritySnapshot { Self.lock.lock(); defer { Self.lock.unlock() }; return try readUnlocked(scope) }
    func compareAndSet(_ scope: String, _ expected: String, _ payload: String) throws -> Bool {
        Self.lock.lock(); defer { Self.lock.unlock() }; let current = try readUnlocked(scope); guard current.revision == expected else { return false }
        let next = try McpAuthorityState.snapshot(UUID().uuidString.lowercased(), payload); try writeUnlocked(scope, next); return true
    }
}
