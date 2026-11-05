import { afterEach, expect, it, vi } from 'vitest';
import { deliverExportFile, deliverExportUrl, hasFileDeliveryHandler, registerFileDeliveryHandler } from './file-delivery';

afterEach(() => vi.unstubAllGlobals());

it('requires native registration and preserves a newer handler when the old registration is disposed', async () => {
  expect(hasFileDeliveryHandler()).toBe(false);
  const request = { name: 'synthetic.ka1', mimeType: 'application/octet-stream', bytes: new Uint8Array([1, 2]) };
  await expect(deliverExportFile(request)).rejects.toThrow('file-delivery-unavailable');
  const first = registerFileDeliveryHandler(async () => ({ status: 'cancelled' }));
  const latest = vi.fn(async () => ({ status: 'opened' as const }));
  const second = registerFileDeliveryHandler(latest);
  first();
  await expect(deliverExportFile(request)).resolves.toEqual({ status: 'opened' });
  expect(latest).toHaveBeenCalledWith(request);
  second();
  expect(hasFileDeliveryHandler()).toBe(false);
});

it('reads only generated object URLs of this origin and sends the actual bytes to the registered handler', async () => {
  vi.stubGlobal('window', { location: { origin: 'http://127.0.0.1:4233' } });
  const bytes = new Uint8Array([75, 69, 69, 80, 65, 78, 89, 49]);
  const fetchFile = vi.fn(async () => new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }));
  vi.stubGlobal('fetch', fetchFile);
  const handler = vi.fn(async () => ({ status: 'cancelled' as const }));
  const dispose = registerFileDeliveryHandler(handler);
  try {
    for (const url of ['https://outside.test/private.ka1', 'blob:https://outside.test/file', 'file:///private.kdbx']) {
      await expect(deliverExportUrl(url, 'synthetic.ka1')).rejects.toThrow('file-delivery-url');
    }
    expect(fetchFile).not.toHaveBeenCalled();
    await expect(deliverExportUrl('blob:http://127.0.0.1:4233/synthetic', 'synthetic.ka1')).resolves.toEqual({ status: 'cancelled' });
    expect(handler).toHaveBeenCalledWith({ name: 'synthetic.ka1', mimeType: 'application/octet-stream', bytes });
  } finally { dispose(); }
});
