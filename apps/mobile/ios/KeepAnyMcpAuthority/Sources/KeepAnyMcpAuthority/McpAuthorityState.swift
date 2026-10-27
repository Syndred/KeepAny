import Foundation
import CoreFoundation

struct McpAuthorityFailure: Error {}
struct McpAuthoritySnapshot { let revision: String, payload: String }
enum McpAuthorityState {
    static let maximum = 2 * 1024 * 1024, envelopeMaximum = maximum + 4096
    static let empty = "{\"grants\":[],\"previews\":[],\"operations\":[],\"audit\":[]}"
    private static let reads: Set<String> = ["kind", "name", "category", "tags", "description", "url", "status", "dueDate"]
    private static let writes: Set<String> = ["name", "category", "tags", "description", "url"]
    static func scope(_ value: String) throws { guard value.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw McpAuthorityFailure() } }
    static func object(_ text: String, maximum: Int) throws -> [String: Any] {
        guard text.utf8.count <= maximum else { throw McpAuthorityFailure() }; let data = Data(text.utf8)
        var depth = 0, quoted = false, escape = false
        for byte in data {
            if quoted { if escape { escape = false } else if byte == 92 { escape = true } else if byte == 34 { quoted = false } }
            else if byte == 34 { quoted = true }
            else if byte == 123 || byte == 91 { depth += 1; guard depth <= 8 else { throw McpAuthorityFailure() } }
            else if byte == 125 || byte == 93 { depth -= 1; guard depth >= 0 else { throw McpAuthorityFailure() } }
        }
        guard !quoted, depth == 0, let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw McpAuthorityFailure() }; return object
    }
    private static func fields(_ row: [String: Any], _ required: Set<String>, _ optional: Set<String> = []) throws {
        let keys = Set(row.keys); guard required.isSubset(of: keys), keys.isSubset(of: required.union(optional)), !row.values.contains(where: { $0 is NSNull }) else { throw McpAuthorityFailure() }
    }
    private static func string(_ row: [String: Any], _ key: String, _ pattern: String) throws -> String {
        guard let value = row[key] as? String, value.range(of: pattern, options: .regularExpression) != nil else { throw McpAuthorityFailure() }; return value
    }
    private static func uuid(_ row: [String: Any], _ key: String) throws -> String { try string(row, key, "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$") }
    private static func id(_ row: [String: Any], _ key: String) throws -> String { try string(row, key, "^[A-Za-z0-9_-]{1,96}$") }
    private static func operation(_ row: [String: Any], _ key: String) throws -> String { try string(row, key, "^[A-Za-z0-9_-]{8,96}$") }
    private static func hash(_ row: [String: Any], _ key: String) throws { _ = try string(row, key, "^[a-f0-9]{64}$") }
    @discardableResult private static func stamp(_ row: [String: Any], _ key: String) throws -> Double {
        guard let number = row[key] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { throw McpAuthorityFailure() }
        let value = number.doubleValue; guard value.isFinite, value >= 0, value <= 9007199254740991, value.rounded() == value else { throw McpAuthorityFailure() }; return value
    }
    private static func array(_ row: [String: Any], _ key: String, _ minimum: Int, _ maximum: Int) throws -> [Any] { guard let values = row[key] as? [Any], values.count >= minimum, values.count <= maximum else { throw McpAuthorityFailure() }; return values }
    private static func strings(_ row: [String: Any], _ key: String, _ minimum: Int, _ maximum: Int, _ allowed: Set<String>?) throws -> Set<String> {
        let values = try array(row, key, minimum, maximum); var seen = Set<String>()
        for value in values { guard let text = value as? String, seen.insert(text).inserted else { throw McpAuthorityFailure() }; if let allowed { guard allowed.contains(text) else { throw McpAuthorityFailure() } } else { guard text.range(of: "^[A-Za-z0-9_-]{1,96}$", options: .regularExpression) != nil else { throw McpAuthorityFailure() } } }; return seen
    }
    private static func row(_ value: Any) throws -> [String: Any] { guard let object = value as? [String: Any] else { throw McpAuthorityFailure() }; return object }
    private static func unique(_ seen: inout Set<String>, _ key: String) throws { guard seen.insert(key).inserted else { throw McpAuthorityFailure() } }
    static func checked(_ payload: String) throws -> [String: Any] {
        let state = try object(payload, maximum: maximum); try fields(state, ["grants", "previews", "operations", "audit"])
        var seen = Set<String>()
        for value in try array(state, "grants", 0, 1024) {
            let grant = try row(value); try fields(grant, ["id", "secretHash", "assetIds", "readFields", "writeFields", "createdAt", "expiresAt"], ["revokedAt"])
            try unique(&seen, uuid(grant, "id")); try hash(grant, "secretHash"); _ = try strings(grant, "assetIds", 1, 500, nil)
            let read = try strings(grant, "readFields", 1, 8, reads), write = try strings(grant, "writeFields", 0, 5, writes)
            guard write.isSubset(of: read), try stamp(grant, "expiresAt") > stamp(grant, "createdAt") else { throw McpAuthorityFailure() }; if grant["revokedAt"] != nil { try stamp(grant, "revokedAt") }
        }
        seen.removeAll(); var requests = Set<String>()
        for value in try array(state, "previews", 0, 2048) {
            let preview = try row(value); try fields(preview, ["id", "grantId", "operationId", "assetId", "expectedVersion", "patchHash", "expiresAt"], ["approvedAt", "rejectedAt"])
            try unique(&seen, uuid(preview, "id")); try unique(&requests, uuid(preview, "grantId") + ":" + operation(preview, "operationId")); _ = try id(preview, "assetId"); try hash(preview, "expectedVersion"); try hash(preview, "patchHash"); try stamp(preview, "expiresAt")
            if preview["approvedAt"] != nil { try stamp(preview, "approvedAt") }; if preview["rejectedAt"] != nil { try stamp(preview, "rejectedAt") }; guard preview["approvedAt"] == nil || preview["rejectedAt"] == nil else { throw McpAuthorityFailure() }
        }
        seen.removeAll()
        for value in try array(state, "operations", 0, 4096) {
            let receipt = try row(value); try fields(receipt, ["operationId", "grantId", "previewId", "patchHash", "assetId", "state", "createdAt"], ["completedAt"])
            try unique(&seen, uuid(receipt, "grantId") + ":" + operation(receipt, "operationId")); _ = try uuid(receipt, "previewId"); try hash(receipt, "patchHash"); _ = try id(receipt, "assetId"); try stamp(receipt, "createdAt")
            let status = try string(receipt, "state", "^(pending|applied)$"); guard status == "pending" ? receipt["completedAt"] == nil : receipt["completedAt"] != nil else { throw McpAuthorityFailure() }; if receipt["completedAt"] != nil { try stamp(receipt, "completedAt") }
        }
        seen.removeAll()
        for value in try array(state, "audit", 0, 8192) {
            let entry = try row(value); try fields(entry, ["id", "at", "grantId", "action", "outcome"], ["assetId", "fieldNames", "operationId"])
            try unique(&seen, uuid(entry, "id")); _ = try uuid(entry, "grantId"); try stamp(entry, "at"); _ = try string(entry, "action", "^(list|get|preview|confirm|grant|revoke|approve|reject)$"); _ = try string(entry, "outcome", "^(allowed|denied|applied|duplicate|conflict)$")
            if entry["assetId"] != nil { _ = try id(entry, "assetId") }; if entry["operationId"] != nil { _ = try operation(entry, "operationId") }; if entry["fieldNames"] != nil { _ = try strings(entry, "fieldNames", 0, 8, reads) }
        }
        return state
    }
    static func snapshot(_ revision: String, _ payload: String) throws -> McpAuthoritySnapshot {
        _ = try uuid(["revision": revision], "revision"); let canonical = try JSONSerialization.data(withJSONObject: checked(payload), options: [.sortedKeys])
        guard canonical.count <= maximum, let text = String(data: canonical, encoding: .utf8) else { throw McpAuthorityFailure() }; return McpAuthoritySnapshot(revision: revision, payload: text)
    }
    static func frame(_ state: McpAuthoritySnapshot) throws -> Data { let checked = try snapshot(state.revision, state.payload); return try JSONSerialization.data(withJSONObject: ["revision": checked.revision, "payload": self.checked(checked.payload)], options: [.sortedKeys]) }
    static func unpack(_ data: Data) throws -> McpAuthoritySnapshot {
        guard let text = String(data: data, encoding: .utf8) else { throw McpAuthorityFailure() }; let frame = try object(text, maximum: envelopeMaximum); try fields(frame, ["revision", "payload"])
        guard let value = frame["payload"] else { throw McpAuthorityFailure() }; let state = try row(value), canonical = try JSONSerialization.data(withJSONObject: state, options: [.sortedKeys]); guard let payload = String(data: canonical, encoding: .utf8) else { throw McpAuthorityFailure() }; return try snapshot(uuid(frame, "revision"), payload)
    }
}
