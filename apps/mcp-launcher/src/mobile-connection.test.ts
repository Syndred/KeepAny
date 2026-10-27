import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { privateTestDirectory } from '../../../packages/mcp/src/node-private-files.test-support';
import { stopPrivateFilesHelper } from '../../../packages/mcp/src/node-private-files';
import { certificate } from './mobile-launch.test-support';
import { parseMobileMcpConnectionFile, readMobileMcpConnectionFile, writeMobileMcpConnectionFile } from './mobile-connection';

const directories: string[] = [];
afterEach(async () => { stopPrivateFilesHelper(); for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
const identity = certificate();
function profile() { return { kind: 'keepany-mcp-mobile-connection-v1' as const, endpoint: 'https://127.0.0.1:9449/mcp',
  certificatePem: identity.pem, spkiSha256: identity.pin, instanceId: randomUUID(), grantId: randomUUID(), grantSecret: 'a'.repeat(43),
  expiresAt: Date.now() + 300000, scope: { assetIds: ['selected-id'], readFields: ['name' as const], writeFields: [], ttlMs: 300000 as const } }; }

it('writes unique persistent private profiles and reads them after helper restart without deleting earlier profiles', async () => {
  const directory = await privateTestDirectory('keepany-mobile-profile-'); directories.push(directory);
  const value = profile(), first = await writeMobileMcpConnectionFile(value, directory), second = await writeMobileMcpConnectionFile(value, directory);
  expect(first).not.toBe(second); stopPrivateFilesHelper();
  expect(await readMobileMcpConnectionFile(first)).toEqual(value);
  expect(await readFile(second, 'utf8')).toBe(JSON.stringify(value));
}, 20000);

it('rejects unknown fields, legacy kind, excessive/expired TTL, public endpoints and invalid secret without raw diagnostics', () => {
  for (const change of [{ kind: 'keepany-mcp-request-v1' }, { password: 'must-not-be-read' }, { expiresAt: Date.now() - 1 },
    { expiresAt: Date.now() + 900000 }, { endpoint: 'https://8.8.8.8:443/mcp' }, { grantSecret: 'bad' },
    { scope: { assetIds: ['x'], readFields: ['name'], writeFields: ['notes'], ttlMs: 300000 } }]) {
    try { parseMobileMcpConnectionFile({ ...profile(), ...change }); throw Error('accepted'); }
    catch (error) { expect((error as Error).message).toBe('mobile-mcp-connection-invalid'); expect((error as Error).cause).toBeUndefined(); }
  }
});

it.skipIf(process.platform === 'win32')('rejects a symlink directory ancestor before creating a profile', async () => {
  const directory = await privateTestDirectory('keepany-mobile-profile-'); directories.push(directory);
  const target = join(directory, 'target'); await mkdir(target, { mode: 0o700 });
  await mkdir(join(target, 'child'), { mode: 0o700 }); await symlink(target, join(directory, 'linked'));
  await expect(writeMobileMcpConnectionFile(profile(), join(directory, 'linked/child'))).rejects.toThrow('mobile-mcp-connection-invalid');
  expect(await readdir(join(target, 'child'))).toHaveLength(0);
});
