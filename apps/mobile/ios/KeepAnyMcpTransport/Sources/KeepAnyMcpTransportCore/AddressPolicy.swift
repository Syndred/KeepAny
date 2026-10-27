import Foundation
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

public enum McpTransportError: Error { case unavailable, invalid, limit, stale }

enum AddressPolicy {
    static func octets(_ address: String) -> [UInt8]? {
        let parts = address.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return nil }
        let bytes = parts.compactMap { part -> UInt8? in
            guard !part.isEmpty, part.allSatisfy({ $0.isASCII && $0.isNumber }),
                  part.count == 1 || part.first != "0" else { return nil }
            return UInt8(part)
        }
        return bytes.count == 4 ? bytes : nil
    }
    static func allowed(_ address: String) -> Bool {
        guard let b = octets(address) else { return false }
        return address == "127.0.0.1" || b[0] == 10 || b[0] == 192 && b[1] == 168 || b[0] == 172 && (16...31).contains(b[1])
    }
    static func requireLocal(_ address: String) throws {
        guard allowed(address) else { throw McpTransportError.invalid }
        var first: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&first) == 0 else { throw McpTransportError.unavailable }
        defer { freeifaddrs(first) }
        var cursor = first
        while let item = cursor {
            defer { cursor = item.pointee.ifa_next }
            guard let socket = item.pointee.ifa_addr,
                  Int32(socket.pointee.sa_family) == AF_INET,
                  item.pointee.ifa_flags & UInt32(IFF_UP) != 0 else { continue }
            var value = socket.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee.sin_addr }
            var text = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
            if inet_ntop(AF_INET, &value, &text, socklen_t(text.count)) != nil,
               String(cString: text) == address { return }
        }
        throw McpTransportError.unavailable
    }
    /// Reserve an OS-selected port with bind only (never listen), then release
    /// it. Activation must later acquire this exact port or fail visibly.
    static func unusedPort(_ address: String) throws -> Int {
        #if canImport(Darwin)
        let descriptor = Darwin.socket(AF_INET, SOCK_STREAM, 0)
        #else
        let descriptor = Glibc.socket(AF_INET, Int32(SOCK_STREAM.rawValue), 0)
        #endif
        guard descriptor >= 0 else { throw McpTransportError.unavailable }
        defer {
            #if canImport(Darwin)
            Darwin.close(descriptor)
            #else
            Glibc.close(descriptor)
            #endif
        }
        var socket = sockaddr_in()
        #if canImport(Darwin)
        socket.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        #endif
        socket.sin_family = sa_family_t(AF_INET)
        guard inet_pton(AF_INET, address, &socket.sin_addr) == 1 else { throw McpTransportError.invalid }
        let bound = withUnsafePointer(to: &socket) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { address in
                #if canImport(Darwin)
                Darwin.bind(descriptor, address, socklen_t(MemoryLayout<sockaddr_in>.size))
                #else
                Glibc.bind(descriptor, address, socklen_t(MemoryLayout<sockaddr_in>.size))
                #endif
            }
        }
        guard bound == 0 else { throw McpTransportError.unavailable }
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        let result = withUnsafeMutablePointer(to: &socket) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { address in
                getsockname(descriptor, address, &length)
            }
        }
        guard result == 0 else { throw McpTransportError.unavailable }
        return Int(UInt16(bigEndian: socket.sin_port))
    }
}
