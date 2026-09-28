import sodium from 'libsodium-wrappers';
import { z } from 'zod';
import { syncChangeSchema, syncKindSchema, type SyncChange } from '../../contracts/src';

const FORMAT = 'keepany-sync-envelope';
const ALGORITHM = 'XChaCha20-Poly1305-IETF';
const RECOVERY_FORMAT = 'keepany-recovery-wrap';
const GRANT_FORMAT = 'keepany-device-grant';
const CREDENTIAL_PREFIX = 'ka1_';
const b64Schema = z.string().regex(/^[A-Za-z0-9_-]+$/);
const idSchema = z.string().min(1).max(120).regex(/^[A-Za-z0-9:_-]+$/);
const baseContextSchema = z.object({
  workspaceId: z.uuid(), recordId: idSchema, schemaVersion: z.number().int().min(1).max(100),
  keyEpoch: z.number().int().positive(), operationId: z.uuid(),
  tombstone: z.boolean(),
});
const legacyContextSchema = baseContextSchema.extend({ sequence: z.number().int().positive() });
const contextV2Schema = baseContextSchema.extend({
  kind: syncKindSchema,
  recordVersion: z.number().int().positive(),
}).refine(value => value.recordId.startsWith(`${value.kind}:`), 'kind-mismatch');
const contextSchema = z.union([contextV2Schema, legacyContextSchema]);
export type EnvelopeContext = z.infer<typeof contextSchema>;
export type EnvelopeContextV2 = z.infer<typeof contextV2Schema>;
export type LegacyEnvelopeContext = z.infer<typeof legacyContextSchema>;

const envelopeBaseSchema = z.object({
  format: z.literal(FORMAT), algorithm: z.literal(ALGORITHM),
  nonce: b64Schema.max(40), ciphertext: b64Schema.max(2_000_000),
});
const envelopeSchema = z.discriminatedUnion('version', [
  envelopeBaseSchema.extend({ version: z.literal(1), context: legacyContextSchema }),
  envelopeBaseSchema.extend({ version: z.literal(2), context: contextV2Schema }),
]);
export type EncryptedEnvelope = z.infer<typeof envelopeSchema>;

const recoverySchema = z.object({
  format: z.literal(RECOVERY_FORMAT), version: z.literal(1), workspaceId: z.uuid(),
  keyEpoch: z.number().int().positive(), nonce: b64Schema.max(40), ciphertext: b64Schema.max(200),
});
export type RecoveryWrap = z.infer<typeof recoverySchema>;

const grantSchema = z.object({
  format: z.literal(GRANT_FORMAT), version: z.literal(1), workspaceId: z.uuid(),
  keyEpoch: z.number().int().positive(), issuerDeviceId: idSchema, recipientDeviceId: idSchema,
  issuerPublicKey: b64Schema.max(50), recipientPublicKey: b64Schema.max(50),
  nonce: b64Schema.max(40), ciphertext: b64Schema.max(500),
});
export type DeviceGrant = z.infer<typeof grantSchema>;
export interface DeviceKeys { deviceId: string; publicKey: Uint8Array; privateKey: Uint8Array }
export interface DevicePublic { deviceId: string; publicKey: Uint8Array }

const ready = sodium.ready;
const encode = (value: Uint8Array) => sodium.to_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING);
const decode = (value: string) => sodium.from_base64(b64Schema.parse(value), sodium.base64_variants.URLSAFE_NO_PADDING);
const utf8 = (value: string) => sodium.from_string(value);
const equalBytes = (left: Uint8Array, right: Uint8Array) => left.length === right.length && sodium.memcmp(left, right);

