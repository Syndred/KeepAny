import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { newAsset, type Asset } from '../../domain/src';
import { openLocalRepository, type RecordRow } from './index';

const name = () => `test-${crypto.randomUUID().slice(0, 12)}`;
const scope = (workspace: string) => `${'a'.repeat(64)}:${workspace}`;

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
