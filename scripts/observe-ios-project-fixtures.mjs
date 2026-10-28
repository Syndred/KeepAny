import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export const DATABASE_RELATIVE_PATH = 'Library/Application Support/KeepAny/databases/keepany-v1SQLite.db';
export const FIXTURE_QUERY = `SELECT json_object('recordId',id,'payload',json(payload)) FROM records
WHERE type='asset' AND json_valid(payload) AND json_extract(payload,'$.kind')='project'
AND (json_extract(payload,'$.name') GLOB 'iOS simulator persistence fixture full-fields en *'
 OR json_extract(payload,'$.name') GLOB 'iOS simulator persistence fixture full-fields zh-Hans *')
ORDER BY id LIMIT 129;`;
const FIXTURE_NAME = /^iOS simulator persistence fixture full-fields (en|zh-Hans) [a-fA-F0-9]{8}(?: renamed)?$/;
const ASSET_ID = /^asset:([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})$/;
const MAX_ROWS = 128;
const MAX_BYTES = 2 * 1024 * 1024;
const ERROR_CODES = new Set(['query-cancelled', 'query-failed', 'sqlite-unavailable', 'query-output-limit',
  'query-timeout', 'query-busy', 'query-row-limit', 'query-invalid-json', 'database-not-regular',
  'database-missing', 'database-unavailable', 'database-corrupt', 'row-rejected', 'observer-failed',
  'container-unavailable', 'container-not-regular', 'container-identity-mismatch', 'container-generation-changed',
  'database-generation-changed', 'identity-unproven', 'output-inside-app-data',
  'container-resolver-timeout', 'container-resolver-failed', 'container-resolver-unavailable',
  'container-resolver-output-limit', 'container-lookup-missing', 'initial-readiness-timeout',
  'initial-readiness-exhausted', 'observer-readiness-timeout', 'observer-exited-before-ready',
  'observer-readiness-failed', 'observer-readiness-identity']);
const INITIAL_RECOVERABLE = new Set(['container-resolver-timeout',
  'container-resolver-failed', 'container-lookup-missing']);
const RECOVERABLE = new Set(['container-unavailable', 'database-missing', 'query-timeout', 'query-busy', ...INITIAL_RECOVERABLE]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const BUNDLE = /^[a-zA-Z][a-zA-Z0-9-]*(?:\.[a-zA-Z0-9-]+)+$/;
const publicError = code => Object.assign(new Error(code), { observerCode: code });
const digest = value => createHash('sha256').update(value).digest('hex');

function abortOwnedChild(child, signal) {
  if (!signal) return;
  // execFile forwards signal to spawn but not its killSignal. Handle abort
  // explicitly so POSIX cancellation uses the same hard stop as the deadline.
  const abort = () => child.kill('SIGKILL');
  child.once('close', () => signal.removeEventListener('abort', abort));
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
}

export function createSimctlContainerResolver({ simulatorId, bundleId, execFileImpl = execFile } = {}) {
  if (!UUID.test(simulatorId ?? '') || !BUNDLE.test(bundleId ?? '')) throw publicError('invalid-options');
  return ({ signal, timeoutMs = 1500 } = {}) => new Promise((resolve, reject) => {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1500) { reject(publicError('invalid-options')); return; }
    if (signal?.aborted) { reject(publicError('query-cancelled')); return; }
    let outcome; let closed = false;
    const complete = () => {
      if (!closed || !outcome) return;
      if (outcome.code) { reject(publicError(outcome.code)); return; }
      if (typeof outcome.stdout !== 'string') { reject(publicError('container-identity-mismatch')); return; }
      const appData = outcome.stdout.trim();
      const segments = appData.split('/');
      const index = segments.lastIndexOf('Devices');
      if (!path.posix.isAbsolute(appData) || path.posix.normalize(appData) !== appData || /[\r\n\0]/.test(appData)
        || index < 0 || segments[index + 1]?.toLowerCase() !== simulatorId.toLowerCase()
        || segments.slice(index + 2, index + 6).join('/') !== 'data/Containers/Data/Application'
        || segments.length !== index + 7 || !UUID.test(segments.at(-1))) {
        reject(publicError('container-identity-mismatch')); return;
      }
      resolve({ simulatorId, bundleId, appData });
    };
    try {
      const child = execFileImpl('xcrun', ['simctl', 'get_app_container', simulatorId, bundleId, 'data'], {
        encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024, windowsHide: true, killSignal: 'SIGKILL',
      }, (error, stdout) => {
        let code;
        if (error) {
          if (signal?.aborted || error.name === 'AbortError') code = 'query-cancelled';
          else if (error.code === 'ENOENT') code = 'container-resolver-unavailable';
          else if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') code = 'container-resolver-output-limit';
          else code = error.killed ? 'container-resolver-timeout' : 'container-resolver-failed';
        }
        outcome = error ? { code } : { stdout };
        complete();
      });
      child.once('close', () => { closed = true; complete(); });
      abortOwnedChild(child, signal);
    } catch { reject(publicError('container-unavailable')); }
  });
}

