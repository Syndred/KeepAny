import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '../..');
const port = 4179;
const url = `http://127.0.0.1:${port}`;
const server = spawn(resolve(root, 'node_modules/.bin/vite'), ['tests/phase0', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', data => { serverLog += data.toString(); });
server.stderr.on('data', data => { serverLog += data.toString(); });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`Vite exited: ${serverLog}`);
    try { const response = await fetch(url); if (response.ok) { ready = true; break; } } catch { /* booting */ }
    await delay(100);
  }
  if (!ready) throw new Error(`Vite did not start: ${serverLog}`);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`); });
  await page.goto(url);
  await page.waitForFunction(() => typeof window.runKeepAnyBenchmark === 'function', { timeout: 30000 }).catch(error => { throw new Error(`${error.message}; browser errors: ${errors.join('; ')}`); });
  const environment = await page.evaluate(async () => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGiB: navigator.deviceMemory ?? null,
    indexedDB: typeof indexedDB !== 'undefined',
    webCrypto: Boolean(crypto?.subtle),
    storageEstimate: Boolean(navigator.storage?.estimate),
    storagePersisted: typeof navigator.storage?.persisted === 'function' ? await navigator.storage.persisted() : null,
    initialQuotaBytes: (await navigator.storage?.estimate?.())?.quota ?? null,
  }));
  const results = [];
  for (const engine of ['rxdb-dexie', 'dexie']) {
    for (const count of [100, 1000, 10000]) {
      console.log(`Running ${engine} with ${count} assets, ${count} relations, and ${Math.max(1, Math.ceil(count / 100))} attachments`);
      const result = await page.evaluate(async ({ engine, count }) => window.runKeepAnyBenchmark(engine, count), { engine, count });
      results.push(result);
      console.log(JSON.stringify(result));
    }
  }
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
  const output = { generatedAt: new Date().toISOString(), node: process.version, environment, results, caveats: ['Headless Chromium on this machine; repeat on target devices.', 'Each case uses a new IndexedDB database and deletes it after measurement.', 'QuotaExceededError was not intentionally induced.', 'Measurements are single runs, not confidence intervals or a production workload.'] };
  const file = resolve(root, 'tests/phase0/evidence/storage-benchmark.json');
  await mkdir(resolve(root, 'tests/phase0/evidence'), { recursive: true });
  await writeFile(file, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Saved ${file}`);
  await context.close();
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
