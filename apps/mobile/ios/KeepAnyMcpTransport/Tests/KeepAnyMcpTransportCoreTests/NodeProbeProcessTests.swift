import XCTest
import Foundation
import Dispatch

private enum NodeProbeFixtureError: Error { case unavailable, setupFailed, cleanupFailed }

/// Real macOS Process/pipe cases, gated with the same explicit Node CI opt-in.
/// They neither use a fake Process/clock nor exercise the transport or assets.
final class NodeProbeProcessTests: XCTestCase {
    private var directory: URL?
    private var child: NodeProbeProcess?

    override func setUpWithError() throws {
        mcpCoreCaseStage("case-start", name: name)
        try super.setUpWithError()
        guard ProcessInfo.processInfo.environment["KEEPANY_NODE_MCP_PROBE_FILE"]?.hasPrefix("/") == true else {
            throw XCTSkip("The real Node process fixture must be explicitly configured")
        }
        let base = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().standardizedFileURL
        let own = base.appendingPathComponent("keepany-node-probe-helper-\(UUID().uuidString)", isDirectory: true)
        do { try FileManager.default.createDirectory(at: own, withIntermediateDirectories: false) }
        catch { throw NodeProbeFixtureError.setupFailed }
        directory = own
        mcpCoreCaseStage("case-setup-complete", name: name)
    }

    override func tearDownWithError() throws {
        mcpCoreCaseStage("case-teardown-before", name: name)
        defer { mcpCoreCaseStage("case-teardown-after", name: name) }
        child?.stop(); child = nil
        if let own = directory {
            let base = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().standardizedFileURL
            guard own.deletingLastPathComponent().standardizedFileURL == base,
                  own.lastPathComponent.hasPrefix("keepany-node-probe-helper-") else {
                throw NodeProbeFixtureError.cleanupFailed
            }
            do { try FileManager.default.removeItem(at: own) }
            catch { throw NodeProbeFixtureError.cleanupFailed }
        }
        directory = nil
        try super.tearDownWithError()
    }

    private func launch(_ source: String, arguments: [URL] = []) throws -> NodeProbeProcess {
        guard let own = directory else { throw NodeProbeFixtureError.unavailable }
        let file = own.appendingPathComponent("fixture.cjs")
        do { try Data(source.utf8).write(to: file, options: .atomic) }
        catch { throw NodeProbeFixtureError.setupFailed }
        let value = try NodeProbeProcess(executableURL: URL(fileURLWithPath: "/usr/bin/env"),
                                         arguments: ["node", file.path] + arguments.map(\.path), workingDirectory: own)
        child = value
        return value
    }

    private func waitForOwnMarker(_ file: URL, timeout: TimeInterval = 10) -> Bool {
        let deadline = DispatchTime.now().uptimeNanoseconds + UInt64(timeout * 1_000_000_000)
        repeat {
            if FileManager.default.fileExists(atPath: file.path) { return true }
            Thread.sleep(forTimeInterval: 0.01)
        } while DispatchTime.now().uptimeNanoseconds < deadline
        return false
    }

    func testInputEOFParallelOutputAndActualExitStatus() throws {
        let process = try launch("""
            const chunks = [];
            process.stdin.on('data', chunk => chunks.push(chunk));
            process.stdin.on('end', () => {
              if (Buffer.concat(chunks).toString('utf8') !== 'synthetic-input') { process.exitCode = 3; return; }
              process.stdout.write('synthetic-stdout');
              process.stderr.write('synthetic-stderr');
              process.exitCode = 7;
            });
            """)
        try process.writeInput(Data("synthetic-input".utf8))
        let result = try process.finish(timeout: 10)
        XCTAssertEqual(result.status, 7)
        XCTAssertEqual(result.stdout, Data("synthetic-stdout".utf8))
        XCTAssertEqual(result.stderr, Data("synthetic-stderr".utf8))
        process.stop(); process.stop()
    }

    func testParentDeadlineKillsARealChildThatObservedAndIgnoredTERM() throws {
        let own = try XCTUnwrap(directory)
        let ready = own.appendingPathComponent("ready"), term = own.appendingPathComponent("term-observed")
        let process = try launch("""
            const fs = require('node:fs');
            process.on('SIGTERM', () => fs.writeFileSync(process.argv[3], 'synthetic-term-observed'));
            fs.writeFileSync(process.argv[2], 'synthetic-ready');
            setInterval(() => {}, 1000);
            """, arguments: [ready, term])
        try process.writeInput(Data())
        guard waitForOwnMarker(ready) else { throw NodeProbeFixtureError.setupFailed }
        let began = DispatchTime.now().uptimeNanoseconds
        XCTAssertThrowsError(try process.finish(timeout: 0.2)) { error in
            XCTAssertEqual(error as? NodeProbeProcessError, NodeProbeProcessError.timedOut)
        }
        let elapsed = Double(DispatchTime.now().uptimeNanoseconds - began) / 1_000_000_000
        // The ready marker follows installing the actual signal handler, and
        // TERM's marker proves this was not a cold-start default TERM exit.
        XCTAssertTrue(FileManager.default.fileExists(atPath: term.path))
        XCTAssertEqual(try Data(contentsOf: term), Data("synthetic-term-observed".utf8))
        XCTAssertGreaterThanOrEqual(elapsed, 2)
        XCTAssertLessThan(elapsed, 8)
        process.stop(); process.stop()
    }

    func testBothLargePipesDrainAndReportTheCaptureLimit() throws {
        let own = try XCTUnwrap(directory), marker = own.appendingPathComponent("both-writes-completed")
        let process = try launch("""
            const fs = require('node:fs');
            process.stdin.resume();
            process.stdin.on('end', () => {
              let remaining = 2;
              const completed = () => { if (--remaining === 0) fs.writeFileSync(process.argv[2], 'synthetic-both-writes-completed'); };
              process.stdout.write(Buffer.alloc(1024 * 1024 + 65536, 79), completed);
              process.stderr.write(Buffer.alloc(1024 * 1024 + 65536, 69), completed);
            });
            """, arguments: [marker])
        try process.writeInput(Data("synthetic-input".utf8))
        XCTAssertThrowsError(try process.finish(timeout: 20)) { error in
            XCTAssertEqual(error as? NodeProbeProcessError, NodeProbeProcessError.outputLimit)
        }
        XCTAssertEqual(try Data(contentsOf: marker), Data("synthetic-both-writes-completed".utf8))
        process.stop(); process.stop()
    }
}
