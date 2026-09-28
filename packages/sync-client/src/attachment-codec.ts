import { z } from 'zod';
import { openEnvelope, ReplayGuard, sealEnvelope, type LegacyEnvelopeContext } from '../../crypto/src';

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const ATTACHMENT_CHUNK_BYTES = 750_000;
const MAX_CIPHERTEXT_BYTES = 4 * 1024 * 1024;
const MAX_CHUNKS = Math.ceil(MAX_ATTACHMENT_BYTES / ATTACHMENT_CHUNK_BYTES);
const uuid = z.uuid();
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const imageType = z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const chunkSchema = z.strictObject({
  id: uuid, sha256: digest,
  size: z.number().int().positive().max(MAX_CIPHERTEXT_BYTES),
  plainSize: z.number().int().positive().max(ATTACHMENT_CHUNK_BYTES),
});
const manifestSchema = z.strictObject({
  format: z.literal('keepany-encrypted-attachment'), version: z.literal(1),
  attachmentId: uuid, name: z.string().max(255), type: imageType,
  size: z.number().int().nonnegative().max(MAX_ATTACHMENT_BYTES), sha256: digest,
  chunks: z.array(chunkSchema).max(MAX_CHUNKS),
}).superRefine((value, context) => {
  if (value.chunks.reduce((sum, chunk) => sum + chunk.plainSize, 0) !== value.size ||
    (value.size > 0 && !value.chunks.length) ||
    (value.size === 0 && value.chunks.length)) {
    context.addIssue({ code: 'custom', message: 'attachment-size' });
  }
  const ids = new Set(value.chunks.map(chunk => chunk.id));
  if (ids.size !== value.chunks.length || ids.has(value.attachmentId)) {
    context.addIssue({ code: 'custom', message: 'attachment-objects' });
  }
});

export interface CiphertextAttachmentObject { id: string; sha256: string; bytes: Uint8Array }

const text = new TextEncoder();
const decode = new TextDecoder('utf-8', { fatal: true });

async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}

function context(workspaceId: string, attachmentId: string, objectId: string, keyEpoch: number): LegacyEnvelopeContext {
  return { workspaceId, recordId: `attachment:${attachmentId}:${objectId}`,
    schemaVersion: 1, keyEpoch, operationId: objectId, tombstone: false, sequence: 1 };
}

function parseEnvelope(bytes: Uint8Array): unknown {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_CIPHERTEXT_BYTES) throw Error('attachment-ciphertext-size');
  return JSON.parse(decode.decode(bytes));
}

async function sealObject(plaintext: Uint8Array, key: Uint8Array, workspaceId: string,
  attachmentId: string, objectId: string, keyEpoch: number): Promise<CiphertextAttachmentObject> {
  const envelope = await sealEnvelope(plaintext, key, context(workspaceId, attachmentId, objectId, keyEpoch));
  const bytes = text.encode(JSON.stringify(envelope));
  if (bytes.length > MAX_CIPHERTEXT_BYTES) throw Error('attachment-ciphertext-size');
  return { id: objectId, sha256: await sha256(bytes), bytes };
}

export async function sealAttachment(input: {
  workspaceId: string; attachmentId: string; key: Uint8Array; keyEpoch: number;
  name: string; type: string; bytes: Uint8Array;
}): Promise<{ sourceSha256: string; objects: CiphertextAttachmentObject[] }> {
  const workspaceId = uuid.parse(input.workspaceId);
  const attachmentId = uuid.parse(input.attachmentId);
  const name = z.string().max(255).parse(input.name);
  const type = imageType.parse(input.type);
  if (!(input.bytes instanceof Uint8Array) || input.bytes.length > MAX_ATTACHMENT_BYTES) throw Error('attachment-size');
  const sourceSha256 = await sha256(input.bytes);
  const objects: CiphertextAttachmentObject[] = [];
  const chunks: z.infer<typeof chunkSchema>[] = [];
  for (let offset = 0; offset < input.bytes.length; offset += ATTACHMENT_CHUNK_BYTES) {
    const plain = input.bytes.subarray(offset, offset + ATTACHMENT_CHUNK_BYTES);
    const object = await sealObject(plain, input.key, workspaceId, attachmentId, crypto.randomUUID(), input.keyEpoch);
    objects.push(object);
    chunks.push({ id: object.id, sha256: object.sha256, size: object.bytes.length, plainSize: plain.length });
  }
  const manifest = manifestSchema.parse({ format: 'keepany-encrypted-attachment', version: 1,
    attachmentId, name, type, size: input.bytes.length, sha256: sourceSha256, chunks });
  objects.push(await sealObject(text.encode(JSON.stringify(manifest)), input.key,
    workspaceId, attachmentId, attachmentId, input.keyEpoch));
  return { sourceSha256, objects };
}

export async function openAttachment(input: {
  workspaceId: string; attachmentId: string; key: Uint8Array; keyEpoch: number;
  manifestBytes: Uint8Array; loadObject: (id: string) => Promise<Uint8Array>;
}): Promise<{ name: string; type: string; bytes: Uint8Array; sha256: string }> {
  const workspaceId = uuid.parse(input.workspaceId);
  const attachmentId = uuid.parse(input.attachmentId);
  const manifestPlain = await openEnvelope(parseEnvelope(input.manifestBytes), input.key,
    context(workspaceId, attachmentId, attachmentId, input.keyEpoch), new ReplayGuard());
  const manifest = manifestSchema.parse(JSON.parse(decode.decode(manifestPlain)));
  if (manifest.attachmentId !== attachmentId) throw Error('attachment-context');
  const bytes = new Uint8Array(manifest.size);
  let offset = 0;
  for (const chunk of manifest.chunks) {
    const ciphertext = await input.loadObject(chunk.id);
    if (!(ciphertext instanceof Uint8Array) || ciphertext.length !== chunk.size ||
      await sha256(ciphertext) !== chunk.sha256) throw Error('attachment-integrity');
    const plain = await openEnvelope(parseEnvelope(ciphertext), input.key,
      context(workspaceId, attachmentId, chunk.id, input.keyEpoch), new ReplayGuard());
    if (plain.length !== chunk.plainSize) throw Error('attachment-integrity');
    bytes.set(plain, offset);
    offset += plain.length;
  }
  if (await sha256(bytes) !== manifest.sha256) throw Error('attachment-integrity');
  return { name: manifest.name, type: manifest.type, bytes, sha256: manifest.sha256 };
}
