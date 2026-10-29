import { defineConfig } from "@playwright/test";
import { browserDefaults, compiledServer } from "./scripts/testing/browser-config";

// Asset acceptance must consume the explicitly selected portable build.
if (!process.env.KEEPANY_PREVIEW_DIRECTORY || process.env.KEEPANY_PREVIEW_ARCHIVE)
	throw Error("Set KEEPANY_PREVIEW_DIRECTORY to the compiled asset candidate; no source fallback is allowed.");
const port = Number(process.env.KEEPANY_RELEASE_TEST_PORT ?? "4418");
export default defineConfig({
	...browserDefaults,
	testMatch: "assets-workbench.spec.ts",
	workers: 1,
	timeout: 150_000,
	expect: { timeout: 10_000 },
	outputDir: process.env.KEEPANY_ASSETS_RESULTS ?? "test-results/assets-workbench/run",
	reporter: [["list"], ["json", { outputFile: process.env.KEEPANY_ASSETS_REPORT ?? "test-results/assets-workbench/results.json" }]],
	webServer: compiledServer(port),
	use: { ...browserDefaults.use, baseURL: `http://127.0.0.1:${port}`, timezoneId: "Asia/Shanghai", trace: "retain-on-failure", acceptDownloads: true },
});
