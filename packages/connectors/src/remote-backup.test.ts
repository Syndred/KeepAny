import { describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { createS3PresignedTransport, createWebDavTransport, downloadVerifiedArchive, restoreEncryptedArchive, uploadEncryptedArchive } from './remote-backup';

const passphrase = 'a-long-test-passphrase';
async function validArchive(): Promise<Uint8Array> {
  const records = strToU8('[]');
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', records as BufferSource)))
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  const manifest = { format: 'keepany-backup', version: 1, createdAt: '2026-09-28T00:00:00.000Z',
    recordCount: 0, recordsHash: hash, attachments: [] };
  return zipSync({ 'records.json': records, 'manifest.json': strToU8(JSON.stringify(manifest)) });
}

function mockObjectStore() {
  let stored: Uint8Array | undefined;
  const fetchImpl = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      stored = new Uint8Array(await (init.body as Blob).arrayBuffer());
      return new Response(null, { status: 201 });
    }
    return stored ? new Response(stored as BodyInit, { status: 200 }) : new Response(null, { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, getStored: () => stored, setStored: (bytes: Uint8Array) => { stored = bytes; } };
}

describe('S3 presigned encrypted backup', () => {
  const putUrl = 'https://objects.example/bucket/keepany.backup?signature=put-secret';
  const getUrl = 'https://objects.example/bucket/keepany.backup?signature=get-secret';

  it('uploads encrypted bytes, reads back, validates and restores through the repository', async () => {
    const store = mockObjectStore();
    const transport = createS3PresignedTransport({ putUrl, getUrl, fetchImpl: store.fetchImpl });
    const archive = await validArchive();
    const receipt = await uploadEncryptedArchive(archive, passphrase, transport);
    expect(store.getStored()).toBeDefined();
    expect(store.getStored()).not.toEqual(archive);
    expect(new TextDecoder().decode(store.getStored()!.slice(0, 8))).toBe('KEEPANY1');
    expect(await downloadVerifiedArchive(receipt, passphrase, transport)).toEqual(archive);
    const repository = { restoreArchive: vi.fn(async (bytes: Uint8Array) => {
      expect(bytes).toEqual(archive);
      return 0;
    }) };
    expect(await restoreEncryptedArchive(receipt, passphrase, transport, repository)).toBe(0);
    expect(repository.restoreArchive).toHaveBeenCalledOnce();
    const calls = vi.mocked(store.fetchImpl).mock.calls;
    expect(calls[0][1]).toMatchObject({ method: 'PUT', redirect: 'error', credentials: 'omit' });
    expect(calls[1][1]).toMatchObject({ method: 'GET', redirect: 'error', credentials: 'omit' });
  });

  it('rejects URL credentials, insecure endpoints and mismatched object paths', () => {
    expect(() => createS3PresignedTransport({ putUrl: 'http://objects.example/file', getUrl })).toThrow('backup-endpoint');
    expect(() => createS3PresignedTransport({ putUrl: 'https://user:secret@objects.example/file', getUrl })).toThrow('backup-endpoint');
    expect(() => createS3PresignedTransport({ putUrl: 'https://127.0.0.1/file', getUrl })).toThrow('backup-endpoint');
    expect(() => createS3PresignedTransport({ putUrl, getUrl: 'https://objects.example/other' })).toThrow('backup-object-mismatch');
  });

  it('refuses corrupt readback and does not return a success receipt', async () => {
    const store = mockObjectStore();
    const fetchImpl = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      const response = await store.fetchImpl(url, init);
      return init?.method === 'GET' ? new Response(new Uint8Array([1, 2, 3]), { status: 200 }) : response;
    }) as unknown as typeof fetch;
    const transport = createS3PresignedTransport({ putUrl, getUrl, fetchImpl });
    await expect(uploadEncryptedArchive(await validArchive(), passphrase, transport)).rejects.toThrow('backup-readback-mismatch');
  });

  it('rejects invalid local archives before sending and oversized remote content', async () => {
    const store = mockObjectStore();
    const transport = createS3PresignedTransport({ putUrl, getUrl, fetchImpl: store.fetchImpl });
    await expect(uploadEncryptedArchive(new Uint8Array([1, 2, 3]), passphrase, transport)).rejects.toThrow();
    expect(store.getStored()).toBeUndefined();
    const large = createS3PresignedTransport({ putUrl, getUrl, fetchImpl: vi.fn(async () =>
      new Response('x', { status: 200, headers: { 'content-length': String(200 * 1024 * 1024) } })) as unknown as typeof fetch });
    await expect(large.get()).rejects.toThrow('backup-size');
  });
});

describe('WebDAV encrypted backup', () => {
  it('uses scoped headers and verifies before invoking restore', async () => {
    const store = mockObjectStore();
    const authorization = vi.fn(async () => 'Bearer local-test-token');
    const transport = createWebDavTransport({ objectUrl: 'https://dav.example/keepany/backup.bin', authorization, fetchImpl: store.fetchImpl });
    const receipt = await uploadEncryptedArchive(await validArchive(), passphrase, transport);
    const options = vi.mocked(store.fetchImpl).mock.calls[0][1]!;
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer local-test-token');
    expect(options).toMatchObject({ redirect: 'error', credentials: 'omit' });
    const repository = { restoreArchive: vi.fn(async () => 0) };
    await expect(restoreEncryptedArchive(receipt, 'wrong-password', transport, repository)).rejects.toThrow();
    expect(repository.restoreArchive).not.toHaveBeenCalled();
    expect(await restoreEncryptedArchive(receipt, passphrase, transport, repository)).toBe(0);
  });

  it('rejects WebDAV redirects and invalid authorization headers', async () => {
    const redirected = vi.fn(async () => new Response(null, { status: 302, headers: { Location: 'https://other.example' } })) as unknown as typeof fetch;
    const transport = createWebDavTransport({ objectUrl: 'https://dav.example/backup.bin', fetchImpl: redirected });
    await expect(transport.put(new Uint8Array([1]))).rejects.toThrow('backup-http');
    const invalid = createWebDavTransport({ objectUrl: 'https://dav.example/backup.bin', authorization: async () => 'Basic x\r\nInjected: yes', fetchImpl: redirected });
    await expect(invalid.get()).rejects.toThrow('backup-authorization');
  });
});
