import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { newAsset } from '../../domain/src';
import { openLocalRepository } from '../../local-db/src';
import { RxdbMcpAssetStore } from './rxdb-store';

describe('MCP writes use the canonical RxDB collection', () => {
  it('performs a compare-and-set update and refuses stale or deleted assets', async () => {
    const repository = await openLocalRepository(`mcp-${crypto.randomUUID().slice(0, 12)}`);
    try {
      const asset = { ...newAsset('project'), name: 'Original' };
      await repository.save('asset', asset);
      const adapter = new RxdbMcpAssetStore(repository);
      const initial = await adapter.get(asset.id);
      expect(initial?.asset.name).toBe('Original');
      if (!initial) throw Error('missing initial asset');
      expect(await adapter.compareAndSet(asset.id, initial.version, { ...asset, name: 'First' })).toBe('applied');
      expect(await repository.get<typeof asset>('asset', asset.id)).toMatchObject({ name: 'First' });
      expect(await adapter.compareAndSet(asset.id, initial.version, { ...asset, name: 'Stale' })).toBe('conflict');
      await repository.deleteEntity('asset', asset.id);
      const deleted = await adapter.get(asset.id);
      if (!deleted) throw Error('missing deleted asset');
      expect(await adapter.compareAndSet(asset.id, deleted.version, { ...asset, name: 'Resurrect' })).toBe('conflict');
    } finally { await repository.close(); }
  });
});
