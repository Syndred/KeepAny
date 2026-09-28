import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { expect, it } from 'vitest';
import { newAsset, type Asset } from '../../domain/src';
import { openLocalRepository, type DatasetBinding, type RecordRow } from './index';

const name = () => `test-${crypto.randomUUID().slice(0, 12)}`;
const scope = (workspace: string) => `${'a'.repeat(64)}:${workspace}`;
async function binding(endpoint = 'https://sync.example.test', accountId = 'self-host-owner',
  workspaceId: string = crypto.randomUUID()): Promise<DatasetBinding> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(JSON.stringify([endpoint, accountId]))));
  const digest = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return { endpoint, accountId, workspaceId, scope: `${digest}:${workspaceId}` };
}

it('binds one local dataset durably and refuses A to B to A copying without losing A edits or outbox', async () => {
  const dbName = name();
  const a = await binding();
  const b = await binding(a.endpoint);
  const otherServer = await binding('https://another.example.test', a.accountId, a.workspaceId);
  const otherAccount = await binding(a.endpoint, 'another-owner', a.workspaceId);
  const db = await openLocalRepository(dbName);
  const asset = { ...newAsset('project'), name: 'Private A' };
  const original = await db.save('asset', asset);
  expect(await db.claimDatasetBinding(a)).toEqual(a);
  const operationId = crypto.randomUUID();
  await db.stageScopedOutbox(a.scope, original, { operationId, id: original.id, kind: 'asset', schemaVersion: 1,
    expectedVersion: 0, ciphertext: 'opaque', tombstone: false, intent: 'write' });
  await db.close();

  const reopened = await openLocalRepository(dbName);
  expect(await reopened.getDatasetBinding()).toEqual(a);
  expect(await reopened.claimDatasetBinding(a)).toEqual(a);
  for (const candidate of [b, otherServer, otherAccount]) {
    await expect(reopened.claimDatasetBinding(candidate)).rejects.toThrow('sync-dataset-bound');
    await expect(reopened.dirtyScopedRows(candidate.scope)).rejects.toThrow('sync-dataset-bound');
    expect(await reopened.listScopedOutbox(candidate.scope)).toEqual([]);
  }
  await expect(reopened.applyScopedPull(b.scope, { row: original, sequence: 1, version: 1 }))
    .rejects.toThrow('sync-dataset-bound');
  await reopened.save('asset', { ...asset, name: 'Edited in A' });
  expect(await reopened.claimDatasetBinding(a)).toEqual(a);
  expect(await reopened.getDatasetBinding()).toEqual(a);
  expect((await reopened.listScopedOutbox(a.scope))[0].operation.operationId).toBe(operationId);
  expect((await reopened.get<Asset>('asset', asset.id))?.name).toBe('Edited in A');
  await reopened.acknowledgeScopedOutbox(a.scope, operationId, 1, 1);
  expect(await reopened.dirtyScopedRows(a.scope)).toHaveLength(1);
  await reopened.close();
});

it('claims matching legacy scoped state but refuses a different target without modifying pending data', async () => {
  const a = await binding();
  const b = await binding(a.endpoint);
  const db = await openLocalRepository(name());
  const asset = { ...newAsset('project'), name: 'Old private A' };
  const row = await db.save('asset', asset);
  const operationId = crypto.randomUUID();
  await db.pinScopedKey(a.scope, 'f'.repeat(64), 1);
  await db.stageScopedOutbox(a.scope, row, { operationId, id: row.id, kind: 'asset', schemaVersion: 1,
    expectedVersion: 0, ciphertext: 'opaque', tombstone: false, intent: 'write' });
  await expect(db.claimDatasetBinding(b)).rejects.toThrow('sync-dataset-bound');
  expect(await db.getDatasetBinding()).toBeNull();
  expect((await db.listScopedOutbox(a.scope))[0].operation.operationId).toBe(operationId);
  expect(await db.claimDatasetBinding(a)).toEqual(a);
  expect(await db.getDatasetBinding()).toEqual(a);
  await db.close();
});

