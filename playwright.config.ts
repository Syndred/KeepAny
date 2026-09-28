import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/e2e",
	timeout: 45_000,
	use: { baseURL: "http://127.0.0.1:4173", screenshot: "only-on-failure" },
	webServer: {
		command: "pnpm dev --port 4173 --strictPort",
		url: "http://127.0.0.1:4173",
		reuseExistingServer: !process.env.CI,
		timeout: 30_000,
	},
});
