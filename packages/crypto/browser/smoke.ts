import {
  ReplayGuard, createRecoveryCredential, generateDeviceKeys, generateWorkspaceKey,
  grantDeviceKey, openDeviceGrant, openEnvelope, rotateWorkspaceKey, sealEnvelope,
  unwrapRecovery, wrapForRecovery,
} from '../src';

async function runCryptoSmoke() {
  const workspaceId = '00000000-0000-4000-8000-000000000001';
  const key = await generateWorkspaceKey();
  const plaintext = new TextEncoder().encode('browser synthetic record');
  const context = { workspaceId, recordId: 'asset:browser-test', schemaVersion: 1, keyEpoch: 1,
    sequence: 1, operationId: '10000000-0000-4000-8000-000000000001', tombstone: false };
  const envelope = await sealEnvelope(plaintext, key, context);
  const guard = new ReplayGuard();
  const opened = await openEnvelope(envelope, key, context, guard);
  guard.markApplied(context);
  let replayRejected = false;
  try { await openEnvelope(envelope, key, context, guard); } catch { replayRejected = true; }
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
    roundTrip: new TextDecoder().decode(opened) === 'browser synthetic record',
    replayRejected, recoveryMatches: recovered.every((byte, index) => byte === key[index]),
    secondDeviceMatches: joined.every((byte, index) => byte === key[index]),
    rotatedEpoch: rotated.keyEpoch,
    previousKeyChanged: rotated.dataKey.some((byte, index) => byte !== key[index]),
  };
}

Object.assign(window, { runCryptoSmoke });
