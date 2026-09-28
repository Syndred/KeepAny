import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileAuthorityStorage } from './file-storage';
import { McpAuthority } from './authority';

const dirs: string[] = [];
afterEach(async () => { for (const directory of dirs.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe('local authority state', () => {
  it('persists grants, revocation and metadata-only audit across instances', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'keepany-mcp-'));
    dirs.push(dir);
    const path = join(dir, 'state.json');
    const first = new McpAuthority(new FileAuthorityStorage(path));
    const issued = await first.issueGrant({ assetIds: ['asset-1'], readFields: ['name'], ttlMs: 60_000 });
    const second = new McpAuthority(new FileAuthorityStorage(path));
    await expect(second.requireGrant(issued.id, issued.secret)).resolves.toMatchObject({ id: issued.id });
    expect((await stat(path)).mode & 0o077).toBe(0);
    await second.revokeGrant(issued.id);
    await expect(first.requireGrant(issued.id, issued.secret)).rejects.toThrow('grant-denied');
    expect(JSON.stringify(await first.auditEntries(issued.id))).not.toContain(issued.secret);
  });
});
