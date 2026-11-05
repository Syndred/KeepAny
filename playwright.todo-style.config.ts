import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
const port = Number(process.env.KEEPANY_TODO_PORT ?? "4501");
const candidate = process.env.KEEPANY_WEB_CANDIDATE;
export default defineConfig({
	testDir: "./tests/e2e",
	testMatch: "todo-style.spec.ts",
	retries: 0,
	workers: 1,
	timeout: 300_000,
	outputDir: process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/todo-style",
	use: {
		baseURL: `http://127.0.0.1:${port}`,
		timezoneId: "Asia/Shanghai",
		actionTimeout: 12_000,
		serviceWorkers: "block",
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: candidate
		? {
				command: `node node_modules/vite/bin/vite.js preview apps/web --host 127.0.0.1 --port ${port} --strictPort --outDir "${resolve(candidate)}"`,
				url: `http://127.0.0.1:${port}`,
				reuseExistingServer: false,
			}
		: {
				command: "node scripts/serve-preview-for-tests.mjs",
				url: `http://127.0.0.1:${port}`,
				env: { KEEPANY_RELEASE_TEST_PORT: String(port) },
				reuseExistingServer: false,
			},
});
