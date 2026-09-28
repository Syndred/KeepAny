import {
  ReplayGuard, createRecoveryCredential, generateDeviceKeys, generateWorkspaceKey,
  grantDeviceKey, openDeviceGrant, openSyncChangeEnvelope, rotateWorkspaceKey, sealEnvelope,
  unwrapRecovery, wrapForRecovery,
} from '../src';

async function runCryptoSmoke() {
  const workspaceId = '00000000-0000-4000-8000-000000000001';
  const key = await generateWorkspaceKey();
  const plaintext = new TextEncoder().encode('browser synthetic record');
  const context = { workspaceId, recordId: 'asset:browser-test', kind: 'asset' as const,
    schemaVersion: 1, keyEpoch: 1, recordVersion: 1,
    operationId: '10000000-0000-4000-8000-000000000001', tombstone: false };
  const envelope = await sealEnvelope(plaintext, key, context);
  const change = { operationId: context.operationId, id: context.recordId, kind: context.kind,
    schemaVersion: context.schemaVersion, ciphertext: JSON.stringify(envelope),
    tombstone: context.tombstone, version: 1, sequence: 3 };
  const guard = new ReplayGuard();
  const opened = await openSyncChangeEnvelope(envelope, key, { workspaceId, change, keyEpoch: 1 }, guard);
  guard.markApplied(opened.context, opened.recordVersion);
  let replayRejected = false;
  try { await openSyncChangeEnvelope(envelope, key, { workspaceId, change, keyEpoch: 1 }, guard); }
  catch { replayRejected = true; }
  const credential = await createRecoveryCredential();
  const wrap = await wrapForRecovery(key, credential, workspaceId, 1);
  const recovered = await unwrapRecovery(wrap, credential, workspaceId, 1);
  const first = await generateDeviceKeys('device-browser-one');
  const second = await generateDeviceKeys('device-browser-two');
  const grant = await grantDeviceKey(key, workspaceId, 1, first, second);
  const joined = await openDeviceGrant(grant, second, first, workspaceId, 1);
  const rotated = await rotateWorkspaceKey({ workspaceId, previousEpoch: 1, previousKey: key, issuer: first,
    recipients: [first, second], revokedDeviceIds: ['device-revoked'], recoveryCredential: credential });
  return {
    roundTrip: new TextDecoder().decode(opened.plaintext) === 'browser synthetic record',
    replayRejected, recoveryMatches: recovered.every((byte, index) => byte === key[index]),
    secondDeviceMatches: joined.every((byte, index) => byte === key[index]),
    rotatedEpoch: rotated.keyEpoch,
    previousKeyChanged: rotated.dataKey.some((byte, index) => byte !== key[index]),
  };
}

Object.assign(window, { runCryptoSmoke });
