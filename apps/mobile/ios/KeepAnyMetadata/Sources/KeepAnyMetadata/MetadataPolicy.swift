import Foundation
import Darwin

enum MetadataFailure: Error {
    case code(String)
    case redirect(String)
    var safeCode: String {
        if case .code(let value) = self { return value }
        return "metadata-redirect"
    }
}

enum MetadataPolicy {
    static let maxBytes = 1024 * 1024
    static let timeoutNanoseconds: UInt64 = 8_000_000_000

    static func target(_ input: String) throws -> URL {
        guard !input.isEmpty, input.utf16.count <= 2048,
              var components = URLComponents(string: input),
              ["http", "https"].contains(components.scheme?.lowercased() ?? ""),
              components.user == nil, components.password == nil,
              let host = components.host, !host.isEmpty else { throw MetadataFailure.code("metadata-url") }
        if host.contains(":"), !publicAddress(host.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))) {
            throw MetadataFailure.code("metadata-private")
        }
        components.fragment = nil
        guard let url = components.url else { throw MetadataFailure.code("metadata-url") }
        return url
    }

    static func publicBytes(_ bytes: [UInt8], family: Int32) -> Bool {
        if family == AF_INET, bytes.count == 4 {
            let a = Int(bytes[0]), b = Int(bytes[1]), c = Int(bytes[2])
            return !(a == 0 || a == 10 || a == 127 || a >= 224 ||
                (a == 100 && (64...127).contains(b)) || (a == 169 && b == 254) ||
                (a == 172 && (16...31).contains(b)) || (a == 192 && b == 168) ||
                (a == 192 && b == 0 && (c == 0 || c == 2)) || (a == 192 && b == 88 && c == 99) ||
                (a == 198 && (b == 18 || b == 19)) || (a == 198 && b == 51 && c == 100) ||
                (a == 203 && b == 0 && c == 113))
        }
        if family == AF_INET6, bytes.count == 16 {
            let first = Int(bytes[0]) * 256 + Int(bytes[1]), second = Int(bytes[2]) * 256 + Int(bytes[3])
            return (0x2000...0x3fff).contains(first) && first != 0x2002 &&
                !(first == 0x2001 && (second < 0x200 || second == 0xdb8))
        }
        return false
    }

    static func publicAddress(_ input: String) -> Bool {
        var v4 = in_addr(), v6 = in6_addr()
        if inet_pton(AF_INET, input, &v4) == 1 {
            return withUnsafeBytes(of: v4) { publicBytes(Array($0), family: AF_INET) }
        }
        if inet_pton(AF_INET6, input, &v6) == 1 {
            return withUnsafeBytes(of: v6) { publicBytes(Array($0), family: AF_INET6) }
        }
        return false
    }

    static func address(_ host: String) throws -> String {
        var hints = addrinfo()
        hints.ai_family = AF_UNSPEC
        hints.ai_socktype = SOCK_STREAM
        var result: UnsafeMutablePointer<addrinfo>?
        guard getaddrinfo(host, nil, &hints, &result) == 0, let first = result else { throw MetadataFailure.code("metadata-network") }
        defer { freeaddrinfo(first) }
        var current: UnsafeMutablePointer<addrinfo>? = first, addresses: [String] = []
        while let item = current {
            defer { current = item.pointee.ai_next }
            let family = item.pointee.ai_family
            var numeric = [CChar](repeating: 0, count: Int(INET6_ADDRSTRLEN))
            let text: String
            if family == AF_INET, let value = item.pointee.ai_addr {
                var address = UnsafeRawPointer(value).assumingMemoryBound(to: sockaddr_in.self).pointee.sin_addr
                guard inet_ntop(AF_INET, &address, &numeric, socklen_t(numeric.count)) != nil else { throw MetadataFailure.code("metadata-network") }
                text = String(cString: numeric)
            } else if family == AF_INET6, let value = item.pointee.ai_addr {
                var address = UnsafeRawPointer(value).assumingMemoryBound(to: sockaddr_in6.self).pointee.sin6_addr
                guard inet_ntop(AF_INET6, &address, &numeric, socklen_t(numeric.count)) != nil else { throw MetadataFailure.code("metadata-network") }
                text = String(cString: numeric)
            } else { throw MetadataFailure.code("metadata-private") }
            guard publicAddress(text) else { throw MetadataFailure.code("metadata-private") }
            addresses.append(text)
        }
        guard let selected = addresses.first else { throw MetadataFailure.code("metadata-private") }
        return selected
    }
}
