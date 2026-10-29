import { browserDefaults, sourceServer } from "./scripts/testing/browser-config";
import { defineConfig } from "@playwright/test";

const port = Number(process.env.KEEPANY_E2E_PORT ?? "4173");
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
 ...browserDefaults,

	outputDir: "test-results/source",
	timeout: 45_000,
	use: { ...browserDefaults.use, baseURL,  },
	webServer: sourceServer(port),
});
