import { expect, it, vi } from 'vitest';
import { listSessionWorkspaces } from './index';
import { registerSyncFetchFactory } from './platform-fetch';
it('loads session workspaces through the selected endpoint transport and checks the authenticated account and writable membership', async () => {
  const endpoint = 'https://selected.example.test';
  const writable = '11111111-1111-4111-8111-111111111111';
  const readOnly = '22222222-2222-4222-8222-222222222222';
  const client = vi.fn<typeof fetch>(async input => String(input).endsWith('/sync/identity') ? Response.json({ accountId: 'selfhost:owner' }) :
    Response.json({ workspaces: [{ workspaceId: writable, canRead: true, canWrite: true }, { workspaceId: readOnly, canRead: true, canWrite: false }] }));
  const origins: string[] = [];
  const remove = registerSyncFetchFactory(origin => { origins.push(origin); return client; });
  try {
    expect(await listSessionWorkspaces(endpoint, 'selfhost:owner')).toEqual([writable]);
    expect(origins).toEqual([endpoint, endpoint]);
    expect(client.mock.calls[1]).toEqual([`${endpoint}/workspaces`, expect.objectContaining({ credentials: 'include', headers: { 'X-KeepAny-Account-Id': 'selfhost:owner' } })]);
    client.mockClear(); await expect(listSessionWorkspaces(endpoint, 'selfhost:other')).rejects.toThrow('sync-account-mismatch');
    expect(client).toHaveBeenCalledTimes(1);
  } finally { remove(); }
});
