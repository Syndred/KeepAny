import { browserDefaults, compiledServer } from "./scripts/testing/browser-config";
import { defineConfig } from "@playwright/test";

// Fault injection only. The normal/offline/upgrade suites keep their own SW policy.
const port = Number(process.env.KEEPANY_RELEASE_TEST_PORT ?? "4241");
process.env.KEEPANY_RELEASE_TEST_PORT = String(port);
process.env.KEEPANY_EVIDENCE_DIR ??= "test-results/route-load-recovery/evidence";
export default defineConfig({
 ...browserDefaults,

	testMatch: "route-load-recovery.spec.ts",
	outputDir: "test-results/route-load-recovery/run",
	workers: 1,

	timeout: 480_000,
	use: { ...browserDefaults.use,
		baseURL: `http://127.0.0.1:${port}`,
		serviceWorkers: "block",

		trace: "retain-on-failure",
	},
	webServer: compiledServer(port),
});