function assertKey(key: Uint8Array): void {
  if (!(key instanceof Uint8Array) || key.length !== sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES) throw Error('key-length');
}
function isV2(context: EnvelopeContext): context is EnvelopeContextV2 {
  return 'recordVersion' in context;
}
function aad(context: EnvelopeContext): Uint8Array {
  if (isV2(context)) return utf8(JSON.stringify([FORMAT, 2, ALGORITHM, context.workspaceId,
    context.recordId, context.kind, context.schemaVersion, context.keyEpoch, context.recordVersion,
    context.operationId, context.tombstone]));
  return utf8(JSON.stringify([FORMAT, 1, ALGORITHM, context.workspaceId, context.recordId,
    context.schemaVersion, context.keyEpoch, context.sequence, context.operationId, context.tombstone]));
}
function assertContext(actual: EnvelopeContext, expected: EnvelopeContext): void {
  if (isV2(actual) !== isV2(expected)) throw Error('envelope-context');
  const fields = isV2(actual) ? Object.keys(baseContextSchema.shape) : Object.keys(legacyContextSchema.shape);
  if (isV2(actual)) fields.push('kind', 'recordVersion');
  for (const field of fields as (keyof EnvelopeContext)[]) {
    if (actual[field] !== expected[field]) throw Error('envelope-context');
  }
}
function decryptAuthenticated(ciphertext: Uint8Array, associatedData: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array {
  try { return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, associatedData, nonce, key); }
  catch { throw Error('envelope-auth'); }
}

export async function generateWorkspaceKey(): Promise<Uint8Array> {
  await ready;
  return sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
}

export async function sealEnvelope(plaintext: Uint8Array, dataKey: Uint8Array, rawContext: EnvelopeContext): Promise<EncryptedEnvelope> {
  await ready;
  assertKey(dataKey);
  const context = contextSchema.parse(rawContext);
  if (!(plaintext instanceof Uint8Array) || plaintext.length > 1_000_000) throw Error('envelope-size');
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const common = { format: FORMAT, algorithm: ALGORITHM, nonce: encode(nonce),
    ciphertext: encode(sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, aad(context), null, nonce, dataKey)) } as const;
  return isV2(context) ? { ...common, version: 2, context } : { ...common, version: 1, context };
}

interface ReplayEntry { workspaceId: string; recordId: string; keyEpoch: number; sequence?: number; recordVersion?: number }
const replayEntrySchema = baseContextSchema.pick({ workspaceId: true, recordId: true, keyEpoch: true }).extend({
  sequence: z.number().int().positive().optional(), recordVersion: z.number().int().positive().optional(),
}).refine(value => value.sequence !== undefined || value.recordVersion !== undefined);
const replaySnapshotSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]), entries: z.array(replayEntrySchema).max(100_000),
  operations: z.array(z.uuid()).max(100_000), minimumEpochs: z.array(z.object({ workspaceId: z.uuid(), epoch: z.number().int().positive() })).max(10_000),
});
export type ReplaySnapshot = z.infer<typeof replaySnapshotSchema>;

// Prototype replay guard. Persist its snapshot atomically with the decrypted record write.
export class ReplayGuard {
  private readonly latest = new Map<string, ReplayEntry>();
  private readonly operations = new Set<string>();
  private readonly minimumEpochs = new Map<string, number>();

  static fromSnapshot(input: unknown): ReplayGuard {
    const snapshot = replaySnapshotSchema.parse(input);
    const guard = new ReplayGuard();
    for (const entry of snapshot.entries) guard.latest.set(JSON.stringify([entry.workspaceId, entry.recordId]), entry);
    for (const operation of snapshot.operations) guard.operations.add(operation);
    for (const item of snapshot.minimumEpochs) guard.minimumEpochs.set(item.workspaceId, item.epoch);
    return guard;
  }

  snapshot(): ReplaySnapshot {
    return { version: 2, entries: [...this.latest.values()], operations: [...this.operations],
      minimumEpochs: [...this.minimumEpochs].map(([workspaceId, epoch]) => ({ workspaceId, epoch })) };
  }

  advanceMinimumEpoch(workspaceId: string, epoch: number): void {
    z.uuid().parse(workspaceId);
    if (!Number.isSafeInteger(epoch) || epoch < 1) throw Error('key-epoch');
    this.minimumEpochs.set(workspaceId, Math.max(epoch, this.minimumEpochs.get(workspaceId) ?? 1));
  }

