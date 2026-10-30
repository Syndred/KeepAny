import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { readCandidate, selectCandidate } from "./lib/portable-candidate.mjs";

const [argument, directory, ...extra] = process.argv.slice(2);
if (extra.length) throw Error("Usage: node scripts/check-account-entry.mjs [portable-zip] [new-evidence-directory]");
const candidate = readCandidate(selectCandidate({ argument, archiveOnly: true }));
const output = resolve(directory ?? "test-results/account-entry-ci");
if (existsSync(output) && readdirSync(output).length) throw Error("Use a new evidence directory; previous results are preserved.");
mkdirSync(output, { recursive: true });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const receipt = {
  schema: "keepany.account-entry-check.v1", input: candidate.input,
  sourceCommit: candidate.release.sourceCommit, sourceDirty: candidate.release.sourceDirty,
  archiveSha256: candidate.archiveSha256 ?? null,
  webManifestSha256: hash(Buffer.from(JSON.stringify(candidate.release.webFiles))),
  specSha256: hash(readFileSync("tests/e2e/unified-account-editor.spec.ts")),
  simpleSpecSha256: hash(readFileSync("tests/e2e/simple-account-relations.spec.ts")),
  compactSpecSha256: hash(readFileSync("tests/e2e/compact-accounts.spec.ts")),
  automatedCoverage: ["SR01", "SR02", "SR03", "SR04", "SR05", "SR06", "SR07", "UE01", "UE02", "UE03", "UE04", "UE05", "UE06", "UE07", "UE08", "UE09", "CC03", "CC04", "CC05", "CC09"],
  coverageNotes: { UE10: "Controller and independent actual candidate review remain separate.", supersedes: "SE01-SE16's earlier form workflow is retained as history; user now requires unlock before account management and direct merged editing." },
  manualVisualReview: "separate", controllerJourney: "separate", independentReview: "separate",
  verdict: "incomplete",
};
writeFileSync(join(output, "candidate.json"), JSON.stringify(receipt, null, 2));
const reportPath = join(output, "playwright.json");
const env = { ...process.env, KEEPANY_SIMPLE_ACCOUNT_EVIDENCE: join(output, "evidence"), KEEPANY_UNIFIED_EDITOR_EVIDENCE: join(output, "evidence"), KEEPANY_COMPACT_EVIDENCE: join(output, "evidence", "compact"), KEEPANY_INDEPENDENT_RESULTS: join(output, "browser"), KEEPANY_INDEPENDENT_REPORT: reportPath };
delete env.KEEPANY_PREVIEW_ARCHIVE;
delete env.KEEPANY_PREVIEW_DIRECTORY;
env[candidate.input.endsWith(".zip") ? "KEEPANY_PREVIEW_ARCHIVE" : "KEEPANY_PREVIEW_DIRECTORY"] = candidate.input;
const run = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config", "playwright.account-entry.config.ts"], { env, stdio: "inherit", timeout: 12 * 60_000 });
if (run.error || run.status !== 0) {
  writeFileSync(join(output, "result.json"), JSON.stringify({ ...receipt, exitCode: run.status, error: run.error?.message ?? null }, null, 2));
  process.exitCode = run.status || 1;
} else {
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const tests = [];
  const walk = suites => suites.forEach(suite => { for (const spec of suite.specs ?? []) tests.push(...spec.tests); walk(suite.suites ?? []); });
  walk(report.suites);
  if (report.errors?.length || tests.length !== 36 || tests.some(test => test.status !== "expected" || test.results.length !== 1 || test.results[0].status !== "passed")) throw Error("Account-entry coverage is missing, skipped, retried or failed.");
  const images = [];
  function collect(dir) { for (const file of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, file.name); if (file.isDirectory()) collect(path); else if (file.name.endsWith(".png")) images.push({ path: relative(output, path).replaceAll("\\", "/"), sha256: hash(readFileSync(path)) }); } }
  collect(join(output, "evidence"));
  const imageNames = new Set(images.map(image => image.path.split("/").at(-1)));
  for (const lang of ["zh-CN", "en"]) {
    for (const width of [390, 768, 1280, 1920, 2262]) {
      for (const state of ["card", "edit", "menu", "delete", "gate"]) if (!imageNames.has(`matrix-${state}-${lang}-${width}.png`)) throw Error(`Missing unified matrix: ${lang}/${width}/${state}`);
      for (const state of ["card", "detail", "impact", "graph", "edit"]) if (!imageNames.has(`simple-${state}-${lang}-${width}.png`)) throw Error(`Missing simple account evidence: ${lang}/${width}/${state}`);
      for (const state of ["normal", "locked"]) if (!imageNames.has(`matrix-${state}-${lang}-${width}.png`)) throw Error(`Missing compact evidence: ${lang}/${width}/${state}`);
    }
    for (const state of ["relation-fullscreen", "relation-expanded", "relation-after-delete", "private-detail", "unlock-single-status", "unified-edit", "selected-backup", "delete-restored", "ordinary-restored", "locked-editor", "validation-error", "partial-save", "purge-error", "imported-cards", "private-added", "entry-restored", "clipboard-failure", "query-return", "flow-switched", "flow-reloaded"]) if (!imageNames.has(`${state}-${lang}.png`)) throw Error(`Missing unified flow: ${lang}/${state}`);
  }
  writeFileSync(join(output, "result.json"), JSON.stringify({ ...receipt, verdict: "automated-pass", expectedTests: 36, completedTests: tests.length, retries: 0, images }, null, 2));
  console.log(`Account-entry machine checks passed for ${receipt.sourceCommit}. Manual visual review, controller journey and independent review remain separate.`);
}
