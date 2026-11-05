import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { compiledServer } from './scripts/testing/browser-config';
const candidate=process.env.KEEPANY_WEB_CANDIDATE;
const port=Number(process.env.KEEPANY_SCROLL_PORT??'4480');
export default defineConfig({testDir:'./tests/e2e',testMatch:['natural-scroll.spec.ts'],workers:1,retries:0,timeout:180000,
 outputDir:process.env.KEEPANY_SCROLL_OUTPUT??'test-results/natural-scroll/browser',
 reporter:[['line'],['json',{outputFile:process.env.KEEPANY_SCROLL_REPORT??'test-results/natural-scroll/report.json'}]],
 use:{baseURL:`http://127.0.0.1:${port}`,actionTimeout:10000,screenshot:'only-on-failure',trace:'retain-on-failure'},
 webServer:candidate?{command:`node node_modules/vite/bin/vite.js preview apps/web --host 127.0.0.1 --port ${port} --strictPort --outDir "${resolve(candidate)}"`,url:`http://127.0.0.1:${port}`,reuseExistingServer:false}:compiledServer(port,true)
});
