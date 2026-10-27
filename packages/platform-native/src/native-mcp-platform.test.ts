import { afterEach, expect, it, vi } from 'vitest';
import { McpAuthority, MemoryAuthorityStorage, type AuthorityStorage } from '../../mcp/src/authority';
import { readNativeMcpHistory, revokeNativeMcpOrphans } from './native-mcp-history';
import { createNativeMcpPlatform, type NativeMcpPlatformDependencies } from './native-mcp-platform';
import { prepareNativeMcpSession, type NativeMcpContext, type NativeMcpSession, type NativeMcpSessionOptions } from './native-mcp-session';

afterEach(() => vi.restoreAllMocks());
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const assetId = crypto.randomUUID();
const scope = { assetIds: [assetId], readFields: ['name' as const], writeFields: ['name' as const], ttlMs: 300000 as const };
const endpoint = { instanceId: crypto.randomUUID(), endpoint: 'https://127.0.0.1:9452/mcp', certificatePem: `-----BEGIN CERTIFICATE-----\n${'A'.repeat(64)}\n-----END CERTIFICATE-----\n`, spkiSha256: 'a'.repeat(64) };
const diagnostic = 'SYNTHETIC_PRIVATE_DIAGNOSTIC_DO_NOT_EXPOSE';
function request(): Omit<NativeMcpSessionOptions, 'loadContext'> {
  return { address: '127.0.0.1', scope, onClient: vi.fn(), onAuthorized: vi.fn(), onPreviews: vi.fn(), onStopped: vi.fn() };
}
function fakeSession(options: NativeMcpSessionOptions) {
  const close = vi.fn(async () => { options.onStopped(true, false); return { writeMayHaveApplied: false }; });
  const session: NativeMcpSession = { pairingFile: { kind: 'keepany-mcp-mobile-pairing-v1', ...endpoint,
    scope, createdAt: Date.now(), expiresAt: Date.now() + 120000, requestNonce: crypto.randomUUID(), pairingSecret: 'a'.repeat(43) },
    activate: vi.fn(async () => {}), decideClient: vi.fn(async () => {}), decidePreview: vi.fn(async () => {}),
    checkPreview: vi.fn(async () => true), pendingPreviews: vi.fn(() => []), auditEntries: vi.fn(async () => []), close };
  return { session, close, options };
}
function fixture(overrides: Partial<NativeMcpPlatformDependencies> = {}) {
  const storage = new MemoryAuthorityStorage(); let current = true;
  const context: NativeMcpContext = { datasetName: 'keepany-platform-fixture', assertCurrent: () => { if (!current) throw Error(diagnostic); },
    onInvalidated: vi.fn(() => () => {}), store: { get: vi.fn(async () => null), list: vi.fn(async () => []), compareAndSet: vi.fn(async () => 'conflict' as const) } };
  const sessions: ReturnType<typeof fakeSession>[] = [];
  const dependencies = { reset: vi.fn(async () => true), readHistory: vi.fn(readNativeMcpHistory), recover: vi.fn(revokeNativeMcpOrphans),
    storageFactory: vi.fn((): AuthorityStorage => storage),
    prepareSession: vi.fn(async (options: NativeMcpSessionOptions) => { const f = fakeSession(options); sessions.push(f); return f.session; }), ...overrides };
  const loadContext = vi.fn(async () => context);
  return { platform: createNativeMcpPlatform({ loadContext }, dependencies), dependencies, loadContext, context, storage, sessions,
    invalidate: () => { current = false; } };
}
async function seeded(storage: AuthorityStorage) {
  const authority = new McpAuthority(storage), grant = await authority.issueGrant({ assetIds: [assetId], readFields: ['name'], writeFields: ['name'], ttlMs: 60000 });
  const preview = await authority.createPreview({ grantId: grant.id, operationId: 'platform_pending_operation', assetId, expectedVersion: 'a'.repeat(64), patchHash: 'b'.repeat(64) });
  await authority.approvePreview(grant.id, preview.id);
  await authority.reserveOperation({ grantId: grant.id, operationId: preview.operationId, previewId: preview.id, patchHash: preview.patchHash, assetId });
  return { authority, grant, preview };
}

