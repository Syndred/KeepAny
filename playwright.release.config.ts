import { defineConfig } from "@playwright/test";

// Test the committed delivery files, without serving development source.
const port = Number(process.env.KEEPANY_RELEASE_TEST_PORT ?? "4181");
const baseURL = `http://127.0.0.1:${port}`;
process.env.KEEPANY_PRODUCTION_OFFLINE = "1";
process.env.KEEPANY_PDF_RELEASE = "1";
process.env.KEEPANY_EVIDENCE_DIR ??= "docs/evidence/2026-09-30/delivery";

export default defineConfig({
	testDir: "./tests/e2e",
	testMatch: [
		"ai-release.spec.ts",
		"ai-account-import-release.spec.ts",
		"ai-dialog-matrix.spec.ts",
		"local-core.spec.ts",
		"english-demo-release.spec.ts",
		"production-offline.spec.ts",
		"intake-pdf.spec.ts",
		"intake-expense.spec.ts",
		"intake-review-backup.spec.ts",
		"intake-review-merge.spec.ts",
		"custom-category-release.spec.ts",
		"global-search-release.spec.ts",
		"detail-entry-statistics.spec.ts",
		"intake-asset-receipt.spec.ts",
		"collections-route.spec.ts",
		"relation-graph-verification.spec.ts",
		"restore-identity.spec.ts",
		"archive-migration.spec.ts",
		"vault-reference-release.spec.ts",
		"password-vault.spec.ts",
		"themed-select.spec.ts",
		"spacing-consistency.spec.ts",
		"task-theme-release.spec.ts",
		"finance-ledger-release.spec.ts",
		"collections-ledger-release.spec.ts",
		"restore-self-service-release.spec.ts",
	],
	timeout: 90_000,
	workers: 2,
	use: { baseURL, screenshot: "only-on-failure" },
	webServer: {
		command: `node node_modules/vite/bin/vite.js preview apps/web --outDir ../../release/web --host 127.0.0.1 --port ${port} --strictPort`,
		url: baseURL,
		reuseExistingServer: false,
		timeout: 30_000,
	},
});
