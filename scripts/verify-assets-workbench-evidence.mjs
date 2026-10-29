import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readCandidate, selectCandidate } from "./lib/portable-candidate.mjs";

const check = (condition, reason) => { if (!condition) throw Error(reason); };
const read = path => JSON.parse(readFileSync(path, "utf8"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const evidence = resolve(process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/assets-workbench/evidence");
const reportPath = resolve(process.env.KEEPANY_ASSETS_REPORT ?? "test-results/assets-workbench/results.json");
const candidate = readCandidate(selectCandidate());
const raw = read(join(evidence, "candidate.json"));
check(raw.input === candidate.input && raw.sourceCommit === candidate.release.sourceCommit && raw.sourceDirty === candidate.release.sourceDirty,
  "Asset evidence candidate identity mismatch.");
check(JSON.stringify(raw.webFiles) === JSON.stringify(candidate.release.webFiles), "Asset evidence web manifest mismatch.");
const report = read(reportPath);
const specs = report.suites.flatMap(suite => suite.specs ?? []);
check(specs.length === 8 && report.stats.expected === 8 && report.stats.unexpected === 0 && report.stats.skipped === 0 && report.stats.flaky === 0,
  "Asset report is incomplete, failed, skipped or flaky.");
const groups = [
  "AS01 AS02 AS03 AS04 AS05 AS09", "AS06 AS07", "AS01 AS02 AS06", "AS08",
];
for (const locale of ["zh-CN", "en"]) for (const group of groups) {
  const matched = specs.filter(spec => spec.title.startsWith(`${group} ${locale}:`));
  check(matched.length === 1 && matched[0].ok, `Missing asset case: ${group} ${locale}`);
  const tests = matched[0].tests;
  check(tests.length === 1 && tests[0].status === "expected" && tests[0].results.length === 1 &&
    tests[0].results[0].status === "passed" && tests[0].results[0].retry === 0, `Asset case was retried or did not pass: ${group} ${locale}`);
}
const screenshots = [];
for (const locale of ["zh-CN", "en"]) for (const width of [390, 768, 1280, 1920, 2560]) {
  for (const state of ["overview", "online-cards", "online-expanded-filters", "create-dialog", "physical-cards", "physical-state-menu", "ledger-fields", "ledger-error"]) {
    const path = `${locale}-${width}-${state}.png`, bytes = readFileSync(join(evidence, path));
    check(bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.readUInt32BE(16) === width && bytes.readUInt32BE(20) >= 1000,
      `Asset screenshot missing or wrong dimensions: ${path}`);
    screenshots.push({ locale, width, state, path, sha256: sha(bytes), height: bytes.readUInt32BE(20) });
  }
}
const ids = Array.from({ length: 9 }, (_, index) => `AS${String(index + 1).padStart(2, "0")}`);
const receipt = {
  schema: "keepany.assets-workbench.machine.v1",
  scope: "Machine black-box and screenshot integrity only. Human visual review, owner experience and independent review are recorded separately.",
  candidate: { input: candidate.input, sourceCommit: candidate.release.sourceCommit, sourceDirty: candidate.release.sourceDirty,
    indexSha256: candidate.release.webFiles.find(file => file.path === "index.html").sha256 },
  report: { path: reportPath, sha256: sha(readFileSync(reportPath)), stats: report.stats, retries: 0 },
  cases: ids.map(id => ({ id, machineResult: "passed", tests: specs.filter(spec => spec.title.split(":")[0].split(" ").includes(id)).map(spec => spec.title), manualVisualResult: "separate-record-required" })),
  screenshots,
};
writeFileSync(join(evidence, "AS01-AS09-machine-results.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log("AS01-AS09 machine evidence passed; candidate and required screenshot states match. Human acceptance is not inferred.");
