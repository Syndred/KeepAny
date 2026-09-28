import { describe, expect, it } from 'vitest';
import { generateWorkspaceKey, openEnvelope, ReplayGuard, sealEnvelope, type LegacyEnvelopeContext } from '../../crypto/src';
import { ATTACHMENT_CHUNK_BYTES, MAX_ATTACHMENT_BYTES, openAttachment, sealAttachment } from './attachment-codec';

const workspaceId = crypto.randomUUID();
const attachmentId = crypto.randomUUID();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function fixture(size = 34) {
  const key = await generateWorkspaceKey();
  const bytes = new Uint8Array(size);
  for (let index = 0; index < bytes.length; index++) bytes[index] = (index * 31 + 17) % 256;
  const sealed = await sealAttachment({ workspaceId, attachmentId, key, keyEpoch: 1,
    name: 'private-photo.png', type: 'image/png', bytes });
  const stored = new Map(sealed.objects.map(object => [object.id, object.bytes]));
  const input = { workspaceId, attachmentId, key, keyEpoch: 1,
    manifestBytes: sealed.objects[sealed.objects.length - 1].bytes,
    loadObject: async (id: string) => {
      const object = stored.get(id);
      if (!object) throw Error('object-missing');
      return object;
    } };
  return { key, bytes, sealed, stored, input };
}

async function forgeManifest(input: Awaited<ReturnType<typeof fixture>>['input'],
  change: (manifest: Record<string, unknown>) => void): Promise<Uint8Array> {
  const envelope = JSON.parse(decoder.decode(input.manifestBytes));
  const context = envelope.context as LegacyEnvelopeContext;
  const plain = await openEnvelope(envelope, input.key, context, new ReplayGuard());
  const manifest = JSON.parse(decoder.decode(plain)) as Record<string, unknown>;
  change(manifest);
  return encoder.encode(JSON.stringify(await sealEnvelope(encoder.encode(JSON.stringify(manifest)), input.key, context)));
}

describe('encrypted attachment codec', () => {
  it('splits a large image into immutable ciphertext objects and authenticates the round trip', async () => {
    const { bytes, sealed, input } = await fixture(ATTACHMENT_CHUNK_BYTES * 2 + 51);
    expect(sealed.objects).toHaveLength(4);
    expect(sealed.objects.at(-1)?.id).toBe(attachmentId);
    expect(new Set(sealed.objects.map(object => object.id)).size).toBe(4);
    expect(sealed.objects.every(object => object.bytes.length < 4 * 1024 * 1024)).toBe(true);
    for (const object of sealed.objects) {
      expect(decoder.decode(object.bytes)).not.toContain('private-photo.png');
      expect(decoder.decode(object.bytes)).not.toContain('image/png');
    }
    const opened = await openAttachment(input);
    expect(opened).toEqual({ name: 'private-photo.png', type: 'image/png', bytes, sha256: sealed.sourceSha256 });
    expect(await openAttachment(input)).toEqual(opened);
  });

  it('rejects wrong key, epoch, workspace, and logical attachment identity', async () => {
    const { input } = await fixture();
    await expect(openAttachment({ ...input, key: await generateWorkspaceKey() })).rejects.toThrow('envelope-auth');
    await expect(openAttachment({ ...input, keyEpoch: 2 })).rejects.toThrow('envelope-context');
    await expect(openAttachment({ ...input, workspaceId: crypto.randomUUID() })).rejects.toThrow('envelope-context');
    await expect(openAttachment({ ...input, attachmentId: crypto.randomUUID() })).rejects.toThrow('envelope-context');
  });

  it('rejects missing, modified, and substituted objects', async () => {
    const { input, sealed } = await fixture(ATTACHMENT_CHUNK_BYTES + 3);
    const changedManifest = Uint8Array.from(input.manifestBytes);
    changedManifest[changedManifest.length - 3] ^= 1;
    await expect(openAttachment({ ...input, manifestBytes: changedManifest })).rejects.toThrow();
    await expect(openAttachment({ ...input, loadObject: async () => { throw Error('object-missing'); } }))
      .rejects.toThrow('object-missing');
    await expect(openAttachment({ ...input, loadObject: async id => {
      const original = await input.loadObject(id);
      return id === sealed.objects[0].id ? Uint8Array.from(original, (byte, index) => index === 20 ? byte ^ 1 : byte) : original;
    } })).rejects.toThrow('attachment-integrity');
    await expect(openAttachment({ ...input, loadObject: async id => {
      return id === sealed.objects[0].id ? sealed.objects[1].bytes : input.loadObject(id);
    } })).rejects.toThrow('attachment-integrity');
  });

  it('rejects authenticated malformed manifests, duplicate chunk IDs, and claimed oversize', async () => {
    const { input } = await fixture();
    const invalidType = await forgeManifest(input, manifest => { manifest.type = 'text/plain'; });
    await expect(openAttachment({ ...input, manifestBytes: invalidType })).rejects.toThrow();
    const repeated = await forgeManifest(input, manifest => {
      const chunks = manifest.chunks as Record<string, unknown>[];
      manifest.chunks = [chunks[0], chunks[0]];
      manifest.size = 2 * Number(chunks[0].plainSize);
    });
    await expect(openAttachment({ ...input, manifestBytes: repeated })).rejects.toThrow();
    const oversized = await forgeManifest(input, manifest => { manifest.size = MAX_ATTACHMENT_BYTES + 1; });
    await expect(openAttachment({ ...input, manifestBytes: oversized })).rejects.toThrow();
  });

  it('rejects oversized input and unsupported media before sealing', async () => {
    const key = await generateWorkspaceKey();
    const base = { workspaceId, attachmentId, key, keyEpoch: 1, name: 'photo.png', type: 'image/png' };
    await expect(sealAttachment({ ...base, bytes: new Uint8Array(MAX_ATTACHMENT_BYTES + 1) }))
      .rejects.toThrow('attachment-size');
    await expect(sealAttachment({ ...base, type: 'text/plain', bytes: new Uint8Array([1]) })).rejects.toThrow();
  });
});
