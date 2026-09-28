import { assetSchema, type Asset } from '../../domain/src';
import { digest, McpAccessError, writableFields, type Grant, type McpAuthority, type WriteField } from './authority';

export interface AssetSnapshot { asset: Asset; version: string }
export interface McpAssetStore {
  get(id: string): Promise<AssetSnapshot | null>;
  list(ids: readonly string[]): Promise<AssetSnapshot[]>;
  // Must reject a concurrent change. The caller must never use a blind save here.
  compareAndSet(id: string, expectedVersion: string, next: Asset,
    assertCanCommit?: () => void | Promise<void>): Promise<'applied' | 'conflict'>;
}

export type AssetPatch = Partial<Pick<Asset, WriteField>>;
export type PreviewResult = { previewId: string; operationId: string; assetId: string; expectedVersion: string; expiresAt: number;
  changes: Array<{ field: WriteField; before: Asset[WriteField]; after: Asset[WriteField] }> };

const allowedRead = (grant: Grant, asset: Asset) => grant.assetIds.includes(asset.id) && !asset.deleted;
const project = (grant: Grant, asset: Asset): Record<string, unknown> => {
  const value: Record<string, unknown> = { id: asset.id };
  for (const field of grant.readFields) value[field] = asset[field];
  return value;
};
const patchKey = (patch: AssetPatch) => JSON.stringify(Object.keys(patch).sort().map(field => [field, patch[field as WriteField]]));
const patchHash = (patch: AssetPatch) => digest(patchKey(patch));

export class McpAssetService {
  private confirmQueue: Promise<unknown> = Promise.resolve();
  constructor(private readonly store: McpAssetStore, private readonly authority: McpAuthority,
    private readonly grantId: string, private readonly grantSecret: string) {}

  private grant() { return this.authority.requireGrant(this.grantId, this.grantSecret); }