  assertFresh(context: EnvelopeContext, observedRecordVersion?: number): void {
    if (observedRecordVersion !== undefined && (!Number.isSafeInteger(observedRecordVersion) || observedRecordVersion < 1 ||
      (isV2(context) && context.recordVersion !== observedRecordVersion))) throw Error('envelope-context');
    if (context.keyEpoch < (this.minimumEpochs.get(context.workspaceId) ?? 1)) throw Error('envelope-replay');
    if (this.operations.has(context.operationId)) throw Error('envelope-replay');
    const previous = this.latest.get(JSON.stringify([context.workspaceId, context.recordId]));
    if (!previous) return;
    if (context.keyEpoch < previous.keyEpoch) throw Error('envelope-replay');
    const recordVersion = isV2(context) ? context.recordVersion : observedRecordVersion;
    if (previous.recordVersion !== undefined && recordVersion === undefined) throw Error('envelope-replay-baseline');
    if (previous.recordVersion !== undefined && recordVersion !== undefined) {
      if (recordVersion <= previous.recordVersion) throw Error('envelope-replay');
    } else if (!isV2(context) && previous.sequence !== undefined) {
      if (context.sequence <= previous.sequence) throw Error('envelope-replay');
    } else {
      // A legacy snapshot does not prove a record version. Require a trusted rebaseline.
      throw Error('envelope-replay-baseline');
    }
  }

  markApplied(context: EnvelopeContext, observedRecordVersion?: number): void {
    this.assertFresh(context, observedRecordVersion);
    this.latest.set(JSON.stringify([context.workspaceId, context.recordId]), {
      workspaceId: context.workspaceId, recordId: context.recordId, keyEpoch: context.keyEpoch,
      ...(isV2(context) ? { recordVersion: context.recordVersion } : { sequence: context.sequence,
        ...(observedRecordVersion === undefined ? {} : { recordVersion: observedRecordVersion }) }),
    });
    this.operations.add(context.operationId);
  }
}

export async function openEnvelope(
  input: unknown, dataKey: Uint8Array, rawExpected: EnvelopeContext, replayGuard: ReplayGuard,
  observedRecordVersion?: number,
): Promise<Uint8Array> {
  await ready;
  assertKey(dataKey);
  const envelope = envelopeSchema.parse(input);
  const expected = contextSchema.parse(rawExpected);
  if (envelope.version !== (isV2(expected) ? 2 : 1)) throw Error('envelope-context');
  assertContext(envelope.context, expected);
  replayGuard.assertFresh(envelope.context, observedRecordVersion);
  let nonce: Uint8Array;
  let ciphertext: Uint8Array;
  try { nonce = decode(envelope.nonce); ciphertext = decode(envelope.ciphertext); }
  catch { throw Error('envelope-auth'); }
  if (nonce.length !== sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES) throw Error('envelope-nonce');
  const plaintext = decryptAuthenticated(ciphertext, aad(envelope.context), nonce, dataKey);
  // The caller commits after its own durable record write. A failed write can be retried.
  return plaintext;
}

// Expected metadata must come from the authenticated pull response and trusted local workspace/key epoch.
// Never derive expected values from envelope.context itself.
export async function openSyncChangeEnvelope(
  input: unknown, dataKey: Uint8Array,
  source: { workspaceId: string; change: SyncChange; keyEpoch: number }, replayGuard: ReplayGuard,
): Promise<{ plaintext: Uint8Array; context: EnvelopeContext; recordVersion: number }> {
  const change = syncChangeSchema.parse(source.change);
  if (!change.id.startsWith(`${change.kind}:`)) throw Error('envelope-context');
  const version = envelopeSchema.parse(input).version;
  const common = { workspaceId: z.uuid().parse(source.workspaceId), recordId: change.id,
    schemaVersion: change.schemaVersion, keyEpoch: z.number().int().positive().parse(source.keyEpoch),
    operationId: change.operationId, tombstone: change.tombstone };
  const context: EnvelopeContext = version === 2
    ? { ...common, kind: change.kind, recordVersion: change.version }
    : { ...common, sequence: change.sequence };
  const plaintext = await openEnvelope(input, dataKey, context, replayGuard, change.version);
  return { plaintext, context, recordVersion: change.version };
}

