import { spawn } from "node:child_process";
import { join } from "node:path";
import { materializeCandidate, selectCandidate } from "./lib/portable-candidate.mjs";

// Serve a verified compiled candidate through its shipped server; no source fallback.
const candidate = materializeCandidate(selectCandidate());
let stopping = false;
const child = spawn(process.execPath, [join(candidate.directory, "preview-server.mjs"), "start", "--port", process.env.KEEPANY_RELEASE_TEST_PORT ?? "4391", "--no-open"], { cwd: candidate.directory, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopping = true; child.kill(signal); });
child.on("error", error => { console.error(error); candidate.cleanup(); process.exitCode = 1; });
child.on("exit", code => { candidate.cleanup(); process.exitCode = stopping ? 0 : code ?? 1; });
