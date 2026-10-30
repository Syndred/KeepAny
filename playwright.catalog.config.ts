import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
const candidate = process.env.KEEPANY_WEB_CANDIDATE;
if (!candidate)
	throw Error(
		"KEEPANY_WEB_CANDIDATE must name an explicitly compiled Web candidate.",
	);
const port = Number(process.env.KEEPANY_CATALOG_PORT ?? "4399");
export default defineConfig({
	testDir: "./tests/e2e",
	testMatch: [
		"catalog-categories.spec.ts",
		"cleanup-ux.spec.ts",
		"project-simplification.spec.ts",
	],
	retries: 0,
	workers: 2,
	timeout: 90_000,
	outputDir:
		process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/catalog-categories",
	use: {
		baseURL: `http://127.0.0.1:${port}`,
		actionTimeout: 10_000,
		screenshot: "only-on-failure",
	},
	webServer: {
		command: `node node_modules/vite/bin/vite.js preview apps/web --host 127.0.0.1 --port ${port} --strictPort --outDir "${resolve(candidate)}"`,
		url: `http://127.0.0.1:${port}`,
		reuseExistingServer: false,
	},
});