it('upgrades a version 4 file store without clearing its legacy scoped outbox', async () => {
  const dbName = name();
  const a = await binding();
  const asset = { ...newAsset('project'), name: 'Before upgrade' };
  const row: RecordRow = { id: `asset:${asset.id}`, type: 'asset', payload: JSON.stringify(asset), updatedAt: Date.now() };
  const operationId = crypto.randomUUID();
  const legacy = new Dexie(`${dbName}-files-v1`);
  legacy.version(4).stores({ blobs: 'id', journal: 'id', importJournal: 'id', syncBase: 'id', syncMeta: 'id',
    pullJournal: 'id', scopedBase: 'id, scope', scopedMeta: 'id', scopedOutbox: 'id, scope', scopedPull: 'id' });
  await legacy.table('scopedOutbox').put({ id: `${a.scope}|${row.id}`, scope: a.scope, row,
    operation: { operationId, id: row.id, kind: 'asset', schemaVersion: 1, expectedVersion: 0,
      ciphertext: 'opaque', tombstone: false, intent: 'write' } });
  legacy.close();
  const db = await openLocalRepository(dbName);
  expect((await db.listScopedOutbox(a.scope))[0].operation.operationId).toBe(operationId);
  expect(await db.claimDatasetBinding(a)).toEqual(a);
  expect((await db.listScopedOutbox(a.scope))[0].operation.operationId).toBe(operationId);
  await db.close();
});

it('rejects ambiguous legacy scopes across metadata, base, outbox and pull journals', async () => {
  const a = await binding();
  const b = await binding(a.endpoint);
  const db = await openLocalRepository(name());
  const asset = { ...newAsset('project'), name: 'Unresolved' };
  const row = await db.save('asset', asset);
  await db.fileStore.scopedMeta.put({ id: a.scope, cursor: 1 });
  await db.fileStore.scopedBase.put({ id: `${b.scope}|${row.id}`, scope: b.scope, rowId: row.id,
    payload: row.payload, version: 1 });
  await db.fileStore.scopedOutbox.put({ id: `${a.scope}|${row.id}`, scope: a.scope, row,
    operation: { operationId: crypto.randomUUID(), id: row.id, kind: 'asset', schemaVersion: 1,
      expectedVersion: 0, ciphertext: 'opaque', tombstone: false, intent: 'write' } });
  await db.fileStore.scopedPull.put({ id: b.scope, scope: b.scope, cursorStart: 0,
    change: { row, sequence: 1, version: 1 }, localPayload: row.payload });
  await expect(db.claimDatasetBinding(a)).rejects.toThrow('sync-dataset-ambiguous');
  expect(await db.getDatasetBinding()).toBeNull();
  expect((await db.listScopedOutbox(a.scope))).toHaveLength(1);
  expect(await db.fileStore.scopedPull.get(b.scope)).toBeDefined();
  expect((await db.get<Asset>('asset', asset.id))?.name).toBe('Unresolved');
  await db.close();
});

it('does not attach a local dataset whose older unscoped sync provenance is unknown', async () => {
  const db = await openLocalRepository(name());
  const a = await binding();
  await db.fileStore.syncMeta.put({ id: 'cursor', cursor: 1 });
  await expect(db.claimDatasetBinding(a)).rejects.toThrow('sync-dataset-ambiguous');
  expect(await db.getDatasetBinding()).toBeNull();
  await db.close();
});

it('does not replay a pull journal from another dataset during repository reopen', async () => {
  const dbName = name();
  const a = await binding();
  const b = await binding(a.endpoint);
  const db = await openLocalRepository(dbName);
  const asset = { ...newAsset('project'), name: 'Private A' };
  const row = await db.save('asset', asset);
  await db.claimDatasetBinding(a);
  await db.pinScopedKey(a.scope, 'f'.repeat(64), 1);
  await db.fileStore.scopedPull.put({ id: b.scope, scope: b.scope, cursorStart: 0,
    change: { row: { ...row, payload: JSON.stringify({ ...asset, name: 'Private B' }) }, sequence: 1, version: 1 },
    localPayload: row.payload, decision: 'remote' });
  await db.close();
  const reopened = await openLocalRepository(dbName);
  expect(reopened.syncRecoveryError).toBe('sync-dataset-ambiguous');
  expect((await reopened.get<Asset>('asset', asset.id))?.name).toBe('Private A');
  expect(await reopened.fileStore.scopedPull.get(b.scope)).toBeDefined();
  await reopened.close();
});

