import { constants } from 'node:fs';
import { open, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readLaunchRequest, parseLaunchRequest } from './request';
import { prepareStateDirectory, writePairingFile, type PairingFilePayload } from './pairing-file';
import { stopPrivateFilesHelper } from '../../../packages/mcp/src/node-private-files';
import { assertPrivateTestFile, fixtureDirectoryMode, privateTestDirectory } from '../../../packages/mcp/src/node-private-files.test-support';

const directories: string[] = [];
afterEach(async () => { stopPrivateFilesHelper(); await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 25 }))); });
const temporary = async () => { const directory = await privateTestDirectory('keepany-mcp-launcher-'); directories.push(directory); return directory; };
const request = (now = Date.now()) => ({
  kind: 'keepany-mcp-local-request-v1', appOrigin: 'http://127.0.0.1:5173',
  assetIds: ['asset-1'], readFields: ['name'], writeFields: ['name'],
  ttlMs: 60_000, createdAt: now, requestNonce: '3c3c64d2-718c-4964-984e-a6a242363a58',
});
const pairing = (): PairingFilePayload => ({
  kind: 'keepany-mcp-pairing-v1', url: 'http://127.0.0.1:30998', pairingSecret: 'x'.repeat(43),
  requestNonce: request().requestNonce, appOrigin: request().appOrigin, expiresAt: Date.now() + 120_000,
});

describe('trusted local request parsing', () => {
  it('requires exact shape, fresh proposal, exact safe origin and bounded scope', () => {
    const now = 1_000_000;
    expect(parseLaunchRequest(request(now), now).assetIds).toEqual(['asset-1']);
    expect(() => parseLaunchRequest({ ...request(now), extra: 'value' }, now)).toThrow('invalid-request');
    expect(() => parseLaunchRequest(request(now - 300_001), now)).toThrow('request-expired');
    expect(() => parseLaunchRequest(request(now + 30_001), now)).toThrow('request-expired');
    expect(() => parseLaunchRequest({ ...request(now), appOrigin: 'http://example.com' }, now)).toThrow('invalid-origin');
    expect(() => parseLaunchRequest({ ...request(now), appOrigin: 'https://example.com/path' }, now)).toThrow('invalid-origin');
    expect(() => parseLaunchRequest({ ...request(now), assetIds: ['asset-1', 'asset-1'] }, now)).toThrow('invalid-scope');
    expect(() => parseLaunchRequest({ ...request(now), readFields: ['name', 'name'] }, now)).toThrow('invalid-scope');
    expect(() => parseLaunchRequest({ ...request(now), writeFields: ['description'] }, now)).toThrow('invalid-scope');
  });

  it('reads only an owned, bounded regular file through a no-follow descriptor', async () => {
    const directory = await temporary();
    const path = join(directory, 'request.json');
    await writeFile(path, JSON.stringify(request()));
    expect((await readLaunchRequest(path)).assetIds).toEqual(['asset-1']);
    await symlink(path, join(directory, 'link.json'));
    await expect(readLaunchRequest(join(directory, 'link.json'))).rejects.toThrow('request-file-unavailable');
    await expect(readLaunchRequest('request.json')).rejects.toThrow('request-path-not-absolute');
    await writeFile(path, 'x'.repeat(64 * 1024 + 1));
    await expect(readLaunchRequest(path)).rejects.toThrow('request-file-unsafe');
  });
});

describe('one-time private pairing file', () => {
  it('creates 0600 without replacing an existing path and deletes only its own inode', async () => {
    const directory = await temporary();
    await fixtureDirectoryMode(directory, 0o700);
    const path = join(directory, 'pairing.json');
    const file = await writePairingFile(path, pairing());
    const opened = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    await assertPrivateTestFile(path, expect);
    expect(JSON.parse(await opened.readFile('utf8'))).toMatchObject({ kind: 'keepany-mcp-pairing-v1' });
    await opened.close();
    await expect(writePairingFile(path, pairing())).rejects.toThrow('pairing-file-exists');
    await file.remove();
    await expect(open(path, constants.O_RDONLY)).rejects.toMatchObject({ code: 'ENOENT' });
    await file.remove();

    const second = await writePairingFile(path, pairing());
    await rename(path, join(directory, 'original.json'));
    await writeFile(path, 'someone else');
    await second.remove();
    const replacement = await open(path, constants.O_RDONLY);
    expect(await replacement.readFile('utf8')).toBe('someone else');
    await replacement.close();
  }, 20_000);

  it('rejects symlink, group-readable directory and relative path', async () => {
    const directory = await temporary();
    const privateDir = join(directory, 'private');
    await fixtureDirectoryMode(directory, 0o755);
    await expect(writePairingFile(join(directory, 'pair.json'), pairing())).rejects.toThrow('pairing-directory-unsafe');
    await fixtureDirectoryMode(directory, 0o700);
    await expect(writePairingFile('pair.json', pairing())).rejects.toThrow('pairing-path-not-absolute');
    await symlink(directory, privateDir);
    await expect(writePairingFile(join(privateDir, 'pair.json'), pairing())).rejects.toThrow('pairing-directory-unsafe');
    await expect(prepareStateDirectory('relative')).rejects.toThrow('state-directory-not-absolute');
    await expect(prepareStateDirectory(privateDir)).rejects.toThrow('pairing-directory-unsafe');
    await fixtureDirectoryMode(directory, 0o755);
    await expect(prepareStateDirectory(directory)).rejects.toThrow('pairing-directory-unsafe');
    await fixtureDirectoryMode(directory, 0o700);
    expect(await prepareStateDirectory(directory)).toBe(directory);
  }, 20_000);
});
