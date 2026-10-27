import Foundation
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

/// Opt-in test diagnostics only. Append a complete safe metadata event without
/// depending on SwiftPM forwarding the child process's stdout/stderr buffers.
enum StageTrace {
    private static let lock = NSLock()

    static func caseEvent(_ event: String, name: String) {
        emit(event: event, caseName: name, probeID: nil)
    }
    static func probeEvent(_ event: String, id: String) {
        emit(event: event, caseName: nil, probeID: id)
    }

    private static func emit(event: String, caseName: String?, probeID: String?) {
        lock.lock()
        defer { lock.unlock() }
        let pid = ProcessInfo.processInfo.processIdentifier
        let uptime = ProcessInfo.processInfo.systemUptime
        var row: [String: Any] = ["pid": pid, "uptime": uptime, "event": event]
        let line: String
        if let caseName {
            row["caseName"] = caseName
            line = "KeepAny Core case \(event) pid=\(pid) uptime=\(uptime) name=\(caseName)\n"
        } else {
            let id = probeID ?? "unknown"
            row["probeId"] = id
            line = "KeepAny TLS probe [\(id)] \(event)\n"
        }
        // Persist first if enabled, so stderr backpressure cannot hide this
        // event from the independently collected file.
        defer { FileHandle.standardError.write(Data(line.utf8)) }
        guard let path = ProcessInfo.processInfo.environment["KEEPANY_MCP_STAGE_FILE"] else { return }
        guard (path as NSString).isAbsolutePath else { unavailable(); return }

        // O_APPEND avoids truncating an existing trace and requires no file
        // reads. The parent creates the directory; only this opt-in file opens.
        let descriptor = path.withCString { open($0, O_WRONLY | O_CREAT | O_APPEND, mode_t(S_IRUSR | S_IWUSR)) }
        guard descriptor >= 0 else { unavailable(); return }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        do {
            var data = try JSONSerialization.data(withJSONObject: row, options: [.sortedKeys])
            data.append(0x0a)
            try handle.write(contentsOf: data)
            try handle.synchronize()
            try handle.close()
        } catch {
            try? handle.close()
            unavailable()
        }
    }

    private static func unavailable() {
        // Diagnostic failure never changes, skips or accepts a test result.
        // No path, exception value or application data is echoed.
        FileHandle.standardError.write(Data("KeepAny MCP stage trace unavailable\n".utf8))
    }
}