function fileIdentity(info) {
  if (typeof info.ino !== 'bigint' || typeof info.birthtimeNs !== 'bigint' || info.ino <= 0n || info.birthtimeNs <= 0n) throw publicError('identity-unproven');
  return digest(`${info.dev}:${info.ino}:${info.birthtimeNs}`);
}
async function writeAll(file, bytes, position = null) {
  for (let offset = 0; offset < bytes.length;) {
    const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset, position === null ? null : position + offset);
    if (!bytesWritten) throw publicError('output-unavailable');
    offset += bytesWritten;
  }
}

// Abort can invoke execFile's callback before close. Wait for the exact owned
// ChildProcess close as well; never enumerate or signal unrelated processes.
export function querySqliteReadonly(database, { signal, execFileImpl = execFile } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(publicError('query-cancelled')); return; }
    const args = ['-readonly', '-batch', '-noheader', '-cmd', '.timeout 200', database, FIXTURE_QUERY];
    let outcome; let closed = false;
    const complete = () => {
      if (!closed || !outcome) return;
      if (outcome.code) reject(publicError(outcome.code)); else resolve(outcome.stdout);
    };
    try {
      const child = execFileImpl('sqlite3', args, {
        encoding: 'utf8', timeout: 1500, maxBuffer: MAX_BYTES,
        windowsHide: true, killSignal: 'SIGKILL',
      }, (error, stdout, stderr) => {
        if (!error) { outcome = { stdout }; complete(); return; }
        let code = 'query-failed';
        if (signal?.aborted || error.name === 'AbortError') code = 'query-cancelled';
        else if (error.code === 'ENOENT') code = 'sqlite-unavailable';
        else if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') code = 'query-output-limit';
        else if (error.killed) code = 'query-timeout';
        else if (typeof stderr === 'string' && /database (?:is )?(?:locked|busy)/i.test(stderr)) code = 'query-busy';
        else if (typeof stderr === 'string' && /(?:database (?:disk image )?is malformed|file is not a database)/i.test(stderr)) code = 'database-corrupt';
        outcome = { code }; complete();
      });
      child.once('close', () => { closed = true; complete(); });
      abortOwnedChild(child, signal);
    } catch {
      reject(publicError('query-failed'));
    }
  });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function parseSnapshots(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) throw publicError('query-output-limit');
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (lines.length > MAX_ROWS) throw publicError('query-row-limit');
  let rows;
  try { rows = lines.map(line => JSON.parse(line)); } catch { throw publicError('query-invalid-json'); }
  const snapshots = []; let filtered = 0; let invalid = 0;
  for (const row of rows) {
    const payload = row?.payload;
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).sort().join(',') !== 'payload,recordId'
      || !payload || typeof payload !== 'object' || Array.isArray(payload)) { invalid++; continue; }
    if (payload.kind !== 'project' || typeof payload.name !== 'string' || !FIXTURE_NAME.test(payload.name)) { filtered++; continue; }
    const id = typeof row.recordId === 'string' ? ASSET_ID.exec(row.recordId) : null;
    if (!id || payload.id !== id[1]) { invalid++; continue; }
    snapshots.push({ recordId: row.recordId, payload });
  }
  return { snapshots, filtered, invalid };
}