it('is lazy and shares reset→fixed context→real orphan recovery across concurrent history and reserved prepare', async () => {
  const reset = deferred<boolean>(), recovery = deferred<void>(), events: string[] = [];
  const f = fixture({ reset: vi.fn(async () => { events.push('reset'); return reset.promise; }),
    recover: vi.fn(async (dataset, guard, options) => { events.push('recover'); guard(); await recovery.promise; guard(); return revokeNativeMcpOrphans(dataset, guard, options); }) });
  const seededState = await seeded(f.storage), before = await f.storage.read();
  expect(f.dependencies.reset).not.toHaveBeenCalled(); expect(f.loadContext).not.toHaveBeenCalled();
  const first = f.platform.history(), prepared = f.platform.prepare(request()), second = f.platform.history();
  await vi.waitFor(() => expect(f.dependencies.reset).toHaveBeenCalledOnce()); expect(f.loadContext).not.toHaveBeenCalled();
  reset.resolve(true); await vi.waitFor(() => expect(f.dependencies.recover).toHaveBeenCalledOnce());
  expect(f.dependencies.prepareSession).not.toHaveBeenCalled(); expect(f.loadContext).toHaveBeenCalledOnce();
  recovery.resolve(); const [history, session, other] = await Promise.all([first, prepared, second]);
  expect(events).toEqual(['reset', 'recover']); expect(history).toEqual(other); expect(history.entries.at(-1)?.action).toBe('revoke');
  const state = await f.storage.read(); expect(state.grants[0].id).toBe(seededState.grant.id); expect(state.grants[0].revokedAt).toBeDefined();
  expect(state.operations).toEqual(before.operations); expect(state.previews).toEqual(before.previews);
  const options = f.sessions[0].options, fixed = await options.loadContext(); expect(fixed.store).toBe(f.context.store); expect(f.dependencies.storageFactory).toHaveBeenCalledOnce();
  expect(f.context.store.get).not.toHaveBeenCalled(); expect(f.context.store.list).not.toHaveBeenCalled(); await session.close();
});

it.each(['false', 'throw'] as const)('does not load authority or return tickets until reset confirms true (%s), then permits an explicit retry', async mode => {
  const reset = vi.fn(async () => { if (mode === 'throw') throw Error(diagnostic); return false; }); const f = fixture({ reset });
  await expect(f.platform.prepare(request())).rejects.toThrow(/^mcp-native-recovery-unconfirmed$/);
  expect(f.loadContext).not.toHaveBeenCalled(); expect(f.dependencies.storageFactory).not.toHaveBeenCalled(); expect(f.dependencies.prepareSession).not.toHaveBeenCalled();
  reset.mockResolvedValue(true); expect((await f.platform.history()).entries).toEqual([]); expect(reset).toHaveBeenCalledTimes(2); expect(f.loadContext).toHaveBeenCalledOnce();
});

it('retries context acquisition failure without a fallback and fixes the first captured dataset across later retries', async () => {
  const f = fixture(); f.loadContext.mockRejectedValueOnce(Error(diagnostic));
  await expect(f.platform.history()).rejects.toThrow(/^mcp-native-recovery-unconfirmed$/); expect(f.dependencies.readHistory).not.toHaveBeenCalled();
  await f.platform.history(); expect(f.loadContext).toHaveBeenCalledTimes(2); expect(f.dependencies.reset).toHaveBeenCalledTimes(2);
  f.context.datasetName = 'keepany-other';
  await f.platform.history(); expect(f.dependencies.readHistory).toHaveBeenLastCalledWith('keepany-platform-fixture', expect.any(Object));
  expect(f.dependencies.reset).toHaveBeenCalledTimes(2);
});

it('does not turn partial recovery into empty history/tickets and finishes an explicit retry without duplicate facts', async () => {
  const f = fixture(), first = await seeded(f.storage), extra = await first.authority.issueGrant({ assetIds: [assetId], readFields: ['name'], ttlMs: 60000 });
  const before = await f.storage.read(), update = f.storage.update.bind(f.storage); let calls = 0;
  const fault = vi.spyOn(f.storage, 'update').mockImplementation(async change => { if (++calls === 2) throw Error(diagnostic); return update(change); });
  await expect(f.platform.history()).rejects.toThrow(/^mcp-native-recovery-unconfirmed$/); expect(f.dependencies.readHistory).not.toHaveBeenCalled(); expect(f.dependencies.prepareSession).not.toHaveBeenCalled();
  expect((await f.storage.read()).grants.filter(grant => grant.revokedAt === undefined).map(grant => grant.id)).toEqual([extra.id]); fault.mockRestore();
  const session = await f.platform.prepare(request()), after = await f.storage.read();
  expect(after.grants.every(grant => grant.revokedAt !== undefined)).toBe(true); expect(after.audit.filter(row => row.action === 'revoke')).toHaveLength(2);
  expect(after.operations).toEqual(before.operations); expect(after.previews).toEqual(before.previews); expect(f.loadContext).toHaveBeenCalledOnce(); expect(f.dependencies.reset).toHaveBeenCalledTimes(2); await session.close();
});

