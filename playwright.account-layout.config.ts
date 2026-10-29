import { browserDefaults, compiledServer, sourceServer, reviewedSnapshots } from "./scripts/testing/browser-config";
import { defineConfig } from "@playwright/test";

const port = Number(process.env.KEEPANY_RELEASE_TEST_PORT ?? "4230");
const portable = Boolean(process.env.KEEPANY_PREVIEW_DIRECTORY || process.env.KEEPANY_PREVIEW_ARCHIVE);
if (process.env.KEEPANY_FINAL_CANDIDATE && (!portable || process.env.KEEPANY_LAYOUT_REUSE)) throw Error("Final layout checks require an explicit compiled candidate and a fresh server.");
export default defineConfig({
 ...browserDefaults,

	testMatch: ["account-password-layout.spec.ts", "account-password-consolidation.spec.ts", "ui-consolidation.spec.ts", "core-pages-matrix.spec.ts"],
	outputDir: process.env.KEEPANY_LAYOUT_RUN_DIR ?? "test-results/account-layout-run",
	workers: 1,
 globalTimeout: 20 * 60_000,
 ...reviewedSnapshots("accounts"),
	use: { ...browserDefaults.use, baseURL: `http://127.0.0.1:${port}`,  },
	webServer: portable ? compiledServer(port) : sourceServer(port, Boolean(process.env.KEEPANY_LAYOUT_REUSE)),
});
