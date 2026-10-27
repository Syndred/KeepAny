import Foundation
import CryptoKit
import Security

final class McpAuthoritySecureStore {
    private static let lock = NSLock()
    private let service = (Bundle.main.bundleIdentifier ?? "io.github.syndred.keepany") + ".mcp-authority.v1"
    private let files = FileManager.default
    private func root() throws -> URL {
        let folder = try files.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("KeepAnyMcpAuthority-v1", isDirectory: true)
        try files.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700, .protectionKey: FileProtectionType.complete])
        guard try folder.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else { throw McpAuthorityFailure() }
        var protected = folder, values = URLResourceValues(); values.isExcludedFromBackup = true; try protected.setResourceValues(values); return folder
    }
    private func file(_ scope: String) throws -> URL { try McpAuthorityState.scope(scope); return try root().appendingPathComponent(scope + ".enc") }
    private func query(_ scope: String) throws -> [String: Any] {
        try McpAuthorityState.scope(scope); return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: scope, kSecAttrSynchronizable as String: false]
    }
    private func hasKey(_ scope: String) throws -> Bool {
        let status = SecItemCopyMatching(try query(scope) as CFDictionary, nil)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw McpAuthorityFailure() }; return status == errSecSuccess
    }
    private func key(_ scope: String) throws -> SymmetricKey {
        var request = try query(scope); request[kSecReturnData as String] = true; request[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?; guard SecItemCopyMatching(request as CFDictionary, &value) == errSecSuccess, let bytes = value as? Data, bytes.count == 32 else { throw McpAuthorityFailure() }; return SymmetricKey(data: bytes)
    }
    private func createKey(_ scope: String) throws {
        guard try !hasKey(scope) else { throw McpAuthorityFailure() }; let key = SymmetricKey(size: .bits256)
        var item = try query(scope); item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly; item[kSecValueData as String] = key.withUnsafeBytes { Data($0) }
        guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw McpAuthorityFailure() }
    }
    private func hasFile(_ scope: String) throws -> Bool {
        let destination = try file(scope); if files.fileExists(atPath: destination.path) { return true }
        return try files.contentsOfDirectory(at: root(), includingPropertiesForKeys: nil).contains(where: { $0.lastPathComponent.hasPrefix(".new-" + scope + "-") })
    }
    private func aad(_ scope: String) throws -> Data { try McpAuthorityState.scope(scope); return Data(("KeepAny/MCP/authority/v1/" + scope).utf8) }
    private func readUnlocked(_ scope: String) throws -> McpAuthoritySnapshot {
        guard try hasFile(scope), try hasKey(scope) else { throw McpAuthorityFailure() }
        let location = try file(scope), attributes = try location.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard attributes.isRegularFile == true, attributes.isSymbolicLink != true, let size = attributes.fileSize, size >= 32, size <= McpAuthorityState.envelopeMaximum + 32 else { throw McpAuthorityFailure() }
        let encrypted = try Data(contentsOf: location)
        guard encrypted.count <= McpAuthorityState.envelopeMaximum + 32, encrypted.prefix(4) == Data("KMA1".utf8) else { throw McpAuthorityFailure() }
        let box = try AES.GCM.SealedBox(combined: encrypted.dropFirst(4))
        var plain = try AES.GCM.open(box, using: key(scope), authenticating: aad(scope)); defer { plain.resetBytes(in: 0..<plain.count) }
        return try McpAuthorityState.unpack(plain)
    }
    private func writeUnlocked(_ scope: String, _ state: McpAuthoritySnapshot) throws {
        var plain = try McpAuthorityState.frame(state); defer { plain.resetBytes(in: 0..<plain.count) }
        guard plain.count <= McpAuthorityState.envelopeMaximum, let box = try AES.GCM.seal(plain, using: key(scope), authenticating: aad(scope)).combined else { throw McpAuthorityFailure() }
        let ciphertext = Data("KMA1".utf8) + box, destination = try file(scope), temporary = try root().appendingPathComponent(".new-" + scope + "-" + UUID().uuidString.lowercased())
        guard files.createFile(atPath: temporary.path, contents: nil, attributes: [.posixPermissions: 0o600, .protectionKey: FileProtectionType.complete]) else { throw McpAuthorityFailure() }
        do {
            let output = try FileHandle(forWritingTo: temporary)
            do { try output.write(contentsOf: ciphertext); try output.synchronize(); try output.close() } catch { try? output.close(); throw error }
            if files.fileExists(atPath: destination.path) { _ = try files.replaceItemAt(destination, withItemAt: temporary) }
            else { try files.moveItem(at: temporary, to: destination) }
        } catch { if files.fileExists(atPath: temporary.path) { try? files.removeItem(at: temporary) }; throw McpAuthorityFailure() }
        guard try readUnlocked(scope).revision == state.revision else { throw McpAuthorityFailure() }
    }
    func initialize(_ scope: String) throws {
        Self.lock.lock(); defer { Self.lock.unlock() }; try McpAuthorityState.scope(scope)
        let file = try hasFile(scope), key = try hasKey(scope); guard file == key else { throw McpAuthorityFailure() }
        if !file {
            do { try createKey(scope); try writeUnlocked(scope, McpAuthorityState.snapshot(UUID().uuidString.lowercased(), McpAuthorityState.empty)) }
            catch {
                // Only this branch proved there was no previous file or key.
                // Never erase existing grants, nor a readable commit after an acknowledgement failure.
                if (try? readUnlocked(scope)) == nil { let location = try self.file(scope); if files.fileExists(atPath: location.path) { try? files.removeItem(at: location) }; _ = SecItemDelete(try query(scope) as CFDictionary) }
                throw McpAuthorityFailure()
            }
        }
        _ = try readUnlocked(scope)
    }
    func read(_ scope: String) throws -> McpAuthoritySnapshot { Self.lock.lock(); defer { Self.lock.unlock() }; return try readUnlocked(scope) }
    func compareAndSet(_ scope: String, _ expected: String, _ payload: String) throws -> Bool {
        Self.lock.lock(); defer { Self.lock.unlock() }; let current = try readUnlocked(scope); guard current.revision == expected else { return false }
        let next = try McpAuthorityState.snapshot(UUID().uuidString.lowercased(), payload); try writeUnlocked(scope, next); return true
    }
}