it('does not reset, recover or close an active session when a later history read fails', async () => {
  const f = fixture(), session = await f.platform.prepare(request()); await session.activate();
  const authority = new McpAuthority(f.storage), grant = await authority.issueGrant({ assetIds: [assetId], readFields: ['name'], ttlMs: 60000 });
  const fault = vi.spyOn(f.storage, 'read').mockRejectedValue(Error(diagnostic));
  await expect(f.platform.history()).rejects.toThrow(/^mcp-native-history-unavailable$/); expect(f.dependencies.reset).toHaveBeenCalledOnce(); expect(f.dependencies.recover).toHaveBeenCalledOnce(); expect(f.sessions[0].close).not.toHaveBeenCalled();
  fault.mockRestore(); expect((await authority.requireGrant(grant.id, grant.secret)).id).toBe(grant.id); expect((await f.platform.history()).entries.length).toBeGreaterThan(0);
  expect(f.dependencies.reset).toHaveBeenCalledOnce(); await session.close();
});

it('reserves one owner before async initialization/allocation and never treats that reservation as existing IO', async () => {
  const gate = deferred<NativeMcpSession>(); const f = fixture({ prepareSession: vi.fn(async () => gate.promise) });
  const preparing = f.platform.prepare(request()); await vi.waitFor(() => expect(f.dependencies.prepareSession).toHaveBeenCalledOnce());
  await expect(f.platform.prepare(request())).rejects.toThrow(/^mcp-native-session-occupied$/); await f.platform.history(); expect(f.dependencies.reset).toHaveBeenCalledOnce();
  const fake = fakeSession(requestWithContext(f.context)); gate.resolve(fake.session); const first = await preparing; await first.close();
  const next = await f.platform.prepare(request()); await next.close(); expect(f.dependencies.prepareSession).toHaveBeenCalledTimes(2);
});
function requestWithContext(context: NativeMcpContext): NativeMcpSessionOptions { return { ...request(), loadContext: async () => context }; }

it('retains the same closed resource after ACK failure and blocks new prepare without reset until exact close retries', async () => {
  const f = fixture(), first = await f.platform.prepare(request()), original = f.sessions[0];
  original.close.mockImplementationOnce(async () => { original.options.onStopped(false); throw Error(diagnostic); });
  await expect(first.close()).rejects.toThrow(/^mcp-native-revoke-unconfirmed$/); await expect(f.platform.prepare(request())).rejects.toThrow(/^mcp-native-revoke-unconfirmed$/);
  await f.platform.history(); expect(f.dependencies.reset).toHaveBeenCalledOnce(); await first.close(); expect(original.close).toHaveBeenCalledTimes(2);
  const next = await f.platform.prepare(request()); original.options.onStopped(true); original.options.onStopped(false); await first.close();
  await expect(f.platform.prepare(request())).rejects.toThrow(/^mcp-native-session-occupied$/); expect(f.dependencies.reset).toHaveBeenCalledOnce(); await next.close();
});

it('shares close in flight and does not hand a new slot to a callback before that close acknowledgement settles', async () => {
  const f = fixture(), session = await f.platform.prepare(request()), closeGate = deferred<{ writeMayHaveApplied: boolean }>();
  f.sessions[0].close.mockImplementation(async () => { f.sessions[0].options.onStopped(true); return closeGate.promise; });
  const first = session.close(), second = session.close(); expect(first).toBe(second);
  await vi.waitFor(() => expect(f.sessions[0].close).toHaveBeenCalledOnce()); await expect(f.platform.prepare(request())).rejects.toThrow(/^mcp-native-session-occupied$/);
  closeGate.resolve({ writeMayHaveApplied: true }); expect(await first).toEqual({ writeMayHaveApplied: true });
  const next = await f.platform.prepare(request()); await next.close();
});

