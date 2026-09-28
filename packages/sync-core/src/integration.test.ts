import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { newAsset, type Asset } from '../../domain/src';
import { openLocalRepository, type RecordRow } from '../../local-db/src';
import { MemorySyncStateStore, SyncService } from './index';

// Test-only shared key. Device enrollment and recovery are separate production gates.
async function codec() {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return {
    async seal(payload: string) {
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, new TextEncoder().encode(payload)));
      const packed = new Uint8Array(nonce.length + ciphertext.length);
      packed.set(nonce);
      packed.set(ciphertext, nonce.length);
      return Buffer.from(packed).toString('base64');
    },
    async open(ciphertext: string) {
      const packed = new Uint8Array(Buffer.from(ciphertext, 'base64'));
      return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: packed.slice(0, 12) }, key, packed.slice(12)));
    },
  };
}

it('syncs two offline Dexie devices with opaque AES-GCM payloads and preserves a concurrent edit', async () => {
  const workspaceId = crypto.randomUUID();
  const asset = { ...newAsset('project'), name: 'Initial project' };
  const deviceA = await openLocalRepository(`device-a-${crypto.randomUUID().slice(0, 8)}`);
  const deviceB = await openLocalRepository(`device-b-${crypto.randomUUID().slice(0, 8)}`);
  const service = new SyncService(new MemorySyncStateStore());
  const encryption = await codec();
  try {
    await deviceA.save('asset', asset);
    const rowA = (await deviceA.allRecords())[0];
    const first = (await service.push({ workspaceId, operations: [{ operationId: crypto.randomUUID(),
      id: rowA.id, kind: 'asset', schemaVersion: 1, expectedVersion: 0,
      ciphertext: await encryption.seal(rowA.payload), tombstone: false, intent: 'write' }] })).results[0];
    expect(first.status).toBe('accepted');
    const page1 = await service.pull({ workspaceId, cursor: 0, limit: 100 });
    const pulled: RecordRow = { id: page1.changes[0].id, type: 'asset',
      payload: await encryption.open(page1.changes[0].ciphertext), updatedAt: Date.now() };
    expect(await deviceB.applyPulledBatch([{ row: pulled, sequence: 1, version: 1 }], 0)).toBe(1);
    expect((await deviceB.get<Asset>('asset', asset.id))?.name).toBe('Initial project');

    await deviceA.save('asset', { ...asset, name: 'A offline edit' });
    await deviceB.save('asset', { ...asset, name: 'B offline edit' });
    const editedA = (await deviceA.allRecords())[0];
    const editedB = (await deviceB.allRecords())[0];
    expect((await service.push({ workspaceId, operations: [{ operationId: crypto.randomUUID(), id: editedA.id,
      kind: 'asset', schemaVersion: 1, expectedVersion: 1, ciphertext: await encryption.seal(editedA.payload), tombstone: false, intent: 'write' }] })).results[0].status).toBe('accepted');
    expect((await service.push({ workspaceId, operations: [{ operationId: crypto.randomUUID(), id: editedB.id,
      kind: 'asset', schemaVersion: 1, expectedVersion: 1, ciphertext: await encryption.seal(editedB.payload), tombstone: false, intent: 'write' }] })).results[0]).toMatchObject({ status: 'conflict', version: 2 });
    const page2 = await service.pull({ workspaceId, cursor: 1, limit: 100 });
    const remoteA: RecordRow = { id: editedA.id, type: 'asset', payload: await encryption.open(page2.changes[0].ciphertext), updatedAt: Date.now() };
    await expect(deviceB.applyPulledBatch([{ row: remoteA, sequence: 2, version: 2 }], 1)).rejects.toThrow('sync-conflict');
    expect(await deviceB.syncCursor()).toBe(1);
    expect((await deviceB.get<Asset>('asset', asset.id))?.name).toBe('B offline edit');
  } finally {
    await deviceA.close();
    await deviceB.close();
  }
});
