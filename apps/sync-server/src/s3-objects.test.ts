import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { expect, it, vi } from 'vitest';
import { AttachmentIntegrityError, CIPHERTEXT_ATTACHMENT_TYPE } from '../../../packages/sync-core/src/attachments';
import { createS3CiphertextObjectStore, S3CiphertextObjectStore } from './s3-objects';

it('uses AWS SDK S3 commands with server-selected bucket/key and bounded ciphertext readback', async () => {
  const bytes = Uint8Array.from([1, 8, 3]);
  const send = vi.fn(async (command: unknown) => {
    if (command instanceof GetObjectCommand) return { Body: Readable.from([Buffer.from(bytes)]), ContentLength: bytes.length };
    return {};
  });
  const store = new S3CiphertextObjectStore({ send } as unknown as S3Client, 'private-bucket');
  await store.put('workspace/attachment', bytes);
  const put = send.mock.calls[0][0] as PutObjectCommand;
  expect(put).toBeInstanceOf(PutObjectCommand);
  expect(put.input).toMatchObject({ Bucket: 'private-bucket', Key: 'workspace/attachment', ContentType: CIPHERTEXT_ATTACHMENT_TYPE });
  expect(await store.get('workspace/attachment')).toEqual(Buffer.from(bytes));
  const get = send.mock.calls[1][0] as GetObjectCommand;
  expect(get.input).toMatchObject({ Bucket: 'private-bucket', Key: 'workspace/attachment' });
});

it('rejects oversized S3 objects and incomplete endpoint credentials', async () => {
  const send = vi.fn(async () => ({ Body: Readable.from([Buffer.from([1])]), ContentLength: 4 * 1024 * 1024 + 1 }));
  const store = new S3CiphertextObjectStore({ send } as unknown as S3Client, 'private-bucket');
  await expect(store.get('key')).rejects.toBeInstanceOf(AttachmentIntegrityError);
  expect(createS3CiphertextObjectStore({})).toBeNull();
  expect(() => createS3CiphertextObjectStore({ KEEPANY_S3_BUCKET: 'private-bucket' })).toThrow('KEEPANY_S3_REGION-required');
  expect(() => createS3CiphertextObjectStore({ KEEPANY_S3_BUCKET: 'private-bucket', KEEPANY_S3_REGION: 'auto',
    KEEPANY_S3_ENDPOINT: 'https://user:password@objects.example' })).toThrow('KEEPANY_S3_ENDPOINT-invalid');
  expect(() => createS3CiphertextObjectStore({ KEEPANY_S3_BUCKET: 'private-bucket', KEEPANY_S3_REGION: 'auto',
    KEEPANY_S3_ACCESS_KEY_ID: 'key' })).toThrow('KEEPANY_S3-credentials');
});

it('round trips through a local S3-compatible HTTP mock with signed SDK requests', async () => {
  const stored = new Map<string, Buffer>();
  const server = createServer(async (request, response) => {
    const key = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (!request.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ')) {
      response.writeHead(403).end();
      return;
    }
    if (request.method === 'PUT') {
      const parts: Buffer[] = [];
      for await (const part of request) parts.push(Buffer.from(part));
      stored.set(key, Buffer.concat(parts));
      response.writeHead(200, { ETag: '"mock-etag"' }).end();
      return;
    }
    const bytes = stored.get(key);
    if (!bytes) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Length': bytes.length, 'Content-Type': CIPHERTEXT_ATTACHMENT_TYPE }).end(bytes);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('mock-address');
    const store = createS3CiphertextObjectStore({
      KEEPANY_S3_BUCKET: 'private-bucket', KEEPANY_S3_REGION: 'us-east-1',
      KEEPANY_S3_ENDPOINT: `http://127.0.0.1:${address.port}`,
      KEEPANY_S3_ACCESS_KEY_ID: 'local-test-key', KEEPANY_S3_SECRET_ACCESS_KEY: 'local-test-secret',
    });
    if (!store) throw Error('mock-store');
    const bytes = Uint8Array.from([7, 0, 12, 255]);
    await store.put('workspace/attachment', bytes);
    expect([...stored.keys()]).toEqual(['/private-bucket/workspace/attachment']);
    expect(stored.get('/private-bucket/workspace/attachment')).toEqual(Buffer.from(bytes));
    expect(await store.get('workspace/attachment')).toEqual(Buffer.from(bytes));
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}, 20_000);
