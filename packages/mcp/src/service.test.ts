import { describe, expect, it } from 'vitest';
import { newAsset, type Asset } from '../../domain/src';
import { McpAuthority, MemoryAuthorityStorage } from './authority';
import { McpAssetService, type AssetSnapshot, type McpAssetStore } from './service';

class MemoryAssets implements McpAssetStore {
  private rows = new Map<string, AssetSnapshot>();
  seed(asset: Asset) { this.rows.set(asset.id, { asset, version: '1' }); }
  async get(id: string) { return this.rows.get(id) ?? null; }
  async list(ids: readonly string[]) { return ids.map(id => this.rows.get(id)).filter((item): item is AssetSnapshot => Boolean(item)); }
  async compareAndSet(id: string, expectedVersion: string, next: Asset) {
    const previous = this.rows.get(id);
    if (!previous || previous.version !== expectedVersion) return 'conflict' as const;
    this.rows.set(id, { asset: next, version: String(Number(previous.version) + 1) });
    return 'applied' as const;
  }
  externalEdit(id: string, name: string) {
    const value = this.rows.get(id);
    if (value) this.rows.set(id, { asset: { ...value.asset, name }, version: String(Number(value.version) + 1) });
  }
}

const fixture = async () => {
  let time = Date.parse('2026-09-28T10:00:00.000Z');
  const authority = new McpAuthority(new MemoryAuthorityStorage(), () => time);
  const store = new MemoryAssets();
  const asset = { ...newAsset('project'), name: 'Visible project', description: 'private text', username: 'private-login' };
  const other = { ...newAsset('account'), name: 'Hidden account' };
  store.seed(asset); store.seed(other);
  const grant = await authority.issueGrant({ assetIds: [asset.id], readFields: ['name'], writeFields: ['name'], ttlMs: 60_000 });
  const service = new McpAssetService(store, authority, grant.id, grant.secret);
  return { authority, store, asset, other, grant, service, advance: (ms: number) => { time += ms; } };
};

describe('local MCP capability boundary', () => {
  it('shows only granted assets and fields; denies wrong secret and revoked grants', async () => {
    const { authority, store, asset, other, grant, service } = await fixture();
    expect(await service.listAssets()).toEqual([{ id: asset.id, name: 'Visible project' }]);
    expect(await service.listAssets('private')).toEqual([]);
    expect(await service.getAsset(asset.id)).toEqual({ id: asset.id, name: asset.name });
    await expect(service.getAsset(other.id)).rejects.toThrow('asset-denied');
    const wrong = new McpAssetService(store, authority, grant.id, 'not-a-secret');
    await expect(wrong.listAssets()).rejects.toThrow('grant-denied');
    await authority.revokeGrant(grant.id);
    await expect(service.getAsset(asset.id)).rejects.toThrow('grant-denied');
    const audit = await authority.auditEntries(grant.id);
    expect(audit.some(item => item.action === 'get' && item.outcome === 'denied')).toBe(true);
    expect(JSON.stringify(audit)).not.toContain('private text');
    expect(JSON.stringify(audit)).not.toContain(grant.secret);
  });

  it('requires an exact approved preview, applies once and audits without values', async () => {
    const { authority, store, asset, grant, service } = await fixture();
    await expect(service.previewUpdate(asset.id, 'operation-001', { description: 'leak' })).rejects.toThrow('write-denied');
    const preview = await service.previewUpdate(asset.id, 'operation-001', { name: 'Renamed project' });
    expect(preview.changes).toEqual([{ field: 'name', before: 'Visible project', after: 'Renamed project' }]);
    await expect(service.confirmUpdate({ id: asset.id, operationId: 'operation-001', previewId: preview.previewId,
      patch: { name: 'Renamed project' } })).rejects.toThrow('preview-not-approved');
    await authority.approvePreview(grant.id, preview.previewId);
    await expect(service.confirmUpdate({ id: asset.id, operationId: 'operation-001', previewId: preview.previewId,
      patch: { name: 'Different' } })).rejects.toThrow('preview-not-approved');
    expect(await service.confirmUpdate({ id: asset.id, operationId: 'operation-001', previewId: preview.previewId,
      patch: { name: 'Renamed project' } })).toEqual({ status: 'applied' });
    expect((await store.get(asset.id))?.asset.name).toBe('Renamed project');
    expect(await service.confirmUpdate({ id: asset.id, operationId: 'operation-001', previewId: preview.previewId,
      patch: { name: 'Renamed project' } })).toEqual({ status: 'duplicate' });
    await expect(service.confirmUpdate({ id: asset.id, operationId: 'operation-001', previewId: preview.previewId,
      patch: { name: 'Different' } })).rejects.toThrow('operation-reused');
    const audit = await authority.auditEntries(grant.id);
    expect(audit.map(item => item.outcome)).toContain('applied');
    expect(audit.map(item => item.outcome)).toContain('duplicate');
    expect(JSON.stringify(audit)).not.toContain('Renamed project');
  });

  it('rejects stale previews, concurrent changes and expired grants', async () => {
    const { authority, store, asset, grant, service, advance } = await fixture();
    const preview = await service.previewUpdate(asset.id, 'operation-002', { name: 'New title' });
    await authority.approvePreview(grant.id, preview.previewId);
    store.externalEdit(asset.id, 'Changed in app');
    await expect(service.confirmUpdate({ id: asset.id, operationId: 'operation-002', previewId: preview.previewId,
      patch: { name: 'New title' } })).rejects.toThrow('write-conflict');
    advance(60_001);
    await expect(service.listAssets()).rejects.toThrow('grant-denied');
  });

  it('does not automatically replay a write after an uncertain store failure', async () => {
    const { authority, store, asset, grant } = await fixture();
    let writes = 0;
    const uncertainStore: McpAssetStore = {
      get: id => store.get(id), list: ids => store.list(ids),
      async compareAndSet(id, version, next) {
        writes++;
        await store.compareAndSet(id, version, next);
        throw Error('ack-lost');
      },
    };
    const service = new McpAssetService(uncertainStore, authority, grant.id, grant.secret);
    const preview = await service.previewUpdate(asset.id, 'operation-004', { name: 'Updated once' });
    await authority.approvePreview(grant.id, preview.previewId);
    await expect(service.confirmUpdate({ id: asset.id, operationId: 'operation-004', previewId: preview.previewId,
      patch: { name: 'Updated once' } })).rejects.toThrow('ack-lost');
    await expect(service.confirmUpdate({ id: asset.id, operationId: 'operation-004', previewId: preview.previewId,
      patch: { name: 'Updated once' } })).rejects.toThrow('operation-uncertain');
    expect(writes).toBe(1);
    expect((await store.get(asset.id))?.asset.name).toBe('Updated once');
  });

  it('does not copy untrusted patch keys into audit metadata', async () => {
    const { authority, asset, grant, service } = await fixture();
    const malicious = { 'secret-value-in-key': 'anything' } as unknown as { name: string };
    await expect(service.previewUpdate(asset.id, 'operation-005', malicious)).rejects.toThrow('write-denied');
    expect(JSON.stringify(await authority.auditEntries(grant.id))).not.toContain('secret-value-in-key');
  });
});