export async function createProjectFixtureObserver({ appData, output, simulatorId, bundleId, resolveContainer, runQuery = querySqliteReadonly,
  now = () => new Date(), intervalMs = 1000, signal, runId = randomUUID(), initialReadinessMs = 30_000, initialRetryMs = 1000 } = {}) {
  const live = simulatorId !== undefined || bundleId !== undefined || resolveContainer !== undefined;
  if ((live ? appData !== undefined || !UUID.test(simulatorId ?? '') || !BUNDLE.test(bundleId ?? '') : typeof appData !== 'string')
    || typeof output !== 'string' || !Number.isInteger(intervalMs)
    || intervalMs < 10 || intervalMs > 10_000 || !UUID.test(runId)
    || !Number.isInteger(initialReadinessMs) || initialReadinessMs < 10 || initialReadinessMs > 30_000
    || !Number.isInteger(initialRetryMs) || initialRetryMs < 1 || initialRetryMs > 1000) throw publicError('invalid-options');
  const resolver = live ? resolveContainer ?? createSimctlContainerResolver({ simulatorId, bundleId }) : null;
  const timing = { resolver: { calls: 0, totalMs: 0, maxMs: 0 }, query: { calls: 0, totalMs: 0, maxMs: 0 } };
  function timed(metric, start) { const elapsed = performance.now() - start; metric.calls++; metric.totalMs += elapsed; metric.maxMs = Math.max(metric.maxMs, elapsed); }
  let base, initialContainer;
  let outputDirectory = path.resolve(output);
  const requireOutsideAppData = directory => {
    const relative = path.relative(directory, outputDirectory);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw publicError('output-inside-app-data');
  };
  async function locate({ signal, timeoutMs } = {}) {
    let resolved;
    const start = performance.now();
    try { resolved = live ? await resolver({ signal, ...(timeoutMs === undefined ? {} : { timeoutMs }) }) : { appData: base }; }
    catch (error) { throw publicError(ERROR_CODES.has(error?.observerCode) ? error.observerCode : 'container-unavailable'); }
    finally { if (live) timed(timing.resolver, start); }
    if (live && (resolved?.simulatorId !== simulatorId || resolved?.bundleId !== bundleId || typeof resolved?.appData !== 'string')) throw publicError('container-identity-mismatch');
    const directory = path.resolve(resolved.appData);
    let info, canonical;
    try { info = await fs.lstat(directory, { bigint: true }); canonical = await fs.realpath(directory); }
    catch (error) { throw publicError(error?.code === 'ENOENT' ? 'container-lookup-missing' : 'container-unavailable'); }
    if (!info.isDirectory() || info.isSymbolicLink() || canonical !== directory) throw publicError('container-not-regular');
    requireOutsideAppData(directory);
    return { directory, containerPathSha256: digest(directory), containerIdentitySha256: fileIdentity(info) };
  }
  if (!live) {
    try { base = await fs.realpath(appData); if (!(await fs.stat(base)).isDirectory()) throw publicError('invalid-app-data'); }
    catch { throw publicError('invalid-app-data'); }
  }
  const initialization = { attempts: 0, errors: {}, lastError: null, elapsedMs: 0, status: 'locating' };
  const initializationStart = performance.now();
  const startup = new AbortController(); let deadlineExpired = false;
  const cancelStartup = () => startup.abort();
  signal?.addEventListener('abort', cancelStartup, { once: true });
  if (signal?.aborted) startup.abort();
  const deadline = initializationStart + initialReadinessMs;
  const deadlineTimer = setTimeout(() => { deadlineExpired = true; startup.abort(); }, initialReadinessMs);
  try {
    for (;;) {
      if (signal?.aborted) throw publicError('query-cancelled');
      const remaining = Math.floor(deadline - performance.now());
      if (deadlineExpired || remaining < 1) throw publicError('initial-readiness-timeout');
      initialization.attempts++;
      try {
        initialContainer = await locate({ signal: startup.signal, timeoutMs: Math.min(1500, remaining) });
        if (signal?.aborted) throw publicError('query-cancelled');
        if (deadlineExpired || performance.now() >= deadline) throw publicError('initial-readiness-timeout');
        break;
      } catch (error) {
        const code = ERROR_CODES.has(error?.observerCode) ? error.observerCode : 'observer-failed';
        initialization.errors[code] = (initialization.errors[code] ?? 0) + 1; initialization.lastError = code;
        if (signal?.aborted) throw publicError('query-cancelled');
        if (deadlineExpired || performance.now() >= deadline) throw publicError('initial-readiness-timeout');
        if (!live || !INITIAL_RECOVERABLE.has(code)) throw publicError(code);
        if (initialization.attempts >= 15) throw publicError('initial-readiness-exhausted');
        const waitMs = Math.min(initialRetryMs, Math.max(0, deadline - performance.now()));
        try { await delay(waitMs, undefined, { signal: startup.signal }); }
        catch { throw publicError(signal?.aborted ? 'query-cancelled' : 'initial-readiness-timeout'); }
      }
    }
    initialization.status = 'located';
  } catch (error) {
    initialization.status = 'failed'; initialization.elapsedMs = performance.now() - initializationStart;
    const failure = publicError(ERROR_CODES.has(error?.observerCode) ? error.observerCode : 'observer-failed');
    failure.initialization = initialization;
    throw failure;
  } finally {
    clearTimeout(deadlineTimer); signal?.removeEventListener('abort', cancelStartup);
    initialization.elapsedMs = performance.now() - initializationStart;
  }
  base ??= initialContainer.directory;
  requireOutsideAppData(base);
  const state = { schema: 'keepany-ios-project-observer-v1', status: 'observing', observerPid: process.pid, runId, initialization,
    polls: 0, successfulQueries: 0, matchedSnapshots: 0, appendedSnapshots: 0,
    distinctRecordIds: 0, filteredRows: 0, invalidRows: 0, errors: {},
    lastError: null, hasObservations: false, normalStop: false, timing,
    errorCountsAreHistorical: true,
    health: { status: 'waiting', currentError: null, fatalError: null, recoveries: 0 },
    binding: { mode: live ? 'simctl' : 'static', resolver: live ? resolveContainer ? 'injected' : 'simctl' : 'static',
      ...(live ? { simulatorId, bundleId } : {}), generation: 0, baselineCaptured: !live, baselineExcludedSnapshots: 0,
      initialContainer: { containerPathSha256: initialContainer.containerPathSha256, containerIdentitySha256: initialContainer.containerIdentitySha256 },
      before: null, after: null, generations: [] } };
  const last = new Map(); const groups = new Map(); let closed = false; let polling = false;
  let bound = null, pendingIdentity = null;
  const baselineIds = new Set(), baselineNames = new Set();
  const sameContainer = (a, b) => a.containerPathSha256 === b.containerPathSha256 && a.containerIdentitySha256 === b.containerIdentitySha256;
  const sameIdentity = (a, b) => sameContainer(a, b) && a.databaseIdentitySha256 === b.databaseIdentitySha256;
  const publicIdentity = value => ({ containerPathSha256: value.containerPathSha256, containerIdentitySha256: value.containerIdentitySha256,
    ...(value.databaseIdentitySha256 ? { databaseIdentitySha256: value.databaseIdentitySha256 } : {}) });
  function checkContainer(location) {
    const prior = bound ?? initialContainer;
    if (prior.containerPathSha256 === location.containerPathSha256
      && prior.containerIdentitySha256 !== location.containerIdentitySha256) throw publicError('container-generation-changed');
    if (bound && !sameContainer(bound, location)
      && (!live || state.matchedSnapshots || state.health.fatalError)) throw publicError('container-generation-changed');
    if (pendingIdentity && !sameContainer(pendingIdentity, location)) throw publicError('identity-unproven');
  }
  async function inspectDatabase(location) {
    const database = path.join(location.directory, DATABASE_RELATIVE_PATH);
    let info;
    try { info = await fs.lstat(database, { bigint: true }); }
    catch (error) { throw publicError(error?.code === 'ENOENT' ? 'database-missing' : 'database-unavailable'); }
    if (!info.isFile() || info.isSymbolicLink() || await fs.realpath(database) !== database) throw publicError('database-not-regular');
    await fs.access(database, constants.R_OK).catch(() => { throw publicError('database-unavailable'); });
    const identity = { ...location, database, databaseIdentitySha256: fileIdentity(info) };
    if (bound && sameContainer(bound, identity) && bound.databaseIdentitySha256 !== identity.databaseIdentitySha256) throw publicError('database-generation-changed');
    if (pendingIdentity && !sameIdentity(pendingIdentity, identity)) throw publicError('database-generation-changed');
    return identity;
  }
  function bind(identity) {
    if (!bound || !sameContainer(bound, identity)) {
      if (state.binding.generations.length >= 32) throw publicError('identity-unproven');
      last.clear(); groups.clear(); baselineIds.clear(); baselineNames.clear();
      state.binding.generation++;
      state.binding.baselineCaptured = !live;
      state.binding.generations.push({ generation: state.binding.generation, ...publicIdentity(identity) });
    }
    bound = identity; pendingIdentity = null;
  }
  function rememberStage(row) {
    const baseName = row.payload.name.replace(/ renamed$/, '');
    const language = FIXTURE_NAME.exec(row.payload.name)[1];
    let group = groups.get(baseName);
    const renamed = row.payload.name.endsWith(' renamed');
    if (!group) {
      group = { language, ids: new Set(), payloads: new Set(), originalSnapshots: 0, renamedSnapshots: 0,
        firstStage: renamed ? 'renamed' : 'original' };
      groups.set(baseName, group);
    }
    group.ids.add(row.recordId);
    const stablePayload = Object.fromEntries(Object.entries(row.payload).filter(([key]) => key !== 'name' && key !== 'updatedAt'));
    group.payloads.add(createHash('sha256').update(canonicalJson(stablePayload)).digest('hex'));
    if (renamed) group.renamedSnapshots++; else group.originalSnapshots++;
  }
  function verification() {
    const languages = {};
    for (const language of ['en', 'zh-Hans']) {
      const found = [...groups.values()].filter(group => group.language === language);
      languages[language] = { markers: found.length,
        originalSnapshots: found.reduce((sum, group) => sum + group.originalSnapshots, 0),
        renamedSnapshots: found.reduce((sum, group) => sum + group.renamedSnapshots, 0) };
    }
    let status = 'verified';
    const all = [...groups.values()];
    if (state.health.fatalError) status = 'observation-error';
    else if (state.health.status === 'waiting') status = 'waiting';
    else if (state.health.status !== 'healthy') status = 'observation-error';
    else if (!all.length) status = 'none';
    else if (Object.values(languages).some(language => language.markers > 1)) status = 'ambiguous-markers';
    else if (Object.values(languages).some(language => language.markers !== 1)
      || all.some(group => !group.originalSnapshots || !group.renamedSnapshots)) status = 'partial';
    else if (all.some(group => group.ids.size !== 1)) status = 'identity-changed';
    else if (all.some(group => group.payloads.size !== 1)) status = 'payload-changed';
    else if (all.some(group => group.firstStage !== 'original')) status = 'invalid-sequence';
    return { complete: status === 'verified', status, languages };
  }
  let records, summary;
  try {
    await fs.mkdir(outputDirectory, { recursive: true });
    outputDirectory = await fs.realpath(outputDirectory); requireOutsideAppData(base);
    records = await fs.open(path.join(outputDirectory, 'fixtures.ndjson'), 'wx');
    summary = await fs.open(path.join(outputDirectory, 'summary.json'), 'wx');
  } catch {
    await records?.close(); await summary?.close(); throw publicError('output-unavailable');
  }
  const recordError = code => {
    state.errors[code] = (state.errors[code] ?? 0) + 1; state.lastError = code;
    state.health.currentError = code;
    if (!RECOVERABLE.has(code)) state.health.fatalError ??= code;
    state.health.status = state.health.fatalError ? 'blocked' : code === 'database-missing' && !bound ? 'waiting' : 'unavailable';
  };
  async function writeSummary() {
    try {
      const bytes = Buffer.from(`${JSON.stringify(publicSummary(), null, 2)}\n`);
      await writeAll(summary, bytes, 0); await summary.truncate(bytes.length);
    } catch { throw publicError('output-unavailable'); }
  }
  async function pollOnce({ signal } = {}) {
    if (closed || polling) throw publicError('observer-not-idle');
    if (signal?.aborted) return;
    polling = true; state.polls++;
    state.binding.before = null; state.binding.after = null;
    try {
      const location = await locate({ signal }); checkContainer(location);
      state.binding.before = publicIdentity(location);
      const before = await inspectDatabase(location);
      state.binding.before = publicIdentity(before);
      pendingIdentity ??= before;
      const start = performance.now(); let text;
      try { text = await runQuery(before.database, { signal }); }
      finally { timed(timing.query, start); }
      if (signal?.aborted) return;
      const afterLocation = await locate({ signal });
      state.binding.after = publicIdentity(afterLocation);
      if (!sameContainer(before, afterLocation)) throw publicError('container-generation-changed');
      let after;
      try { after = await inspectDatabase(afterLocation); }
      catch (error) { throw error?.observerCode === 'database-missing' ? publicError('identity-unproven') : error; }
      state.binding.after = publicIdentity(after);
      if (!sameIdentity(before, after)) throw publicError('database-generation-changed');
      const result = parseSnapshots(text);
      if (signal?.aborted) return;
      bind(after);
      if (state.health.currentError && !state.health.fatalError) state.health.recoveries++;
      state.health.currentError = null;
      state.health.status = state.health.fatalError ? 'blocked' : 'healthy';
      state.successfulQueries++; state.filteredRows += result.filtered; state.invalidRows += result.invalid;
      if (result.invalid) recordError('row-rejected');
      state.matchedSnapshots += result.snapshots.length;
      if (live && !state.binding.baselineCaptured) {
        for (const row of result.snapshots) { baselineIds.add(row.recordId); baselineNames.add(row.payload.name.replace(/ renamed$/, '')); }
        state.binding.baselineCaptured = true;
      }
      for (const row of result.snapshots) {
        if (baselineIds.has(row.recordId) || baselineNames.has(row.payload.name.replace(/ renamed$/, ''))) {
          state.binding.baselineExcludedSnapshots++; continue;
        }
        const digest = createHash('sha256').update(canonicalJson(row.payload)).digest('hex');
        if (last.get(row.recordId) === digest) continue;
        const observedAt = now().toISOString();
        await writeAll(records, Buffer.from(`${JSON.stringify({ ...row, observedAt, generation: state.binding.generation,
          containerPathSha256: bound.containerPathSha256, databaseIdentitySha256: bound.databaseIdentitySha256 })}\n`));
        last.set(row.recordId, digest); state.appendedSnapshots++;
        rememberStage(row);
      }
      state.distinctRecordIds = last.size; state.hasObservations = state.appendedSnapshots > 0;
    } catch (error) {
      const code = ERROR_CODES.has(error?.observerCode) ? error.observerCode : 'observer-failed';
      if (!(signal?.aborted && code === 'query-cancelled')) recordError(code);
    } finally {
      polling = false;
      await writeSummary();
    }
  }
  async function finish(normalStop) {
    if (closed) return;
    if (polling) throw publicError('observer-not-idle');
    closed = true; state.normalStop = normalStop;
    state.status = normalStop ? (state.hasObservations ? 'stopped-with-observations' : 'stopped-without-observations') : 'failed';
    try { await writeSummary(); } finally { await records.close(); await summary.close(); }
  }
  async function run({ signal } = {}) {
    let normalStop = false;
    try {
      while (!signal?.aborted) {
        await pollOnce({ signal });
        try { await delay(intervalMs, undefined, { signal }); }
        catch (error) { if (!signal?.aborted) throw error; }
      }
      normalStop = true;
    } finally { await finish(normalStop); }
    return publicSummary();
  }
  function publicSummary() { return structuredClone({ ...state, verification: verification() }); }
  try { await writeSummary(); } catch {
    await records.close(); await summary.close(); throw publicError('output-unavailable');
  }
  return { pollOnce, run, finish, summary: publicSummary };
}

