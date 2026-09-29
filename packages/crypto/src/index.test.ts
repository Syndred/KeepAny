import { describe, expect, it } from 'vitest';
import {
  ReplayGuard, createRecoveryCredential, generateDeviceKeys, generateWorkspaceKey,
  grantDeviceKey, openDeviceGrant, openEnvelope, rotateWorkspaceKey,
  openSyncChangeEnvelope, sealEnvelope, unwrapRecovery, wrapForRecovery,
  type EnvelopeContext, type EnvelopeContextV2,
} from './index';
import { MemorySyncStateStore, SyncService } from '../../sync-core/src';
import type { SyncChange } from '../../contracts/src';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const otherWorkspaceId = '00000000-0000-4000-8000-000000000002';
const context = (overrides: Partial<EnvelopeContext> = {}): EnvelopeContext => ({
  workspaceId, recordId: 'asset:fixture', schemaVersion: 1, keyEpoch: 1,
  sequence: 1, operationId: '10000000-0000-4000-8000-000000000001', tombstone: false, ...overrides,
});
const message = new TextEncoder().encode('local synthetic asset');
const v2Context = (overrides: Partial<EnvelopeContextV2> = {}): EnvelopeContextV2 => ({
  workspaceId, recordId: 'asset:fixture', kind: 'asset', schemaVersion: 1, keyEpoch: 1,
  recordVersion: 1, operationId: '10000000-0000-4000-8000-000000000001', tombstone: false,
  ...overrides,
});

describe('versioned XChaCha20-Poly1305 envelope', () => {
  it('round trips and generates a new nonce for every encryption', async () => {
    const key = await generateWorkspaceKey();
    const first = await sealEnvelope(message, key, context());
    const second = await sealEnvelope(message, key, context());
    expect(first).toMatchObject({ format: 'keepany-sync-envelope', version: 1, algorithm: 'XChaCha20-Poly1305-IETF' });
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(JSON.stringify(first)).not.toContain('local synthetic asset');
    expect(await openEnvelope(first, key, context(), new ReplayGuard())).toEqual(message);
  });

  it('binds workspace, record, schema, operation and sequence to authenticated data', async () => {
    const key = await generateWorkspaceKey();
    const envelope = await sealEnvelope(message, key, context());
    for (const change of [
      { workspaceId: otherWorkspaceId }, { recordId: 'asset:other' }, { schemaVersion: 2 },
      { keyEpoch: 2 }, { sequence: 2 }, { operationId: '10000000-0000-4000-8000-000000000002' },
      { tombstone: true },
    ]) {
      await expect(openEnvelope(envelope, key, context(change), new ReplayGuard())).rejects.toThrow('envelope-context');
      const altered = { ...envelope, context: { ...envelope.context, ...change } };
      await expect(openEnvelope(altered, key, context(change), new ReplayGuard())).rejects.toThrow('envelope-auth');
    }
  });

  it('rejects ciphertext, nonce, key and format tampering', async () => {
    const key = await generateWorkspaceKey();
    const envelope = await sealEnvelope(message, key, context());
    const otherKey = await generateWorkspaceKey();
    await expect(openEnvelope(envelope, otherKey, context(), new ReplayGuard())).rejects.toThrow('envelope-auth');
    const changedCiphertext = { ...envelope, ciphertext: envelope.ciphertext.slice(0, -1) + (envelope.ciphertext.endsWith('A') ? 'B' : 'A') };
    await expect(openEnvelope(changedCiphertext, key, context(), new ReplayGuard())).rejects.toThrow('envelope-auth');
    const changedNonce = { ...envelope, nonce: envelope.nonce.slice(0, -1) + (envelope.nonce.endsWith('A') ? 'B' : 'A') };
    await expect(openEnvelope(changedNonce, key, context(), new ReplayGuard())).rejects.toThrow();
    await expect(openEnvelope({ ...envelope, version: 2 }, key, context(), new ReplayGuard())).rejects.toThrow();
  });

  it('rejects replay only after the caller marks the decrypted write as applied', async () => {
    const key = await generateWorkspaceKey();
    const guard = new ReplayGuard();
    const first = await sealEnvelope(message, key, context());
    expect(await openEnvelope(first, key, context(), guard)).toEqual(message);
    expect(await openEnvelope(first, key, context(), guard)).toEqual(message);
    guard.markApplied(context());
    await expect(openEnvelope(first, key, context(), guard)).rejects.toThrow('envelope-replay');
    const sameSequence = context({ operationId: '10000000-0000-4000-8000-000000000002' });
    const stale = await sealEnvelope(message, key, sameSequence);
    await expect(openEnvelope(stale, key, sameSequence, guard)).rejects.toThrow('envelope-replay');
    const next = context({ sequence: 2, operationId: '10000000-0000-4000-8000-000000000003' });
    const fresh = await sealEnvelope(message, key, next);
    expect(await openEnvelope(fresh, key, next, guard)).toEqual(message);
    guard.markApplied(next);
    const restoredGuard = ReplayGuard.fromSnapshot(guard.snapshot());
    await expect(openEnvelope(fresh, key, next, restoredGuard)).rejects.toThrow('envelope-replay');
    restoredGuard.advanceMinimumEpoch(workspaceId, 2);
    await expect(openEnvelope(first, key, context(), restoredGuard)).rejects.toThrow('envelope-replay');
  });
});

