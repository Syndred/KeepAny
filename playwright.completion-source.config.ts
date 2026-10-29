import { defineConfig } from "@playwright/test";
import { browserDefaults, sourceServer } from "./scripts/testing/browser-config";

const port = Number(process.env.KEEPANY_E2E_PORT ?? "4419");
process.env.KEEPANY_EVIDENCE_DIR ??= "test-results/completion-source-evidence";

// Deliberate source-only storage fault/CAS probes. They are not portable-package evidence.
export default defineConfig({
	...browserDefaults,
	testMatch: [
		"qa-t16-completion.spec.ts",
		"qa-t19-merge-drafts.spec.ts",
		"qa-t19-merge-completion.spec.ts",
		"intake-expense-recovery.spec.ts",
	],
	grep: /T16-03|never reuse invalid|keeps a newer target|fault-injected legacy PDF expense/,
	outputDir: "test-results/completion-source",
	workers: 2,
	timeout: 45_000,
	use: { ...browserDefaults.use, baseURL: `http://127.0.0.1:${port}` },
	webServer: sourceServer(port, false),
});
