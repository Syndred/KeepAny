import { readCandidate, selectCandidate } from "./scripts/lib/portable-candidate.mjs";
import { browserDefaults, compiledServer } from "./scripts/testing/browser-config";
import { defineConfig } from "@playwright/test";

// Opt-in diagnostic for a real storage failure; never included in the normal
// release suite. Always serve the delivered production package in isolation.
const port = Number(process.env.KEEPANY_QUOTA_TEST_PORT ?? "4403");
const baseURL = `http://127.0.0.1:${port}`;
const input = selectCandidate();
const { release } = readCandidate(input);
const archive = input.endsWith(".zip") ? input : undefined;
if (archive) process.env.KEEPANY_PREVIEW_ARCHIVE = input;
else process.env.KEEPANY_PREVIEW_DIRECTORY = input;
const entry = release.webFiles.find((file: { path: string }) => /^assets\/index-.*\.js$/.test(file.path));
if (!entry) throw Error("Portable application entry missing.");
process.env.KEEPANY_QUOTA_PACKAGE_ENTRY = `/${entry.path}`;
process.env.KEEPANY_QUOTA_PACKAGE_COMMIT = release.sourceCommit;

export default defineConfig({
 ...browserDefaults,

	testMatch: "storage-quota-recovery.spec.ts",
	outputDir: "test-results/quota-review",
	timeout: 120_000,
	workers: 1,
	use: { ...browserDefaults.use, baseURL,  trace: "retain-on-failure" },
	webServer: compiledServer(port),
});