// This gate proves a fresh, stable SQLite baseline, not the later full-field
// save/rename contract. Zero matching markers is expected before UI starts.
export async function waitForProjectFixtureBaseline({ output, observerPid, runId, simulatorId, bundleId,
  signal, timeoutMs = 45_000, intervalMs = 200,
  isObserverAlive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } } } = {}) {
  if (typeof output !== 'string' || !Number.isInteger(observerPid) || observerPid < 1 || !UUID.test(runId ?? '')
    || !UUID.test(simulatorId ?? '') || !BUNDLE.test(bundleId ?? '') || !Number.isInteger(timeoutMs)
    || timeoutMs < 10 || timeoutMs > 45_000 || !Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > 1000) throw publicError('invalid-options');
  const filename = path.resolve(output, 'summary.json'); const deadline = performance.now() + timeoutMs;
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  async function readSummary() {
    let file;
    try {
      const before = await fs.lstat(filename, { bigint: true });
      if (!before.isFile() || before.isSymbolicLink() || await fs.realpath(filename) !== filename
        || before.size > 128n * 1024n) throw publicError('observer-readiness-failed');
      file = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const opened = await file.stat({ bigint: true });
      if (fileIdentity(before) !== fileIdentity(opened)) throw publicError('observer-readiness-identity');
      const bytes = Buffer.alloc(128 * 1024 + 1); const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      if (bytesRead > 128 * 1024) throw publicError('observer-readiness-failed');
      try { return JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')); }
      catch (error) { if (error instanceof SyntaxError) return null; throw error; }
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw publicError(ERROR_CODES.has(error?.observerCode) ? error.observerCode : 'observer-readiness-failed');
    } finally { await file?.close(); }
  }
  for (;;) {
    if (signal?.aborted) throw publicError('query-cancelled');
    if (!isObserverAlive(observerPid)) throw publicError('observer-exited-before-ready');
    if (performance.now() >= deadline) throw publicError('observer-readiness-timeout');
    const summary = await readSummary();
    if (summary) {
      if (summary.schema !== 'keepany-ios-project-observer-v1' || summary.observerPid !== observerPid
        || summary.runId !== runId || summary.binding?.mode !== 'simctl' || summary.binding.resolver !== 'simctl'
        || summary.binding.simulatorId !== simulatorId || summary.binding.bundleId !== bundleId) throw publicError('observer-readiness-identity');
      const required = ['initialization', 'polls', 'successfulQueries', 'matchedSnapshots', 'appendedSnapshots', 'distinctRecordIds',
        'filteredRows', 'invalidRows', 'errors', 'lastError', 'hasObservations', 'normalStop', 'timing', 'errorCountsAreHistorical', 'health', 'verification'];
      if (required.some(key => !Object.hasOwn(summary, key)) || typeof summary.verification?.complete !== 'boolean'
        || !Number.isInteger(summary.initialization?.attempts) || summary.initialization.attempts < 1
        || summary.initialization.attempts > 15) throw publicError('observer-readiness-failed');
      if (summary.status !== 'observing' || summary.normalStop !== false || summary.health?.fatalError
        || summary.initialization?.status !== 'located') throw publicError('observer-readiness-failed');
      const { before, after } = summary.binding;
      const identityKeys = ['containerPathSha256', 'containerIdentitySha256', 'databaseIdentitySha256'];
      if (summary.health?.status === 'healthy' && summary.health.currentError === null && summary.health.fatalError === null
        && Number.isInteger(summary.successfulQueries) && summary.successfulQueries >= 1
        && summary.binding.baselineCaptured === true && Number.isInteger(summary.binding.generation) && summary.binding.generation >= 1
        && identityKeys.every(key => hash(before?.[key]) && before[key] === after?.[key])) {
        if (signal?.aborted) throw publicError('query-cancelled');
        if (!isObserverAlive(observerPid)) throw publicError('observer-exited-before-ready');
        if (performance.now() >= deadline) throw publicError('observer-readiness-timeout');
        return { observer: 'ios-project-fixtures', status: 'baseline-ready', observerPid, runId, simulatorId, bundleId,
          successfulQueries: summary.successfulQueries, fullFixtureVerificationStillPending: true };
      }
      if (summary.health?.status === 'blocked') throw publicError('observer-readiness-failed');
    }
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw publicError('observer-readiness-timeout');
    try { await delay(Math.min(intervalMs, remaining), undefined, { signal }); }
    catch { throw publicError(signal?.aborted ? 'query-cancelled' : 'observer-readiness-failed'); }
  }
}

export async function main(args = process.argv.slice(2)) {
  let observer; const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    if (args.length === 11 && args[0] === '--wait-ready' && args[1] === '--observer-pid' && /^[1-9][0-9]*$/.test(args[2])
      && args[3] === '--run-id' && args[5] === '--simulator-id' && args[7] === '--bundle-id' && args[9] === '--output') {
      const ready = await waitForProjectFixtureBaseline({ observerPid: Number(args[2]), runId: args[4], simulatorId: args[6],
        bundleId: args[8], output: args[10], signal: controller.signal });
      process.stdout.write(`${JSON.stringify(ready)}\n`); return;
    } else if (args.length === 4 && args[0] === '--app-data' && args[2] === '--output') {
      observer = await createProjectFixtureObserver({ appData: args[1], output: args[3], signal: controller.signal });
    } else if ((args.length === 6 || (args.length === 8 && args[6] === '--run-id'))
      && args[0] === '--simulator-id' && args[2] === '--bundle-id' && args[4] === '--output') {
      observer = await createProjectFixtureObserver({ simulatorId: args[1], bundleId: args[3], output: args[5],
        ...(args.length === 8 ? { runId: args[7] } : {}), signal: controller.signal });
    } else throw publicError('invalid-options');
    process.stdout.write(`${JSON.stringify({ observer: 'ios-project-fixtures', status: 'observing' })}\n`);
    const summary = await observer.run({ signal: controller.signal });
    process.stdout.write(`${JSON.stringify({ observer: 'ios-project-fixtures', status: summary.status,
      appendedSnapshots: summary.appendedSnapshots, errorCount: Object.values(summary.errors).reduce((sum, value) => sum + value, 0) })}\n`);
  } catch (error) {
    // Preserve only enumerated failure categories. Never emit CLI arguments,
    // app-data paths, SQLite stderr or arbitrary exception messages.
    const code = ERROR_CODES.has(error?.observerCode)
      || ['invalid-options', 'invalid-app-data', 'output-unavailable'].includes(error?.observerCode)
      ? error.observerCode : 'observer-unavailable';
    process.stdout.write(`${JSON.stringify({ observer: 'ios-project-fixtures', status: 'failed', code,
      ...(error?.initialization ? { initialization: error.initialization } : {}) })}\n`);
    process.exitCode = 1;
  } finally {
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
    if (observer) await observer.finish(false).catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
