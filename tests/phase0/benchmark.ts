import { createRxDatabase, type RxDatabase } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import Dexie from 'dexie';

type Engine = 'rxdb-dexie' | 'dexie';
type BenchResult = Record<string, unknown>;
const now = () => performance.now();
const elapsed = (start: number) => Math.round((now() - start) * 100) / 100;
const asset = (i: number) => ({ id: `asset-${String(i).padStart(8, '0')}`, name: `Asset ${String(i).padStart(8, '0')}`, kind: 'project', updatedAt: i });
const relation = (i: number, count: number) => ({ id: `relation-${String(i).padStart(8, '0')}`, fromId: asset(i).id, toId: asset((i + 1) % count).id, kind: 'uses' });
const attachment = (i: number) => ({ id: `attachment-${i}`, ownerId: asset(i).id, blob: new Blob([new Uint8Array(16 * 1024)], { type: 'application/octet-stream' }) });
const chunks = (size: number, chunkSize = 500) => Array.from({ length: Math.ceil(size / chunkSize) }, (_, i) => [i * chunkSize, Math.min(size, (i + 1) * chunkSize)]);

async function rxdbBenchmark(count: number): Promise<BenchResult> {
  const dbName = `keepany-phase0-rx-${count}-${crypto.randomUUID().replaceAll('-', '')}`;
  const files = new Dexie(`${dbName}-files`);
  files.version(1).stores({ attachments: 'id,ownerId' });
  let db: RxDatabase = await createRxDatabase({ name: dbName, storage: getRxStorageDexie(), multiInstance: false });
  const collections = {
    assets: { schema: { version: 0, primaryKey: 'id', type: 'object', properties: { id: { type: 'string', maxLength: 32 }, name: { type: 'string' }, kind: { type: 'string' }, updatedAt: { type: 'number' } }, required: ['id', 'name', 'kind', 'updatedAt'], indexes: ['name'] } },
    relations: { schema: { version: 0, primaryKey: 'id', type: 'object', properties: { id: { type: 'string', maxLength: 32 }, fromId: { type: 'string' }, toId: { type: 'string' }, kind: { type: 'string' } }, required: ['id', 'fromId', 'toId', 'kind'], indexes: ['fromId'] } },
  };
  try {
    await db.addCollections(collections);
    let start = now();
    for (const [first, end] of chunks(count)) {
      const written = await db.assets.bulkInsert(Array.from({ length: end - first }, (_, i) => asset(first + i)));
      if (written.error.length) throw new Error(`RxDB asset insert failed: ${written.error.length}`);
      const linked = await db.relations.bulkInsert(Array.from({ length: end - first }, (_, i) => relation(first + i, count)));
      if (linked.error.length) throw new Error(`RxDB relation insert failed: ${linked.error.length}`);
    }
    const insertMs = elapsed(start);
    start = now();
    const assets = await db.assets.find().exec();
    const relations = await db.relations.find().exec();
    const loadMs = elapsed(start);
    start = now();
    const match = await db.assets.findOne({ selector: { name: asset(Math.floor(count / 2)).name } }).exec();
    const connected = await db.relations.find({ selector: { fromId: asset(Math.floor(count / 2)).id } }).exec();
    const indexedLookupMs = elapsed(start);
    if (assets.length !== count || relations.length !== count || !match || connected.length !== 1) throw new Error('RxDB count or indexed lookup mismatch');
    start = now();
    for (const [first, end] of chunks(Math.max(1, Math.ceil(count / 100)))) {
      await files.table('attachments').bulkPut(Array.from({ length: end - first }, (_, i) => attachment(first + i)));
    }
    const attachmentWriteMs = elapsed(start);
    const attachmentCount = await files.table('attachments').count();
    if (attachmentCount !== Math.max(1, Math.ceil(count / 100))) throw new Error('RxDB attachment count mismatch');
    await db.close();
    start = now();
    db = await createRxDatabase({ name: dbName, storage: getRxStorageDexie(), multiInstance: false });
    await db.addCollections(collections);
    const reopenedAssets = await db.assets.find().exec();
    const reopenedRelations = await db.relations.find().exec();
    const reopenLoadMs = elapsed(start);
    if (reopenedAssets.length !== count || reopenedRelations.length !== count) throw new Error('RxDB reopen count mismatch');
    return { engine: 'rxdb-dexie', count, relationCount: relations.length, attachmentCount, insertMs, loadMs, reopenLoadMs, indexedLookupMs, attachmentWriteMs };
  } finally {
    await db.remove();
    files.close();
    await Dexie.delete(`${dbName}-files`);
  }
}

async function dexieBenchmark(count: number): Promise<BenchResult> {
  const dbName = `keepany-phase0-dexie-${count}-${crypto.randomUUID()}`;
  const db = new Dexie(dbName);
  db.version(1).stores({ assets: 'id,name', relations: 'id,fromId', attachments: 'id,ownerId' });
  try {
    let start = now();
    for (const [first, end] of chunks(count)) {
      await db.transaction('rw', db.table('assets'), db.table('relations'), async () => {
        await db.table('assets').bulkAdd(Array.from({ length: end - first }, (_, i) => asset(first + i)));
        await db.table('relations').bulkAdd(Array.from({ length: end - first }, (_, i) => relation(first + i, count)));
      });
    }
    const insertMs = elapsed(start);
    start = now();
    const assets = await db.table('assets').toArray();
    const relations = await db.table('relations').toArray();
    const loadMs = elapsed(start);
    start = now();
    const match = await db.table('assets').where('name').equals(asset(Math.floor(count / 2)).name).first();
    const connected = await db.table('relations').where('fromId').equals(asset(Math.floor(count / 2)).id).toArray();
    const indexedLookupMs = elapsed(start);
    if (assets.length !== count || relations.length !== count || !match || connected.length !== 1) throw new Error('Dexie count or indexed lookup mismatch');
    start = now();
    for (const [first, end] of chunks(Math.max(1, Math.ceil(count / 100)))) {
      await db.table('attachments').bulkPut(Array.from({ length: end - first }, (_, i) => attachment(first + i)));
    }
    const attachmentWriteMs = elapsed(start);
    const attachmentCount = await db.table('attachments').count();
    if (attachmentCount !== Math.max(1, Math.ceil(count / 100))) throw new Error('Dexie attachment count mismatch');
    db.close();
    start = now();
    await db.open();
    const reopenedAssets = await db.table('assets').toArray();
    const reopenedRelations = await db.table('relations').toArray();
    const reopenLoadMs = elapsed(start);
    if (reopenedAssets.length !== count || reopenedRelations.length !== count) throw new Error('Dexie reopen count mismatch');
    return { engine: 'dexie', count, relationCount: relations.length, attachmentCount, insertMs, loadMs, reopenLoadMs, indexedLookupMs, attachmentWriteMs };
  } finally {
    db.close();
    await Dexie.delete(dbName);
  }
}

async function runKeepAnyBenchmark(engine: Engine, count: number) {
  if (![100, 1000, 10000].includes(count)) throw new Error('Unsupported benchmark size');
  const before = await navigator.storage?.estimate?.();
  const result = engine === 'rxdb-dexie' ? await rxdbBenchmark(count) : await dexieBenchmark(count);
  const after = await navigator.storage?.estimate?.();
  return { ...result, quotaBytes: after?.quota ?? null, usageDeltaBytes: before?.usage === undefined || after?.usage === undefined ? null : after.usage - before.usage, heapUsedBytes: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null };
}

Object.assign(window, { runKeepAnyBenchmark });
