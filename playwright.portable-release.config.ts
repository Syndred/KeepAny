import { browserDefaults, compiledServer } from "./scripts/testing/browser-config";
import { defineConfig } from "@playwright/test";
import releaseConfig from "./playwright.release.config";

const port = Number(process.env.KEEPANY_RELEASE_TEST_PORT ?? "4391");
export default defineConfig({
 ...browserDefaults,
	...releaseConfig,
	outputDir: "test-results/portable-release",
	webServer: compiledServer(port),
	use: { ...browserDefaults.use, ...releaseConfig.use, baseURL: `http://127.0.0.1:${port}` },
});
