import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { windowsPrivateFilesSource } from './windows-private-files';

type Reply = { id: number; value?: unknown; error?: string };
type Pending = { resolve(value: unknown): void; reject(reason: Error): void; timer: ReturnType<typeof setTimeout> };
let helper: ChildProcessWithoutNullStreams | undefined;
let sequence = 0;
const pending = new Map<number, Pending>();
const retained = new Set<string>();
let idle: ReturnType<typeof setTimeout> | undefined;

function unavailable(code: string) { return Object.assign(new Error(code), { code }); }
function scheduleIdle() {
  if (idle) clearTimeout(idle);
  const child = helper;
  if (child && pending.size === 0 && retained.size === 0) idle = setTimeout(() => {
    if (helper === child && retained.size === 0 && pending.size === 0) { helper = undefined; child.stdin.end(); }
  }, 2_000);
}
function start() {
  if (helper) return helper;
  if (process.platform !== 'win32') throw unavailable('windows-helper-unavailable');
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !/^[a-z]:\\[^\r\n]+$/i.test(systemRoot)) throw unavailable('windows-helper-unavailable');
  // This executable and bootstrap are fixed. No request path/content is executable code.
  const executable = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const bootstrap = "$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);try{Add-Type -ReferencedAssemblies System.Web.Extensions -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::ReadLine())));[KeepAnyPrivateFiles]::Run()}catch{[Console]::Error.WriteLine('windows-helper-unavailable');exit 1}";
  const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(bootstrap, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  helper = child;
  child.stdin.write(`${Buffer.from(windowsPrivateFilesSource).toString('base64')}\n`);
  // Native diagnostics can contain local paths; expose only stable error codes.
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    let reply: Reply;
    try { reply = JSON.parse(line) as Reply; } catch { child.kill(); return; }
    const item = pending.get(reply.id);
    if (!item) return;
    clearTimeout(item.timer); pending.delete(reply.id);
    if (reply.error) item.reject(unavailable(reply.error)); else item.resolve(reply.value);
  });
  const fail = () => {
    if (helper !== child) return;
    helper = undefined; retained.clear();
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(unavailable('windows-helper-unavailable')); }
    pending.clear();
  };
  child.once('error', fail); child.once('close', fail);
  return child;
}

async function call<T>(op: string, data: Record<string, unknown> = {}): Promise<T> {
  if (idle) clearTimeout(idle);
  const child = start();
  const id = ++sequence;
  try {
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(unavailable('windows-helper-timeout')); }, 30_000);
      pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      child.stdin.write(`${JSON.stringify({ id, op, ...data })}\n`, error => { if (error) { pending.delete(id); clearTimeout(timer); reject(unavailable('windows-helper-unavailable')); } });
    });
  } finally {
    // Do not keep test/CLI processes alive, and never close a live pairing lease.
    scheduleIdle();
  }
}

async function lease(op: string, data: Record<string, unknown>) {
  const token = await call<string>(op, data); retained.add(token);
  let released = false;
  return {
    async release() { if (released) return; released = true; try { await call('release', { token }); } finally { retained.delete(token); scheduleIdle(); } },
    releaseOnExit() { stopPrivateFilesHelper(); },
  };
}

export function stopPrivateFilesHelper() { if (idle) clearTimeout(idle); const child = helper; if (child && pending.size === 0) { helper = undefined; retained.clear(); child.stdin.end(); } }
process.once('exit', () => { helper?.stdin.destroy(); });

export const nativePrivateFiles = {
  createDirectory(path: string) { return call<void>('createDirectory', { path }); },
  checkDirectory(path: string) { return call<void>('checkDirectory', { path }); },
  readRequest(path: string) { return call<string>('readRequest', { path }); },
  readState(path: string) { return call<string | null>('readState', { path }); },
  readMobileSecret(path: string) { return call<{ text: string; identity: string }>('readMobileSecret', { path }); },
  inspect(path: string) { return call<string>('inspect', { path }); },
  createFile(path: string, data: string) { return call<string>('createFile', { path, data }); },
  pairing(path: string, data: string) { return lease('pairing', { path, data }); },
  holdDirectory(path: string) { return lease('holdDirectory', { path }); },
  async transaction(path: string) {
    const result = await call<{ token: string; data: string | null }>('begin', { path });
    retained.add(result.token);
    let released = false;
    return {
      data: result.data,
      prepare(data: string) {
        if (Buffer.byteLength(data, 'utf8') > 8 * 1024 * 1024) return Promise.reject(unavailable('authority-file-too-large'));
        return call<{ path: string; identity: string }>('prepare', { token: result.token, data });
      },
      async commit(data?: string) {
        if (data !== undefined) {
          if (Buffer.byteLength(data, 'utf8') > 8 * 1024 * 1024) throw unavailable('authority-file-too-large');
          await call('prepare', { token: result.token, data });
        }
        await call<void>('commit', { token: result.token });
      },
      async release() { if (released) return; released = true; try { await call('release', { token: result.token }); } finally { retained.delete(result.token); scheduleIdle(); } },
    };
  },
};
