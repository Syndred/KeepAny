import { afterEach, expect, it, vi } from 'vitest';
const platform = vi.hoisted(() => ({ native: false, available: false }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => platform.native, isPluginAvailable: () => platform.available }, registerPlugin: () => ({}) }));
import { McpAuthority, MemoryAuthorityStorage, type AuthorityStorage } from '../../mcp/src/authority';
import { readNativeMcpHistory, revokeNativeMcpOrphans } from './native-mcp-history';

const assetId = crypto.randomUUID(), hash = 'a'.repeat(64);
const noListener = () => {};
async function seeded(storage = new MemoryAuthorityStorage()) {
  const authority = new McpAuthority(storage);
  const grant = await authority.issueGrant({ assetIds: [assetId], readFields: ['name'], writeFields: ['name'], ttlMs: 60000 });
  const preview = await authority.createPreview({ grantId: grant.id, operationId: 'cold_start_operation', assetId: assetId, expectedVersion: hash, patchHash: 'b'.repeat(64) });
  await authority.approvePreview(grant.id, preview.id);
  await authority.reserveOperation({ grantId: grant.id, operationId: preview.operationId, previewId: preview.id, patchHash: preview.patchHash, assetId });
  return { storage, authority, grant, preview };
}
const options = (storage: AuthorityStorage) => ({ storageFactory: () => storage });
afterEach(() => { vi.restoreAllMocks(); platform.native = false; platform.available = false; });

it('cold-reopens the same private state as recent metadata only, with persisted revocation time and no raw credentials or values', async () => {
  const f = await seeded();
  await f.authority.record({ grantId: f.grant.id, action: 'confirm', outcome: 'denied', assetId, fieldNames: ['name'], operationId: f.preview.operationId });
  const before = await f.storage.read();
  const first = await readNativeMcpHistory('keepany-cold', options(f.storage));
  const reopened = await readNativeMcpHistory('keepany-cold', options(f.storage));
  expect(first).toEqual(reopened); expect(first.lastRevokedAt).toBeNull();
  expect(first.entries.at(-1)).toEqual(expect.objectContaining({ action: 'confirm', assetId, fieldNames: ['name'], operationId: f.preview.operationId }));
  const text = JSON.stringify(first);
  for (const forbidden of [f.grant.secret, before.grants[0].secretHash, 'secretHash', 'patchHash', 'expectedVersion', 'changes', 'expiresAt', 'previews', 'operations']) expect(text).not.toContain(forbidden);
  expect(await f.storage.read()).toEqual(before);
  vi.spyOn(Date, 'now').mockReturnValue(1740000000000);
  const recovered = await revokeNativeMcpOrphans('keepany-cold', noListener, options(f.storage));
  const history = await readNativeMcpHistory('keepany-cold', options(f.storage));
  expect(history.lastRevokedAt).toBe(1740000000000); expect(recovered.lastRevokedAt).toBe(history.lastRevokedAt);
  expect(history.entries.at(-1)).toEqual(expect.objectContaining({ at: 1740000000000, action: 'revoke', outcome: 'allowed', grantId: f.grant.id }));
  vi.mocked(Date.now).mockReturnValue(1900000000000);
  expect((await readNativeMcpHistory('keepany-cold', options(f.storage))).lastRevokedAt).toBe(1740000000000);
});

it('returns only the latest100 appended audit rows and independent projected field-name arrays', async () => {
  const f = await seeded();
  for (let index = 0; index < 110; index++) await f.authority.record({ grantId: f.grant.id, action: 'get', outcome: 'allowed', assetId, fieldNames: ['name'], operationId: `history_${String(index).padStart(3, '0')}` });
  const history = await readNativeMcpHistory('keepany-recent', options(f.storage));
  expect(history.entries).toHaveLength(100); expect(history.entries[0].operationId).toBe('history_010');
  expect(history.entries.at(-1)?.operationId).toBe('history_109');
  const fields = history.entries[0].fieldNames;
  if (!fields) throw Error('Missing projected field names');
  fields.push('description');
  expect((await readNativeMcpHistory('keepany-recent', options(f.storage))).entries[0].fieldNames).toEqual(['name']);
});

