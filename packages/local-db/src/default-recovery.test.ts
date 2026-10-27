import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { newAsset } from '../../domain/src';

const globalState = globalThis as typeof globalThis & { __keepanyLocalDbState?: unknown };

afterEach(() => {
  delete globalState.__keepanyLocalDbState;
  vi.resetModules();
});

it('carries a real pending restore warning through the public default entry and HMR reuse', async () => {
  const first = await import('./index');
  const initial = await first.localRepository();
  const asset = { ...newAsset('project'), name: 'Local edit' };
  await initial.save('asset', asset);
  const incoming = { ...asset, name: 'Archive version' };
  await initial.fileStore.journal.put({ id: 'pending-restore', rows: [{
    id: `asset:${asset.id}`, type: 'asset', payload: JSON.stringify(incoming), updatedAt: Date.now(),
  }] });
  await initial.close();

  // A browser refresh creates a new global module state while IndexedDB persists.
  delete globalState.__keepanyLocalDbState;
  vi.resetModules();
  const refreshed = await import('./index');
  const reopened = await refreshed.localRepository();
  expect(reopened.restoreRecoveryError).toBe('restore-conflict');
  expect((await reopened.get<{ name: string }>('asset', asset.id))?.name).toBe('Local edit');
  expect(await reopened.fileStore.journal.count()).toBe(1);
  await expect(reopened.restoreArchive(new Uint8Array())).rejects.toThrow('restore-recovery-pending');

  // Vite HMR re-evaluates the module but must keep the open handles and warning.
  reopened.syncRecoveryError = 'pull-failed';
  vi.resetModules();
  const hot = await import('./index');
  const reused = await hot.localRepository();
  expect(reused).not.toBe(reopened);
  expect(reused.records).toBe(reopened.records);
  expect(reused.fileStore).toBe(reopened.fileStore);
  expect(reused.restoreRecoveryError).toBe('restore-conflict');
  expect(reused.syncRecoveryError).toBe('pull-failed');
  reused.syncRecoveryError = 'sync-dataset-bound';
  expect(reopened.syncRecoveryError).toBe('sync-dataset-bound');
  expect(await reused.fileStore.journal.count()).toBe(1);
  await reused.close();
});
