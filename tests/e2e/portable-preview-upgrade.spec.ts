import { materializeCandidate, selectCandidate } from "../../scripts/lib/portable-candidate.mjs";
import { openProjectDetails } from "./helpers/project-details";
import { openBackupPage } from "./helpers/backup-restore";
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { decryptBackup } from '../../packages/local-db/src/backup-crypto';

const oldCommit = '8f9a1b5';
test.skip(process.env.KEEPANY_PORTABLE_UPGRADE !== '1', 'Use playwright.portable-upgrade.config.ts with a built portable preview');
const sha256 = (bytes: Buffer | string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function unusedPort() {
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const address = reservation.address();
  if (!address || typeof address === 'string') throw Error('No reserved loopback address');
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  return address.port;
}

async function startPackage(directory: string, port: number) {
  const child = spawn(process.execPath, [join(directory, 'preview-server.mjs'), 'start', '--no-open', '--port', String(port)],
    { cwd: tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', bytes => { output += bytes; });
  child.stderr.on('data', bytes => { output += bytes; });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const state = JSON.parse(readFileSync(join(directory, '.keepany-preview-server.json'), 'utf8'));
      const response = await fetch(`http://127.0.0.1:${port}/__keepany_preview__/status`, {
        headers: { authorization: `Bearer ${state.token}` }, signal: AbortSignal.timeout(500),
      });
      if (response.ok && (await response.json()).pid === child.pid) return child;
    } catch {}
    if (child.exitCode !== null) throw Error(`Package did not start: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  child.kill('SIGTERM');
  throw Error(`Package did not become ready: ${output}`);
}

async function stopPackage(directory: string, child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null) return;
  const stopped = spawn(process.execPath, [join(directory, 'preview-server.mjs'), 'stop'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  stopped.stdout.on('data', bytes => { output += bytes; });
  stopped.stderr.on('data', bytes => { output += bytes; });
  const stoppedCode = await new Promise<number | null>((resolve, reject) => { stopped.once('exit', resolve); stopped.once('error', reject); });
  if (stoppedCode !== 0) throw Error(`Own package did not stop: ${output}`);
  if (child.exitCode === null) await new Promise<void>(resolve => child.once('exit', () => resolve()));
  expect(child.exitCode).toBe(0);
}

// Read the running service worker's actual script via Chromium's debugger.
// Fetching /sw.js would only prove the server response, not which worker runs.
async function activeWorkerSource(context: BrowserContext, origin: string) {
  const browser = context.browser();
  if (!browser) throw Error('Persistent Chromium browser missing');
  const cdp = await browser.newBrowserCDPSession();
  const { targetInfos } = await cdp.send('Target.getTargets');
  const workers = targetInfos.filter(item => item.type === 'service_worker' && item.url === `${origin}/sw.js`);
  if (workers.length !== 1) { await cdp.detach(); throw Error(`Expected one running worker, found ${workers.length}`); }
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: workers[0].targetId, flatten: false });
  let nextId = 0;
  const scripts: Array<{ url: string; scriptId: string }> = [];
  const pending = new Map<number, { resolve(value: { scriptSource?: string }): void; reject(error: Error): void }>();
  cdp.on('Target.receivedMessageFromTarget', event => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    if (message.id) {
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      if (message.error) item.reject(Error(JSON.stringify(message.error)));
      else item.resolve(message.result);
    } else if (message.method === 'Debugger.scriptParsed') scripts.push(message.params);
  });
  function childCommand(method: string, params = {}): Promise<{ scriptSource?: string }> {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(Error(`Worker debugger timed out: ${method}`)); }, 5000);
      pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      void cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
    });
  }
  try {
    await childCommand('Debugger.enable');
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const script = scripts.find(script => script.url === `${origin}/sw.js`);
      if (script) {
        const { scriptSource } = await childCommand('Debugger.getScriptSource', { scriptId: script.scriptId });
        if (typeof scriptSource !== 'string') throw Error('Worker script source missing');
        return scriptSource;
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw Error('Active worker script was not reported by Chromium');
  } finally {
    await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => undefined);
    await cdp.detach();
  }
}

async function originalImage(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // The pinned old UI exposes images directly; current UI opens its real disclosure.
  if (await page.locator(".asset-project-media-disclosure").count()) await openProjectDetails(page);
  await expect(page.locator('.asset-image')).toHaveCount(1);
  await expect.poll(() => page.locator('.asset-image').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  return page.locator('.asset-image').evaluate(async (image: HTMLImageElement) => Array.from(new Uint8Array(await (await fetch(image.src)).arrayBuffer())));
}

test('closed old PWA upgrades to the fresh-only portable package on the same persistent origin and restores its actual backup', async () => {
  const root = process.cwd();
  const checked = materializeCandidate(selectCandidate());
  const candidate = checked.directory;
  const release = checked.release;
  const directory = mkdtempSync(join(tmpdir(), 'keepany-portable-pwa-upgrade-'));
  const oldPackage = join(directory, 'old-package');
  const newPackage = join(directory, 'new-package');
  const profile = join(directory, 'same-browser-profile');
  const port = await unusedPort();
  const origin = `http://127.0.0.1:${port}`;
  const errors: string[] = [];
  const failedCurrentResponses: string[] = [];
  const project = `Portable upgrade ${crypto.randomUUID().slice(0, 8)}`;
  const collectionName = 'Portable collection';
  const password = 'synthetic-portable-upgrade-backup-only';
  let context: BrowserContext | undefined;
  let restoredContext: BrowserContext | undefined;
  let oldService: ChildProcess | undefined;
  let newService: ChildProcess | undefined;
  let stage = 'prepare';
  try {
    mkdirSync(join(oldPackage, 'web'), { recursive: true });
    mkdirSync(newPackage, { recursive: true });
    const oldArchive = execFileSync('git', ['archive', oldCommit, 'release/web'], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    const extracted = spawnSync('tar', ['-x', '-C', join(oldPackage, 'web'), '--strip-components=2'], { input: oldArchive });
    if (extracted.status !== 0) throw Error(extracted.stderr.toString());
    cpSync(join(candidate, 'preview-server.mjs'), join(oldPackage, 'preview-server.mjs'));
    writeFileSync(join(oldPackage, 'RELEASE.json'), JSON.stringify({ version: 'old-fixed-8f9a1b5', sourceCommit: execFileSync('git', ['rev-parse', oldCommit], { cwd: root, encoding: 'utf8' }).trim(), applicationRoutes: release.applicationRoutes }));
    cpSync(join(candidate, 'web'), join(newPackage, 'web'), { recursive: true });
    cpSync(join(candidate, 'preview-server.mjs'), join(newPackage, 'preview-server.mjs'));
    cpSync(join(candidate, 'RELEASE.json'), join(newPackage, 'RELEASE.json'));
    for (const file of release.webFiles) expect(sha256(readFileSync(join(newPackage, 'web', file.path)))).toBe(file.sha256);
    const oldIndex = readFileSync(join(oldPackage, 'web', 'index.html'), 'utf8');
    const newIndex = readFileSync(join(newPackage, 'web', 'index.html'), 'utf8');
    const oldEntry = oldIndex.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)?.[1];
    const newEntry = newIndex.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)?.[1];
    expect(oldEntry).toBeTruthy(); expect(newEntry).toBeTruthy(); expect(newEntry).not.toBe(oldEntry);
    expect(release.webFiles.some((file: { path: string }) => `/${file.path}` === oldEntry)).toBe(false);
    const oldWorkerHash = sha256(readFileSync(join(oldPackage, 'web', 'sw.js')));
    const newWorkerHash = sha256(readFileSync(join(newPackage, 'web', 'sw.js')));
    expect(newWorkerHash).not.toBe(oldWorkerHash);

    stage = 'write original project and image under fixed old worker';
    oldService = await startPackage(oldPackage, port);
    context = await chromium.launchPersistentContext(profile, { locale: 'en-US', acceptDownloads: true, viewport: { width: 1280, height: 800 } });
    context.setDefaultTimeout(10_000);
    const page = context.pages()[0] ?? await context.newPage();
    page.on('pageerror', error => errors.push(`old: ${error.message}`));
    await page.goto(`${origin}/assets/project`);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill(project);
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText(project, { exact: true }).click();
    await expect(page.getByRole('heading', { name: project, exact: true })).toBeVisible();
    const detailPath = new URL(page.url()).pathname;
    const assetId = detailPath.split('/').at(-1);
    const imageBase64 = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
      const pen = canvas.getContext('2d'); if (!pen) throw Error('Canvas missing');
      pen.fillStyle = '#237bc4'; pen.fillRect(0, 0, 16, 16);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const imageBytes = Buffer.from(imageBase64, 'base64');
    await page.getByLabel('Add image').setInputFiles({ name: 'portable-upgrade.png', mimeType: 'image/png', buffer: imageBytes });
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
    expect(Buffer.from(await originalImage(page))).toEqual(imageBytes);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    expect(sha256(await activeWorkerSource(context, origin))).toBe(oldWorkerHash);

    stage = 'close all old tabs and old service, retain browser profile';
    for (const tab of context.pages()) await tab.close();
    await context.close(); context = undefined;
    await stopPackage(oldPackage, oldService); oldService = undefined;
    newService = await startPackage(newPackage, port);
    expect((await fetch(`${origin}${oldEntry}`)).status).toBe(404);

    stage = 'reopen same browser profile and activate actual fresh-only worker';
    context = await chromium.launchPersistentContext(profile, { locale: 'en-US', acceptDownloads: true, viewport: { width: 1280, height: 800 } });
    context.setDefaultTimeout(10_000);
    const upgraded = context.pages()[0] ?? await context.newPage();
    upgraded.on('pageerror', error => errors.push(`new: ${error.message}`));
    upgraded.on('response', response => { if (response.status() >= 400 && response.url().startsWith(`${origin}/assets/`)) failedCurrentResponses.push(`${response.status()} ${response.url()}`); });
    await upgraded.goto(`${origin}${detailPath}`);
    await expect(upgraded.getByRole('heading', { name: project, exact: true })).toBeVisible();
    await upgraded.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
    await expect.poll(async () => {
      try { return sha256(await activeWorkerSource(context!, origin)); } catch { return 'worker-transition'; }
    }, { timeout: 30_000, intervals: [250, 500, 1000] }).toBe(newWorkerHash);
    await upgraded.reload();
    await expect.poll(() => upgraded.locator('script[type="module"]').getAttribute('src')).toBe(newEntry);
    expect(Buffer.from(await originalImage(upgraded))).toEqual(imageBytes);
    await expect(upgraded.getByRole('heading', { name: project, exact: true })).toBeVisible();
    const visited: string[] = [];
    for (const path of ['/', '/assets/project', '/assets/account', '/assets/subscription', '/assets/item', '/assets/vault', detailPath,
      `${detailPath}/workflow/brand`, `${detailPath}/workflow/close`, '/change-impact', '/assistant-access',
      '/finance', '/tasks', '/collections', '/intake', '/settings', '/trash']) {
      await upgraded.goto(`${origin}${path}`);
      await expect(upgraded.getByRole('heading', { level: 1 })).toBeVisible();
      visited.push(path);
    }
    await upgraded.goto(`${origin}/collections`);
    await upgraded.getByRole('button', { name: 'New collection', exact: true }).first().click();
    const collectionEditor = upgraded.getByRole('region', { name: 'New collection', exact: true });
    await collectionEditor.getByLabel('Collection name', { exact: true }).fill(collectionName);
    await collectionEditor.getByRole('checkbox', { name: project, exact: true }).check();
    await collectionEditor.getByRole('button', { name: 'Save collection', exact: true }).click();
    await expect(upgraded).toHaveURL(/\/collections\/[^/]+$/);
    const collectionPath = new URL(upgraded.url()).pathname;
    await upgraded.goto(`${origin}${collectionPath}`);
    await expect(upgraded.getByRole('heading', { name: collectionName, exact: true })).toBeVisible();
    visited.push(collectionPath);

    stage = 'download actual encrypted backup and inspect original identity/image';
    await upgraded.goto(`${origin}/intake`);
    await openBackupPage(upgraded); await upgraded.locator('#backup-password').fill(password);
    await upgraded.getByRole('button', { name: 'Create backup', exact: true }).click();
    const downloadEvent = upgraded.waitForEvent('download');
    await upgraded.getByRole('link', { name: 'Save backup file', exact: true }).click();
    const backup = await downloadEvent;
    const backupPath = join(directory, 'upgrade-backup.ka1');
    await backup.saveAs(backupPath);
    const entries = unzipSync(await decryptBackup(new Uint8Array(readFileSync(backupPath)), password));
    const records = JSON.parse(strFromU8(entries['records.json'])) as Array<{ type: string; payload: string }>;
    const asset = records.filter(row => row.type === 'asset').map(row => JSON.parse(row.payload)).find(row => row.name === project);
    expect(asset).toMatchObject({ id: assetId, name: project, kind: 'project' });
    expect(asset.attachments).toHaveLength(1);
    expect(Buffer.from(entries[`files/${asset.attachments[0]}`])).toEqual(imageBytes);

    stage = 'restore actual backup into a clean persistent browser profile';
    restoredContext = await chromium.launchPersistentContext(join(directory, 'clean-restore-profile'), { locale: 'en-US', viewport: { width: 390, height: 844 } });
    restoredContext.setDefaultTimeout(10_000);
    const restored = restoredContext.pages()[0] ?? await restoredContext.newPage();
    restored.on('pageerror', error => errors.push(`restore: ${error.message}`));
    await restored.goto(`${origin}/assets/project`);
    await expect(restored.getByText(project, { exact: true })).toHaveCount(0);
    await restored.goto(`${origin}/intake`);
    await openBackupPage(restored); await restored.locator('#backup-password').fill(password);
    await restored.locator('#restore-file').setInputFiles(backupPath);
    await restored.getByRole('button', { name: 'Preview', exact: true }).first().click();
    await restored.getByRole('button', { name: /Confirm ·/ }).click();
    await expect(restored.getByText(/Restored \d+ records/)).toBeVisible();
    await restored.goto(`${origin}${detailPath}`);
    await expect(restored.getByRole('heading', { name: project, exact: true })).toBeVisible();
    expect(Buffer.from(await originalImage(restored))).toEqual(imageBytes);
    await restored.reload();
    await expect(restored.getByRole('heading', { name: project, exact: true })).toBeVisible();
    expect(Buffer.from(await originalImage(restored))).toEqual(imageBytes);
    await restored.goto(`${origin}${collectionPath}`);
    await expect(restored.getByRole('heading', { name: collectionName, exact: true })).toBeVisible();
    await expect(restored.getByRole('link', { name: new RegExp(project) })).toBeVisible();
    expect(errors).toEqual([]);
    expect(failedCurrentResponses).toEqual([]);
    console.log(JSON.stringify({ oldCommit, newCommit: release.sourceCommit, sourceDirty: release.sourceDirty, oldWorkerHash, newWorkerHash, oldEntry, newEntry,
      platform: process.platform, samePersistentProfile: true, currentOnlyWebFiles: release.webFiles.length, restoredAssetId: assetId,
      imageSha256: sha256(imageBytes), visited, pageErrors: errors, failedCurrentResponses }, null, 2));
  } catch (error) {
    throw Error(`Portable upgrade failed at: ${stage}`, { cause: error });
  } finally {
    await restoredContext?.close();
    await context?.close();
    await stopPackage(oldPackage, oldService);
    await stopPackage(newPackage, newService);
    rmSync(directory, { recursive: true, force: true });
    checked.cleanup();
  }
});
