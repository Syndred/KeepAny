import { defineConfig } from "@playwright/test";

const port = Number(process.env.KEEPANY_E2E_PORT ?? "4173");
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
	testDir: "./tests/e2e",
	timeout: 45_000,
	use: { baseURL, screenshot: "only-on-failure" },
	webServer: {
		command: `pnpm dev --port ${port} --strictPort`,
		url: baseURL,
		reuseExistingServer: !process.env.CI,
		timeout: 30_000,
	},
});