it('never falls back to empty/memory/ordinary storage for missing plugins, missing factories, corruption or private read failure', async () => {
  await expect(readNativeMcpHistory('keepany-missing')).rejects.toThrow(/^mcp-native-history-unavailable$/);
  await expect(revokeNativeMcpOrphans('keepany-missing', noListener)).rejects.toThrow(/^mcp-native-recovery-unconfirmed$/);
  await expect(readNativeMcpHistory('keepany-missing', { storageFactory: () => undefined as unknown as AuthorityStorage })).rejects.toThrow(/^mcp-native-history-unavailable$/);
  const broken = new MemoryAuthorityStorage();
  vi.spyOn(broken, 'read').mockRejectedValue(Error('synthetic private credential/path diagnostic'));
  await expect(readNativeMcpHistory('keepany-broken', options(broken))).rejects.toThrow(/^mcp-native-history-unavailable$/);
  await expect(revokeNativeMcpOrphans('keepany-broken', noListener, options(broken))).rejects.toThrow(/^mcp-native-recovery-unconfirmed$/);
  const corrupt = new MemoryAuthorityStorage(); await corrupt.update(state => { (state as unknown as { secret: string }).secret = 'must reject'; });
  const state = await corrupt.read();
  await expect(readNativeMcpHistory('keepany-corrupt', options(corrupt))).rejects.toThrow(/^mcp-native-history-unavailable$/);
  await expect(revokeNativeMcpOrphans('keepany-corrupt', noListener, options(corrupt))).rejects.toThrow(/^mcp-native-recovery-unconfirmed$/);
  expect(await corrupt.read()).toEqual(state);
});

it('validates immutable dataset names before storage IO and revokes only the selected dataset', async () => {
  const one = await seeded(), two = await seeded(), secondBefore = await two.storage.read();
  const factory = vi.fn((dataset: string) => dataset === 'keepany-one' ? one.storage : two.storage);
  for (const invalid of ['', '../other', 'Main', 'a'.repeat(62)]) {
    await expect(readNativeMcpHistory(invalid, { storageFactory: factory })).rejects.toThrow(/^mcp-native-history-unavailable$/);
    await expect(revokeNativeMcpOrphans(invalid, noListener, { storageFactory: factory })).rejects.toThrow(/^mcp-native-recovery-unconfirmed$/);
  }
  expect(factory).not.toHaveBeenCalled();
  const result = await revokeNativeMcpOrphans('keepany-one', noListener, { storageFactory: factory });
  expect(result.revokedGrantIds).toEqual([one.grant.id]);
  expect(await two.storage.read()).toEqual(secondBefore);
  await expect(one.authority.requireGrant(one.grant.id, one.grant.secret)).rejects.toThrow('grant-denied');
  expect((await two.authority.requireGrant(two.grant.id, two.grant.secret)).id).toBe(two.grant.id);
});

it('preserves pending receipts and preview metadata and makes repeated bootstrap recovery idempotent', async () => {
  const f = await seeded(), before = await f.storage.read();
  const first = await revokeNativeMcpOrphans('keepany-idempotent', noListener, options(f.storage));
  const recovered = await f.storage.read();
  expect(recovered.previews).toEqual(before.previews); expect(recovered.operations).toEqual(before.operations);
  expect(recovered.operations[0].state).toBe('pending'); expect(first.revokedGrantIds).toEqual([f.grant.id]);
  const second = await revokeNativeMcpOrphans('keepany-idempotent', noListener, options(f.storage));
  expect(second).toEqual({ revokedGrantIds: [], lastRevokedAt: first.lastRevokedAt });
  expect(await f.storage.read()).toEqual(recovered);
});

it('fails before any storage access when a listener exists and does not continue revoking after guard invalidation', async () => {
  const f = await seeded(), extra = await f.authority.issueGrant({ assetIds: [assetId], readFields: ['name'], ttlMs: 60000 });
  const factory = vi.fn(() => f.storage);
  await expect(revokeNativeMcpOrphans('keepany-fenced', () => { throw Error('listener active'); }, { storageFactory: factory })).rejects.toThrow(/^mcp-native-recovery-unconfirmed$/);
  expect(factory).not.toHaveBeenCalled();
  let valid = true;
  const update = f.storage.update.bind(f.storage), writes = vi.spyOn(f.storage, 'update').mockImplementation(async change => {
    const result = await update(change); valid = false; return result;
  });
  await expect(revokeNativeMcpOrphans('keepany-fenced', () => { if (!valid) throw Error('listener became active'); }, options(f.storage))).rejects.toThrow(/^mcp-native-recovery-unconfirmed$/);
  expect(writes).toHaveBeenCalledOnce();
  const partial = await f.storage.read(); expect(partial.grants.find(row => row.id === f.grant.id)?.revokedAt).toBeDefined();
  expect(partial.grants.find(row => row.id === extra.id)?.revokedAt).toBeUndefined();
});

