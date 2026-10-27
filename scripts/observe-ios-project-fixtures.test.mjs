import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { test } from 'vitest';
import { DATABASE_RELATIVE_PATH, FIXTURE_QUERY, createProjectFixtureObserver, createSimctlContainerResolver, querySqliteReadonly } from './observe-ios-project-fixtures.mjs';

const fixture = (language = 'en', token = 'aBcD1234', id = randomUUID()) => ({
  recordId: `asset:${id}`, payload: { id, kind: 'project', name: `iOS simulator persistence fixture full-fields ${language} ${token}`, description: 'synthetic complete project' },
});
const outputLines = rows => rows.map(row => JSON.stringify(row)).join('\n');
async function environment(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'keepany-observer-')));
  const relativeRoot = path.relative(await fs.realpath(os.tmpdir()), root);
  assert.ok(!relativeRoot.startsWith('..') && !path.isAbsolute(relativeRoot) && path.basename(root).startsWith('keepany-observer-'));
  const appData = path.join(root, 'app data'); const output = path.join(root, 'own observer output');
  await fs.mkdir(appData); t.onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  const database = path.join(appData, DATABASE_RELATIVE_PATH);
  async function createDatabase(rows) {
    await fs.mkdir(path.dirname(database), { recursive: true });
    const db = new DatabaseSync(database);
    try {
      db.exec('CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, type TEXT, payload TEXT)');
      const insert = db.prepare('INSERT OR REPLACE INTO records VALUES (?,?,?)');
      for (const row of rows) insert.run(row.recordId, row.type ?? 'asset', JSON.stringify(row.payload));
    } finally { db.close(); }
  }
  async function sqliteRunner(filename) {
    assert.equal(filename, database);
    const db = new DatabaseSync(filename, { readOnly: true });
    try { return db.prepare(FIXTURE_QUERY).all().map(row => Object.values(row)[0]).join('\n'); }
    finally { db.close(); }
  }
  async function observe(options = {}) {
    const observer = await createProjectFixtureObserver({ appData, output, runQuery: sqliteRunner, ...options });
    t.onTestFinished(() => observer.finish(false)); return observer;
  }
  const readRows = async () => (await fs.readFile(path.join(output, 'fixtures.ndjson'), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  return { root, appData, output, database, createDatabase, sqliteRunner, observe, readRows };
}

test('real synthetic SQLite: both exact languages/uppercase marker retained; non-assets, kinds and broad prefix excluded; source unchanged', async t => {
  const env = await environment(t); const en = fixture(); const zh = fixture('zh-Hans', 'ABCDEF09');
  const otherKind = fixture(); otherKind.payload.kind = 'account';
  const otherType = { ...fixture(), type: 'task' };
  const wrongLanguage = fixture('zh-CN'); const trailing = fixture(); trailing.payload.name += ' unrelated';
  const invalidId = fixture(); invalidId.payload.id = randomUUID();
  await env.createDatabase([en, zh, otherKind, otherType, wrongLanguage, trailing, invalidId]);
  const before = createHash('sha256').update(await fs.readFile(env.database)).digest('hex');
  const observer = await env.observe({ now: () => new Date('2026-10-28T00:00:00Z') }); await observer.pollOnce();
  assert.notEqual(observer.summary().successfulQueries, 0, JSON.stringify(observer.summary()));
  const rows = await env.readRows();
  assert.deepEqual(new Set(rows.map(row => row.recordId)), new Set([en.recordId, zh.recordId]));
  assert.ok(rows.every(row => row.observedAt === '2026-10-28T00:00:00.000Z'));
  assert.deepEqual(rows.find(row => row.recordId === en.recordId).payload, en.payload);
  assert.equal(observer.summary().invalidRows, 1); assert.equal(observer.summary().filteredRows, 1);
  assert.equal(observer.summary().errors['row-rejected'], 1);
  assert.equal(createHash('sha256').update(await fs.readFile(env.database)).digest('hex'), before);
});

test('same SQL ID is observed before rename and after rename; unchanged/reordered JSON dedupes, different ID is retained', async t => {
  const env = await environment(t); const en = fixture(); const zh = fixture('zh-Hans');
  await env.createDatabase([en, zh]); const observer = await env.observe();
  await observer.pollOnce(); await observer.pollOnce();
  en.payload = { description: en.payload.description, name: en.payload.name, kind: en.payload.kind, id: en.payload.id };
  await env.createDatabase([en]); await observer.pollOnce(); assert.equal((await env.readRows()).length, 2);
  en.payload = { description: en.payload.description, name: `${en.payload.name} renamed`, kind: en.payload.kind, id: en.payload.id };
  await env.createDatabase([en]); await observer.pollOnce(); await observer.pollOnce();
  const other = fixture('en', 'aBcD1234'); await env.createDatabase([other]); await observer.pollOnce();
  const rows = await env.readRows(); const history = rows.filter(row => row.recordId === en.recordId);
  assert.equal(rows.length, 4); assert.equal(history.length, 2);
  assert.equal(history[0].payload.name.endsWith(' renamed'), false); assert.equal(history[1].payload.name.endsWith(' renamed'), true);
  assert.equal(history[0].payload.id, history[1].payload.id); assert.equal(observer.summary().distinctRecordIds, 3);
  assert.equal(observer.summary().appendedSnapshots, 4);
});

test('missing exact DB never spawns/creates one; later real database can be observed', async t => {
  const env = await environment(t); let queries = 0;
  const observer = await env.observe({ runQuery: async (...args) => { queries++; return env.sqliteRunner(...args); } });
  await observer.pollOnce(); assert.equal(queries, 0); assert.equal(observer.summary().hasObservations, false);
  assert.equal(observer.summary().successfulQueries, 0); assert.equal(observer.summary().errors['database-missing'], 1);
  await assert.rejects(fs.stat(env.database), { code: 'ENOENT' });
  await env.createDatabase([fixture()]); await observer.pollOnce(); assert.equal(queries, 1); assert.equal((await env.readRows()).length, 1);
});

test('verification: real SQLite observes one marker per language with stable original ID/full payload despite property order and updatedAt changes', async t => {
  const env = await environment(t); const en = fixture(); const zh = fixture('zh-Hans', 'ABCDEF01');
  en.payload.url = 'https://synthetic.example.invalid/'; en.payload.tags = ['one', 'two']; en.payload.updatedAt = 1;
  await env.createDatabase([en, zh]); const observer = await env.observe(); await observer.pollOnce();
  assert.equal(observer.summary().verification.status, 'partial');
  en.payload = { tags: en.payload.tags, url: en.payload.url, id: en.payload.id, name: `${en.payload.name} renamed`, kind: en.payload.kind, description: en.payload.description, updatedAt: 2 };
  zh.payload.name += ' renamed'; await env.createDatabase([en, zh]); await observer.pollOnce(); await observer.finish(true);
  const verification = JSON.parse(await fs.readFile(path.join(env.output, 'summary.json'), 'utf8')).verification;
  assert.equal(verification.complete, true); assert.equal(verification.status, 'verified');
  for (const language of ['en', 'zh-Hans']) assert.deepEqual(verification.languages[language], { markers: 1, originalSnapshots: 1, renamedSnapshots: 1 });
});

test('verification rejects same marker renamed under another SQL/payload ID', async t => {
  const env = await environment(t); const en = fixture(); const zh = fixture('zh-Hans');
  await env.createDatabase([en, zh]); const observer = await env.observe(); await observer.pollOnce();
  const replacement = fixture('en', 'aBcD1234'); replacement.payload.name += ' renamed'; zh.payload.name += ' renamed';
  await env.createDatabase([replacement, zh]); await observer.pollOnce();
  assert.equal(observer.summary().verification.complete, false); assert.equal(observer.summary().verification.status, 'identity-changed');
});

test('verification rejects change to any non-name/non-updatedAt field even with same ID', async t => {
  const env = await environment(t); const en = fixture(); const zh = fixture('zh-Hans');
  en.payload.nested = { flags: ['keep'], status: 'active' }; await env.createDatabase([en, zh]);
  const observer = await env.observe(); await observer.pollOnce();
  en.payload.name += ' renamed'; en.payload.nested.flags.push('unexpected'); zh.payload.name += ' renamed';
  await env.createDatabase([en, zh]); await observer.pollOnce();
  assert.equal(observer.summary().verification.complete, false); assert.equal(observer.summary().verification.status, 'payload-changed');
});

test('verification rejects missing first-save stage, empty observations and ambiguous extra markers', async t => {
  const env = await environment(t); await env.createDatabase([]); const observer = await env.observe();
  await observer.pollOnce(); assert.equal(observer.summary().verification.status, 'none');
  const en = fixture(); en.payload.name += ' renamed'; const zh = fixture('zh-Hans'); zh.payload.name += ' renamed';
  await env.createDatabase([en, zh]); await observer.pollOnce();
  assert.equal(observer.summary().verification.status, 'partial'); assert.equal(observer.summary().verification.complete, false);
  en.payload.name = en.payload.name.replace(/ renamed$/, ''); zh.payload.name = zh.payload.name.replace(/ renamed$/, '');
  await env.createDatabase([en, zh]); await observer.pollOnce(); assert.equal(observer.summary().verification.status, 'invalid-sequence');
  await env.createDatabase([fixture('en', '00000000')]); await observer.pollOnce();
  assert.equal(observer.summary().verification.status, 'ambiguous-markers'); assert.equal(observer.summary().verification.complete, false);
});

test('no DB scan: a valid-looking different database does not substitute for the exact business DB', async t => {
  const env = await environment(t); const control = new DatabaseSync(path.join(env.appData, 'control.db'));
  control.exec('CREATE TABLE records (id TEXT, type TEXT, payload TEXT)'); control.close();
  const observer = await env.observe({ runQuery: () => { assert.fail('must not query a different database'); } });
  await observer.pollOnce(); assert.equal(observer.summary().errors['database-missing'], 1); assert.equal((await env.readRows()).length, 0);
});

test('query failures/malformed output cannot claim empty success; later explicit poll retries without replay', async t => {
  const env = await environment(t); await env.createDatabase([]); let attempt = 0;
  const observer = await env.observe({ runQuery: async () => {
    attempt++;
    if (attempt === 1) throw Object.assign(new Error('private stderr must not appear'), { observerCode: 'private-diagnostic-code' });
    if (attempt === 2) throw Object.assign(new Error('private locked database path'), { observerCode: 'query-busy' });
    if (attempt === 3) return '{broken private content';
    return outputLines([fixture()]);
  } });
  for (let index = 0; index < 3; index++) await observer.pollOnce();
  assert.equal(observer.summary().successfulQueries, 0); assert.equal(observer.summary().hasObservations, false);
  assert.deepEqual(observer.summary().errors, { 'observer-failed': 1, 'query-busy': 1, 'query-invalid-json': 1 });
  assert.equal((await env.readRows()).length, 0); await observer.pollOnce(); assert.equal(observer.summary().appendedSnapshots, 1);
  await observer.finish(true);
  const summary = await fs.readFile(path.join(env.output, 'summary.json'), 'utf8'); assert.doesNotMatch(summary, /private|stderr|content|path/);
});

test('JS exact marker/id/type verification rejects broader or malformed runner rows rather than leaking them', async t => {
  const env = await environment(t); await env.createDatabase([]);
  const lower = fixture('en', '12345678'); const invalidName = fixture('en', '123456789');
  const badId = fixture(); badId.recordId = `asset:not-a-uuid`;
  const withExtra = { ...fixture(), raw: 'must never persist' };
  const wrongKind = fixture(); wrongKind.payload.kind = 'account';
  const observer = await env.observe({ runQuery: async () => outputLines([lower, invalidName, badId, withExtra, wrongKind, null]) });
  await observer.pollOnce(); assert.deepEqual((await env.readRows()).map(row => row.recordId), [lower.recordId]);
  assert.equal(observer.summary().invalidRows, 3); assert.equal(observer.summary().filteredRows, 2);
  assert.doesNotMatch(await fs.readFile(path.join(env.output, 'fixtures.ndjson'), 'utf8'), /must never persist/);
});

test('row/output budgets fail closed without truncating into an apparent success', async t => {
  const env = await environment(t); await env.createDatabase([]); let large = false;
  const observer = await env.observe({ runQuery: async () => large ? 'x'.repeat(2 * 1024 * 1024 + 1) : outputLines(Array.from({ length: 129 }, () => fixture())) });
  await observer.pollOnce(); large = true; await observer.pollOnce();
  assert.deepEqual(observer.summary().errors, { 'query-row-limit': 1, 'query-output-limit': 1 });
  assert.equal(observer.summary().successfulQueries, 0); assert.equal((await env.readRows()).length, 0);
});

test('SIGINT/TERM-style abort during wait is normal stop without claiming missing DB was observed', async t => {
  const env = await environment(t); const controller = new AbortController(); const observer = await env.observe({ intervalMs: 10 });
  const result = observer.run({ signal: controller.signal });
  while (observer.summary().polls < 1) await new Promise(resolve => setTimeout(resolve, 1));
  controller.abort(); const summary = await result;
  assert.equal(summary.normalStop, true); assert.equal(summary.status, 'stopped-without-observations');
  assert.equal(summary.hasObservations, false); assert.equal(summary.errors['database-missing'], 1);
});

test('real owned ChildProcess abort waits for close; command arguments remain readonly and shell-free', async () => {
  const controller = new AbortController(); let child; let closed = false; let ready;
  const started = new Promise(resolve => { ready = resolve; });
  const query = querySqliteReadonly('synthetic-db-path', { signal: controller.signal, execFileImpl: (command, args, options, callback) => {
    assert.equal(command, 'sqlite3'); assert.equal(args[0], '-readonly'); assert.equal(args.at(-1), FIXTURE_QUERY);
    assert.equal(args.at(-2), 'synthetic-db-path'); assert.equal(options.shell, undefined); assert.equal(options.maxBuffer, 2 * 1024 * 1024); assert.equal(options.timeout, 1500);
    child = execFile(process.execPath, ['-e', 'process.stdout.write("ready"); setInterval(()=>{},1000)'], options, callback);
    child.stdout.once('data', ready); child.once('close', () => { closed = true; }); return child;
  } });
  await started; controller.abort(); await assert.rejects(query, { observerCode: 'query-cancelled' });
  assert.equal(closed, true); assert.ok(child.exitCode !== null || child.signalCode !== null);
});

test('real owned child timeout is bounded and close completes before returning the fixed error', async () => {
  let child; let closed = false;
  const query = querySqliteReadonly('synthetic-db-path', { execFileImpl: (_command, _args, options, callback) => {
    child = execFile(process.execPath, ['-e', 'setInterval(()=>{},1000)'], options, callback);
    child.once('close', () => { closed = true; }); return child;
  } });
  await assert.rejects(query, { observerCode: 'query-timeout' }); assert.equal(closed, true); assert.equal(child.killed, true);
});

test('sqlite failure categories expose fixed codes only, and already-aborted calls spawn nothing', async () => {
  for (const [error, stderr, expected] of [
    [{ code: 'ENOENT' }, 'private binary path', 'sqlite-unavailable'],
    [{ code: 1 }, 'Error: database is locked at private path', 'query-busy'],
    [{ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, 'private bytes', 'query-output-limit'],
    [{ code: 1 }, 'private unknown error', 'query-failed'],
  ]) {
    const query = querySqliteReadonly('synthetic-db-path', { execFileImpl: (_command, _args, _options, callback) => {
      const child = new EventEmitter(); queueMicrotask(() => { callback(error, 'private stdout', stderr); child.emit('close'); }); return child;
    } });
    await assert.rejects(query, error => error.observerCode === expected && error.message === expected);
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(querySqliteReadonly('synthetic-db-path', { signal: controller.signal, execFileImpl: () => assert.fail('must not spawn') }), { observerCode: 'query-cancelled' });
});

test('inflight observer abort passes signal, waits runner cleanup, and writes no late snapshot', async t => {
  const env = await environment(t); await env.createDatabase([]); const controller = new AbortController(); let entered; let cleaned = false;
  const started = new Promise(resolve => { entered = resolve; });
  const observer = await env.observe({ runQuery: async (_database, { signal }) => {
    entered(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    await new Promise(resolve => setTimeout(resolve, 15)); cleaned = true;
    return outputLines([fixture()]);
  } });
  const result = observer.run({ signal: controller.signal }); await started; controller.abort(); const summary = await result;
  assert.equal(cleaned, true); assert.equal(summary.normalStop, true); assert.equal(summary.appendedSnapshots, 0); assert.equal((await env.readRows()).length, 0);
});

test('existing output is not overwritten, and output inside app-data is rejected', async t => {
  const env = await environment(t); await fs.mkdir(env.output); await fs.writeFile(path.join(env.output, 'fixtures.ndjson'), 'existing-marker');
  await assert.rejects(env.observe(), { observerCode: 'output-unavailable' });
  assert.equal(await fs.readFile(path.join(env.output, 'fixtures.ndjson'), 'utf8'), 'existing-marker');
  await assert.rejects(createProjectFixtureObserver({ appData: env.appData, output: path.join(env.appData, 'output') }), { observerCode: 'output-inside-app-data' });
});

test('CLI invalid arguments emit only fixed public metadata, never the supplied private argument', async () => {
  const result = await new Promise(resolve => execFile(process.execPath, [path.resolve('scripts/observe-ios-project-fixtures.mjs'), '--private-marker'], (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error.code, 1); assert.equal(result.stderr, ''); assert.doesNotMatch(result.stdout, /private-marker/);
  assert.deepEqual(JSON.parse(result.stdout), { observer: 'ios-project-fixtures', status: 'failed', code: 'observer-unavailable' });
});

const coded = code => Object.assign(new Error(`private diagnostic for ${code}`), { observerCode: code });
const simulatorId = '11111111-2222-4333-8444-555555555555';
const bundleId = 'io.github.syndred.keepany';
const renamed = rows => rows.map(row => ({ ...row, payload: { ...row.payload, name: `${row.payload.name} renamed` } }));
const pair = () => [fixture('en', '1234abcd'), fixture('zh-Hans', '1234dcba')];
const tuple = env => ({ simulatorId, bundleId, appData: env.appData });
const liveOptions = resolveContainer => ({ appData: undefined, simulatorId, bundleId, resolveContainer });

test('initial missing is waiting, then same real database reaches strict original/rename verification with history retained', async t => {
  const env = await environment(t); const rows = pair(); const observer = await env.observe();
  await observer.pollOnce();
  assert.equal(observer.summary().health.status, 'waiting'); assert.equal(observer.summary().verification.status, 'waiting');
  await env.createDatabase(rows); await observer.pollOnce();
  await env.createDatabase(renamed(rows)); await observer.pollOnce();
  const summary = observer.summary();
  assert.equal(summary.verification.complete, true); assert.equal(summary.health.status, 'healthy');
  assert.equal(summary.health.currentError, null); assert.equal(summary.health.fatalError, null);
  assert.equal(summary.errors['database-missing'], 1); assert.equal(summary.health.recoveries, 1);
  assert.equal(summary.errorCountsAreHistorical, true); assert.equal(summary.timing.query.calls, 2);
});

test('timeout and busy recover only after the same SQLite identity is proven healthy; completed evidence remains gated meanwhile', async t => {
  const env = await environment(t); const rows = pair(); let failure;
  await env.createDatabase(rows);
  const observer = await env.observe({ runQuery: (...args) => failure ? Promise.reject(coded(failure)) : env.sqliteRunner(...args) });
  await observer.pollOnce();
  for (const code of ['query-timeout', 'query-busy']) {
    failure = code; await observer.pollOnce();
    assert.equal(observer.summary().health.status, 'unavailable'); assert.equal(observer.summary().verification.complete, false);
    failure = undefined; await observer.pollOnce(); assert.equal(observer.summary().health.status, 'healthy');
  }
  await env.createDatabase(renamed(rows)); await observer.pollOnce();
  const summary = observer.summary(); assert.equal(summary.verification.complete, true);
  assert.deepEqual(summary.errors, { 'query-timeout': 1, 'query-busy': 1 }); assert.equal(summary.health.recoveries, 2);
  assert.equal(summary.binding.generations.length, 1); assert.equal(summary.timing.query.calls, 6);
  assert.ok(summary.timing.query.totalMs >= summary.timing.query.maxMs);
});

test('real corrupt SQLite remains fatal even after bytes in the same file are restored and later original/rename evidence appears', async t => {
  const env = await environment(t); const rows = pair(); await env.createDatabase(rows);
  const good = await fs.readFile(env.database); await fs.writeFile(env.database, Buffer.alloc(good.length, 0x61));
  let corruptReads = 0;
  const observer = await env.observe({ runQuery: async (...args) => {
    try { return await env.sqliteRunner(...args); }
    catch (error) { assert.match(error.message, /not a database|malformed/i); corruptReads++; throw coded('database-corrupt'); }
  } });
  await observer.pollOnce(); assert.equal(corruptReads, 1); assert.equal(observer.summary().health.fatalError, 'database-corrupt');
  await fs.writeFile(env.database, good); await observer.pollOnce();
  await env.createDatabase(renamed(rows)); await observer.pollOnce();
  assert.equal((await env.readRows()).length, 4);
  assert.equal(observer.summary().health.status, 'blocked'); assert.equal(observer.summary().verification.status, 'observation-error');
  assert.equal(observer.summary().verification.complete, false);
});

test('same path inode replacement cannot recover a timeout or merge evidence across a new SQLite generation', async t => {
  for (const firstTimeout of [false, true]) {
    const env = await environment(t); const rows = pair(); await env.createDatabase(rows); let queries = 0;
    const observer = await env.observe({ runQuery: async (...args) => {
      queries++; if (firstTimeout && queries === 1) throw coded('query-timeout'); return env.sqliteRunner(...args);
    } });
    await observer.pollOnce(); await fs.rename(env.database, `${env.database}.original`);
    await env.createDatabase(renamed(rows)); await observer.pollOnce();
    assert.equal(queries, 1); assert.equal(observer.summary().health.fatalError, 'database-generation-changed');
    assert.equal(observer.summary().verification.complete, false); assert.equal((await env.readRows()).length, firstTimeout ? 0 : 2);
  }
});

test('non-regular exact database is fatal and never substituted or queried', async t => {
  const env = await environment(t); await fs.mkdir(env.database, { recursive: true });
  const observer = await env.observe({ runQuery: () => assert.fail('non-regular file must not be queried') });
  await observer.pollOnce(); assert.equal(observer.summary().health.fatalError, 'database-not-regular');
  assert.equal(observer.summary().verification.complete, false); assert.equal((await env.readRows()).length, 0);
});

test('same container path with a replaced directory inode is fatal even before the first marker', async t => {
  const env = await environment(t); await env.createDatabase([]); let queries = 0;
  const observer = await env.observe({ ...liveOptions(async () => tuple(env)), runQuery: (...args) => {
    queries++; return env.sqliteRunner(...args);
  } });
  await observer.pollOnce(); await fs.rename(env.appData, `${env.appData} previous`); await fs.mkdir(env.appData);
  await env.createDatabase([]); await observer.pollOnce();
  assert.equal(queries, 1); assert.equal(observer.summary().health.fatalError, 'container-generation-changed');
  assert.equal(observer.summary().binding.generation, 1); assert.equal(observer.summary().verification.complete, false);
});

test('live binding adopts only an empty pre-marker generation, with stable before/after mapping and no old-container snapshots', async t => {
  const a = await environment(t); const b = await environment(t); await a.createDatabase([]); await b.createDatabase([]);
  let current = a; const queried = [];
  const observer = await a.observe({ ...liveOptions(async () => tuple(current)), runQuery: (...args) => {
    queried.push(args[0]); return current.sqliteRunner(...args);
  } });
  await observer.pollOnce();
  await a.createDatabase(pair()); current = b; await observer.pollOnce();
  const rows = pair(); await b.createDatabase(rows); await observer.pollOnce();
  await b.createDatabase(renamed(rows)); await observer.pollOnce();
  const summary = observer.summary(); assert.equal(summary.verification.complete, true); assert.equal(summary.binding.generation, 2);
  assert.deepEqual(queried, [a.database, b.database, b.database, b.database]);
  assert.ok((await a.readRows()).every(row => row.generation === 2 && rows.some(expected => expected.recordId === row.recordId)));
  assert.equal(summary.binding.baselineCaptured, true); assert.equal(summary.timing.resolver.calls, 9);
  assert.deepEqual(summary.binding.before, summary.binding.after);
  assert.doesNotMatch(JSON.stringify(summary), new RegExp(a.root.replaceAll('\\', '\\\\')));
});

test('live startup excludes pre-existing full-field IDs and marker names even after rename; only new run markers can verify', async t => {
  const env = await environment(t); const old = pair(); await env.createDatabase(old);
  const observer = await env.observe(liveOptions(async () => tuple(env))); await observer.pollOnce();
  await env.createDatabase(renamed(old)); await observer.pollOnce(); assert.equal((await env.readRows()).length, 0);
  const rows = [fixture('en', 'a1a1a1a1'), fixture('zh-Hans', 'b2b2b2b2')];
  await env.createDatabase(rows); await observer.pollOnce(); await env.createDatabase(renamed(rows)); await observer.pollOnce();
  assert.equal(observer.summary().verification.complete, true); assert.equal(observer.summary().binding.baselineExcludedSnapshots, 8);
  assert.deepEqual(new Set((await env.readRows()).map(row => row.recordId)), new Set(rows.map(row => row.recordId)));
});

test('live container change after any marker, including excluded old baseline, is fatal and cannot merge stages', async t => {
  for (const oldBaseline of [false, true]) {
    const a = await environment(t); const b = await environment(t); const rows = pair();
    await a.createDatabase(oldBaseline ? rows : []); await b.createDatabase(renamed(rows)); let current = a;
    const observer = await a.observe({ ...liveOptions(async () => tuple(current)), runQuery: (...args) => current.sqliteRunner(...args) });
    await observer.pollOnce(); if (!oldBaseline) { await a.createDatabase(rows); await observer.pollOnce(); }
    current = b; await observer.pollOnce();
    assert.equal(observer.summary().health.fatalError, 'container-generation-changed'); assert.equal(observer.summary().binding.generation, 1);
    assert.equal(observer.summary().verification.complete, false); assert.equal((await a.readRows()).length, oldBaseline ? 0 : 2);
  }
});

test('live before/after mapping race discards all query output and fails closed', async t => {
  const a = await environment(t); const b = await environment(t); await a.createDatabase(pair()); await b.createDatabase([]); let current = a;
  const observer = await a.observe({ ...liveOptions(async () => tuple(current)), runQuery: async (...args) => {
    const result = await a.sqliteRunner(...args); current = b; return result;
  } });
  await observer.pollOnce(); assert.equal((await a.readRows()).length, 0);
  assert.equal(observer.summary().health.fatalError, 'container-generation-changed'); assert.equal(observer.summary().binding.generation, 0);
  assert.notDeepEqual(observer.summary().binding.before, observer.summary().binding.after);
});

test('live resolver unavailability can recover on the same identity; wrong UDID/bundle never becomes an empty success', async t => {
  const env = await environment(t); await env.createDatabase([]); let mode = 'good';
  const observer = await env.observe(liveOptions(async () => {
    if (mode === 'unavailable') throw coded('container-unavailable');
    return { ...tuple(env), ...(mode === 'wrong' ? { bundleId: 'other.synthetic.app' } : {}) };
  }));
  await observer.pollOnce(); mode = 'unavailable'; await observer.pollOnce();
  assert.equal(observer.summary().health.status, 'unavailable'); mode = 'good'; await observer.pollOnce();
  assert.equal(observer.summary().health.status, 'healthy'); assert.equal(observer.summary().health.recoveries, 1);
  mode = 'wrong'; await observer.pollOnce(); assert.equal(observer.summary().health.fatalError, 'container-identity-mismatch');
  mode = 'good'; const rows = pair(); await env.createDatabase(rows); await observer.pollOnce();
  await env.createDatabase(renamed(rows)); await observer.pollOnce(); assert.equal(observer.summary().verification.complete, false);
});

test('simctl resolver uses exact UDID/bundle command, bounded owned process, and rejects untrusted path output without leaking it', async () => {
  const appData = `/synthetic/Devices/${simulatorId}/data/Containers/Data/Application/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`;
  const resolveWith = stdout => createSimctlContainerResolver({ simulatorId, bundleId, execFileImpl: (command, args, options, callback) => {
    assert.equal(command, 'xcrun'); assert.deepEqual(args, ['simctl', 'get_app_container', simulatorId, bundleId, 'data']);
    assert.equal(options.timeout, 1500); assert.equal(options.maxBuffer, 16384);
    const child = new EventEmitter(); queueMicrotask(() => { callback(null, stdout); child.emit('close'); }); return child;
  } });
  assert.deepEqual(await resolveWith(`${appData}\n`)(), { simulatorId, bundleId, appData });
  for (const bad of [undefined, 'private-diagnostic', appData.replace(simulatorId, randomUUID()), `${appData}\n/private`, `${appData}/../other`, `${appData}/extra`]) {
    await assert.rejects(resolveWith(bad)(), error => error.observerCode === 'container-identity-mismatch' && error.message === 'container-identity-mismatch');
  }
});

test('simctl timeout and cancellation wait for the exact owned child close, never leave a resolver process running', async () => {
  for (const abort of [false, true]) {
    const controller = new AbortController(); let child; let closed = false;
    const resolver = createSimctlContainerResolver({ simulatorId, bundleId, execFileImpl: (_command, _args, options, callback) => {
      child = execFile(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options, callback);
      child.once('close', () => { closed = true; }); return child;
    } });
    const result = resolver({ signal: controller.signal }); if (abort) controller.abort();
    await assert.rejects(result, { observerCode: abort ? 'query-cancelled' : 'container-unavailable' });
    assert.equal(closed, true); assert.equal(child.killed, true);
  }
});

test('default sqlite parser classifies actual corruption diagnostics as fixed fatal codes', async () => {
  for (const stderr of ['Error: file is not a database at private path', 'Error: database disk image is malformed']) {
    const result = querySqliteReadonly('synthetic', { execFileImpl: (_command, _args, _options, callback) => {
      const child = new EventEmitter(); queueMicrotask(() => { callback({ code: 1 }, 'private', stderr); child.emit('close'); }); return child;
    } });
    await assert.rejects(result, error => error.observerCode === 'database-corrupt' && error.message === 'database-corrupt');
  }
});

// Windows force-terminates even SIGTERM; real TERM resistance is exercised
// when these same tests run on macOS/POSIX. No unrelated process is signalled.
for (const kind of ['sqlite', 'simctl']) for (const abort of [false, true]) {
  test(`owned ${kind} force-kills and drains a TERM-handler child on ${abort ? 'ready-state abort' : 'deadline'}`, async () => {
    const controller = new AbortController(); let child; let closed = false; let rescued = false; let resolveReady; let killSignal;
    const ready = new Promise(resolve => { resolveReady = resolve; });
    const execFileImpl = (_command, _args, options, callback) => {
      killSignal = options.killSignal;
      assert.equal(options.timeout, 1500);
      child = execFile(process.execPath, ['-e', "process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)"], options, callback);
      child.stdout.on('data', () => resolveReady()); child.once('close', () => { closed = true; }); return child;
    };
    const start = performance.now();
    const result = kind === 'sqlite' ? querySqliteReadonly('synthetic', { signal: controller.signal, execFileImpl })
      : createSimctlContainerResolver({ simulatorId, bundleId, execFileImpl })({ signal: controller.signal });
    // Rescue only our own process if the implementation regresses, so a red
    // test also terminates. Passing requires this safety net never firing.
    const rescue = setTimeout(() => { if (!closed && child) { rescued = true; child.kill('SIGKILL'); } }, 4500);
    try {
      if (abort) { await Promise.race([ready, result]); controller.abort(); }
      await assert.rejects(result, { observerCode: abort ? 'query-cancelled' : kind === 'sqlite' ? 'query-timeout' : 'container-unavailable' });
      assert.equal(closed, true); assert.equal(child.killed, true); assert.equal(rescued, false);
      assert.equal(killSignal, 'SIGKILL');
      assert.ok(performance.now() - start < 4500, 'owned close must precede the safety-net deadline');
    } finally { clearTimeout(rescue); if (child && !closed) child.kill('SIGKILL'); }
  });
}
