import { defineConfig } from "@playwright/test";
import { browserDefaults, compiledServer } from "./scripts/testing/browser-config";
const port = Number(process.env.KEEPANY_RELEASE_TEST_PORT ?? "4406");
process.env.KEEPANY_PRODUCTION_OFFLINE = "1";
process.env.KEEPANY_EVIDENCE_DIR ??= "test-results/cleanup-ux/evidence";
export default defineConfig({ ...browserDefaults, testMatch: ["cleanup-ux.spec.ts", "ai-release.spec.ts", "ai-key-persistence.spec.ts", "ai-account-import-release.spec.ts"], outputDir: process.env.KEEPANY_QA_OUTPUT ?? "test-results/cleanup-ux/run", reporter: [["line"], ["json", { outputFile: `${process.env.KEEPANY_QA_OUTPUT ?? "test-results/cleanup-ux/run"}/results.json` }]], timeout: 90_000, workers: 2, use: { ...browserDefaults.use, baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" }, webServer: compiledServer(port) });
