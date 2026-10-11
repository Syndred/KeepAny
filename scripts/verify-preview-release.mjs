import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { createConnection } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = await readdir(join(root, 'dist', 'preview'));
const archives = await Promise.all(files.filter(name => name.endsWith('.zip')).map(async name => ({ name, mtime: (await stat(join(root, 'dist', 'preview', name))).mtimeMs })));
const defaultArchive = archives.sort((a, b) => b.mtime - a.mtime)[0]?.name;
const archivePath = process.argv[2] ? resolve(process.argv[2]) : join(root, 'dist', 'preview', defaultArchive ?? 'missing.zip');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = await readFile(archivePath);
const expectedZipHash = (await readFile(`${archivePath}.sha256`, 'utf8')).split(/\s+/)[0];
assert.equal(sha256(bytes), expectedZipHash, 'ZIP checksum matches');
const extracted = unzipSync(bytes);
const temp = await mkdtemp(join(tmpdir(), 'keepany-preview-verification-'));
const children = new Set();
const checks = [];
let conflictServer;
let app;
let packageRoot;
let port;

function run(args, cwd = temp) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, KEEPANY_PREVIEW_NO_OPEN: '1', KEEPANY_PREVIEW_NO_PAUSE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  let output = '';
  child.stdout.on('data', bytes => { output += bytes; });
  child.stderr.on('data', bytes => { output += bytes; });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => { children.delete(child); resolve({ code, signal, output }); });
  });
  return { child, exited, output: () => output };
}
async function complete(process, timeout = 10000) {
  return Promise.race([process.exited, new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`Process timed out: ${process.output()}`)), timeout);
    timer.unref();
  })]);
}
async function waitForState(process) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const state = JSON.parse(await readFile(join(packageRoot, '.keepany-preview-server.json'), 'utf8'));
      const status = await fetch(`http://127.0.0.1:${state.port}/__keepany_preview__/status`, {
        headers: { authorization: `Bearer ${state.token}` }, signal: AbortSignal.timeout(500),
      });
      if (status.ok) {
        const identity = await status.json();
        assert.equal(identity.listenAddress, '127.0.0.1', 'Actual OS listener is loopback, never a wildcard address');
        if (identity.pid === state.pid) return state;
      }
    } catch (error) { if (error instanceof SyntaxError || error.name === 'AssertionError') throw error; }
    if (process.child.exitCode !== null) throw Error(`Startup failed: ${process.output()}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error(`No startup state: ${process.output()}`);
}
async function reservePort() {
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const chosen = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return chosen;
}
function rawRequest(path, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers, timeout: 3000 }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(Error('request timed out')));
    req.on('error', reject);
    req.end();
  });
}
async function refusesConnection(host) {
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host, port, timeout: 1000 });
    socket.once('connect', () => { socket.destroy(); reject(Error(`Unexpected non-loopback listener: ${host}:${port}`)); });
    socket.once('error', resolve);
    socket.once('timeout', () => { socket.destroy(); resolve(); });
  });
}

try {
  const packageNames = new Set();
  for (const path of Object.keys(extracted)) {
    assert(!path.startsWith('/') && !path.split('/').includes('..') && !path.includes('\\'), `Safe ZIP path: ${path}`);
    packageNames.add(path.split('/')[0]);
  }
  assert.equal(packageNames.size, 1, 'ZIP has one root folder');
  if (process.platform === 'win32') {
    const literal = value => `'${value.replaceAll("'", "''")}'`;
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${literal(archivePath)} -DestinationPath ${literal(temp)}`], { stdio: 'pipe' });
  } else execFileSync('unzip', ['-q', archivePath, '-d', temp], { stdio: 'pipe' });
  packageRoot = join(temp, [...packageNames][0]);
  assert(!packageRoot.startsWith(root), 'Runs outside repository');
  const sumLines = (await readFile(join(packageRoot, 'SHA256SUMS.txt'), 'utf8')).trim().split('\n');
  for (const line of sumLines) {
    const [, digest, path] = line.match(/^([a-f0-9]{64})  (.+)$/) ?? [];
    assert(path && !path.startsWith('/') && !path.split('/').includes('..'), 'Safe checksum path');
    assert.equal(sha256(await readFile(join(packageRoot, path))), digest, `Delivered checksum: ${path}`);
  }
  const release = JSON.parse(await readFile(join(packageRoot, 'RELEASE.json'), 'utf8'));
  const deliveredWeb = Object.keys(extracted).filter(path => path.startsWith(`${[...packageNames][0]}/web/`));
  assert.equal(deliveredWeb.length, release.webFiles.length, 'Only current web files shipped');
  for (const file of release.webFiles) assert.equal(sha256(await readFile(join(packageRoot, 'web', file.path))), file.sha256, `Web identity: ${file.path}`);
  assert.equal(release.defaultOrigin, 'http://127.0.0.1:4180');
  assert(!Object.keys(extracted).some(path => path.includes('/release/web/') || path.includes('/node_modules/')), 'No historical bundle or installed dependencies shipped');
  for (const action of ['start', 'stop']) for (const ext of ['command', 'sh', 'bat']) {
    const mode = (await stat(join(packageRoot, `${action}.${ext}`))).mode;
    if (process.platform !== 'win32' && ext !== 'bat') assert(mode & 0o111, `Native ZIP extraction preserves executable permission: ${action}.${ext}`);
  }
  const licenses = JSON.parse(await readFile(join(packageRoot, 'legal', 'preview-license-inventory.json'), 'utf8'));
  assert.equal(licenses.unresolvedPackageCount, 0, 'No unresolved distributed license text');
  assert(licenses.packages.some(pkg => pkg.name === 'hono') && licenses.packages.some(pkg => pkg.name === '@hono/node-server'));
  for (const name of ['react', 'react-dom', 'rxdb', 'dexie', 'kdbxweb']) assert(licenses.packages.some(pkg => pkg.name === name), `Browser core dependency license recorded: ${name}`);
  for (const path of ['source/package.json', 'source/pnpm-lock.yaml', 'source/pnpm-workspace.yaml', 'source/tsconfig.json', 'source/LICENSE', 'source/SBOM.spdx.json', 'source/legal/third-party/manifest.json', 'source/scripts/preview-server.mjs']) await stat(join(packageRoot, path));
  assert(release.sourceFiles.some(file => file.path.startsWith('apps/web/src/')) && release.sourceFiles.some(file => file.path.startsWith('packages/')));
  for (const file of release.sourceFiles) assert.equal(sha256(await readFile(join(packageRoot, 'source', file.path))), file.sha256, `Corresponding source: ${file.path}`);
  checks.push('ZIP and per-file checksums, current web identity, source, launchers, license inventory, and clean external extraction');

  port = await reservePort();
  const executable = join(packageRoot, 'preview-server.mjs');
  app = run([executable, 'start', '--no-open', '--port', String(port)]);
  const state = await waitForState(app);
  assert.equal(state.pid, app.child.pid);
  if (process.platform !== 'win32') assert.equal((await stat(join(packageRoot, '.keepany-preview-server.json'))).mode & 0o777, 0o600, 'Private control state');
  const indexBytes = await readFile(join(packageRoot, 'web', 'index.html'));
  const index = await rawRequest('/');
  assert.equal(index.status, 200);
  assert(index.body.equals(indexBytes));
  assert.equal(index.headers['x-content-type-options'], 'nosniff');
  const navigation = await rawRequest('/projects/example', { accept: 'text/html' });
  assert.equal(navigation.status, 200);
  assert(navigation.body.equals(indexBytes));
  for (const path of ['/assets/project', '/assets/account', '/assets/subscription', '/assets/item', '/assets/project/synthetic-id', '/assets/project/synthetic-id/workflow/retire']) {
    const response = await rawRequest(path, { accept: 'text/html' });
    assert.equal(response.status, 200, `Actual application deep link has SPA fallback: ${path}`);
    assert(response.body.equals(indexBytes));
  }
  const head = await rawRequest('/', {}, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  const asset = release.webFiles.find(file => file.path.startsWith('assets/') && file.path.endsWith('.js'));
  assert(asset, 'Production JS asset exists');
  const js = await rawRequest(`/${asset.path}`);
  assert.equal(js.status, 200);
  assert.equal(sha256(js.body), asset.sha256);
  for (const path of ['/assets/does-not-exist.js', '/icons/missing.png', '/missing.js', '/api/auth/session', '/sync', '/.keepany-preview-server.json']) {
    const response = await rawRequest(path, { accept: 'text/html' });
    assert.equal(response.status, 404, `No HTML fallback: ${path}`);
    assert(!response.body.equals(indexBytes));
  }
  assert.equal((await rawRequest('/projects/example')).status, 404, 'Non-navigation fetch has no fallback');
  assert.equal((await rawRequest('/', {}, 'POST')).status, 405);
  checks.push('Production assets, HEAD, SPA navigation fallback, missing asset/API/dotfile rejection');

  await writeFile(join(packageRoot, 'outside-secret.txt'), 'DO-NOT-SERVE-OUTSIDE-WEB');
  for (const path of ['/../outside-secret.txt', '/%2e%2e/outside-secret.txt', '/%252e%252e/outside-secret.txt', '/assets/%2e%2e/%2e%2e/outside-secret.txt', '/%2f%2e%2e%2foutside-secret.txt', '/%5c..%5coutside-secret.txt', '/%00', '/%zz']) {
    const response = await rawRequest(path, { accept: 'text/html' });
    assert.equal(response.status, 400, `Traversal/malformed path rejected: ${path}`);
    assert(!response.body.includes('DO-NOT-SERVE-OUTSIDE-WEB'));
  }
  assert.equal((await rawRequest('/', { host: `evil.example:${port}` })).status, 403, 'Untrusted host rejected');
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    // VPN/TUN interfaces may transparently redirect traffic to loopback. Probe
    // physical adapters, and separately verify the actual bound OS address.
    if (/^(?:utun|tun|tap|wg|tailscale)/i.test(name)) continue;
    for (const details of addresses) if (details.family === 'IPv4' && !details.internal) await refusesConnection(details.address);
  }
  checks.push('Raw and encoded path traversal, malformed path, Host rejection, private state, loopback-only listener');

  const duplicate = await complete(run([executable, 'start', '--no-open', '--port', String(port)]));
  assert.equal(duplicate.code, 1, 'Conflict exits with failure');
  assert.match(duplicate.output, /already in use/);
  assert.deepEqual(JSON.parse(await readFile(join(packageRoot, '.keepany-preview-server.json'), 'utf8')), state, 'Conflict leaves original control state untouched');
  const anotherPort = await reservePort();
  const duplicateDifferentPort = await complete(run([executable, 'start', '--no-open', '--port', String(anotherPort)]));
  assert.equal(duplicateDifferentPort.code, 1, 'Same package cannot overwrite control state on a different port');
  assert.deepEqual(JSON.parse(await readFile(join(packageRoot, '.keepany-preview-server.json'), 'utf8')), state);
  const bearer = { authorization: `Bearer ${state.token}` };
  assert.equal((await rawRequest('/__keepany_preview__/stop', {}, 'POST')).status, 403);
  assert.equal((await rawRequest('/__keepany_preview__/stop', { ...bearer, origin: 'https://evil.example' }, 'POST')).status, 403);
  const forgedState = { ...state, pid: state.pid + 100000 };
  await writeFile(join(packageRoot, '.keepany-preview-server.json'), JSON.stringify(forgedState));
  const forged = await complete(run([executable, 'stop']));
  assert.equal(forged.code, 1);
  assert.equal((await rawRequest('/')).status, 200, 'Forged PID cannot stop this or any other process');
  await writeFile(join(packageRoot, '.keepany-preview-server.json'), JSON.stringify(state), { mode: 0o600 });
  const stopped = await complete(run([executable, 'stop']));
  assert.equal(stopped.code, 0, stopped.output);
  assert.equal((await complete(app)).code, 0);
  await assert.rejects(readFile(join(packageRoot, '.keepany-preview-server.json')), { code: 'ENOENT' });
  checks.push('Duplicate-start conflict, unauthenticated/cross-origin stop rejection, forged PID rejection, own-instance stop and cleanup');

  let requests = 0;
  conflictServer = createServer((_request, response) => { requests += 1; response.end('unrelated-service'); });
  await new Promise(resolve => conflictServer.listen(port, '127.0.0.1', resolve));
  const unrelatedConflict = await complete(run([executable, 'start', '--no-open', '--port', String(port)]));
  assert.equal(unrelatedConflict.code, 1);
  assert.equal((await rawRequest('/')).body.toString(), 'unrelated-service');
  const unrelatedStop = await complete(run([executable, 'stop']));
  assert.equal(unrelatedStop.code, 0, 'No state means no service to stop');
  assert.equal((await rawRequest('/')).body.toString(), 'unrelated-service');
  assert(requests >= 2);
  await new Promise(resolve => conflictServer.close(resolve));
  conflictServer = undefined;
  checks.push('Occupied port leaves an unrelated HTTP service running; stop never sends process signals');

  // Exercise a delivered platform launcher, from outside the package directory.
  const launcher = process.platform === 'win32'
    ? spawn('cmd.exe', ['/d', '/c', join(packageRoot, 'start.bat'), '--no-open', '--port', String(port)], { cwd: temp, env: { ...process.env, KEEPANY_PREVIEW_NO_OPEN: '1', KEEPANY_PREVIEW_NO_PAUSE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn('sh', [join(packageRoot, process.platform === 'darwin' ? 'start.command' : 'start.sh'), '--no-open', '--port', String(port)], { cwd: temp, env: { ...process.env, KEEPANY_PREVIEW_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(launcher);
  let launcherOutput = '';
  launcher.stdout.on('data', bytes => { launcherOutput += bytes; });
  launcher.stderr.on('data', bytes => { launcherOutput += bytes; });
  const launchProcess = { child: launcher, output: () => launcherOutput, exited: new Promise(resolve => launcher.once('exit', code => { children.delete(launcher); resolve({ code, output: launcherOutput }); })) };
  await waitForState(launchProcess);
  assert.equal((await rawRequest('/')).status, 200);
  assert.equal((await complete(run([executable, 'stop']))).code, 0);
  assert.equal((await complete(launchProcess)).code, 0);
  checks.push(`Delivered ${process.platform} launcher starts without repository or project dependencies, then stops cleanly`);

  console.log(JSON.stringify({ archive: archivePath, platform: process.platform, sourceCommit: release.sourceCommit, sourceDirty: release.sourceDirty, webFiles: release.webFiles.length, checks }, null, 2));
} finally {
  if (packageRoot) {
    try {
      const stopProcess = run([join(packageRoot, 'preview-server.mjs'), 'stop']);
      await complete(stopProcess, 4000);
    } catch {}
  }
  for (const child of children) child.kill('SIGTERM');
  if (conflictServer) await new Promise(resolve => conflictServer.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
