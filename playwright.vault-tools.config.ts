import { browserDefaults, compiledServer } from "./scripts/testing/browser-config";
import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
const port = Number(process.env.KEEPANY_RELEASE_TEST_PORT ?? "4392");
export default defineConfig({
 ...browserDefaults,

	testMatch: [
		"vault-tool-loading.spec.ts",
		"vault-tool-recovery.spec.ts",
		"workspace-vault-status.spec.ts",
		"toast-dialog-layer.spec.ts",
	],
	outputDir: resolve(
		process.env.KEEPANY_VAULT_TOOLS_OUTPUT ?? "test-results/vault-tools",
	),
	workers: 2,

	maxFailures: 1,
	timeout: 120000,
	use: { ...browserDefaults.use,
		baseURL: `http://127.0.0.1:${port}`,
		viewport: { width: 1280, height: 900 },
		serviceWorkers: "allow",
		actionTimeout: 15000,
		trace: "on",

	},
	webServer: compiledServer(port),
});
