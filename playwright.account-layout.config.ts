import { defineConfig } from "@playwright/test";

const port = Number(process.env.KEEPANY_RELEASE_TEST_PORT ?? "4230");
const portable = Boolean(process.env.KEEPANY_PREVIEW_DIRECTORY || process.env.KEEPANY_PREVIEW_ARCHIVE);
export default defineConfig({
	testDir: "./tests/e2e",
	testMatch: ["account-password-layout.spec.ts", "account-password-consolidation.spec.ts", "ui-consolidation.spec.ts", "core-pages-matrix.spec.ts"],
	outputDir: "test-results/account-layout-run",
	workers: 1,
	use: { baseURL: `http://127.0.0.1:${port}`, screenshot: "only-on-failure" },
	webServer: {
		command: portable ? "node scripts/serve-preview-for-tests.mjs" : `node node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port ${port} --strictPort`,
		url: `http://127.0.0.1:${port}`,
		reuseExistingServer: Boolean(process.env.KEEPANY_LAYOUT_REUSE),
		timeout: 60_000,
	},
});
