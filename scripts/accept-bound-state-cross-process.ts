/**
 * Cross-process synthetic bound-state acceptance. Run with:
 *   KEEPANY_TEST_DATABASE_URL=<isolated PostgreSQL URL> node --import tsx scripts/accept-bound-state-cross-process.ts
 *
 * The commercial process is an archive of the fixed reviewed commit. It never
 * writes to the adjacent commercial checkout. Test credentials stay in its
 * mode-0600 fixture file and are never printed by this script.
 */
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, type KeyObject } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';
import pg from 'pg';
import { migrateSyncDatabase } from '../apps/sync-server/src/migrate';

const FIXED_COMMERCIAL_COMMIT = '7589b6d';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const commercialCheckout = resolve(root, '../KeepAnyAdm');
const bindingBase = '/api/keepany/v1/bindings';
const sleep = (ms: number) => new Promise(resolveWait => setTimeout(resolveWait, ms));

type Fixture = { origin: string; secretsPath: string; child: ChildProcess };
type Envelope<T> = { code: number; message: string; data?: T };
type Challenge = { deviceCode: string; userCode: string };
type Poll = { status: string; bindingId?: string; refreshToken?: string; subject?: string };
type Refreshed = { accessToken: string; bindingId: string; subject: string; status: string };

async function availablePort(): Promise<number> {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  if (!address || typeof address === 'string') throw Error('Could not allocate loopback port');
  await new Promise<void>((resolveClose, rejectClose) => listener.close(error => error ? rejectClose(error) : resolveClose()));
  return address.port;
}

async function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(resolveExit => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 7_000);
    child.once('exit', () => { clearTimeout(timeout); resolveExit(); });
    child.kill('SIGTERM');
  });
}

async function commercialSnapshot(destination: string): Promise<void> {
  const type = execFileSync('git', ['cat-file', '-t', FIXED_COMMERCIAL_COMMIT], { cwd: commercialCheckout, encoding: 'utf8' }).trim();
  assert.equal(type, 'commit', 'Reviewed commercial commit is absent');
  const committedLock = execFileSync('git', ['show', `${FIXED_COMMERCIAL_COMMIT}:pnpm-lock.yaml`], {
    cwd: commercialCheckout, maxBuffer: 8 * 1024 * 1024,
  });
  assert.ok(committedLock.equals(await readFile(join(commercialCheckout, 'pnpm-lock.yaml'))),
    'Installed commercial dependencies do not match the reviewed commit lockfile');
  await mkdir(destination);
  const archive = execFileSync('git', ['archive', '--format=tar', FIXED_COMMERCIAL_COMMIT], {
    cwd: commercialCheckout, maxBuffer: 256 * 1024 * 1024,
  });
  execFileSync('tar', ['-xf', '-', '-C', destination], { input: archive });
  // Copy dependencies with APFS clone files. A node_modules symlink resolves
  // Vite/Nitro modules outside the archived source root and breaks dev SSR.
  // This reads the live checkout's installed packages without changing it.
  execFileSync('cp', [process.platform === 'darwin' ? '-cR' : '-R',
    join(commercialCheckout, 'node_modules'), join(destination, 'node_modules')]);
  // KeepAnyAdm generates schema.ts from the checked-in provider-specific file.
  await copyFile(join(destination, 'src/config/db/schema.sqlite.ts'), join(destination, 'src/config/db/schema.ts'));
  // The fixture's sole pnpm call is `pnpm exec drizzle-kit ...`. The archived
  // tree has no pnpm install metadata; invoke the cloned binary directly.
  await mkdir(join(destination, '.accept-bin'));
  await writeFile(join(destination, '.accept-bin/pnpm'),
    '#!/bin/sh\n[ "$1" = exec ] && [ "$2" = drizzle-kit ] || exit 64\nshift 2\nexec "$PWD/node_modules/.bin/drizzle-kit" "$@"\n',
    { mode: 0o755 });
  // The generated Paraglide runtime is gitignored. Precompile from the
  // archived messages so SSR can import it on the very first Vite request.
  execFileSync(join(destination, 'node_modules/.bin/paraglide-js'), [
    'compile', '--project', './project.inlang', '--outdir', './src/paraglide',
    '--strategy', 'url', 'cookie', 'baseLocale', '--output-structure', 'message-modules', '--silent',
  ], { cwd: destination, timeout: 45_000, maxBuffer: 2 * 1024 * 1024 });
}