  async listAssets(query = '', limit = 20): Promise<Record<string, unknown>[]> {
    const grant = await this.grant();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || query.length > 160) throw new McpAccessError('invalid-query');
    const rows = await this.store.list(grant.assetIds);
    const term = query.trim().toLocaleLowerCase();
    const visible = rows.filter(row => allowedRead(grant, row.asset))
      .map(row => project(grant, row.asset))
      .filter(row => !term || Object.values(row).some(value => typeof value === 'string' && value.toLocaleLowerCase().includes(term)))
      .slice(0, limit);
    await this.authority.record({ grantId: grant.id, action: 'list', outcome: 'allowed' });
    return visible;
  }

  async getAsset(id: string): Promise<Record<string, unknown>> {
    const grant = await this.grant();
    if (!grant.assetIds.includes(id)) {
      await this.authority.record({ grantId: grant.id, action: 'get', outcome: 'denied', assetId: id });
      throw new McpAccessError('asset-denied');
    }
    const snapshot = await this.store.get(id);
    if (!snapshot || !allowedRead(grant, snapshot.asset)) throw new McpAccessError('asset-not-found');
    await this.authority.record({ grantId: grant.id, action: 'get', outcome: 'allowed', assetId: id, fieldNames: grant.readFields });
    return project(grant, snapshot.asset);
  }

  async previewUpdate(id: string, operationId: string, patch: AssetPatch): Promise<PreviewResult> {
    const grant = await this.grant();
    const fields = Object.keys(patch) as WriteField[];
    const auditableFields = fields.filter(field => writableFields.includes(field));
    if (!grant.assetIds.includes(id) || !grant.writeFields.length || !fields.length || fields.length > 5 ||
      fields.some(field => !grant.writeFields.includes(field)) || !/^[A-Za-z0-9_-]{8,96}$/.test(operationId)) {
      await this.authority.record({ grantId: grant.id, action: 'preview', outcome: 'denied', assetId: id, fieldNames: auditableFields });
      throw new McpAccessError('write-denied');
    }
    const snapshot = await this.store.get(id);
    if (!snapshot || !allowedRead(grant, snapshot.asset)) throw new McpAccessError('asset-not-found');
    const next = assetSchema.parse({ ...snapshot.asset, ...patch });
    const changes = fields.filter(field => JSON.stringify(snapshot.asset[field]) !== JSON.stringify(next[field]))
      .map(field => ({ field, before: snapshot.asset[field], after: next[field] }));
    if (!changes.length) throw new McpAccessError('no-change');
    const preview = await this.authority.createPreview({ grantId: grant.id, operationId, assetId: id,
      expectedVersion: snapshot.version, patchHash: patchHash(patch) });
    return { previewId: preview.id, operationId, assetId: id, expectedVersion: preview.expectedVersion,
      expiresAt: preview.expiresAt, changes };
  }

  async confirmUpdate(input: { id: string; operationId: string; previewId: string; patch: AssetPatch }) {
    const work = this.confirmQueue.then(() => this.confirmUpdateInner(input));
    this.confirmQueue = work.catch(() => undefined);
    return work;
  }

  private async confirmUpdateInner(input: { id: string; operationId: string; previewId: string; patch: AssetPatch }) {
    const grant = await this.grant();
    const fields = Object.keys(input.patch) as WriteField[];
    const auditableFields = fields.filter(field => writableFields.includes(field));
    if (!grant.assetIds.includes(input.id) || !fields.length || fields.some(field => !grant.writeFields.includes(field))) {
      await this.authority.record({ grantId: grant.id, action: 'confirm', outcome: 'denied', assetId: input.id,
        fieldNames: auditableFields, operationId: input.operationId });
      throw new McpAccessError('write-denied');
    }
    const hash = patchHash(input.patch);
    const receipt = await this.authority.operation(grant.id, input.operationId);
    if (receipt) {
      if (receipt.previewId !== input.previewId || receipt.assetId !== input.id || receipt.patchHash !== hash) {
        await this.authority.record({ grantId: grant.id, action: 'confirm', outcome: 'denied', assetId: input.id,
          fieldNames: auditableFields, operationId: input.operationId });
        throw new McpAccessError('operation-reused');
      }
      if (receipt.state === 'pending') {
        await this.authority.record({ grantId: grant.id, action: 'confirm', outcome: 'denied', assetId: input.id,
          fieldNames: auditableFields, operationId: input.operationId });
        throw new McpAccessError('operation-uncertain');
      }
      await this.authority.record({ grantId: grant.id, action: 'confirm', outcome: 'duplicate',
        assetId: input.id, fieldNames: auditableFields, operationId: input.operationId });
      return { status: 'duplicate' as const };
    }
    const preview = await this.authority.approvedPreview(grant.id, input.previewId, input.operationId, input.id, hash).catch(async error => {
      await this.authority.record({ grantId: grant.id, action: 'confirm', outcome: 'denied', assetId: input.id,
        fieldNames: auditableFields, operationId: input.operationId });
      throw error;
    });
    const current = await this.store.get(input.id);
    if (!current || !allowedRead(grant, current.asset) || current.version !== preview.expectedVersion) {
      await this.authority.record({ grantId: grant.id, action: 'confirm', outcome: 'conflict', assetId: input.id,
        fieldNames: auditableFields, operationId: input.operationId });
      throw new McpAccessError('write-conflict');
    }
    const next = assetSchema.parse({ ...current.asset, ...input.patch, updatedAt: new Date().toISOString() });
    await this.authority.reserveOperation({ grantId: grant.id, operationId: input.operationId,
      previewId: input.previewId, patchHash: hash, assetId: input.id });
    await this.grant(); // Catch revocation that happened while the preview and reservation were checked.
    // If the store throws, keep pending: replay might duplicate a write whose acknowledgement was lost.
    const result = await this.store.compareAndSet(input.id, preview.expectedVersion, next);
    if (result === 'conflict') {
      await this.authority.cancelPendingOperation(grant.id, input.operationId);
      await this.authority.record({ grantId: grant.id, action: 'confirm', outcome: 'conflict', assetId: input.id,
        fieldNames: auditableFields, operationId: input.operationId });
      throw new McpAccessError('write-conflict');
    }
    await this.authority.completeOperation(grant.id, input.operationId);
    return { status: 'applied' as const };
  }
}