export async function createRecoveryCredential(): Promise<string> {
  await ready;
  return `${CREDENTIAL_PREFIX}${encode(sodium.randombytes_buf(32))}`;
}
function recoveryKey(credential: string): Uint8Array {
  if (!credential.startsWith(CREDENTIAL_PREFIX)) throw Error('recovery-credential');
  const key = decode(credential.slice(CREDENTIAL_PREFIX.length));
  assertKey(key);
  return key;
}
function recoveryAad(workspaceId: string, keyEpoch: number): Uint8Array {
  return utf8(JSON.stringify([RECOVERY_FORMAT, 1, workspaceId, keyEpoch]));
}

export async function wrapForRecovery(dataKey: Uint8Array, credential: string, workspaceId: string, keyEpoch: number): Promise<RecoveryWrap> {
  await ready;
  assertKey(dataKey);
  z.uuid().parse(workspaceId);
  if (!Number.isSafeInteger(keyEpoch) || keyEpoch < 1) throw Error('key-epoch');
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  return {
    format: RECOVERY_FORMAT, version: 1, workspaceId, keyEpoch, nonce: encode(nonce),
    ciphertext: encode(sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(dataKey,
      recoveryAad(workspaceId, keyEpoch), null, nonce, recoveryKey(credential))),
  };
}

export async function unwrapRecovery(input: unknown, credential: string, workspaceId: string, keyEpoch: number): Promise<Uint8Array> {
  await ready;
  const wrap = recoverySchema.parse(input);
  if (wrap.workspaceId !== workspaceId || wrap.keyEpoch !== keyEpoch) throw Error('recovery-context');
  const nonce = decode(wrap.nonce);
  if (nonce.length !== sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES) throw Error('recovery-nonce');
  const key = decryptAuthenticated(decode(wrap.ciphertext), recoveryAad(workspaceId, keyEpoch), nonce, recoveryKey(credential));
  assertKey(key);
  return key;
}

export async function generateDeviceKeys(deviceId: string): Promise<DeviceKeys> {
  await ready;
  idSchema.parse(deviceId);
  const pair = sodium.crypto_box_keypair();
  return { deviceId, publicKey: pair.publicKey, privateKey: pair.privateKey };
}

function assertDeviceKeys(device: DeviceKeys): void {
  idSchema.parse(device.deviceId);
  if (device.publicKey.length !== sodium.crypto_box_PUBLICKEYBYTES ||
      device.privateKey.length !== sodium.crypto_box_SECRETKEYBYTES) throw Error('device-key');
}
function assertDevicePublic(device: DevicePublic): void {
  idSchema.parse(device.deviceId);
  if (device.publicKey.length !== sodium.crypto_box_PUBLICKEYBYTES) throw Error('device-key');
}

export async function grantDeviceKey(
  dataKey: Uint8Array, workspaceId: string, keyEpoch: number,
  issuer: DeviceKeys, recipient: DevicePublic,
): Promise<DeviceGrant> {
  await ready;
  assertKey(dataKey);
  z.uuid().parse(workspaceId);
  if (!Number.isSafeInteger(keyEpoch) || keyEpoch < 1) throw Error('key-epoch');
  assertDeviceKeys(issuer);
  assertDevicePublic(recipient);
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const payload = utf8(JSON.stringify([GRANT_FORMAT, 1, workspaceId, keyEpoch,
    issuer.deviceId, recipient.deviceId, encode(dataKey)]));
  return {
    format: GRANT_FORMAT, version: 1, workspaceId, keyEpoch,
    issuerDeviceId: issuer.deviceId, recipientDeviceId: recipient.deviceId,
    issuerPublicKey: encode(issuer.publicKey), recipientPublicKey: encode(recipient.publicKey),
    nonce: encode(nonce), ciphertext: encode(sodium.crypto_box_easy(payload, nonce, recipient.publicKey, issuer.privateKey)),
  };
}

