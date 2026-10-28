import { defineConfig } from "@playwright/test";

// Fault injection only. The normal/offline/upgrade suites keep their own SW policy.
const port = Number(process.env.KEEPANY_RELEASE_TEST_PORT ?? "4241");
process.env.KEEPANY_RELEASE_TEST_PORT = String(port);
process.env.KEEPANY_EVIDENCE_DIR ??= "test-results/route-load-recovery/evidence";
export default defineConfig({
	testDir: "./tests/e2e",
	testMatch: "route-load-recovery.spec.ts",
	outputDir: "test-results/route-load-recovery/run",
	workers: 1,
	retries: 0,
	timeout: 480_000,
	use: {
		baseURL: `http://127.0.0.1:${port}`,
		serviceWorkers: "block",
		actionTimeout: 15_000,
		screenshot: "only-on-failure",
		trace: "retain-on-failure",
	},
	webServer: {
		command: "node scripts/serve-preview-for-tests.mjs",
		url: `http://127.0.0.1:${port}`,
		reuseExistingServer: false,
		timeout: 30_000,
	},
});
