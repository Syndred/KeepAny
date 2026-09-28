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
  browser = await chromium.launch({ headless: true, args: ['--enable-precise-memory-info'] });
  const context = await browser.newContext();
  const errors = [];
  async function openHarnessPage() {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`); });
    await page.goto(url);
    await page.waitForFunction(() => typeof window.runKeepAnyBenchmark === 'function', { timeout: 30000 }).catch(error => { throw new Error(`${error.message}; browser errors: ${errors.join('; ')}`); });
    return page;
  }
  const page = await openHarnessPage();
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
  await page.close();
  const results = [];
  for (const engine of ['rxdb-dexie', 'dexie']) {
    for (const count of [100, 1000, 10000]) {
      console.log(`Running ${engine} with ${count} assets, ${count} relations, and ${Math.max(1, Math.ceil(count / 100))} attachments`);
      const casePage = await openHarnessPage();
      const result = await casePage.evaluate(async ({ engine, count }) => window.runKeepAnyBenchmark(engine, count), { engine, count });
      results.push(result);
      console.log(JSON.stringify(result));
      await casePage.close();
    }
  }
  const quotaPage = await context.newPage();
  await quotaPage.goto(url);
  const cdp = await context.newCDPSession(quotaPage);
  let quotaProbe;
  try {
    await cdp.send('Storage.overrideQuotaForOrigin', { origin: url, quotaSize: 1024 * 1024 });
    quotaProbe = await quotaPage.evaluate(async () => {
      const quotaBeforeWrite = (await navigator.storage.estimate()).quota ?? null;
      if (quotaBeforeWrite !== 1024 * 1024) return { outcome: 'override-not-applied', quotaBeforeWrite };
      const request = indexedDB.open('keepany-phase0-quota-probe', 1);
      const db = await new Promise((resolve, reject) => {
        request.onupgradeneeded = () => request.result.createObjectStore('blobs');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const transaction = db.transaction('blobs', 'readwrite');
        const data = new Uint8Array(4 * 1024 * 1024);
        for (let offset = 0; offset < data.length; offset += 65536) crypto.getRandomValues(data.subarray(offset, offset + 65536));
        const put = transaction.objectStore('blobs').put(new Blob([data]), 'large');
        return await new Promise(resolve => {
          transaction.oncomplete = () => resolve({ outcome: 'write-succeeded', quotaBeforeWrite });
          transaction.onabort = () => resolve({ outcome: 'write-aborted', quotaBeforeWrite, errorName: transaction.error?.name ?? put.error?.name ?? null });
          transaction.onerror = () => resolve({ outcome: 'write-error', quotaBeforeWrite, errorName: transaction.error?.name ?? put.error?.name ?? null });
        });
      } finally {
        db.close();
        indexedDB.deleteDatabase('keepany-phase0-quota-probe');
      }
    });
  } catch (error) {
    quotaProbe = { outcome: 'probe-unavailable', error: String(error) };
  } finally {
    await cdp.send('Storage.overrideQuotaForOrigin', { origin: url }).catch(() => {});
    await cdp.detach();
    await quotaPage.close();
  }
  console.log(`Quota probe: ${JSON.stringify(quotaProbe)}`);
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
  const output = { generatedAt: new Date().toISOString(), node: process.version, environment, results, quotaProbe, caveats: ['Headless Chromium on this machine; repeat on target devices.', 'Each case uses a new IndexedDB database and deletes it after measurement.', 'Quota probe attempts an isolated 1 MiB Chromium origin override; it writes only if the browser confirms the new quota, and it does not test application error UI.', 'Measurements are single runs, not confidence intervals or a production workload.'] };
  const file = resolve(root, 'tests/phase0/evidence/storage-benchmark.json');
  await mkdir(resolve(root, 'tests/phase0/evidence'), { recursive: true });
  await writeFile(file, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Saved ${file}`);
  await context.close();
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
