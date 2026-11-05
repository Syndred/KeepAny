import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import { compiledServer } from "./scripts/testing/browser-config";
const candidate=process.env.KEEPANY_WEB_CANDIDATE;
const port=Number(process.env.KEEPANY_ACCOUNT_DETAIL_PORT??"4466");
export default defineConfig({testDir:"./tests/e2e",testMatch:["account-detail-approved.spec.ts"],workers:2,retries:0,timeout:120000,
 outputDir:process.env.KEEPANY_ACCOUNT_DETAIL_OUTPUT??"test-results/account-detail-approved",
 reporter:[["line"],["json",{outputFile:process.env.KEEPANY_ACCOUNT_DETAIL_REPORT??"test-results/account-detail-approved/report.json"}]],
 use:{baseURL:`http://127.0.0.1:${port}`,actionTimeout:10000,screenshot:"only-on-failure",trace:"retain-on-failure"},
 webServer:candidate?{command:`node node_modules/vite/bin/vite.js preview apps/web --host 127.0.0.1 --port ${port} --strictPort --outDir "${resolve(candidate)}"`,url:`http://127.0.0.1:${port}`,reuseExistingServer:false}:compiledServer(port,true)
});
