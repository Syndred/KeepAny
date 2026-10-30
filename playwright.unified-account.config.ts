import { defineConfig } from "@playwright/test";
import { browserDefaults, compiledServer } from "./scripts/testing/browser-config";
const port=Number(process.env.KEEPANY_RELEASE_TEST_PORT??"4398");
export default defineConfig({...browserDefaults,testMatch:["unified-account-editor.spec.ts","compact-accounts.spec.ts"],workers:1,outputDir:process.env.KEEPANY_INDEPENDENT_RESULTS??"test-results/unified-editor/browser",reporter:[["list"],["json",{outputFile:process.env.KEEPANY_INDEPENDENT_REPORT??"test-results/unified-editor/playwright.json"}]],use:{...browserDefaults.use,baseURL:`http://127.0.0.1:${port}`,trace:"retain-on-failure"},webServer:compiledServer(port)});
