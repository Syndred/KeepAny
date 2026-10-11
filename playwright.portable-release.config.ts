import { defineConfig } from "@playwright/test";
import releaseConfig from "./playwright.release.config";

const port = Number(process.env.KEEPANY_RELEASE_TEST_PORT ?? "4391");
export default defineConfig({
	...releaseConfig,
	outputDir: "test-results/portable-release",
	webServer: {
		command: "node scripts/serve-preview-for-tests.mjs",
		url: `http://127.0.0.1:${port}`,
		reuseExistingServer: false,
		timeout: 30_000,
	},
	use: { ...releaseConfig.use, baseURL: `http://127.0.0.1:${port}` },
});
