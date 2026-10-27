import { afterEach, expect, it, vi } from 'vitest';
const platform = vi.hoisted(() => ({ native: true, available: true }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => platform.native, isPluginAvailable: () => platform.available }, registerPlugin: () => ({}) }));
import { McpAuthority, type AuthorityState, type AuditEntry } from '../../mcp/src/authority';
import { checkedNativeMcpAuthorityState, createNativeMcpAuthorityStorage, nativeMcpAuthorityLimit, nativeMcpAuthorityScope, type NativeMcpAuthorityPlugin } from './native-mcp-authority';
const empty = (): AuthorityState => ({ grants: [], previews: [], operations: [], audit: [] });
const hash = 'a'.repeat(64), asset = crypto.randomUUID(), grantId = crypto.randomUUID();
const audit = (): AuditEntry => ({ id: crypto.randomUUID(), at: 1, grantId, action: 'list', outcome: 'allowed' });
function fixture() {
  const states = new Map<string, { revision: string; payload: string }>();
  let beforeWrite = false, afterWrite = false, initializeFailure = false;
  const bridge: NativeMcpAuthorityPlugin = {
    initialize: vi.fn(async ({ scope }) => { if (initializeFailure) throw Error('private native diagnostic'); if (!states.has(scope)) states.set(scope, { revision: crypto.randomUUID(), payload: JSON.stringify(empty()) }); }),
    readState: vi.fn(async ({ scope }) => { const state = states.get(scope); if (!state) throw Error('private missing state'); return { ...state }; }),
    compareAndSet: vi.fn(async ({ scope, expectedRevision, payload }) => {
      if (beforeWrite) throw Error('private write diagnostic'); const current = states.get(scope); if (!current || current.revision !== expectedRevision) return { committed: false };
      states.set(scope, { revision: crypto.randomUUID(), payload }); if (afterWrite) throw Error('private acknowledgement diagnostic'); return { committed: true };
    }),
  };
  return { states, bridge, set beforeWrite(value: boolean) { beforeWrite = value; }, set afterWrite(value: boolean) { afterWrite = value; }, set initializeFailure(value: boolean) { initializeFailure = value; } };
}
afterEach(() => { platform.native = true; platform.available = true; vi.restoreAllMocks(); });
it('round-trips the real authority grant, approval, pending/applied receipt, audit and revocation without secret or field values', async () => {
  const test = fixture(), store = createNativeMcpAuthorityStorage('keepany-main', test.bridge), authority = new McpAuthority(store);
  const grant = await authority.issueGrant({ assetIds: [asset], readFields: ['name'], writeFields: ['name'], ttlMs: 60000 });
  const preview = await authority.createPreview({ grantId: grant.id, operationId: 'synthetic_operation', assetId: asset, expectedVersion: hash, patchHash: 'b'.repeat(64) });
  await authority.approvePreview(grant.id, preview.id);
  await authority.reserveOperation({ grantId: grant.id, operationId: preview.operationId, assetId: asset, previewId: preview.id, patchHash: preview.patchHash });
  expect((await store.read()).operations[0].state).toBe('pending');
  await authority.completeOperation(grant.id, preview.operationId);
  const reopened = new McpAuthority(createNativeMcpAuthorityStorage('keepany-main', test.bridge));
  expect((await reopened.requireGrant(grant.id, grant.secret)).assetIds).toEqual([asset]);
  expect((await reopened.operation(grant.id, preview.operationId))?.state).toBe('applied');
  await reopened.revokeGrant(grant.id); await expect(authority.requireGrant(grant.id, grant.secret)).rejects.toMatchObject({ code: 'grant-denied' });
  const payload = test.states.get(nativeMcpAuthorityScope('keepany-main'))?.payload;
  expect(payload).not.toContain(grant.secret); expect(payload).not.toContain('before'); expect(payload).not.toContain('after'); expect(payload).not.toContain('password');
  expect((await reopened.auditEntries(grant.id)).some(row => row.action === 'revoke')).toBe(true);
});
it('isolates immutable dataset scopes, hashes filenames and rejects path/default scope substitutions before native IO', async () => {
  const test = fixture(), first = createNativeMcpAuthorityStorage('keepany-main', test.bridge), second = createNativeMcpAuthorityStorage('keepany-restored', test.bridge);
  await first.update(state => { state.audit.push(audit()); }); expect(await second.read()).toEqual(empty());
  expect((await first.read()).audit).toHaveLength(1);
  expect([...test.states.keys()].every(value => /^[a-f0-9]{64}$/.test(value))).toBe(true);
  expect(nativeMcpAuthorityScope('keepany-main')).not.toBe(nativeMcpAuthorityScope('keepany-restored'));
  for (const scope of ['', '../other', '/tmp/private', 'Main', 'a'.repeat(62)]) expect(() => createNativeMcpAuthorityStorage(scope, test.bridge)).toThrow(/^mcp-native-scope$/);
  expect(test.bridge.initialize).toHaveBeenCalledTimes(2);
});
it('serializes one instance and resolves updates only after the native durable acknowledgement', async () => {
  const test = fixture(), store = createNativeMcpAuthorityStorage('keepany-main', test.bridge);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let secondRan = false;
  const first = store.update(async state => { state.audit.push(audit()); await gate; return 'first'; });
  const second = store.update(state => { secondRan = true; state.audit.push(audit()); return 'second'; });
  await vi.waitFor(() => expect(test.bridge.readState).toHaveBeenCalledOnce()); expect(secondRan).toBe(false); expect(test.bridge.compareAndSet).not.toHaveBeenCalled();
  release(); expect(await first).toBe('first'); expect(await second).toBe('second'); expect((await store.read()).audit).toHaveLength(2);
});
it('rejects a two-instance stale revision without replaying the async callback and keeps the queue usable', async () => {
  const test = fixture(), first = createNativeMcpAuthorityStorage('keepany-main', test.bridge), second = createNativeMcpAuthorityStorage('keepany-main', test.bridge);
  await first.read(); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
  const pending = first.update(async state => { calls++; state.audit.push(audit()); await gate; });
  await vi.waitFor(() => expect(calls).toBe(1)); await second.update(state => { state.audit.push(audit()); }); release();
  await expect(pending).rejects.toThrow(/^mcp-native-conflict$/); expect(calls).toBe(1); expect((await first.read()).audit).toHaveLength(1);
  await first.update(state => { state.audit.push(audit()); }); expect((await second.read()).audit).toHaveLength(2);
});
it('preserves the old state on write failure, sanitizes errors and never replays a lost acknowledgement', async () => {
  const test = fixture(), store = createNativeMcpAuthorityStorage('keepany-main', test.bridge); await store.read();
  test.beforeWrite = true; await expect(store.update(state => { state.audit.push(audit()); })).rejects.toThrow(/^mcp-native-unavailable$/);
  expect(await store.read()).toEqual(empty()); test.beforeWrite = false;
  test.afterWrite = true; let calls = 0;
  await expect(store.update(state => { calls++; state.audit.push(audit()); })).rejects.toThrow(/^mcp-native-unavailable$/);
  expect(calls).toBe(1); expect((await store.read()).audit).toHaveLength(1);
  test.afterWrite = false; await store.update(state => { state.audit.push(audit()); }); expect((await store.read()).audit).toHaveLength(2);
});
it('retries a failed initialize safely but does not wipe corrupted existing state', async () => {
  const test = fixture(), store = createNativeMcpAuthorityStorage('keepany-main', test.bridge);
  test.initializeFailure = true; await expect(store.read()).rejects.toThrow(/^mcp-native-unavailable$/); test.initializeFailure = false;
  expect(await store.read()).toEqual(empty());
  const scope = nativeMcpAuthorityScope('keepany-main'), original = { ...test.states.get(scope) } as { revision: string; payload: string };
  test.states.set(scope, { ...original, payload: '{"grants":[],"previews":[],"operations":[],"audit":[],"secret":"must-reject"}' });
  await expect(store.read()).rejects.toThrow(/^mcp-native-state$/); expect(test.states.get(scope)?.payload).toContain('must-reject');
  expect(test.bridge.initialize).toHaveBeenCalledTimes(2); test.states.set(scope, original); expect(await store.read()).toEqual(empty());
});
it.each([
  { ...empty(), secret: 'never-persist' },
  { ...empty(), grants: [{ id: grantId, secretHash: hash, assetIds: [asset], readFields: ['name'], writeFields: [], createdAt: 1, expiresAt: 2, secret: 'never-persist' }] },
  { ...empty(), previews: [{ id: crypto.randomUUID(), grantId, operationId: 'synthetic_op', assetId: asset, expectedVersion: hash, patchHash: hash, expiresAt: 2, changes: [{ before: 'private' }] }] },
  { ...empty(), audit: [{ ...audit(), fieldNames: ['password'] }] },
  { ...empty(), operations: [{ operationId: 'synthetic_op', grantId, previewId: crypto.randomUUID(), assetId: asset, patchHash: hash, state: 'applied', createdAt: 1 }] },
])('rejects extra/raw-secret/value metadata before any native commit', async invalid => {
  const test = fixture(), store = createNativeMcpAuthorityStorage('keepany-main', test.bridge);
  await expect(store.update(state => { Object.assign(state, invalid); })).rejects.toThrow(/^mcp-native-state$/);
  expect(test.bridge.compareAndSet).not.toHaveBeenCalled(); expect(await store.read()).toEqual(empty());
});
it('checks duplicate IDs, declared UTF8 budget and Native plugin presence without a memory/ordinary DB fallback', async () => {
  const repeated = audit(); expect(() => checkedNativeMcpAuthorityState({ ...empty(), audit: [repeated, repeated] })).toThrow(/^mcp-native-state$/);
  const test = fixture(), store = createNativeMcpAuthorityStorage('keepany-main', test.bridge); await store.read();
  test.states.set(nativeMcpAuthorityScope('keepany-main'), { revision: crypto.randomUUID(), payload: '界'.repeat(Math.ceil(nativeMcpAuthorityLimit / 3) + 1) });
  await expect(store.read()).rejects.toThrow(/^mcp-native-state$/);
  platform.available = false; await expect(createNativeMcpAuthorityStorage('keepany-another', test.bridge).read()).rejects.toThrow(/^mcp-native-unavailable$/);
  expect(test.bridge.initialize).toHaveBeenCalledOnce();
});