it('keeps a fixed pending operation across reopen and acknowledges only its exact version in one scope', async () => {
  const dbName = name();
  const workspaceA = scope(crypto.randomUUID());
  const workspaceB = scope(crypto.randomUUID());
  const db = await openLocalRepository(dbName);
  const asset = { ...newAsset('project'), name: 'Offline' };
  const row = await db.save('asset', asset);
  const operationId = crypto.randomUUID();
  const operation = { operationId, id: row.id, kind: row.type, schemaVersion: 1, expectedVersion: 0,
    ciphertext: 'opaque', tombstone: false, intent: 'write' as const };
  await db.stageScopedOutbox(workspaceA, row, operation);
  await db.close();
  const reopened = await openLocalRepository(dbName);
  expect((await reopened.listScopedOutbox(workspaceA))[0].operation.operationId).toBe(operationId);
  expect(await reopened.listScopedOutbox(workspaceB)).toEqual([]);
  expect(await reopened.dirtyScopedRows(workspaceA)).toEqual([]);
  await expect(reopened.acknowledgeScopedOutbox(workspaceA, operationId, 2, 1)).rejects.toThrow('outbox-ack');
  await reopened.acknowledgeScopedOutbox(workspaceA, operationId, 1, 1);
  expect(await reopened.scopedBaseFor(workspaceA, row.id)).toMatchObject({ version: 1, payload: row.payload, operationId });
  expect(await reopened.dirtyScopedRows(workspaceA)).toEqual([]);
  expect(await reopened.dirtyScopedRows(workspaceB)).toHaveLength(1);
  await reopened.close();
});

it('keeps a conflict and cursor durable until the user chooses the local or server record', async () => {
  const dbName = name();
  const selectedScope = scope(crypto.randomUUID());
  const asset = { ...newAsset('project'), name: 'Original' };
  const initial: RecordRow = { id: `asset:${asset.id}`, type: 'asset', payload: JSON.stringify(asset), updatedAt: Date.now() };
  const db = await openLocalRepository(dbName);
  expect(await db.applyScopedPull(selectedScope, { row: initial, sequence: 1, version: 1 })).toBe('applied');
  await db.save('asset', { ...asset, name: 'Local' });
  const remote: RecordRow = { ...initial, payload: JSON.stringify({ ...asset, name: 'Server' }) };
  expect(await db.applyScopedPull(selectedScope, { row: remote, sequence: 2, version: 2 })).toBe('conflict');
  expect(await db.scopedCursor(selectedScope)).toBe(1);
  expect(await db.scopedConflict(selectedScope)).toMatchObject({ remotePayload: remote.payload, basePayload: initial.payload });
  await db.close();
  const reopened = await openLocalRepository(dbName);
  expect(await reopened.resumeScopedPull(selectedScope)).toBe('conflict');
  await reopened.resolveScopedConflict(selectedScope, 'local');
  expect((await reopened.get<Asset>('asset', asset.id))?.name).toBe('Local');
  expect(await reopened.scopedBaseFor(selectedScope, initial.id)).toMatchObject({ version: 2, payload: remote.payload });
  expect(await reopened.scopedCursor(selectedScope)).toBe(2);
  expect(await reopened.dirtyScopedRows(selectedScope)).toHaveLength(1);
  await reopened.close();
});

it('applies an explicit server choice and rejects a local edit made after the conflict was shown', async () => {
  const db = await openLocalRepository(name());
  const selectedScope = scope(crypto.randomUUID());
  const asset = { ...newAsset('project'), name: 'Original' };
  const initial: RecordRow = { id: `asset:${asset.id}`, type: 'asset', payload: JSON.stringify(asset), updatedAt: Date.now() };
  await db.applyScopedPull(selectedScope, { row: initial, sequence: 1, version: 1 });
  await db.save('asset', { ...asset, name: 'Local' });
  const remote: RecordRow = { ...initial, payload: JSON.stringify({ ...asset, name: 'Server' }) };
  await db.applyScopedPull(selectedScope, { row: remote, sequence: 2, version: 2 });
  await db.save('asset', { ...asset, name: 'Local again' });
  await expect(db.resolveScopedConflict(selectedScope, 'remote')).rejects.toThrow('conflict-local-changed');
  expect(await db.scopedCursor(selectedScope)).toBe(1);
  await db.resolveScopedConflict(selectedScope, 'remote');
  expect((await db.get<Asset>('asset', asset.id))?.name).toBe('Server');
  expect(await db.scopedCursor(selectedScope)).toBe(2);
  await db.close();
});

