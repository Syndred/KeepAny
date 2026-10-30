import { defineConfig } from "@playwright/test";
import { browserDefaults, compiledServer } from "./scripts/testing/browser-config";

const port = Number(process.env.KEEPANY_RELEASE_TEST_PORT ?? "4398");
const evidence = process.env.KEEPANY_SINGLE_ENTRY_EVIDENCE ?? "test-results/account-entry-ci/evidence";
process.env.KEEPANY_SINGLE_ENTRY_EVIDENCE = evidence;
export default defineConfig({
	...browserDefaults,
	testMatch: ["unified-account-editor.spec.ts", "compact-accounts.spec.ts"],
	outputDir: process.env.KEEPANY_INDEPENDENT_RESULTS ?? "test-results/account-entry-ci/browser",
	timeout: 150_000,
	workers: 1,
	reporter: [["list"], ["json", { outputFile: process.env.KEEPANY_INDEPENDENT_REPORT ?? "test-results/account-entry-ci/playwright.json" }]],
	use: { ...browserDefaults.use, baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
	webServer: compiledServer(port),
});
