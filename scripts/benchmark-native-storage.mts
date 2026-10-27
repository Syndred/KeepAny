import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir, platform, release, cpus } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { newAsset, type Asset } from '../packages/domain/src/index.ts';
import { openRepositoryFromBackend, type LocalRepository } from '../packages/local-db/src/index.ts';
import { encryptBackup, decryptBackup, BACKUP_ARCHIVE_MAX_BYTES, BACKUP_CONTAINER_MAX_BYTES } from '../packages/local-db/src/backup-crypto.ts';
import { NativeStore } from '../packages/local-db-native/src/store.ts';
import { NativeFileStore } from '../packages/local-db-native/src/repository-storage.ts';
import type { SqlDriver, SqlRow } from '../packages/local-db-native/src/driver.ts';
import type { PersistentFiles } from '../packages/platform-native/src/index.ts';

// Explicit M0-12 host probe. This is real disk SQLite plus shared business code;
// timings/RSS belong to this Node host, never to Android, iOS or React rendering.
const output = resolve(process.argv[2] ?? 'test-results/native-storage-performance.json');
const archivesDirectory = process.argv[3] ? resolve(process.argv[3]) : undefined;
const root = await mkdtemp(join(tmpdir(), 'keepany-performance-'));
if (!resolve(root).startsWith(`${resolve(tmpdir())}${sep}keepany-performance-`)) throw Error('unsafe-benchmark-cleanup');
const opened = new Set<LocalRepository>();
const results: Record<string, unknown>[] = [];
let peakRss = process.memoryUsage().rss;
const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 10);
function sample() { peakRss = Math.max(peakRss, process.memoryUsage().rss); }
async function timed<T>(action: () => Promise<T>) { const start = performance.now(); const value = await action(); sample(); return { value, ms: Math.round((performance.now() - start) * 10) / 10 }; }
async function connect(name: string) {
  const folder = join(root, name); await mkdir(folder, { recursive: true });
  const db = new DatabaseSync(join(folder, 'data.db'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
  const files: PersistentFiles = {
    async rootUri() { return pathToFileURL(folder).href; },
    async write(path, bytes) { const file = join(folder, path); await mkdir(dirname(file), { recursive: true }); await writeFile(file, bytes); },
    async read(path) { return new Uint8Array(await readFile(join(folder, path))); },
    async remove(path) { await rm(join(folder, path)); },
    async list() { const paths: string[] = []; for (const child of ['files', 'vaults', 'recovery']) for (const entry of await readdir(join(folder, child)).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; })) paths.push(`${child}/${entry}`); return paths; },
  };
  const driver: SqlDriver = {
    uri: pathToFileURL(join(folder, 'data.db')).href,
    async execute(sql) { db.exec(sql); },
    async query<T extends SqlRow>(sql: string, values = []) { return db.prepare(sql).all(...values) as T[]; },
    async run(sql, values = []) { return Number(db.prepare(sql).run(...values).changes); },
    async close() { db.close(); },
  };
  const store = await NativeStore.open(driver, files), side = new NativeFileStore(name, store);
  const repository = await openRepositoryFromBackend(side.records, side); opened.add(repository);
  return repository;
}
try {
  for (const count of [100, 1000, 10000]) {
    peakRss = process.memoryUsage().rss;
    const startRss = peakRss, sourceName = `source-${count}`;
    let source = await connect(sourceName);
    const assets = Array.from({ length: count }, (_, index) => ({ ...newAsset(index % 2 ? 'account' : 'project'), name: `Synthetic ${String(index).padStart(5, '0')}`, description: 'Synthetic benchmark record; no real user data.', tags: ['benchmark'] }));
    const rows = assets.map(asset => ({ id: `asset:${asset.id}`, type: 'asset' as const, payload: JSON.stringify(asset), updatedAt: Date.parse(asset.updatedAt) }));
    const seed = await timed(async () => { const result = await source.records.insertMany(rows); if (result.error.length || result.success.length !== count) throw Error('benchmark-seed'); });
    await source.close(); opened.delete(source);
    const startup = await timed(() => connect(sourceName)); source = startup.value;
    const search = await timed(async () => { const found = (await source.list<Asset>('asset')).filter(asset => asset.name.includes('00042')); if (found.length !== 1 || found[0].id !== assets[42].id) throw Error('benchmark-search'); });
    const edited = { ...assets[42], description: 'Updated synthetic description', updatedAt: new Date().toISOString() };
    const edit = await timed(() => source.save('asset', edited));
    const exported = await timed(async () => encryptBackup(await source.exportArchive(), 'Synthetic-benchmark-password'));
    if (exported.value.length > BACKUP_CONTAINER_MAX_BYTES) throw Error('benchmark-budget');
    if (archivesDirectory) {
      await mkdir(archivesDirectory, { recursive: true });
      await writeFile(join(archivesDirectory, `synthetic-${count}.ka1`), exported.value);
    }
    const target = await connect(`target-${count}`);
    const restored = await timed(async () => target.restoreArchive(await decryptBackup(exported.value, 'Synthetic-benchmark-password')));
    const original = await source.allRecords(), returned = await target.allRecords();
    if (JSON.stringify(original) !== JSON.stringify(returned) || (await target.get<Asset>('asset', edited.id))?.description !== edited.description) throw Error('benchmark-restore-content');
    const bytes = await stat(join(root, sourceName, 'data.db'));
    sample();
    results.push({ count, seedMs: seed.ms, reopenRepositoryMs: startup.ms, readAllAndFilterMs: search.ms, editMs: edit.ms, encryptedExportMs: exported.ms, decryptAndRestoreMs: restored.ms, encryptedBytes: exported.value.length, databaseBytesAfterReopen: bytes.size, startProcessRssBytes: startRss, peakProcessRssBytes: peakRss, exactRowsAndEditedIdVerified: true });
    console.log(JSON.stringify(results.at(-1)));
    await source.close(); opened.delete(source); await target.close(); opened.delete(target);
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ generatedAt: new Date().toISOString(), evidence: 'C: Node host disk SQLite, not native plugin/device/UI', host: { platform: platform(), release: release(), cpu: cpus()[0]?.model, node: process.version, sqlite: process.versions.sqlite }, archiveBudgetBytes: BACKUP_ARCHIVE_MAX_BYTES, encryptedBudgetBytes: BACKUP_CONTAINER_MAX_BYTES, measurementLimits: 'Shared host; process RSS sampled at 10ms and operation boundaries, not OS peak or device memory. Seed uses validated backend insertMany; restore uses shared repository. No image/KDBX payload in these scale samples.', results }, null, 2));
} finally {
  clearInterval(sampler);
  for (const repository of opened) await repository.close();
  await rm(root, { recursive: true, force: true });
}
