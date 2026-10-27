import { defineConfig } from "@playwright/test";

const port = Number(process.env.KEEPANY_E2E_PORT ?? "4205");
const baseURL = `http://127.0.0.1:${port}`;

// Keep acceptance separate from the user's fixed 4180 installation, and invoke
// the pinned local Vite directly rather than a machine-specific pnpm shim.
export default defineConfig({
	testDir: "./tests/e2e",
	outputDir: "test-results/windows-qa",
	timeout: 60_000,
	workers: 1,
	use: { baseURL, screenshot: "only-on-failure" },
	webServer: {
		command: `node node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port ${port} --strictPort`,
		url: baseURL,
		reuseExistingServer: !process.env.CI,
		timeout: 30_000,
	},
});
