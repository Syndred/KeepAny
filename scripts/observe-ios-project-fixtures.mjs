import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  'database-missing', 'database-unavailable', 'row-rejected', 'observer-failed']);
const publicError = code => Object.assign(new Error(code), { observerCode: code });
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
        windowsHide: true, signal, killSignal: 'SIGTERM',
      }, (error, stdout, stderr) => {
        if (!error) { outcome = { stdout }; complete(); return; }
        let code = 'query-failed';
        if (signal?.aborted || error.name === 'AbortError') code = 'query-cancelled';
        else if (error.code === 'ENOENT') code = 'sqlite-unavailable';
        else if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') code = 'query-output-limit';
        else if (error.killed) code = 'query-timeout';
        else if (typeof stderr === 'string' && /database (?:is )?(?:locked|busy)/i.test(stderr)) code = 'query-busy';
        outcome = { code }; complete();
      });
      child.once('close', () => { closed = true; complete(); });
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

export async function createProjectFixtureObserver({ appData, output, runQuery = querySqliteReadonly,
  now = () => new Date(), intervalMs = 1000 } = {}) {
  if (typeof appData !== 'string' || typeof output !== 'string' || !Number.isInteger(intervalMs)
    || intervalMs < 10 || intervalMs > 10_000) throw publicError('invalid-options');
  let base;
  try { base = await fs.realpath(appData); if (!(await fs.stat(base)).isDirectory()) throw publicError('invalid-app-data'); }
  catch { throw publicError('invalid-app-data'); }
  let outputDirectory = path.resolve(output);
  const requireOutsideAppData = () => {
    const relative = path.relative(base, outputDirectory);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw publicError('output-inside-app-data');
  };
  requireOutsideAppData();
  const database = path.join(base, DATABASE_RELATIVE_PATH);
  const state = { schema: 'keepany-ios-project-observer-v1', status: 'observing',
    polls: 0, successfulQueries: 0, matchedSnapshots: 0, appendedSnapshots: 0,
    distinctRecordIds: 0, filteredRows: 0, invalidRows: 0, errors: {},
    lastError: null, hasObservations: false, normalStop: false };
  const last = new Map(); const groups = new Map(); let closed = false; let polling = false;
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
    if (Object.keys(state.errors).length) status = 'observation-error';
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
    outputDirectory = await fs.realpath(outputDirectory); requireOutsideAppData();
    records = await fs.open(path.join(outputDirectory, 'fixtures.ndjson'), 'wx');
    summary = await fs.open(path.join(outputDirectory, 'summary.json'), 'wx');
  } catch {
    await records?.close(); await summary?.close(); throw publicError('output-unavailable');
  }
  const recordError = code => {
    state.errors[code] = (state.errors[code] ?? 0) + 1; state.lastError = code;
  };
  async function writeSummary() {
    const bytes = Buffer.from(`${JSON.stringify({ ...state, verification: verification() }, null, 2)}\n`);
    await writeAll(summary, bytes, 0); await summary.truncate(bytes.length);
  }
  async function pollOnce({ signal } = {}) {
    if (closed || polling) throw publicError('observer-not-idle');
    if (signal?.aborted) return;
    polling = true; state.polls++;
    try {
      try {
        const info = await fs.lstat(database);
        if (!info.isFile() || info.isSymbolicLink() || await fs.realpath(database) !== database) throw publicError('database-not-regular');
        await fs.access(database, constants.R_OK);
      } catch (error) {
        if (error?.code === 'ENOENT') throw publicError('database-missing');
        if (error?.observerCode) throw error;
        throw publicError('database-unavailable');
      }
      const result = parseSnapshots(await runQuery(database, { signal }));
      if (signal?.aborted) return;
      state.successfulQueries++; state.filteredRows += result.filtered; state.invalidRows += result.invalid;
      if (result.invalid) recordError('row-rejected');
      state.matchedSnapshots += result.snapshots.length;
      for (const row of result.snapshots) {
        const digest = createHash('sha256').update(canonicalJson(row.payload)).digest('hex');
        if (last.get(row.recordId) === digest) continue;
        const observedAt = now().toISOString();
        await writeAll(records, Buffer.from(`${JSON.stringify({ ...row, observedAt })}\n`));
        last.set(row.recordId, digest); state.appendedSnapshots++;
        rememberStage(row);
      }
      state.distinctRecordIds = last.size; state.hasObservations = state.appendedSnapshots > 0;
    } catch (error) {
      const code = ERROR_CODES.has(error?.observerCode) ? error.observerCode : 'observer-failed';
      if (!(signal?.aborted && code === 'query-cancelled')) recordError(code);
    } finally {
      polling = false;
      try { await writeSummary(); } catch { throw publicError('output-unavailable'); }
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
    return { ...state, errors: { ...state.errors }, verification: verification() };
  }
  try { await writeSummary(); } catch {
    await records.close(); await summary.close(); throw publicError('output-unavailable');
  }
  return { pollOnce, run, finish, summary: () => ({ ...state, errors: { ...state.errors }, verification: verification() }) };
}

export async function main(args = process.argv.slice(2)) {
  let observer; const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    if (args.length !== 4 || args[0] !== '--app-data' || args[2] !== '--output') throw publicError('invalid-options');
    observer = await createProjectFixtureObserver({ appData: args[1], output: args[3] });
    process.stdout.write(`${JSON.stringify({ observer: 'ios-project-fixtures', status: 'observing' })}\n`);
    const summary = await observer.run({ signal: controller.signal });
    process.stdout.write(`${JSON.stringify({ observer: 'ios-project-fixtures', status: summary.status,
      appendedSnapshots: summary.appendedSnapshots, errorCount: Object.values(summary.errors).reduce((sum, value) => sum + value, 0) })}\n`);
  } catch {
    process.stdout.write(`${JSON.stringify({ observer: 'ios-project-fixtures', status: 'failed', code: 'observer-unavailable' })}\n`);
    process.exitCode = 1;
  } finally {
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
    if (observer) await observer.finish(false).catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