async function startCommercial(snapshot: string, fixtureRoot: string): Promise<Fixture> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/binding-integration-server.ts', '--bound-state-fixture'], {
    cwd: snapshot, env: { ...process.env, TMPDIR: fixtureRoot,
      PATH: `${join(snapshot, '.accept-bin')}:${process.env.PATH ?? ''}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderrBytes = 0;
  let stderrTail = '';
  let viteLogTail = '';
  child.stdout?.on('data', chunk => { stdout = `${stdout}${String(chunk)}`.slice(-16_384); });
  // Drain without echoing any fixture output or credentials.
  child.stderr?.on('data', chunk => {
    stderrBytes += Buffer.byteLength(chunk);
    stderrTail = `${stderrTail}${String(chunk)}`.slice(-500);
  });
  try {
    for (let attempt = 0; attempt < 300; attempt++) {
      const dirs = await readdir(fixtureRoot).catch(() => []);
      for (const dir of dirs) {
        if (dir.startsWith('keepany-binding-integration-')) {
          viteLogTail = (await readFile(join(fixtureRoot, dir, 'vite.log'), 'utf8').catch(() => '')).slice(-2_000);
        }
      }
      if (child.exitCode !== null) {
        const hint = /Cannot find package|Cannot find module|Temporary fixture schema setup failed|Run pnpm db:setup|spawn pnpm ENOENT/.exec(stderrTail)?.[0] ?? '';
        const outputHint = stdout.includes('ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY') ? 'pnpm install metadata mismatch' : '';
        const viteHint = viteLogTail.includes('ERR_LOAD_URL') ? 'Vite module resolution failed' : '';
        throw Error(`Commercial fixture exited before ready (${child.exitCode}, stderr bytes ${stderrBytes}, Vite log bytes ${viteLogTail.length}${hint ? `, ${hint}` : ''}${outputHint ? `, ${outputHint}` : ''}${viteHint ? `, Vite: ${viteHint}` : ''})`);
      }
      const origin = stdout.match(/^Commercial fixture: (http:\/\/127\.0\.0\.1:\d+)$/m)?.[1];
      const secretsPath = stdout.match(/^Private test material \(mode 0600, read locally if needed\): (.+)$/m)?.[1];
      if (origin && secretsPath && stdout.includes('Synthetic binding ID:')) return { origin, secretsPath, child };
      await sleep(200);
    }
    throw Error(`Commercial fixture start timed out (stderr bytes ${stderrBytes})`);
  } catch (error) {
    await stop(child);
    throw error;
  }
}

async function ready(origin: string, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw Error(`Sync server exited before ready (${child.exitCode})`);
    try {
      const response = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(1_000) });
      if (response.status === 200) return;
    } catch { /* Startup is still in progress. */ }
    await sleep(100);
  }
  throw Error('Sync server did not become ready');
}

async function post<T>(origin: string, path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  const envelope = await response.json() as Envelope<T>;
  assert.equal(response.status, 200, `${path} HTTP ${response.status}`);
  assert.equal(envelope.code, 0, `${path} rejected`);
  assert.ok(envelope.data, `${path} returned no data`);
  return envelope.data;
}

function proof(key: KeyObject, jwk: JsonWebKey,
  method: string, url: string, token: string): Promise<string> {
  return new SignJWT({ htm: method, htu: url, ath: createHash('sha256').update(token).digest('base64url') })
    .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk })
    .setJti(randomBytes(32).toString('base64url'))
    .setIssuedAt(Math.floor(Date.now() / 1000))
    .sign(key);
}

async function authenticatedResource(origin: string, path: string, method: 'GET' | 'POST',
  accessToken: string, key: KeyObject, jwk: JsonWebKey): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method,
    headers: { Authorization: `DPoP ${accessToken}`, DPoP: await proof(key, jwk, method, `${origin}${path}`, accessToken),
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
    ...(method === 'POST' ? { body: '{}' } : {}),
    signal: AbortSignal.timeout(8_000),
  });
}

async function waitForRevocation(pool: pg.Pool, bindingId: string): Promise<void> {
  for (let attempt = 0; attempt < 35; attempt++) {
    const result = await pool.query<{ status: string }>('SELECT status FROM sync_bound_bindings WHERE binding_id=$1', [bindingId]);
    if (result.rows[0]?.status === 'revoked') return;
    await sleep(300);
  }
  throw Error('Background feed did not observe revocation within ten seconds');
}

async function waitForRenewedLease(pool: pg.Pool, bindingId: string, previousObservation: Date): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const result = await pool.query<{ observed: Date; fresh: boolean }>(
      "SELECT state_observed_at AS observed, state_expires_at > CURRENT_TIMESTAMP + INTERVAL '2 seconds' AS fresh " +
      'FROM sync_bound_bindings WHERE binding_id=$1 AND status=$2', [bindingId, 'active']);
    if (result.rows[0]?.fresh && result.rows[0].observed > previousObservation) return;
    await sleep(300);
  }
  throw Error('Background feed did not renew after commercial recovery');
}

function viteChildPid(fixture: Fixture, snapshot: string): number {
  const processes = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' });
  for (const line of processes.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (match && Number(match[2]) === fixture.child.pid &&
      match[3].includes(`${snapshot}/node_modules/vite/bin/vite.js dev`)) return Number(match[1]);
  }
  throw Error('Could not identify this fixture Vite child');
}

async function main(): Promise<void> {
  const databaseUrl = process.env.KEEPANY_TEST_DATABASE_URL;
  if (!databaseUrl) throw Error('KEEPANY_TEST_DATABASE_URL is required');
  const temporary = await mkdtemp(join(tmpdir(), 'keepany-bound-cross-'));
  const snapshot = join(temporary, 'commercial');
  const fixtureRoot = join(temporary, 'fixture-tmp');
  const schema = `keepany_cross_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5_000 });
  const scoped = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 4,
    connectionTimeoutMillis: 5_000 });
  let commercial: Fixture | undefined;
  let syncServer: ChildProcess | undefined;
  let schemaCreated = false;
  try {
    await commercialSnapshot(snapshot);
    await mkdir(fixtureRoot);
    commercial = await startCommercial(snapshot, fixtureRoot);
    const secretStat = await stat(commercial.secretsPath);
    assert.equal(secretStat.mode & 0o077, 0, 'Commercial fixture secret file is not private');
    const secrets = JSON.parse(await readFile(commercial.secretsPath, 'utf8')) as {
      email: string; password: string; readerPrivatePem: string;
    };
    assert.ok(secrets.email && secrets.password && secrets.readerPrivatePem);
    const readerKeyPath = join(temporary, 'reader-private.pem');
    await writeFile(readerKeyPath, secrets.readerPrivatePem, { mode: 0o600 });
    const jwksResponse = await fetch(`${commercial.origin}/.well-known/jwks.json`, { signal: AbortSignal.timeout(5_000) });
    assert.equal(jwksResponse.status, 200);
    const commercialJwks = await jwksResponse.json();

    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    await migrateSyncDatabase(scoped);
    const syncOrigin = `http://127.0.0.1:${await availablePort()}`;
    syncServer = spawn(process.execPath, ['--import', 'tsx', 'apps/sync-server/src/main.ts'], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: {
        ...process.env, DATABASE_URL: databaseUrl, PGOPTIONS: `-c search_path=${schema}`,
        KEEPANY_SYNC_AUTH_MODE: 'bound', KEEPANY_SYNC_TOKEN: '',
        KEEPANY_BOUND_ISSUER: commercial.origin, KEEPANY_SYNC_PUBLIC_ORIGIN: syncOrigin,
        KEEPANY_BOUND_JWKS_JSON: JSON.stringify(commercialJwks),
        KEEPANY_BOUND_STATE_COMMERCIAL_ORIGIN: commercial.origin,
        KEEPANY_BOUND_STATE_READER_ISSUER: commercial.origin,
        KEEPANY_BOUND_STATE_READER_KID: 'binding-state-reader-local',
        KEEPANY_BOUND_STATE_READER_PRIVATE_KEY_FILE: readerKeyPath,
        HOST: '127.0.0.1', PORT: new URL(syncOrigin).port,
      },
    });
    let syncErrorBytes = 0;
    syncServer.stdout?.on('data', () => {});
    syncServer.stderr?.on('data', chunk => { syncErrorBytes += Buffer.byteLength(chunk); });
    await ready(syncOrigin, syncServer).catch(() => { throw Error(`Sync server failed to start (stderr bytes ${syncErrorBytes})`); });

    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const publicJwk = keyPair.publicKey.export({ format: 'jwk' }) as JsonWebKey;
    const challenge = await post<Challenge>(commercial.origin, `${bindingBase}/device`, {
      instanceId: randomBytes(32).toString('base64url'), instanceName: 'Synthetic cross-process writer test',
      scopes: ['sync:read', 'sync:write'], devicePublicKey: publicJwk,
    });
    const login = await fetch(`${commercial.origin}/api/auth/sign-in/email`, {
      method: 'POST', headers: { Origin: commercial.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: secrets.email, password: secrets.password }), signal: AbortSignal.timeout(8_000),
    });
    assert.equal(login.status, 200, 'Synthetic commercial account login failed');
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie, 'Synthetic login did not issue a session cookie');
    const accountHeaders = { Origin: commercial.origin, Cookie: cookie };
    const verified = await post<{ status: string }>(commercial.origin, `${bindingBase}/verify`,
      { userCode: challenge.userCode }, accountHeaders);
    assert.equal(verified.status, 'pending');
    const decision = await post<{ status: string; bindingId: string }>(commercial.origin, `${bindingBase}/decision`,
      { userCode: challenge.userCode, decision: 'approve' }, accountHeaders);
    assert.equal(decision.status, 'approved');
    const polled = await post<Poll>(commercial.origin, `${bindingBase}/poll`, { deviceCode: challenge.deviceCode });
    assert.equal(polled.status, 'approved');
    assert.equal(polled.bindingId, decision.bindingId);
    assert.ok(polled.refreshToken);
    const refreshPath = `${bindingBase}/refresh`;
    const refreshed = await post<Refreshed>(commercial.origin, refreshPath, {
      bindingId: decision.bindingId, refreshToken: polled.refreshToken,
      requestId: randomBytes(32).toString('base64url'),
    }, { DPoP: await proof(keyPair.privateKey, publicJwk, 'POST', `${commercial.origin}${refreshPath}`, polled.refreshToken) });
    assert.equal(refreshed.status, 'active');
    assert.equal(refreshed.bindingId, decision.bindingId);
    assert.equal(refreshed.subject, polled.subject);
    const before = await scoped.query('SELECT 1 FROM sync_bound_bindings WHERE binding_id=$1', [decision.bindingId]);
    assert.equal(before.rowCount, 0, 'The second device must enter through first-proof bootstrap');

    const resource = await authenticatedResource(syncOrigin, '/workspaces', 'POST', refreshed.accessToken,
      keyPair.privateKey, publicJwk);
    assert.equal(resource.status, 201, `First bound resource request returned ${resource.status}`);
    const workspace = await resource.json() as { workspaceId: string };
    assert.ok(workspace.workspaceId);
    const active = await scoped.query<{ status: string; subject: string; epoch: string; observed: Date }>(
      'SELECT status,subject,epoch,state_observed_at AS observed FROM sync_bound_bindings WHERE binding_id=$1',
      [decision.bindingId]);
    assert.equal(active.rows[0]?.status, 'active');
    assert.equal(active.rows[0]?.subject, refreshed.subject);
    console.info('Cross-process: HTTP device approval, refresh, first-proof state bootstrap, and /workspaces 201 passed.');

    // Pause only the temporary commercial HTTP child. Its parent fixture and
    // SQLite state remain alive, so resuming tests a real network recovery.
    const commercialHttpPid = viteChildPid(commercial, snapshot);
    process.kill(commercialHttpPid, 'SIGSTOP');
    try {
      await sleep(11_000);
      const expired = await scoped.query<{ expired: boolean }>(
        'SELECT state_expires_at <= CURRENT_TIMESTAMP AS expired FROM sync_bound_bindings WHERE binding_id=$1',
        [decision.bindingId]);
      assert.equal(expired.rows[0]?.expired, true, 'The commercial outage must not renew a local lease');
      const unavailable = await authenticatedResource(syncOrigin, '/sync/identity', 'POST', refreshed.accessToken,
        keyPair.privateKey, publicJwk);
      assert.equal(unavailable.status, 401, 'Expired commercial state lease must deny resource access');
    } finally {
      process.kill(commercialHttpPid, 'SIGCONT');
    }
    await waitForRenewedLease(scoped, decision.bindingId, active.rows[0].observed);
    const recovered = await authenticatedResource(syncOrigin, '/sync/identity', 'POST', refreshed.accessToken,
      keyPair.privateKey, publicJwk);
    assert.equal(recovered.status, 200, 'Fresh signed state must restore resource access');
    console.info('Cross-process: commercial HTTP outage expired the state lease (401); recovered signed state restored access (200).');

    const revoked = await post<{ status: string }>(commercial.origin, `${bindingBase}/revoke`,
      { bindingId: decision.bindingId }, accountHeaders);
    assert.equal(revoked.status, 'revoked');
    await waitForRevocation(scoped, decision.bindingId);
    const denied = await authenticatedResource(syncOrigin, '/sync/identity', 'POST', refreshed.accessToken,
      keyPair.privateKey, publicJwk);
    assert.equal(denied.status, 401, 'Commercial revocation must block the resource server');
    console.info('Cross-process: commercial HTTP revoke reached PostgreSQL tombstone; existing token received /sync/identity 401.');
  } finally {
    try {
      await Promise.allSettled([stop(syncServer), stop(commercial?.child)]);
      await scoped.end();
      try {
        if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await admin.end();
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}

await main().catch(error => {
  console.error(`Cross-process acceptance failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