describe('v2 pull authentication against external sync metadata', () => {
  it('opens interleaved records whose record versions differ from the workspace cursor', async () => {
    const key = await generateWorkspaceKey();
    const service = new SyncService(new MemorySyncStateStore());
    const otherId = 'task:fixture';
    const writes = [
      v2Context(),
      v2Context({ recordId: otherId, kind: 'task', operationId: crypto.randomUUID() }),
      v2Context({ recordVersion: 2, operationId: crypto.randomUUID() }),
    ];
    for (const item of writes) {
      const envelope = await sealEnvelope(message, key, item);
      expect(envelope.version).toBe(2);
      const result = (await service.push({ workspaceId, operations: [{
        operationId: item.operationId, id: item.recordId, kind: item.kind, schemaVersion: item.schemaVersion,
        expectedVersion: item.recordVersion - 1, ciphertext: JSON.stringify(envelope),
        tombstone: item.tombstone, intent: 'write',
      }] })).results[0];
      expect(result).toMatchObject({ status: 'accepted', version: item.recordVersion });
    }
    const page = await service.pull({ workspaceId, cursor: 0, limit: 10 });
    expect(page.changes.map(change => [change.version, change.sequence])).toEqual([[1, 1], [1, 2], [2, 3]]);
    const guard = new ReplayGuard();
    for (const change of page.changes) {
      const opened = await openSyncChangeEnvelope(JSON.parse(change.ciphertext), key,
        { workspaceId, change, keyEpoch: 1 }, guard);
      expect(opened.plaintext).toEqual(message);
      guard.markApplied(opened.context, opened.recordVersion);
    }
    await expect(openSyncChangeEnvelope(JSON.parse(page.changes[0].ciphertext), key,
      { workspaceId, change: page.changes[0], keyEpoch: 1 }, guard)).rejects.toThrow('envelope-replay');
    const restored = ReplayGuard.fromSnapshot(guard.snapshot());
    await expect(openSyncChangeEnvelope(JSON.parse(page.changes[2].ciphertext), key,
      { workspaceId, change: page.changes[2], keyEpoch: 1 }, restored)).rejects.toThrow('envelope-replay');
  });

  it('rejects changed server metadata, envelope metadata, tombstones and operation IDs', async () => {
    const key = await generateWorkspaceKey();
    const sealed = await sealEnvelope(message, key, v2Context({ tombstone: true }));
    const change: SyncChange = { operationId: sealed.context.operationId, id: sealed.context.recordId,
      kind: 'asset', schemaVersion: 1, ciphertext: JSON.stringify(sealed), tombstone: true,
      version: 1, sequence: 99 };
    const source = { workspaceId, change, keyEpoch: 1 };
    expect((await openSyncChangeEnvelope(sealed, key, source, new ReplayGuard())).plaintext).toEqual(message);
    const alternate = [
      { ...source, workspaceId: otherWorkspaceId },
      { ...source, change: { ...change, id: 'asset:other' } },
      { ...source, change: { ...change, kind: 'task' as const } },
      { ...source, change: { ...change, schemaVersion: 2 } },
      { ...source, change: { ...change, tombstone: false } },
      { ...source, change: { ...change, version: 2 } },
      { ...source, change: { ...change, operationId: crypto.randomUUID() } },
      { ...source, keyEpoch: 2 },
    ];
    for (const sourceChange of alternate) {
      await expect(openSyncChangeEnvelope(sealed, key, sourceChange, new ReplayGuard())).rejects.toThrow();
    }
    const changedEnvelope = { ...sealed, context: { ...sealed.context, tombstone: false } };
    await expect(openSyncChangeEnvelope(changedEnvelope, key, source, new ReplayGuard())).rejects.toThrow('envelope-context');
    const changedCiphertext = { ...sealed, ciphertext: sealed.ciphertext.slice(0, -1) + (sealed.ciphertext.endsWith('A') ? 'B' : 'A') };
    await expect(openSyncChangeEnvelope(changedCiphertext, key, source, new ReplayGuard())).rejects.toThrow('envelope-auth');
  });

  it('opens authenticated v1 rows only at their assigned sequence and migrates a trusted record baseline', async () => {
    const key = await generateWorkspaceKey();
    const oldContext = context({ sequence: 7 });
    const legacy = await sealEnvelope(message, key, oldContext);
    const change: SyncChange = { operationId: oldContext.operationId, id: oldContext.recordId,
      kind: 'asset', schemaVersion: 1, ciphertext: JSON.stringify(legacy), tombstone: false,
      version: 1, sequence: 7 };
    const guard = new ReplayGuard();
    const opened = await openSyncChangeEnvelope(legacy, key, { workspaceId, change, keyEpoch: 1 }, guard);
    expect(opened.plaintext).toEqual(message);
    guard.markApplied(opened.context, opened.recordVersion);
    const next = v2Context({ recordVersion: 2, operationId: crypto.randomUUID() });
    const v2 = await sealEnvelope(message, key, next);
    const nextChange = { ...change, operationId: next.operationId, ciphertext: JSON.stringify(v2), version: 2, sequence: 8 };
    const migrated = ReplayGuard.fromSnapshot(guard.snapshot());
    const verified = await openSyncChangeEnvelope(v2, key, { workspaceId, change: nextChange, keyEpoch: 1 }, migrated);
    migrated.markApplied(verified.context, verified.recordVersion);
    await expect(openSyncChangeEnvelope(legacy, key, { workspaceId, change, keyEpoch: 1 }, migrated)).rejects.toThrow('envelope-replay');
    await expect(openSyncChangeEnvelope(legacy, key, { workspaceId, change: { ...change, sequence: 8 }, keyEpoch: 1 }, new ReplayGuard()))
      .rejects.toThrow('envelope-context');

    const oldSnapshot = { version: 1, entries: [{ workspaceId, recordId: oldContext.recordId,
      keyEpoch: 1, sequence: 7 }], operations: [oldContext.operationId], minimumEpochs: [] };
    await expect(openSyncChangeEnvelope(v2, key, { workspaceId, change: nextChange, keyEpoch: 1 },
      ReplayGuard.fromSnapshot(oldSnapshot))).rejects.toThrow('envelope-replay-baseline');
  });
});

