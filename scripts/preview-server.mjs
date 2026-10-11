import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { createAdaptorServer } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const statePath = join(packageRoot, '.keepany-preview-server.json');
const webRoot = join(packageRoot, 'web');
const controlPath = '/__keepany_preview__';
const args = process.argv.slice(2);
const command = args.shift() ?? 'start';
let portValue = process.env.KEEPANY_PREVIEW_PORT ?? '4180';
let noOpen = process.env.KEEPANY_PREVIEW_NO_OPEN === '1';
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--no-open') noOpen = true;
  else if (args[index] === '--port' && args[index + 1]) portValue = args[++index];
  else throw Error('Usage: node preview-server.mjs [start|stop] [--no-open] [--port 4180]');
}
const port = Number(portValue);
if (!['start', 'stop'].includes(command) || !/^\d+$/.test(portValue)
  || !Number.isInteger(port) || port < 1024 || port > 65535) {
  throw Error('Use start or stop and a port between 1024 and 65535.');
}
if (Number(process.versions.node.split('.')[0]) < 22) {
  throw Error('需要 Node.js 22 或更新版本。 / Node.js 22 or newer is required.');
}

function authenticate(supplied, expected) {
  if (typeof supplied !== 'string' || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

async function readState() {
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  if (state.schema !== 'keepany.preview-server.v1' || !Number.isInteger(state.port)
    || state.port < 1024 || state.port > 65535 || !Number.isInteger(state.pid)
    || state.pid < 1 || typeof state.token !== 'string' || !/^[a-f0-9]{64}$/.test(state.token)) {
    throw Error('启动状态文件无效；未停止任何进程。 / Invalid startup state; no process was stopped.');
  }
  return state;
}

async function stop() {
  let state;
  try { state = await readState(); }
  catch (error) {
    if (error.code === 'ENOENT') {
      console.log('本测试版未运行。 / This preview is not running.');
      return;
    }
    throw error;
  }
  const url = `http://127.0.0.1:${state.port}${controlPath}`;
  const headers = { authorization: `Bearer ${state.token}` };
  try {
    const status = await fetch(`${url}/status`, { headers, signal: AbortSignal.timeout(3000) });
    if (!status.ok) throw Error('instance-mismatch');
    const identity = await status.json();
    if (identity.pid !== state.pid || identity.schema !== state.schema) throw Error('instance-mismatch');
    const response = await fetch(`${url}/stop`, { method: 'POST', headers, signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw Error('instance-mismatch');
  } catch (error) {
    throw Error('无法确认这是本测试版的服务；未向其他进程发送停止信号。 / Cannot verify this preview instance; no other process was stopped.', { cause: error });
  }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const current = await readState();
      if (current.token !== state.token) throw Error('instance-changed');
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('KeepAny 本地服务已停止。 / KeepAny local server stopped.');
        return;
      }
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error('停止超时，请检查启动终端。 / Stop timed out; check the startup terminal.');
}

function openBrowser(url) {
  const browser = process.platform === 'darwin'
    ? spawn('open', [url], { stdio: 'ignore' })
    : process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/c', 'start', '""', url], { stdio: 'ignore', windowsHide: true })
      : spawn('xdg-open', [url], { stdio: 'ignore' });
  browser.on('error', () => console.log(`请手动打开 / Open manually: ${url}`));
  browser.on('exit', code => { if (code) console.log(`请手动打开 / Open manually: ${url}`); });
  browser.unref();
}

async function start() {
  const release = JSON.parse(await readFile(join(packageRoot, 'RELEASE.json'), 'utf8'));
  const routes = release.applicationRoutes;
  if (!Array.isArray(routes?.paths) || !routes.paths.includes('/')
    || routes.paths.some(path => typeof path !== 'string' || !/^\/(?:[\w$-]+\/?)*$/.test(path))
    || !Array.isArray(routes.parameters?.kind) || !routes.parameters.kind.length
    || routes.parameters.kind.some(kind => !/^[a-z][a-z-]*$/.test(kind))) throw Error('Invalid application route contract in RELEASE.json');
  await readFile(join(webRoot, 'index.html'));
  const token = randomBytes(32).toString('hex');
  const state = { schema: 'keepany.preview-server.v1', pid: process.pid, port, token };
  const origin = `http://127.0.0.1:${port}`;
  const app = new Hono({ strict: false });
  let server;
  let closing = false;
  let ownsState = false;
  async function removeOwnState() {
    if (!ownsState) return;
    try {
      const current = await readState();
      if (current.token === token) await rm(statePath);
    } catch (error) { if (error.code !== 'ENOENT') console.error('无法清理启动状态。 / Could not clean startup state.'); }
  }
  function shutdown() {
    if (closing) return;
    closing = true;
    const forceClose = setTimeout(() => server.closeAllConnections(), 2000);
    forceClose.unref();
    server.close(async () => {
      clearTimeout(forceClose);
      await removeOwnState();
      console.log('KeepAny 本地服务已停止。 / KeepAny local server stopped.');
    });
    server.closeIdleConnections();
  }
  app.use('*', async (context, next) => {
    // Inspect the original path before URL normalization can remove dot segments.
    const rawPath = context.env.incoming.url.split('?')[0];
    let decoded;
    try { decoded = decodeURIComponent(rawPath); }
    catch { return context.text('Invalid path', 400); }
    if (!decoded.startsWith('/') || /[%\\\u0000-\u001f\u007f]/.test(decoded)
      || decoded.includes('//') || decoded.split('/').some(segment => segment === '.' || segment === '..')) {
      return context.text('Invalid path', 400);
    }
    if (context.req.header('host') !== `127.0.0.1:${port}`) return context.text('Invalid host', 403);
    if (decoded.split('/').some(segment => segment.startsWith('.'))) return context.notFound();
    context.header('X-Content-Type-Options', 'nosniff');
    context.header('Cache-Control', 'no-cache');
    await next();
  });
  app.use(`${controlPath}/*`, async (context, next) => {
    if (!authenticate(context.req.header('authorization'), `Bearer ${token}`)) return context.text('Forbidden', 403);
    const requestOrigin = context.req.header('origin');
    if (requestOrigin && requestOrigin !== origin) return context.text('Forbidden', 403);
    await next();
  });
  app.get(`${controlPath}/status`, context => context.json({ schema: state.schema, pid: state.pid, listenAddress: server.address().address }));
  app.post(`${controlPath}/stop`, context => {
    setTimeout(shutdown, 50);
    return context.json({ stopping: true });
  });
  app.use('*', async (context, next) => {
    if (!['GET', 'HEAD'].includes(context.req.method)) return context.text('Method not allowed', 405);
    await next();
  });
  app.use('*', serveStatic({ root: webRoot }));
  // Hono matches the complete route contract extracted from the actual
  // TanStack tree. Static files are tried first; missing chunks/API paths have
  // no matching application route and remain 404, even with Accept: text/html.
  for (const path of routes.paths) {
    const pattern = path.replace(/\$([\w]+)/g, (_match, parameter) => {
      const choices = routes.parameters[parameter];
      return choices ? `:${parameter}{(?:${choices.join('|')})}` : `:${parameter}`;
    });
    app.on(['GET', 'HEAD'], pattern, async (context, next) => {
      if (!context.req.header('accept')?.includes('text/html')) return context.notFound();
      return serveStatic({ root: webRoot, path: 'index.html' })(context, next);
    });
  }
  // Claim this package instance before listening. A second process must not
  // overwrite the control state even when it requests a different test port.
  try {
    const previous = await readState();
    let processExists = true;
    try { process.kill(previous.pid, 0); }
    catch (error) { if (error.code === 'ESRCH') processExists = false; else throw error; }
    if (processExists) {
      throw Error(`本包已在运行或其状态仍被使用；未启动另一实例。 / This package is already in use; no second instance was started (port ${previous.port} already in use).`);
    }
    await rm(statePath);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(statePath, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: 'wx' });
  ownsState = true;
  server = createAdaptorServer({ fetch: app.fetch });
  server.on('error', async error => {
    await removeOwnState();
    if (error.code === 'EADDRINUSE') {
      console.error(`端口 ${port} 已被占用；未启动或停止现有服务。 / Port ${port} is already in use; existing services were left running.`);
    } else console.error(error.message);
    process.exitCode = 1;
  });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  console.log(`KeepAny ${release.version} (${release.sourceCommit.slice(0, 12)})\n${origin}/`);
  console.log('保持此终端打开；Ctrl+C 或运行 stop 脚本停止。 / Keep this terminal open; use Ctrl+C or the stop script to stop.');
  console.log('资料保存在当前浏览器中；使用同一浏览器和地址可继续使用已有资料。 / Data stays in this browser; the same browser and address retain existing data.');
  if (!noOpen) openBrowser(`${origin}/`);
}

try { await (command === 'stop' ? stop() : start()); }
catch (error) {
  if (error.code !== 'EADDRINUSE') console.error(error.message);
  process.exitCode = 1;
}
