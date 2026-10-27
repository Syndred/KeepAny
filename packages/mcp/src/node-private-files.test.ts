import { execFile } from 'node:child_process';
import { chmod, link, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { nativePrivateFiles as native, stopPrivateFilesHelper } from './node-private-files';

const directories: string[] = [];
async function privateDirectory() {
  const directory = join(tmpdir(), `keepany-native-test-${crypto.randomUUID()}`);
  await native.createDirectory(directory); directories.push(directory); return directory;
}
afterEach(async () => {
  stopPrivateFilesHelper();
  // The helper disposes directory handles on pipe EOF before fixture cleanup.
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 25 });
});

describe.runIf(process.platform === 'win32')('Windows handle based private files', { timeout: 15_000 }, () => {
  it('creates private ACLs, rejects links/ADS and compares real file identities', async () => {
    const directory = await privateDirectory(), path = join(directory, 'input.json');
    await native.createFile(path, 'synthetic');
    const identity = await native.inspect(path);
    expect(identity).toMatch(/^[A-F0-9]{8}:[A-F0-9]{16}$/);
    expect(await native.readRequest(path)).toBe('synthetic');
    await expect(native.createFile(path, 'replacement')).rejects.toThrow('EEXIST');
    await symlink(path, join(directory, 'link.json'));
    await expect(native.readRequest(join(directory, 'link.json'))).rejects.toThrow('unsafe-file');
    await link(path, join(directory, 'hard.json'));
    await expect(native.readRequest(path)).rejects.toThrow('unsafe-file');
    await expect(native.readRequest(`${path}:stream`)).rejects.toThrow('unsafe-path');
    const second = join(directory, 'second.json');
    await native.createFile(second, 'second');
    expect(await native.inspect(second)).not.toBe(identity);
  }, 15_000);

  it('rejects an Everyone ACE using ACL readback from the opened file', async () => {
    const directory = await privateDirectory(), path = join(directory, 'input.json');
    await native.createFile(path, 'synthetic');
    const script = "$ErrorActionPreference='Stop';$p=$env:KEEPANY_TEST_ACL_PATH;$a=[IO.File]::GetAccessControl($p);$r=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'Read','Allow');$a.AddAccessRule($r);[IO.File]::SetAccessControl($p,$a)";
    const systemRoot = process.env.SystemRoot;
    if (!systemRoot) throw Error('windows-helper-unavailable');
    await promisify(execFile)(join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, env: { ...process.env, KEEPANY_TEST_ACL_PATH: path } });
    await expect(native.inspect(path)).rejects.toThrow('unsafe-acl');
    // Request proposals have the original POSIX owner-only contract; secrets do not.
    expect(await native.readRequest(path)).toBe('synthetic');
  }, 15_000);

  it('fails closed for other principals, null/empty DACLs, denies and mismatched owners', async () => {
    const directory = await privateDirectory();
    const names = ['users', 'authenticated', 'other', 'null', 'empty', 'deny', 'owner'];
    for (const name of names) await native.createFile(join(directory, `${name}.json`), 'synthetic');
    const systemRoot = process.env.SystemRoot;
    if (!systemRoot) throw Error('windows-helper-unavailable');
    const script = "$ErrorActionPreference='Stop';$dir=$env:KEEPANY_TEST_ACL_DIR;$user=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;foreach($n in @('users','authenticated','other','null','empty','deny','owner')){$p=[IO.Path]::Combine($dir,$n+'.json');$a=[IO.File]::GetAccessControl($p);switch($n){users{$sid='S-1-5-32-545'}authenticated{$sid='S-1-5-11'}other{$sid='S-1-5-21-1-2-3-65500'}null{$a.SetSecurityDescriptorSddlForm('O:'+$user+'D:NO_ACCESS_CONTROL')}empty{$a.SetSecurityDescriptorSddlForm('O:'+$user+'D:P')}deny{$a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'Read','Deny'))}owner{$a.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))}};if($n -in @('users','authenticated','other')){$a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'Read','Allow'))};[IO.File]::SetAccessControl($p,$a)}";
    const executable = join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    try {
      await promisify(execFile)(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, env: { ...process.env, KEEPANY_TEST_ACL_DIR: directory } });
      for (const name of names) await expect(native.inspect(join(directory, `${name}.json`)), name).rejects.toThrow();
    } finally {
      // Restore only these exact synthetic negative-control objects for cleanup.
      const restore = "$ErrorActionPreference='Stop';$u=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;foreach($n in @('users','authenticated','other','null','empty','deny','owner')){$p=[IO.Path]::Combine($env:KEEPANY_TEST_ACL_DIR,$n+'.json');$a=[Security.AccessControl.FileSecurity]::new();$a.SetSecurityDescriptorSddlForm('D:P(A;;FA;;;'+$u+')(A;;FA;;;SY)',[Security.AccessControl.AccessControlSections]::Access);[IO.File]::SetAccessControl($p,$a)}";
      await promisify(execFile)(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(restore, 'utf16le').toString('base64')], { windowsHide: true, env: { ...process.env, KEEPANY_TEST_ACL_DIR: directory } });
    }
  }, 15_000);

  it('fails closed when the fixed system helper cannot start', async () => {
    const directory = await privateDirectory();
    stopPrivateFilesHelper();
    const saved = process.env.SystemRoot;
    try { process.env.SystemRoot = join(directory, 'missing-system-root'); await expect(native.checkDirectory(directory)).rejects.toThrow('windows-helper-unavailable'); }
    finally { process.env.SystemRoot = saved; stopPrivateFilesHelper(); }
  });

  it('rejects junction ancestors and prevents both leaf and ancestor directory replacement', async () => {
    const directory = await privateDirectory(), child = join(directory, 'child');
    await native.createDirectory(child); await native.createFile(join(child, 'input.json'), 'synthetic');
    const outer = await mkdtemp(join(tmpdir(), 'keepany-native-junction-')); directories.push(outer);
    await symlink(directory, join(outer, 'junction'), 'junction');
    await expect(native.readRequest(join(outer, 'junction/child/input.json'))).rejects.toThrow('unsafe-file');
    const held = await native.holdDirectory(child);
    try {
      await expect(rename(child, join(directory, 'replaced'))).rejects.toMatchObject({ code: expect.stringMatching(/^(EPERM|EBUSY|EACCES)$/) });
      await expect(rename(directory, `${directory}-replaced`)).rejects.toMatchObject({ code: expect.stringMatching(/^(EPERM|EBUSY|EACCES)$/) });
      expect(await native.readRequest(join(child, 'input.json'))).toBe('synthetic');
    } finally { await held.release(); }
  });

  it('pairs with delete-on-close and preserves a replacement path', async () => {
    const directory = await privateDirectory(), path = join(directory, 'pair.json');
    const lease = await native.pairing(path, 'synthetic');
    expect(await readFile(path, 'utf8')).toBe('synthetic');
    await rename(path, join(directory, 'original.json'));
    await writeFile(path, 'replacement');
    await lease.release();
    expect(await readFile(path, 'utf8')).toBe('replacement');
    await expect(readFile(join(directory, 'original.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('serializes exclusive transactions and performs durable atomic replacement', async () => {
    const directory = await privateDirectory(), path = join(directory, 'authority.json');
    const first = await native.transaction(path);
    try {
      expect(first.data).toBeNull();
      await expect(native.transaction(path)).rejects.toThrow('EEXIST');
      await first.commit('{"generation":1}');
      await first.commit('{"generation":2}');
      expect(await native.readState(path)).toBe('{"generation":2}');
      await native.inspect(path);
      await expect(rename(directory, `${directory}-replaced`)).rejects.toMatchObject({ code: expect.stringMatching(/^(EPERM|EBUSY|EACCES)$/) });
    } finally { await first.release(); }
    const next = await native.transaction(path);
    try {expect(next.data).toBe('{"generation":2}');}finally{await next.release();}
  });

  it('renames the held tmp identity even when the same user replaces its old path', async () => {
    const directory = await privateDirectory(), path = join(directory, 'authority.json');
    const transaction = await native.transaction(path);
    try {
      const prepared = await transaction.prepare('original transaction');
      const moved = join(directory, 'moved-real-tmp.json');
      await rename(prepared.path, moved);
      await writeFile(prepared.path, 'attacker replacement');
      await transaction.commit();
      expect(await native.readState(path)).toBe('original transaction');
      expect(await native.inspect(path)).toBe(prepared.identity);
      expect(await readFile(prepared.path, 'utf8')).toBe('attacker replacement');
      await expect(readFile(moved)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await transaction.release(); }
  });

  it('denies same-user writes to prepared state and the live pairing secret', async () => {
    const directory = await privateDirectory(), path = join(directory, 'authority.json');
    const transaction = await native.transaction(path);
    try {
      const prepared = await transaction.prepare('exact prepared payload');
      await expect(writeFile(prepared.path, 'changed after prepare')).rejects.toMatchObject({ code: expect.stringMatching(/^(EPERM|EBUSY|EACCES)$/) });
      await transaction.commit();
      expect(await native.readState(path)).toBe('exact prepared payload');
    } finally { await transaction.release(); }
    const pairingPath = join(directory, 'pairing.json'), pairing = await native.pairing(pairingPath, 'synthetic pairing');
    try {
      await expect(writeFile(pairingPath, 'changed pairing')).rejects.toMatchObject({ code: expect.stringMatching(/^(EPERM|EBUSY|EACCES)$/) });
      expect(await readFile(pairingPath, 'utf8')).toBe('synthetic pairing');
    } finally { await pairing.release(); }
  });

  it('accepts the exact UTF-8 boundary and rejects boundary+1 before replacing any state', async () => {
    const directory = await privateDirectory(), path = join(directory, 'authority.json');
    const limit = 8 * 1024 * 1024;
    // Three-byte characters make a code-unit-only bound fail this negative control.
    const exact = '中'.repeat(Math.floor(limit / 3)) + 'x'.repeat(limit % 3);
    expect(Buffer.byteLength(exact)).toBe(limit);
    const first = await native.transaction(path);
    try { await first.commit(exact); } finally { await first.release(); }
    const identity = await native.inspect(path);
    const next = await native.transaction(path);
    try { await expect(next.commit(`${exact}x`)).rejects.toThrow('authority-file-too-large'); }
    finally { await next.release(); }
    expect(await native.inspect(path)).toBe(identity);
    expect(await native.readState(path)).toBe(exact);
  }, 30_000);

  it('preserves confirmed identity/content and removes its tmp after a replacement failure', async () => {
    const directory = await privateDirectory(), path = join(directory, 'authority.json');
    const first = await native.transaction(path);
    try { await first.commit('confirmed'); } finally { await first.release(); }
    const identity = await native.inspect(path);
    await chmod(path, 0o400);
    const next = await native.transaction(path);
    let temporary = '';
    try {
      temporary = (await next.prepare('unconfirmed')).path;
      await expect(next.commit()).rejects.toThrow();
    } finally { await next.release(); await chmod(path, 0o600); }
    expect(await native.inspect(path)).toBe(identity);
    expect(await native.readState(path)).toBe('confirmed');
    await expect(readFile(temporary)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
