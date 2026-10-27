import Foundation
import Dispatch
import Darwin

enum NodeProbeProcessError: Error, Equatable {
    case launchFailed, inputFailed, outputFailed, outputLimit, invalidTimeout, timedOut, stopped, cleanupFailed
}

/// Test-only owner of one successfully spawned child. No shell, process-group
/// signal, global signal handler, or caller-owned descriptor is used here.
final class NodeProbeProcess {
    private let child: ProbeChild
    private let input: ProbePipe
    private let output: ProbePipe
    private let diagnostic: ProbePipe
    private let lock = NSLock()
    private let cleanupDone = DispatchGroup()
    private var stopping = false
    private var cleanupFailed = false
    private var inputClaimed = false

    init(executableURL: URL, arguments: [String], workingDirectory: URL) throws {
        let process = Process(), stdin = Pipe(), stdout = Pipe(), stderr = Pipe()
        let handles = [stdin.fileHandleForReading, stdin.fileHandleForWriting,
                       stdout.fileHandleForReading, stdout.fileHandleForWriting,
                       stderr.fileHandleForReading, stderr.fileHandleForWriting]
        // Per-descriptor SIGPIPE suppression, including pipes; never changes
        // the test runner's process-wide signal disposition.
        guard fcntl(stdin.fileHandleForWriting.fileDescriptor, F_SETNOSIGPIPE, 1) == 0 else {
            for handle in handles { try? handle.close() }
            throw NodeProbeProcessError.launchFailed
        }
        let child = ProbeChild(process)
        process.executableURL = executableURL
        process.arguments = arguments
        process.currentDirectoryURL = workingDirectory
        process.standardInput = stdin; process.standardOutput = stdout; process.standardError = stderr
        process.terminationHandler = { [weak child] value in child?.exited(value.terminationStatus) }
        do { try process.run() }
        catch {
            process.terminationHandler = nil
            child.exited(-1) // Balance the private exit latch; no child was started.
            for handle in handles { try? handle.close() }
            throw NodeProbeProcessError.launchFailed
        }
        child.started()
        // Foundation may already close these parent copies after spawning.
        try? stdin.fileHandleForReading.close()
        try? stdout.fileHandleForWriting.close()
        try? stderr.fileHandleForWriting.close()
        // These initializers cannot throw. Work captures only independent pipe
        // state, never this partially initialized owner or its Process.
        self.child = child
        input = ProbePipe(stdin.fileHandleForWriting, reading: false)
        output = ProbePipe(stdout.fileHandleForReading, reading: true)
        diagnostic = ProbePipe(stderr.fileHandleForReading, reading: true)
        cleanupDone.enter()
    }

    deinit { stop() }

    /// The probe accepts at most 24KB of public certificate JSON. Async pipe IO
    /// also bounds this phase if a launched loader never starts reading stdin.
    func writeInput(_ data: Data) throws {
        lock.lock()
        let allowed = !stopping && !inputClaimed && data.count <= 24_000
        if allowed { inputClaimed = true }
        lock.unlock()
        guard allowed else { try failAfterStopping(.inputFailed) }
        if !data.isEmpty {
            input.write(data)
            guard input.wait(until: .now() + 20), !input.snapshot().failed else {
                try failAfterStopping(.inputFailed)
            }
        }
        input.close(abort: false) // Deliver EOF only after the whole write.
        guard input.waitForCleanup(until: .now() + 2) else {
            try failAfterStopping(.cleanupFailed)
        }
    }

    /// timeout is a monotonic parent-side bound shared by exit and both EOFs.
    /// On timeout, bounded TERM/KILL and descriptor cleanup adds at most 6s.
    func finish(timeout: TimeInterval = 20) throws -> (status: Int32, stdout: Data, stderr: Data) {
        let now = DispatchTime.now().uptimeNanoseconds
        let nanoseconds = timeout * 1_000_000_000
        guard timeout.isFinite, timeout >= 0, nanoseconds < Double(UInt64.max - now) else {
            try failAfterStopping(.invalidTimeout)
        }
        let deadline = DispatchTime(uptimeNanoseconds: now + UInt64(nanoseconds))
        lock.lock(); let wasStopped = stopping; lock.unlock()
        guard !wasStopped else { throw NodeProbeProcessError.stopped }
        guard child.wait(until: deadline), output.wait(until: deadline), diagnostic.wait(until: deadline) else {
            try failAfterStopping(.timedOut)
        }
        let stdout = output.snapshot(), stderr = diagnostic.snapshot()
        let status = child.status()
        stop()
        lock.lock(); let failedCleanup = cleanupFailed; lock.unlock()
        guard !failedCleanup, let status else { throw NodeProbeProcessError.cleanupFailed }
        guard !stdout.overflow, !stderr.overflow else { throw NodeProbeProcessError.outputLimit }
        guard !stdout.failed, !stderr.failed else { throw NodeProbeProcessError.outputFailed }
        return (status, stdout.data, stderr.data)
    }

    private func failAfterStopping(_ error: NodeProbeProcessError) throws -> Never {
        stop()
        lock.lock(); let failed = cleanupFailed; lock.unlock()
        throw failed ? NodeProbeProcessError.cleanupFailed : error
    }

