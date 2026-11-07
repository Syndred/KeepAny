import { defineConfig } from '@playwright/test';
import { browserDefaults, compiledServer } from './scripts/testing/browser-config';
const port=Number(process.env.KEEPANY_RELEASE_TEST_PORT ?? '4433');
export default defineConfig({...browserDefaults,testMatch:'account-detail-delete.spec.ts',timeout:120000,workers:1,use:{...browserDefaults.use,channel:process.env.KEEPANY_TEST_BROWSER_CHANNEL,baseURL:`http://127.0.0.1:${port}`,trace:'retain-on-failure'},outputDir:'test-results/account-detail-delete',webServer:compiledServer(port)});
