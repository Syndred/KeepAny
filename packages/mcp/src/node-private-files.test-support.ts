// Synthetic fixtures only. Never imported by application code or the browser barrel.
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { nativePrivateFiles } from './node-private-files';

export async function privateTestDirectory(prefix: string) {
  if (process.platform !== 'win32') { const path = await mkdtemp(join(tmpdir(), prefix)); await chmod(path, 0o700); return path; }
  const path = join(tmpdir(), `${prefix}${crypto.randomUUID()}`);
  await nativePrivateFiles.createDirectory(path); return path;
}

export async function assertPrivateTestFile(path: string, expect: (value: unknown) => { toBe(value: unknown): void; toMatch(value: RegExp): void }) {
  if (process.platform === 'win32') expect(await nativePrivateFiles.inspect(path)).toMatch(/^[A-F0-9]{8}:[A-F0-9]{16}$/);
  else expect((await stat(path)).mode & 0o777).toBe(0o600);
}

export async function fixtureDirectoryMode(path: string, mode: number) {
  if (process.platform !== 'win32') return chmod(path, mode);
  const local = relative(tmpdir(), path);
  if (!isAbsolute(path) || local.startsWith('..') || isAbsolute(local) || !local.startsWith('keepany-')) throw Error('not-a-synthetic-fixture');
  // Only these generated temporary fixtures may have their ACL changed for controls.
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot) throw Error('windows-helper-unavailable');
  const script = "$ErrorActionPreference='Stop';$p=$env:KEEPANY_TEST_ACL_PATH;$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$s='O:'+$sid+'D:P(A;OICI;FA;;;'+$sid+')(A;OICI;FA;;;SY)';if($env:KEEPANY_TEST_ACL_PUBLIC -eq '1'){$s+='(A;OICI;GRGX;;;WD)'};$a=[Security.AccessControl.DirectorySecurity]::new();$a.SetSecurityDescriptorSddlForm($s);[IO.Directory]::SetAccessControl($p,$a)";
  await promisify(execFile)(join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, env: { ...process.env, KEEPANY_TEST_ACL_PATH: path, KEEPANY_TEST_ACL_PUBLIC: mode === 0o700 ? '0' : '1' } });
}