it('releases a confirmed native stop only for its owner; old callbacks and old close cannot release the replacement', async () => {
  const f = fixture(), first = await f.platform.prepare(request()); f.sessions[0].options.onStopped(true, false);
  const next = await f.platform.prepare(request()); f.sessions[0].options.onStopped(true); f.sessions[0].options.onStopped(false); await first.close();
  await expect(f.platform.prepare(request())).rejects.toThrow(/^mcp-native-session-occupied$/); await next.close();
});

it('refuses a changed epoch after successful initialization without reset, reloadContext or a replacement dataset', async () => {
  const f = fixture(); await f.platform.history(); f.invalidate(); f.loadContext.mockResolvedValue({ ...f.context, datasetName: 'keepany-replacement', assertCurrent: () => {} });
  await expect(f.platform.history()).rejects.toThrow(/^mcp-native-history-unavailable$/); await expect(f.platform.prepare(request())).rejects.toThrow(/^mcp-native-session-unavailable$/);
  expect(f.dependencies.reset).toHaveBeenCalledOnce(); expect(f.loadContext).toHaveBeenCalledOnce(); expect(f.dependencies.prepareSession).not.toHaveBeenCalled();
});

it('retains a captured failed-bootstrap epoch and does not let its retry reset another dataset', async () => {
  const f = fixture({ recover: vi.fn(async (_dataset, guard) => { f.invalidate(); guard(); throw Error(diagnostic); }) });
  await expect(f.platform.history()).rejects.toThrow(/^mcp-native-recovery-unconfirmed$/); await expect(f.platform.history()).rejects.toThrow(/^mcp-native-recovery-unconfirmed$/);
  expect(f.dependencies.reset).toHaveBeenCalledOnce(); expect(f.loadContext).toHaveBeenCalledOnce(); expect(f.dependencies.prepareSession).not.toHaveBeenCalled();
});

it('explicitly confirms cleanup after an unreturned prepare failure and does not rerun recovery on later history', async () => {
  const f = fixture(); vi.mocked(f.dependencies.prepareSession).mockRejectedValueOnce(Error(diagnostic));
  await expect(f.platform.prepare(request())).rejects.toThrow(/^mcp-native-session-unavailable$/); expect(f.dependencies.reset).toHaveBeenCalledTimes(2);
  await f.platform.history(); expect(f.dependencies.reset).toHaveBeenCalledTimes(2); expect(f.dependencies.recover).toHaveBeenCalledOnce();
  const next = await f.platform.prepare(request()); await next.close();
});

it.each(['false', 'throw'] as const)('retains partial allocation when cleanup is %s; history never resets it and explicit concurrent prepares share cleanup', async mode => {
  const f = fixture(); vi.mocked(f.dependencies.prepareSession).mockRejectedValueOnce(Error(diagnostic));
  if (mode === 'false') vi.mocked(f.dependencies.reset).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  else vi.mocked(f.dependencies.reset).mockResolvedValueOnce(true).mockRejectedValueOnce(Error(diagnostic));
  await expect(f.platform.prepare(request())).rejects.toThrow(/^mcp-native-revoke-unconfirmed$/); await expect(f.platform.history()).rejects.toThrow(/^mcp-native-revoke-unconfirmed$/);
  expect(f.dependencies.reset).toHaveBeenCalledTimes(2);
  const gate = deferred<boolean>(); vi.mocked(f.dependencies.reset).mockImplementationOnce(async () => gate.promise);
  const left = f.platform.prepare(request()), right = f.platform.prepare(request());
  const outcome = Promise.allSettled([left, right]);
  await vi.waitFor(() => expect(f.dependencies.reset).toHaveBeenCalledTimes(3)); expect(f.dependencies.prepareSession).toHaveBeenCalledOnce();
  const originalOptions = vi.mocked(f.dependencies.prepareSession).mock.calls[0][0]; originalOptions.onStopped(true);
  await expect(f.platform.history()).rejects.toThrow(/^mcp-native-revoke-unconfirmed$/); gate.resolve(true);
  const results = await outcome; expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1); expect(results.filter(row => row.status === 'rejected')).toHaveLength(1);
  expect(f.dependencies.prepareSession).toHaveBeenCalledTimes(2); expect(f.dependencies.recover).toHaveBeenCalledOnce();
  for (const row of results) if (row.status === 'fulfilled') await row.value.close();
});

