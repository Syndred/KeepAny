import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { materializeCandidate, selectCandidate } from "./lib/portable-candidate.mjs";

const [argument, evidenceArgument, ...extra] = process.argv.slice(2);
if (extra.length) throw Error("Usage: node scripts/check-account-layout.mjs <compiled-directory-or-zip> [evidence-directory]");
const candidate = materializeCandidate(selectCandidate({ argument }));
const evidence = resolve(evidenceArgument ?? process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/account-layout-ci");
const env = { ...process.env, KEEPANY_PREVIEW_DIRECTORY: candidate.directory, KEEPANY_FINAL_CANDIDATE: "1", KEEPANY_RELEASE_TEST_PORT: process.env.KEEPANY_RELEASE_TEST_PORT ?? "4230", KEEPANY_EVIDENCE_DIR: evidence, KEEPANY_LAYOUT_RUN_DIR: `${evidence}/run` };
delete env.KEEPANY_PREVIEW_ARCHIVE;
delete env.KEEPANY_LAYOUT_REUSE;
try {
 for (const [args, timeout] of [
  [["node_modules/@playwright/test/cli.js", "test", "--config", "playwright.account-layout.config.ts", "tests/e2e/account-password-layout.spec.ts"], 20 * 60_000],
  [["scripts/verify-account-layout-evidence.mjs", evidence, candidate.directory], 60_000],
 ]) {
  const run = spawnSync(process.execPath, args, { env, stdio: "inherit", timeout });
  if (run.error) throw run.error;
  if (run.status !== 0) { process.exitCode = run.status ?? 1; break; }
 }
} finally { candidate.cleanup(); }
