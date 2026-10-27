import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ native: true, available: true, read: vi.fn(), cancel: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mock.native, isPluginAvailable: () => mock.available },
  registerPlugin: () => ({ read: mock.read, cancel: mock.cancel }),
}));
import { readNativeMetadataHtml } from './metadata';
const encoded = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const response = () => ({ url: 'https://example.com/final#drop', contentType: 'text/html; charset=utf-8', bodyBase64: encoded(new TextEncoder().encode('<title>Synthetic</title>')) });
beforeEach(() => { vi.resetAllMocks(); mock.native = true; mock.available = true; mock.cancel.mockResolvedValue(undefined); mock.read.mockResolvedValue(response()); });

describe('restricted native metadata bridge contract (plugin mocked)', () => {
  it('sends only URL/request ID, strips fragments and decodes raw bytes with the declared charset', async () => {
    mock.read.mockResolvedValueOnce({ ...response(), contentType: 'text/html; charset=windows-1252', bodyBase64: encoded(new Uint8Array([99, 97, 102, 233])) });
    await expect(readNativeMetadataHtml('https://example.com/start#private')).resolves.toEqual({ url: 'https://example.com/final', html: 'café' });
    const input = mock.read.mock.calls[0][0];
    expect(Object.keys(input).sort()).toEqual(['requestId', 'url']);
    expect(input.url).toBe('https://example.com/start'); expect(input.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('rejects fallback, credentials, wrong schemes and an already cancelled signal before native I/O', async () => {
    mock.native = false; await expect(readNativeMetadataHtml('https://example.com')).rejects.toThrow('metadata-unavailable'); mock.native = true;
    for (const url of ['not a URL', 'https://user:password@example.com', 'file:///private', `https://example.com/${'x'.repeat(2048)}`]) await expect(readNativeMetadataHtml(url)).rejects.toThrow('metadata-url');
    await expect(readNativeMetadataHtml('https://example.com', { signal: AbortSignal.abort() })).rejects.toThrow('metadata-timeout');
    expect(mock.read).not.toHaveBeenCalled();
  });
  it('cancels the exact native request and ignores late completion without unhandled rejection', async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    mock.read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const controller = new AbortController(), pending = readNativeMetadataHtml('https://example.com', { signal: controller.signal });
    const id = mock.read.mock.calls[0][0].requestId;
    controller.abort();
    await expect(pending).rejects.toThrow('metadata-timeout'); expect(mock.cancel).toHaveBeenCalledWith({ requestId: id });
    resolve(response()); await Promise.resolve();
  });
  it('rejects malformed encoding, invalid response shape and bodies beyond the raw-byte budget', async () => {
    for (const value of [
      { ...response(), bodyBase64: '/w==' },
      { ...response(), contentType: 'text/html; charset=unknown-charset' },
    ]) { mock.read.mockResolvedValueOnce(value); await expect(readNativeMetadataHtml('https://example.com')).rejects.toThrow('metadata-encoding'); }
    for (const value of [{ ...response(), url: 'file:///private' }, { ...response(), contentType: 'application/json' }, { ...response(), bodyBase64: 'not base64!' }]) {
      mock.read.mockResolvedValueOnce(value); await expect(readNativeMetadataHtml('https://example.com')).rejects.toThrow('metadata-invalid');
    }
    mock.read.mockResolvedValueOnce({ ...response(), bodyBase64: 'AAAA'.repeat(349526) });
    await expect(readNativeMetadataHtml('https://example.com')).rejects.toThrow('metadata-limit');
  });
  it('keeps known safe error codes and never exposes arbitrary native diagnostics', async () => {
    mock.read.mockRejectedValueOnce({ message: 'metadata-private' }); await expect(readNativeMetadataHtml('https://example.com')).rejects.toThrow('metadata-private');
    mock.read.mockRejectedValueOnce({ message: 'synthetic raw response diagnostic' }); await expect(readNativeMetadataHtml('https://example.com')).rejects.toThrow('metadata-network');
  });
});