it('does not release an unreturned allocation merely because an early stopped callback arrived', async () => {
  const gate = deferred<NativeMcpSession>(), f = fixture({ prepareSession: vi.fn(async () => gate.promise) }); const preparing = f.platform.prepare(request());
  await vi.waitFor(() => expect(f.dependencies.prepareSession).toHaveBeenCalledOnce()); const options = vi.mocked(f.dependencies.prepareSession).mock.calls[0][0]; options.onStopped(true);
  await expect(f.platform.prepare(request())).rejects.toThrow(/^mcp-native-session-occupied$/); const fake = fakeSession(options); gate.resolve(fake.session);
  await expect(preparing).rejects.toThrow(/^mcp-native-session-unavailable$/); expect(fake.close).toHaveBeenCalledOnce(); const next = await f.platform.prepare(request()); await next.close();
});

it('cleans an exact returned-but-unexposed session after an epoch change without resetting a replacement dataset', async () => {
  let fake: ReturnType<typeof fakeSession> | undefined;
  const f = fixture({ prepareSession: vi.fn(async options => { fake = fakeSession(options); f.invalidate(); return fake.session; }) });
  await expect(f.platform.prepare(request())).rejects.toThrow(/^mcp-native-session-unavailable$/); expect(fake?.close).toHaveBeenCalledOnce(); expect(f.dependencies.reset).toHaveBeenCalledOnce();
  await expect(f.platform.history()).rejects.toThrow(/^mcp-native-history-unavailable$/);
});

it('never uses a stale factory global reset if exact unexposed cleanup fails after dataset replacement', async () => {
  const f = fixture({ prepareSession: vi.fn(async options => {
    const fake = fakeSession(options); fake.close.mockRejectedValue(Error(diagnostic)); f.invalidate(); return fake.session;
  }) });
  await expect(f.platform.prepare(request())).rejects.toThrow(/^mcp-native-revoke-unconfirmed$/);
  await expect(f.platform.history()).rejects.toThrow(/^mcp-native-revoke-unconfirmed$/);
  await expect(f.platform.prepare(request())).rejects.toThrow(/^mcp-native-revoke-unconfirmed$/);
  expect(f.dependencies.reset).toHaveBeenCalledOnce(); expect(f.loadContext).toHaveBeenCalledOnce();
});

it('default unavailable native plugins fail closed lazily before loading ordinary context, without a memory history fallback', async () => {
  const loadContext = vi.fn(async (): Promise<NativeMcpContext> => { throw Error('ordinary context must not be opened'); });
  const platform = createNativeMcpPlatform({ loadContext }); expect(loadContext).not.toHaveBeenCalled();
  await expect(platform.history()).rejects.toThrow(/^mcp-native-recovery-unconfirmed$/);
  await expect(platform.prepare(request())).rejects.toThrow(/^mcp-native-recovery-unconfirmed$/);
  expect(loadContext).not.toHaveBeenCalled();
});

it('unreturned cleanup is lazy with no owner and refuses a pending/returned owner without resetting its IO', async () => {
  const gate = deferred<NativeMcpSession>(), f = fixture({ prepareSession: vi.fn(async () => gate.promise) });
  await f.platform.cleanupUnreturnedPreparation(); expect(f.dependencies.reset).not.toHaveBeenCalled(); expect(f.loadContext).not.toHaveBeenCalled();
  const preparing = f.platform.prepare(request());
  await expect(f.platform.cleanupUnreturnedPreparation()).rejects.toThrow(/^mcp-native-session-occupied$/);
  await vi.waitFor(() => expect(f.dependencies.prepareSession).toHaveBeenCalledOnce());
  const options = vi.mocked(f.dependencies.prepareSession).mock.calls[0][0], fake = fakeSession(options); gate.resolve(fake.session);
  const session = await preparing; await expect(f.platform.cleanupUnreturnedPreparation()).rejects.toThrow(/^mcp-native-session-occupied$/);
  expect(f.dependencies.reset).toHaveBeenCalledOnce(); expect(fake.close).not.toHaveBeenCalled(); await session.close();
  await f.platform.cleanupUnreturnedPreparation(); expect(f.dependencies.reset).toHaveBeenCalledOnce();
});

