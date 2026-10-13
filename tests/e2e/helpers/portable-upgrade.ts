// Reused from portable-preview-upgrade.spec.ts; no fixed port or shared browser profile.
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type BrowserContext, type Page } from '@playwright/test';

export async function unusedPort() {
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const address = reservation.address();
  if (!address || typeof address === 'string') throw Error('No reserved loopback address');
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  return address.port;
}
export async function startPackage(directory: string, port: number) {
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
  await waitForExit(child);
  throw Error(`Package did not become ready: ${output}`);
}

async function waitForExit(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

export async function stopPackage(directory: string, child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const stopped = spawn(process.execPath, [join(directory, 'preview-server.mjs'), 'stop'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  stopped.stdout.on('data', bytes => { output += bytes; });
  stopped.stderr.on('data', bytes => { output += bytes; });
  const stoppedCode = await new Promise<number | null>((resolve, reject) => { stopped.once('exit', resolve); stopped.once('error', reject); });
  if (stoppedCode !== 0) {
    // A broken launcher must still release this test's own process and port.
    child.kill('SIGTERM');
    await waitForExit(child);
    throw Error(`Own package did not stop: ${output}`);
  }
  await waitForExit(child);
  expect(child.exitCode).toBe(0);
}

// Read the running service worker's actual script via Chromium's debugger.
// Fetching /sw.js would only prove the server response, not which worker runs.
export async function activeWorkerSource(context: BrowserContext, origin: string) {
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

export async function originalImage(page: Page) {
  await expect(page.locator('.asset-image')).toHaveCount(1);
  await expect.poll(() => page.locator('.asset-image').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  return page.locator('.asset-image').evaluate(async (image: HTMLImageElement) => Array.from(new Uint8Array(await (await fetch(image.src)).arrayBuffer())));
}