describe('recovery credential and device onboarding prototype', () => {
  it('wraps a data key with a separate random recovery credential', async () => {
    const dataKey = await generateWorkspaceKey();
    const credential = await createRecoveryCredential();
    const wrap = await wrapForRecovery(dataKey, credential, workspaceId, 1);
    expect(credential).toMatch(/^ka1_[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(wrap)).not.toContain(credential);
    expect(await unwrapRecovery(wrap, credential, workspaceId, 1)).toEqual(dataKey);
    await expect(unwrapRecovery(wrap, await createRecoveryCredential(), workspaceId, 1)).rejects.toThrow('envelope-auth');
    await expect(unwrapRecovery(wrap, credential, otherWorkspaceId, 1)).rejects.toThrow('recovery-context');
    await expect(unwrapRecovery(wrap, credential, workspaceId, 2)).rejects.toThrow('recovery-context');
    // Change high-order bits rather than the last base64url character, whose unused pad bits can alias the same bytes.
    await expect(unwrapRecovery({ ...wrap, ciphertext: `${wrap.ciphertext[0] === 'A' ? 'B' : 'A'}${wrap.ciphertext.slice(1)}` }, credential, workspaceId, 1)).rejects.toThrow();
  });

  it('joins a second device only with its private key and a pinned issuer public key', async () => {
    const dataKey = await generateWorkspaceKey();
    const issuer = await generateDeviceKeys('device-one');
    const recipient = await generateDeviceKeys('device-two');
    const impostor = await generateDeviceKeys('device-impostor');
    const grant = await grantDeviceKey(dataKey, workspaceId, 1, issuer, recipient);
    expect(JSON.stringify(grant)).not.toContain(Buffer.from(dataKey).toString('hex'));
    expect(await openDeviceGrant(grant, recipient, issuer, workspaceId, 1)).toEqual(dataKey);
    await expect(openDeviceGrant(grant, impostor, issuer, workspaceId, 1)).rejects.toThrow('device-grant-context');
    await expect(openDeviceGrant(grant, recipient, impostor, workspaceId, 1)).rejects.toThrow('device-grant-context');
    await expect(openDeviceGrant(grant, recipient, issuer, otherWorkspaceId, 1)).rejects.toThrow('device-grant-context');
    const changed = { ...grant, ciphertext: grant.ciphertext.slice(0, -1) + (grant.ciphertext.endsWith('A') ? 'B' : 'A') };
    await expect(openDeviceGrant(changed, recipient, issuer, workspaceId, 1)).rejects.toThrow('device-grant-auth');
  });

  it('rotates for retained devices and recovery, without issuing a grant to the revoked device', async () => {
    const oldKey = await generateWorkspaceKey();
    const issuer = await generateDeviceKeys('device-one');
    const retained = await generateDeviceKeys('device-two');
    const revoked = await generateDeviceKeys('device-old');
    const credential = await createRecoveryCredential();
    const rotated = await rotateWorkspaceKey({ workspaceId, previousEpoch: 1, previousKey: oldKey,
      issuer, recipients: [issuer, retained], revokedDeviceIds: [revoked.deviceId], recoveryCredential: credential });
    expect(rotated.keyEpoch).toBe(2);
    expect(rotated.dataKey).not.toEqual(oldKey);
    expect(rotated.grants.map(item => item.recipientDeviceId)).toEqual(['device-one', 'device-two']);
    expect(await openDeviceGrant(rotated.grants[1], retained, issuer, workspaceId, 2)).toEqual(rotated.dataKey);
    expect(await unwrapRecovery(rotated.recoveryWrap, credential, workspaceId, 2)).toEqual(rotated.dataKey);
    const newContext = context({ keyEpoch: 2, sequence: 2, operationId: '10000000-0000-4000-8000-000000000002' });
    const newEnvelope = await sealEnvelope(message, rotated.dataKey, newContext);
    await expect(openEnvelope(newEnvelope, oldKey, newContext, new ReplayGuard())).rejects.toThrow('envelope-auth');
    expect(await openEnvelope(newEnvelope, rotated.dataKey, newContext, new ReplayGuard())).toEqual(message);
    await expect(rotateWorkspaceKey({ workspaceId, previousEpoch: 1, previousKey: oldKey,
      issuer, recipients: [issuer, revoked], revokedDeviceIds: [revoked.deviceId], recoveryCredential: credential })).rejects.toThrow('rotation-recipients');
  });
});