it('advances an acknowledged own echo without overwriting a newer local edit', async () => {
  const db = await openLocalRepository(name());
  const selectedScope = scope(crypto.randomUUID());
  const asset = { ...newAsset('project'), name: 'Sent' };
  const sent = await db.save('asset', asset);
  const operationId = crypto.randomUUID();
  await db.stageScopedOutbox(selectedScope, sent, { operationId, id: sent.id, kind: 'asset', schemaVersion: 1,
    expectedVersion: 0, ciphertext: 'sealed', tombstone: false, intent: 'write' });
  await db.acknowledgeScopedOutbox(selectedScope, operationId, 1, 1);
  await db.save('asset', { ...asset, name: 'Edited while waiting' });
  expect(await db.applyScopedPull(selectedScope, { row: sent, sequence: 1, version: 1,
    operationId, keyEpoch: 1, ciphertext: 'sealed' })).toBe('applied');
  expect((await db.get<Asset>('asset', asset.id))?.name).toBe('Edited while waiting');
  expect(await db.scopedCursor(selectedScope)).toBe(1);
  expect(await db.dirtyScopedRows(selectedScope)).toHaveLength(1);
  await db.close();
});

it('recovers a scoped pull interrupted between the record write and cursor commit', async () => {
  const dbName = name();
  const selectedScope = scope(crypto.randomUUID());
  const asset = { ...newAsset('project'), name: 'Recovered pull' };
  const row: RecordRow = { id: `asset:${asset.id}`, type: 'asset', payload: JSON.stringify(asset), updatedAt: Date.now() };
  const db = await openLocalRepository(dbName);
  await db.fileStore.scopedPull.put({ id: selectedScope, scope: selectedScope, cursorStart: 0,
    change: { row, sequence: 1, version: 1 }, localPayload: null });
  await db.db.records.insert(row);
  await db.close();
  const reopened = await openLocalRepository(dbName);
  expect(reopened.syncRecoveryError).toBeNull();
  expect(await reopened.scopedCursor(selectedScope)).toBe(1);
  expect(await reopened.scopedBaseFor(selectedScope, row.id)).toMatchObject({ payload: row.payload, version: 1 });
  expect(await reopened.fileStore.scopedPull.get(selectedScope)).toBeUndefined();
  await reopened.close();
});

it('retires a blocked write when local data returns to the base and a newer server record applies', async () => {
  const db = await openLocalRepository(name());
  const selectedScope = scope(crypto.randomUUID());
  const asset = { ...newAsset('project'), name: 'Base' };
  const initial: RecordRow = { id: `asset:${asset.id}`, type: 'asset', payload: JSON.stringify(asset), updatedAt: Date.now() };
  await db.applyScopedPull(selectedScope, { row: initial, sequence: 1, version: 1 });
  const edit = await db.save('asset', { ...asset, name: 'Rejected local edit' });
  const operationId = crypto.randomUUID();
  await db.stageScopedOutbox(selectedScope, edit, { operationId, id: edit.id, kind: 'asset', schemaVersion: 1,
    expectedVersion: 1, ciphertext: 'sealed', tombstone: false, intent: 'write' });
  await db.blockScopedOutbox(selectedScope, operationId);
  await db.save('asset', asset);
  const remote: RecordRow = { ...initial, payload: JSON.stringify({ ...asset, name: 'Server edit' }) };
  expect(await db.applyScopedPull(selectedScope, { row: remote, sequence: 2, version: 2 })).toBe('applied');
  expect((await db.get<Asset>('asset', asset.id))?.name).toBe('Server edit');
  expect(await db.listScopedOutbox(selectedScope)).toEqual([]);
  expect(await db.dirtyScopedRows(selectedScope)).toEqual([]);
  await db.close();
});
