import { describe, expect, it } from 'vitest';
import {
  ReplayGuard, createRecoveryCredential, generateDeviceKeys, generateWorkspaceKey,
  grantDeviceKey, openDeviceGrant, openEnvelope, rotateWorkspaceKey,
  sealEnvelope, unwrapRecovery, wrapForRecovery,
  type EnvelopeContext,
} from './index';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const otherWorkspaceId = '00000000-0000-4000-8000-000000000002';
const context = (overrides: Partial<EnvelopeContext> = {}): EnvelopeContext => ({
  workspaceId, recordId: 'asset:fixture', schemaVersion: 1, keyEpoch: 1,
  sequence: 1, operationId: '10000000-0000-4000-8000-000000000001', tombstone: false, ...overrides,
});
const message = new TextEncoder().encode('local synthetic asset');

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
    await expect(unwrapRecovery({ ...wrap, ciphertext: `${wrap.ciphertext.slice(0, -1)}A` }, credential, workspaceId, 1)).rejects.toThrow();
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
