import { execFile } from 'node:child_process';
import { chmod, link, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativePrivateFiles, stopPrivateFilesHelper } from '../../../packages/mcp/src/node-private-files';
import { fixtureDirectoryMode, privateTestDirectory } from '../../../packages/mcp/src/node-private-files.test-support';
import { readMobileSecretFile } from './mobile-private-file';

const directories: string[] = [];
const prefix = join(tmpdir(), 'keepany-mobile-secret-');
async function directory() { const value = await privateTestDirectory('keepany-mobile-secret-'); directories.push(value); return value; }
async function file(path: string, text = 'synthetic private pairing text') {
  if (process.platform === 'win32') await nativePrivateFiles.createFile(path, text);
  else await writeFile(path, text, { mode: 0o600, flag: 'wx' });
}
afterEach(async () => {
  vi.restoreAllMocks(); stopPrivateFilesHelper();
  for (const path of directories.splice(0)) {
    // Delete only the resolved unique temporary directories created by this test.
    if (!isAbsolute(path) || !resolve(path).startsWith(resolve(prefix))) throw Error('test-cleanup-boundary');
    await rm(path, { recursive: true, force: true, maxRetries: 20, retryDelay: 25 });
  }
});

describe('strict read-only mobile secret file import', () => {
  it('reads only a bounded private UTF-8 file and leaves it in place without parsing its format', async () => {
    const dir = await directory(), path = join(dir, 'pairing.json');
    const text = '普通合成文件。Unknown format is validated by the caller.';
    await file(path, text); expect(await readMobileSecretFile(path)).toEqual({ text });
    expect(await readFile(path, 'utf8')).toBe(text);
    await expect(readMobileSecretFile('relative.json')).rejects.toThrow('mobile-mcp-file-unsafe');
    await expect(readMobileSecretFile(join(dir, 'missing.json'))).rejects.toThrow('mobile-mcp-file-unsafe');
    await expect(readMobileSecretFile(dir)).rejects.toThrow('mobile-mcp-file-unsafe');
    await expect(readMobileSecretFile(`${path}\0suffix`)).rejects.toThrow('mobile-mcp-file-unsafe');
  });

  it('rejects symlinks, hardlinks, invalid UTF-8, empty and oversize files without logging content', async () => {
    const dir = await directory(), path = join(dir, 'pairing.json'); await file(path);
    await symlink(path, join(dir, 'symlink.json'));
    await expect(readMobileSecretFile(join(dir, 'symlink.json'))).rejects.toThrow('mobile-mcp-file-unsafe');
    await link(path, join(dir, 'hardlink.json'));
    await expect(readMobileSecretFile(path)).rejects.toThrow('mobile-mcp-file-unsafe');
    for (const [name, bytes] of [['utf8', Buffer.from([0xc3, 0x28])], ['empty', Buffer.alloc(0)], ['oversize', Buffer.alloc(65537, 65)]] as const) {
      const invalid = join(dir, `${name}.json`); await file(invalid); await writeFile(invalid, bytes);
      const error = await readMobileSecretFile(invalid).catch(e => e);
      expect(error.message).toBe('mobile-mcp-file-unsafe'); expect(error.cause).toBeUndefined();
    }
    const exact = join(dir, 'exact.json'); await file(exact, 'x'.repeat(65536));
    expect((await readMobileSecretFile(exact)).text.length).toBe(65536);
  });

  it.skipIf(process.platform === 'win32')('requires POSIX owner 0600 / parent 0700 and rejects symlink ancestors', async () => {
    const dir = await directory(), child = join(dir, 'child'); await mkdir(child, { mode: 0o700 });
    const path = join(child, 'pairing.json'); await file(path);
    await chmod(path, 0o644); await expect(readMobileSecretFile(path)).rejects.toThrow('mobile-mcp-file-unsafe');
    await chmod(path, 0o600); await chmod(child, 0o755); await expect(readMobileSecretFile(path)).rejects.toThrow('mobile-mcp-file-unsafe');
    await chmod(child, 0o700); await symlink(child, join(dir, 'linked'));
    await expect(readMobileSecretFile(join(dir, 'linked/pairing.json'))).rejects.toThrow('mobile-mcp-file-unsafe');
  });

  it.skipIf(process.platform !== 'win32')('rejects a non-owner ACL and junction/ADS without chmod or ambient trust changes', async () => {
    const dir = await directory(), path = join(dir, 'pairing.json'); await file(path);
    const systemRoot = process.env.SystemRoot; if (!systemRoot) throw Error('windows-test-environment');
    const script = "$ErrorActionPreference='Stop';$p=$env:KEEPANY_MOBILE_TEST_FILE;$a=[IO.File]::GetAccessControl($p);$a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'Read','Allow'));[IO.File]::SetAccessControl($p,$a)";
    await promisify(execFile)(join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, env: { ...process.env, KEEPANY_MOBILE_TEST_FILE: path } });
    await expect(readMobileSecretFile(path)).rejects.toThrow('mobile-mcp-file-unsafe');
    const target = join(dir, 'child'); await nativePrivateFiles.createDirectory(target); await file(join(target, 'input.json'));
    await symlink(target, join(dir, 'junction'), 'junction');
    await expect(readMobileSecretFile(join(dir, 'junction/input.json'))).rejects.toThrow('mobile-mcp-file-unsafe');
    await expect(readMobileSecretFile(`${join(target, 'input.json')}:stream`)).rejects.toThrow('mobile-mcp-file-unsafe');
  }, 15_000);

  it.skipIf(process.platform !== 'win32')('rejects real replacement between the checked identity and the native read, preserving the replacement', async () => {
    const dir = await directory(), path = join(dir, 'pairing.json'), old = join(dir, 'old.json'); await file(path, 'original synthetic secret');
    const original = nativePrivateFiles.readMobileSecret.bind(nativePrivateFiles);
    vi.spyOn(nativePrivateFiles, 'readMobileSecret').mockImplementationOnce(async actualPath => {
      await rename(actualPath, old); await file(actualPath, 'replacement synthetic secret');
      return original(actualPath);
    });
    await expect(readMobileSecretFile(path)).rejects.toThrow('mobile-mcp-file-unsafe');
    expect(await readFile(path, 'utf8')).toBe('replacement synthetic secret');
    expect(await readFile(old, 'utf8')).toBe('original synthetic secret');
  });

  it.skipIf(process.platform !== 'win32')('requires the leaf parent directory to retain its private ACL', async () => {
    const dir = await directory(), path = join(dir, 'pairing.json'); await file(path);
    try {
      await fixtureDirectoryMode(dir, 0o755);
      await expect(readMobileSecretFile(path)).rejects.toThrow('mobile-mcp-file-unsafe');
    } finally { await fixtureDirectoryMode(dir, 0o700); }
    expect((await readMobileSecretFile(path)).text).toBe('synthetic private pairing text');
  }, 15_000);

  it.skipIf(process.platform !== 'win32')('rejects replacement after the native snapshot and catches an ABA read through its returned FileID', async () => {
    const dir = await directory(), path = join(dir, 'pairing.json'), old = join(dir, 'old.json'), replacement = join(dir, 'replacement.json');
    await file(path, 'original'); await file(replacement, 'different');
    const original = nativePrivateFiles.readMobileSecret.bind(nativePrivateFiles);
    vi.spyOn(nativePrivateFiles, 'readMobileSecret').mockImplementationOnce(async actualPath => {
      await rename(actualPath, old); await rename(replacement, actualPath);
      const value = await original(actualPath);
      await rename(actualPath, replacement); await rename(old, actualPath);
      return value;
    });
    await expect(readMobileSecretFile(path)).rejects.toThrow('mobile-mcp-file-unsafe');
    expect(await readFile(path, 'utf8')).toBe('original');
  });
});
