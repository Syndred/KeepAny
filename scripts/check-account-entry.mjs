import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { readCandidate, selectCandidate } from "./lib/portable-candidate.mjs";

const [argument, directory, ...extra] = process.argv.slice(2);
if (extra.length) throw Error("Usage: node scripts/check-account-entry.mjs [compiled-directory-or-zip] [new-evidence-directory]");
const candidate = readCandidate(selectCandidate({ argument }));
const output = resolve(directory ?? "test-results/account-entry-ci");
if (existsSync(output) && readdirSync(output).length) throw Error("Use a new evidence directory; previous results are preserved.");
mkdirSync(output, { recursive: true });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const receipt = {
  schema: "keepany.account-entry-check.v1", input: candidate.input,
  sourceCommit: candidate.release.sourceCommit, sourceDirty: candidate.release.sourceDirty,
  archiveSha256: candidate.archiveSha256 ?? null,
  webManifestSha256: hash(Buffer.from(JSON.stringify(candidate.release.webFiles))),
  specSha256: hash(readFileSync("tests/e2e/accounts-single-entry.spec.ts")),
  automatedCoverage: ["SE01", "SE02", "SE03", "SE04", "SE06", "SE07", "SE08"],
  manualVisualReview: "separate", controllerJourney: "separate", independentReview: "separate",
  verdict: "incomplete",
};
writeFileSync(join(output, "candidate.json"), JSON.stringify(receipt, null, 2));
const reportPath = join(output, "playwright.json");
const env = { ...process.env, KEEPANY_SINGLE_ENTRY_EVIDENCE: join(output, "evidence"), KEEPANY_INDEPENDENT_RESULTS: join(output, "browser"), KEEPANY_INDEPENDENT_REPORT: reportPath };
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
  if (report.errors?.length || tests.length !== 6 || tests.some(test => test.status !== "expected" || test.results.length !== 1 || test.results[0].status !== "passed")) throw Error("Account-entry coverage is missing, skipped, retried or failed.");
  const images = [];
  function collect(dir) { for (const file of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, file.name); if (file.isDirectory()) collect(path); else if (file.name.endsWith(".png")) images.push({ path: relative(output, path).replaceAll("\\", "/"), sha256: hash(readFileSync(path)) }); } }
  collect(join(output, "evidence"));
  const imageNames = new Set(images.map(image => image.path.split("/").at(-1)));
  for (const lang of ["zh-CN", "en"]) {
    for (const width of [390, 768, 1268, 1280, 1920, 2560]) {
      for (const state of ["empty", "account-expanded", "editor-default", "editor-expanded-error", "category-open"]) if (!imageNames.has(`matrix-${state}-${lang}-${width}.png`)) throw Error(`Missing matrix evidence: ${lang}/${width}/${state}`);
    }
    for (const state of ["complete-form", "bottom-trash"]) if (!imageNames.has(`journey-${state}-${lang}.png`)) throw Error(`Missing journey evidence: ${lang}/${state}`);
    if (!imageNames.has(`same-form-create-error-${lang}.png`)) throw Error(`Missing same-form error evidence: ${lang}`);
  }
  writeFileSync(join(output, "result.json"), JSON.stringify({ ...receipt, verdict: "automated-pass", expectedTests: 6, completedTests: tests.length, retries: 0, images }, null, 2));
  console.log(`Account-entry machine checks passed for ${receipt.sourceCommit}. Manual visual review, controller journey and independent review remain separate.`);
}