    /// Idempotent, including concurrent cleanup and deinit. It only signals the
    /// captured Process if that successful child is still running.
    func stop() {
        lock.lock()
        if stopping {
            lock.unlock()
            _ = cleanupDone.wait(timeout: .now() + 7)
            return
        }
        stopping = true
        lock.unlock()
        input.close(abort: true)
        child.terminate()
        if !child.wait(until: .now() + 2) {
            child.kill()
        }
        let exited = child.wait(until: .now() + 2)
        output.close(abort: true); diagnostic.close(abort: true)
        let cleanupDeadline = DispatchTime.now() + 2
        let inputClosed = input.waitForCleanup(until: cleanupDeadline)
        let outputClosed = output.waitForCleanup(until: cleanupDeadline)
        let diagnosticClosed = diagnostic.waitForCleanup(until: cleanupDeadline)
        lock.lock()
        cleanupFailed = !exited || !inputClosed || !outputClosed || !diagnosticClosed
        lock.unlock()
        cleanupDone.leave()
    }
}

private final class ProbeChild {
    private let process: Process
    private let lock = NSLock()
    private let done = DispatchGroup()
    private var pid: pid_t?
    private var result: Int32?

    init(_ process: Process) { self.process = process; done.enter() }
    func started() { lock.lock(); pid = process.processIdentifier; lock.unlock() }
    func exited(_ status: Int32) {
        lock.lock()
        let first = result == nil
        if first { result = status }
        lock.unlock()
        if first { done.leave() }
    }
    func status() -> Int32? { lock.lock(); defer { lock.unlock() }; return result }
    func wait(until deadline: DispatchTime) -> Bool { done.wait(timeout: deadline) == .success }
    func terminate() {
        lock.lock(); defer { lock.unlock() }
        if pid != nil, process.isRunning { process.terminate() }
    }
    func kill() {
        lock.lock(); defer { lock.unlock() }
        if let pid, pid > 0, process.isRunning, process.processIdentifier == pid {
            _ = Darwin.kill(pid, SIGKILL)
        }
    }
}

/// DispatchIO drains stdout/stderr independently without blocking a read-to-EOF
/// thread. STOP cancels a pipe even if a descendant retains an inherited end.
private final class ProbePipe {
    private let channel: DispatchIO
    private let state: ProbePipeState
    private let queue: DispatchQueue
    private let lock = NSLock()
    private var closing = false

    init(_ handle: FileHandle, reading: Bool) {
        let state = ProbePipeState(), queue = DispatchQueue(label: "keepany.test.node-probe.pipe")
        let channel = DispatchIO(type: .stream, fileDescriptor: handle.fileDescriptor, queue: queue) { error in
            var closeFailed = false
            do { try handle.close() } catch { closeFailed = true }
            state.completeCleanup(error: error, closeFailed: closeFailed)
        }
        self.state = state; self.queue = queue; self.channel = channel
        channel.setLimit(lowWater: 1)
        channel.setLimit(highWater: 16 * 1024)
        if reading {
            state.begin()
            channel.read(offset: 0, length: Int.max, queue: queue) { done, bytes, error in
                if let bytes { state.append(bytes) }
                if done { state.complete(error: error) }
            }
        }
    }
    func write(_ data: Data) {
        let bytes = data.withUnsafeBytes { (buffer: UnsafeRawBufferPointer) in DispatchData(bytes: buffer) }
        let state = self.state
        state.begin()
        channel.write(offset: 0, data: bytes, queue: queue) { done, _, error in
            if done { state.complete(error: error) }
        }
    }
    func close(abort: Bool) {
        lock.lock()
        let first = !closing
        closing = true
        lock.unlock()
        if first { channel.close(flags: abort ? .stop : []) }
    }
    func wait(until deadline: DispatchTime) -> Bool { state.done.wait(timeout: deadline) == .success }
    func waitForCleanup(until deadline: DispatchTime) -> Bool {
        state.cleaned.wait(timeout: deadline) == .success && !state.cleanupHasFailed()
    }
    func snapshot() -> (data: Data, failed: Bool, overflow: Bool) { state.snapshot() }
}

private final class ProbePipeState {
    let done = DispatchGroup(), cleaned = DispatchGroup()
    private let lock = NSLock()
    private var bytes = Data(), failed = false, overflow = false, begun = false, completed = false, cleanupFailed = false
    init() { cleaned.enter() }
    func begin() {
        lock.lock(); defer { lock.unlock() }
        if !begun { begun = true; done.enter() }
    }
    func completeCleanup(error: Int32, closeFailed: Bool) {
        lock.lock(); cleanupFailed = error != 0 || closeFailed; lock.unlock()
        cleaned.leave()
    }
    func cleanupHasFailed() -> Bool { lock.lock(); defer { lock.unlock() }; return cleanupFailed }
    func append(_ data: DispatchData) {
        lock.lock(); defer { lock.unlock() }
        let remaining = 1024 * 1024 - bytes.count
        if data.count > remaining { overflow = true }
        // Continue draining after the 1MiB-per-stream cap so a full diagnostic
        // pipe cannot block the child or grow the test runner without bound.
        bytes.append(contentsOf: data.prefix(max(0, remaining)))
    }
    func complete(error: Int32) {
        lock.lock()
        if error != 0 { failed = true }
        let first = begun && !completed
        completed = true
        lock.unlock()
        if first { done.leave() }
    }
    func snapshot() -> (data: Data, failed: Bool, overflow: Bool) {
        lock.lock(); defer { lock.unlock() }
        return (bytes, failed, overflow)
    }
}