export async function openDeviceGrant(
  input: unknown, recipient: DeviceKeys,
  trustedIssuer: DevicePublic, workspaceId: string, keyEpoch: number,
): Promise<Uint8Array> {
  await ready;
  assertDeviceKeys(recipient);
  assertDevicePublic(trustedIssuer);
  const grant = grantSchema.parse(input);
  if (grant.workspaceId !== workspaceId || grant.keyEpoch !== keyEpoch ||
      grant.recipientDeviceId !== recipient.deviceId || grant.issuerDeviceId !== trustedIssuer.deviceId ||
      !equalBytes(decode(grant.issuerPublicKey), trustedIssuer.publicKey) ||
      !equalBytes(decode(grant.recipientPublicKey), recipient.publicKey)) throw Error('device-grant-context');
  const nonce = decode(grant.nonce);
  if (nonce.length !== sodium.crypto_box_NONCEBYTES) throw Error('device-grant-nonce');
  let payload: unknown;
  try { payload = JSON.parse(sodium.to_string(sodium.crypto_box_open_easy(
    decode(grant.ciphertext), nonce, trustedIssuer.publicKey, recipient.privateKey))); }
  catch { throw Error('device-grant-auth'); }
  if (!Array.isArray(payload) || payload.length !== 7 ||
      payload[0] !== GRANT_FORMAT || payload[1] !== 1 || payload[2] !== workspaceId ||
      payload[3] !== keyEpoch || payload[4] !== trustedIssuer.deviceId || payload[5] !== recipient.deviceId ||
      typeof payload[6] !== 'string') throw Error('device-grant-context');
  const key = decode(payload[6]);
  assertKey(key);
  return key;
}

export async function rotateWorkspaceKey(input: {
  workspaceId: string; previousEpoch: number; previousKey: Uint8Array;
  issuer: DeviceKeys; recipients: DevicePublic[]; revokedDeviceIds: string[];
  recoveryCredential: string;
}): Promise<{ keyEpoch: number; dataKey: Uint8Array; grants: DeviceGrant[]; recoveryWrap: RecoveryWrap }> {
  await ready;
  assertKey(input.previousKey);
  assertDeviceKeys(input.issuer);
  if (!Number.isSafeInteger(input.previousEpoch) || input.previousEpoch < 1 || input.previousEpoch >= Number.MAX_SAFE_INTEGER) throw Error('key-epoch');
  const revoked = new Set(input.revokedDeviceIds.map(id => idSchema.parse(id)));
  if (revoked.has(input.issuer.deviceId) || !input.recipients.length) throw Error('rotation-recipients');
  const seen = new Set<string>();
  for (const recipient of input.recipients) {
    assertDevicePublic(recipient);
    if (revoked.has(recipient.deviceId) || seen.has(recipient.deviceId)) throw Error('rotation-recipients');
    seen.add(recipient.deviceId);
  }
  if (!input.recipients.some(item => item.deviceId === input.issuer.deviceId && equalBytes(item.publicKey, input.issuer.publicKey))) throw Error('rotation-issuer');
  const keyEpoch = input.previousEpoch + 1;
  const dataKey = await generateWorkspaceKey();
  if (equalBytes(dataKey, input.previousKey)) throw Error('rotation-key');
  const grants = await Promise.all(input.recipients.map(device => grantDeviceKey(dataKey, input.workspaceId, keyEpoch, input.issuer, device)));
  const recoveryWrap = await wrapForRecovery(dataKey, input.recoveryCredential, input.workspaceId, keyEpoch);
  return { keyEpoch, dataKey, grants, recoveryWrap };
}
