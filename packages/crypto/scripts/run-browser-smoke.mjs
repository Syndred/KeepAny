import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '../../..');
const url = 'http://127.0.0.1:4180';
const server = spawn(resolve(root, 'node_modules/.bin/vite'), ['packages/crypto/browser', '--host', '127.0.0.1', '--port', '4180', '--strictPort'],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', value => { log += value.toString(); });
server.stderr.on('data', value => { log += value.toString(); });
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw Error(`vite exited: ${log}`);
    try { if ((await fetch(url)).ok) { ready = true; break; } } catch { /* booting */ }
    await delay(100);
  }
  if (!ready) throw Error(`vite did not start: ${log}`);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => typeof window.runCryptoSmoke === 'function', { timeout: 30_000 });
  const result = await page.evaluate(() => window.runCryptoSmoke());
  if (errors.length || !result.roundTrip || !result.replayRejected || !result.recoveryMatches ||
      !result.secondDeviceMatches || result.rotatedEpoch !== 2 || !result.previousKeyChanged) {
    throw Error(`browser crypto smoke failed: ${JSON.stringify({ result, errors })}`);
  }
  console.log(JSON.stringify({ userAgent: await page.evaluate(() => navigator.userAgent), result }));
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
