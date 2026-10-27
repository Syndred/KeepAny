import Foundation
import NIOHTTP1

enum HTTPPolicy {
    static let requestLimit = 1_000_000, responseLimit = 8 * 1024 * 1024, chunkLimit = 256 * 1024
    static let headerLimit = 16 * 1024, headerCount = 64
    static let responseAllowed: Set<String> = ["content-type", "cache-control", "x-content-type-options", "mcp-session-id", "mcp-protocol-version", "allow", "www-authenticate", "retry-after", "vary", "access-control-allow-origin", "access-control-expose-headers"]
    static let singular: Set<String> = ["host", "authorization", "content-length", "content-type", "origin", "transfer-encoding"]
    static func token(_ text: String) -> Bool {
        let allowed = Set("abcdefghijklmnopqrstuvwxyz0123456789!#$%&'*+.^_`|~-")
        return !text.isEmpty && text.allSatisfy { allowed.contains($0) }
    }
    static func value(_ text: String) -> Bool {
        !text.utf8.contains { $0 == 0 || $0 == 10 || $0 == 13 || $0 < 32 && $0 != 9 || $0 == 127 }
    }
    static func request(_ head: HTTPRequestHead) throws -> (host: String, headers: [String: String], length: Int?) {
        guard head.method == .POST, head.version == .http1_1,
              head.uri == "/mcp" || head.uri == "/pair", head.headers.count <= headerCount else { throw McpTransportError.invalid }
        var headers: [String: String] = [:], count = 0
        for (rawName, text) in head.headers {
            let name = rawName.lowercased()
            count += rawName.utf8.count + text.utf8.count + 4
            guard rawName.utf8.allSatisfy({ $0 < 128 }), token(name), value(text), count <= headerLimit,
                  !(singular.contains(name) && headers[name] != nil) else { throw McpTransportError.invalid }
            if let prior = headers[name] { headers[name] = prior + ", " + text }
            else { headers[name] = text }
        }
        guard let host = headers["host"], !host.isEmpty, host.utf8.count <= 260,
              !host.contains(","), !host.contains("@"), !host.contains("/"), !host.contains("\\"),
              !host.contains(where: { $0.isWhitespace }),
              !(headers["content-length"] != nil && headers["transfer-encoding"] != nil),
              headers["expect"] == nil, headers["upgrade"] == nil else { throw McpTransportError.invalid }
        var length: Int?
        if let text = headers["content-length"] {
            guard !text.isEmpty, text.utf8.allSatisfy({ (48...57).contains($0) }), let bytes = Int(text), bytes <= requestLimit else { throw McpTransportError.limit }
            length = bytes
        }
        // Only NIO-decoded, finite chunking is accepted; no extension codings or
        // trailers. Origin and Cookie stay in headers for the TS policy to deny.
        if let encoding = headers["transfer-encoding"], encoding.lowercased() != "chunked" { throw McpTransportError.invalid }
        return (host, headers, length)
    }
    static func response(status: Int, headers: [String: String]) throws {
        guard (200..<600).contains(status), !(300..<400).contains(status), headers.count <= headerCount else { throw McpTransportError.invalid }
        var size = 0
        for (name, text) in headers {
            size += name.utf8.count + text.utf8.count + 4
            guard token(name), responseAllowed.contains(name), value(text), size <= headerLimit else { throw McpTransportError.invalid }
        }
    }
}