it('rechecks a queued write inside its callback and rejects without mutating when the trusted guard is lost there', async () => {
  const f = await seeded(), before = await f.storage.read(); let valid = true;
  const update = f.storage.update.bind(f.storage);
  vi.spyOn(f.storage, 'update').mockImplementation(change => update(state => { valid = false; return change(state); }));
  await expect(revokeNativeMcpOrphans('keepany-write-fence', () => { if (!valid) throw Error('stale guard'); }, options(f.storage))).rejects.toThrow(/^mcp-native-recovery-unconfirmed$/);
  expect(await f.storage.read()).toEqual(before);
});

it('does not report partial failure or a committed/lost acknowledgement as success, and explicit rescan never duplicates revocation', async () => {
  const f = await seeded(), extra = await f.authority.issueGrant({ assetIds: [assetId], readFields: ['name'], ttlMs: 60000 });
  const update = f.storage.update.bind(f.storage); let calls = 0;
  const write = vi.spyOn(f.storage, 'update').mockImplementation(async change => {
    calls++; if (calls === 2) throw Error('synthetic private write failure'); return update(change);
  });
  await expect(revokeNativeMcpOrphans('keepany-partial', noListener, options(f.storage))).rejects.toThrow(/^mcp-native-recovery-unconfirmed$/);
  expect((await f.storage.read()).grants.filter(row => row.revokedAt === undefined).map(row => row.id)).toEqual([extra.id]);
  write.mockRestore();
  const result = await revokeNativeMcpOrphans('keepany-partial', noListener, options(f.storage));
  expect(result.revokedGrantIds).toEqual([extra.id]);
  expect((await f.storage.read()).audit.filter(row => row.action === 'revoke')).toHaveLength(2);
  const lost = await seeded(), lostUpdate = lost.storage.update.bind(lost.storage);
  const lostWrite = vi.spyOn(lost.storage, 'update').mockImplementation(async change => { await lostUpdate(change); throw Error('synthetic lost ACK'); });
  await expect(revokeNativeMcpOrphans('keepany-lost', noListener, options(lost.storage))).rejects.toThrow(/^mcp-native-recovery-unconfirmed$/);
  expect(lostWrite).toHaveBeenCalledOnce(); lostWrite.mockRestore();
  expect((await revokeNativeMcpOrphans('keepany-lost', noListener, options(lost.storage))).revokedGrantIds).toEqual([]);
  expect((await lost.storage.read()).audit.filter(row => row.action === 'revoke')).toHaveLength(1);
});

it('fails on audit capacity instead of pruning history or pretending the grant was revoked', async () => {
  const f = await seeded();
  await f.storage.update(state => {
    while (state.audit.length < 8192) state.audit.push({ id: crypto.randomUUID(), at: 1, grantId: f.grant.id, action: 'list', outcome: 'allowed' });
  });
  const before = await f.storage.read();
  await expect(revokeNativeMcpOrphans('keepany-full', noListener, options(f.storage))).rejects.toThrow(/^mcp-native-recovery-unconfirmed$/);
  expect(await f.storage.read()).toEqual(before);
});

it('does not call an incomplete scan successful if another unrevoked grant appears before final validation', async () => {
  const f = await seeded(), update = f.storage.update.bind(f.storage), other = new McpAuthority(f.storage);
  let inserted = false;
  vi.spyOn(f.storage, 'update').mockImplementation(async change => {
    const result = await update(change);
    if (!inserted) { inserted = true; await other.issueGrant({ assetIds: [assetId], readFields: ['name'], ttlMs: 60000 }); }
    return result;
  });
  await expect(revokeNativeMcpOrphans('keepany-late-writer', noListener, options(f.storage))).rejects.toThrow(/^mcp-native-recovery-unconfirmed$/);
});