it('explicit unreturned cleanup retains a failed token then confirms only reset, without initialization/audit replay', async () => {
  const f = fixture(); await seeded(f.storage); vi.mocked(f.dependencies.prepareSession).mockRejectedValueOnce(Error(diagnostic));
  vi.mocked(f.dependencies.reset).mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockRejectedValueOnce(Error(diagnostic));
  await expect(f.platform.prepare(request())).rejects.toThrow(/^mcp-native-revoke-unconfirmed$/); const before = await f.storage.read();
  await expect(f.platform.cleanupUnreturnedPreparation()).rejects.toThrow(/^mcp-native-revoke-unconfirmed$/);
  await expect(f.platform.history()).rejects.toThrow(/^mcp-native-revoke-unconfirmed$/);
  expect(f.dependencies.reset).toHaveBeenCalledTimes(3); expect(f.dependencies.readHistory).not.toHaveBeenCalled();
  await f.platform.cleanupUnreturnedPreparation(); expect(f.dependencies.reset).toHaveBeenCalledTimes(4); expect(f.dependencies.recover).toHaveBeenCalledOnce(); expect(f.loadContext).toHaveBeenCalledOnce();
  expect(await f.storage.read()).toEqual(before); await f.platform.history(); expect(f.dependencies.reset).toHaveBeenCalledTimes(4);
  const session = await f.platform.prepare(request()); await session.close();
});

it('unreturned cleanup cannot replace exact session revocation retry for an already returned resource', async () => {
  const f = fixture(), session = await f.platform.prepare(request()); f.sessions[0].close.mockRejectedValueOnce(Error(diagnostic));
  await expect(session.close()).rejects.toThrow(/^mcp-native-revoke-unconfirmed$/);
  await expect(f.platform.cleanupUnreturnedPreparation()).rejects.toThrow(/^mcp-native-session-occupied$/);
  expect(f.dependencies.reset).toHaveBeenCalledOnce(); expect(f.sessions[0].close).toHaveBeenCalledOnce(); await session.close();
  expect(f.sessions[0].close).toHaveBeenCalledTimes(2);
});

it('shares a partial token reset across explicit cleanup and prepare, and its late callbacks cannot release the next owner', async () => {
  const f = fixture(); vi.mocked(f.dependencies.prepareSession).mockRejectedValueOnce(Error(diagnostic));
  vi.mocked(f.dependencies.reset).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await expect(f.platform.prepare(request())).rejects.toThrow(/^mcp-native-revoke-unconfirmed$/);
  const oldOptions = vi.mocked(f.dependencies.prepareSession).mock.calls[0][0], gate = deferred<boolean>();
  vi.mocked(f.dependencies.reset).mockImplementationOnce(async () => gate.promise);
  const cleanup = f.platform.cleanupUnreturnedPreparation(), preparing = f.platform.prepare(request());
  await vi.waitFor(() => expect(f.dependencies.reset).toHaveBeenCalledTimes(3)); oldOptions.onStopped(true);
  expect(f.dependencies.prepareSession).toHaveBeenCalledOnce(); gate.resolve(true); await cleanup; const session = await preparing;
  oldOptions.onStopped(true); oldOptions.onStopped(false);
  await expect(f.platform.cleanupUnreturnedPreparation()).rejects.toThrow(/^mcp-native-session-occupied$/);
  await expect(f.platform.prepare(request())).rejects.toThrow(/^mcp-native-session-occupied$/);
  expect(f.dependencies.reset).toHaveBeenCalledTimes(3); expect(f.dependencies.recover).toHaveBeenCalledOnce(); await session.close();
});

it('reuses the actual NativeSession and real Authority/History layers with one canonical context and storage', async () => {
  const ticketClose = vi.fn(async () => {}), prepareTransport = vi.fn(async () => ({ endpoint, close: ticketClose,
    activate: vi.fn(async () => { throw Error('not requested in platform contract'); }) }));
  const prepareSession: typeof prepareNativeMcpSession = (options, dependencies) => {
    if (!dependencies) throw Error('missing test dependencies');
    return prepareNativeMcpSession(options, { authorityStorage: dependencies.authorityStorage, prepareTransport });
  };
  const f = fixture({ prepareSession }), seededState = await seeded(f.storage);
  const session = await f.platform.prepare(request()); expect(session.pairingFile.kind).toBe('keepany-mcp-mobile-pairing-v1');
  expect(prepareTransport).toHaveBeenCalledOnce(); expect(f.dependencies.storageFactory).toHaveBeenCalledOnce(); expect(f.context.store.get).not.toHaveBeenCalled(); expect(f.context.store.list).not.toHaveBeenCalled();
  const history = await f.platform.history(); expect(history.lastRevokedAt).not.toBeNull(); expect(history.entries.at(-1)?.grantId).toBe(seededState.grant.id);
  await session.close(); expect(ticketClose).toHaveBeenCalled(); expect(f.dependencies.reset).toHaveBeenCalledOnce();
});
