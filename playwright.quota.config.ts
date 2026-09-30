import { defineConfig } from "@playwright/test";

// Opt-in diagnostic for a real storage failure; never included in the normal
// release suite. Always serve the committed files in a fresh isolated preview.
const port = Number(process.env.KEEPANY_QUOTA_TEST_PORT ?? "4202");
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
	testDir: "./tests/e2e",
	testMatch: "storage-quota-recovery.spec.ts",
	timeout: 120_000,
	workers: 1,
	use: { baseURL, screenshot: "only-on-failure" },
	webServer: {
		command: `node node_modules/vite/bin/vite.js preview apps/web --outDir ../../release/web --host 127.0.0.1 --port ${port} --strictPort`,
		url: baseURL,
		reuseExistingServer: false,
		timeout: 30_000,
	},
});
