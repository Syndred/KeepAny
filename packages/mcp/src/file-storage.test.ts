import { afterEach, describe, expect, it } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { open, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { FileAuthorityStorage } from './file-storage';
import { McpAuthority } from './authority';
import { assertPrivateTestFile, privateTestDirectory } from './node-private-files.test-support';
import { nativePrivateFiles, stopPrivateFilesHelper } from './node-private-files';
import { readFile } from 'node:fs/promises';

const dirs: string[] = [];
afterEach(async () => { stopPrivateFilesHelper(); for (const directory of dirs.splice(0)) await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 25 }); });

describe('local authority state', () => {
  it('persists grants, revocation and metadata-only audit across instances', async () => {
    const dir = await privateTestDirectory('keepany-mcp-');
    dirs.push(dir);
    const path = join(dir, 'state.json');
    const first = new McpAuthority(new FileAuthorityStorage(path));
    const issued = await first.issueGrant({ assetIds: ['asset-1'], readFields: ['name'], ttlMs: 60_000 });
    const second = new McpAuthority(new FileAuthorityStorage(path));
    await expect(second.requireGrant(issued.id, issued.secret)).resolves.toMatchObject({ id: issued.id });
    if (process.platform === 'win32') await assertPrivateTestFile(path, expect);
    else expect((await stat(path)).mode & 0o077).toBe(0);
    await second.revokeGrant(issued.id);
    await expect(first.requireGrant(issued.id, issued.secret)).rejects.toThrow('grant-denied');
    expect(JSON.stringify(await first.auditEntries(issued.id))).not.toContain(issued.secret);
  }, 20_000);

  it('preserves every metadata row when separate processes concurrently replace state', async () => {
    const dir = await privateTestDirectory('keepany-mcp-concurrent-'); dirs.push(dir);
    const path = join(dir, 'state.json');
    const script = "import {FileAuthorityStorage} from './packages/mcp/src/file-storage.ts';import {stopPrivateFilesHelper} from './packages/mcp/src/node-private-files.ts';const s=new FileAuthorityStorage(process.argv[1]);try{for(let i=0;i<8;i++)await s.update(async state=>{await new Promise(r=>setTimeout(r,8));state.audit.push({id:process.argv[2]+'-'+i,at:i,grantId:'synthetic',action:'list',outcome:'allowed'});});}finally{stopPrivateFilesHelper();}";
    await Promise.all(['a', 'b', 'c'].map(id => promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script, path, id], { windowsHide: true })));
    const state = await new FileAuthorityStorage(path).read();
    expect(state.audit).toHaveLength(24);
    expect(new Set(state.audit.map(row => row.id)).size).toBe(24);
    expect(state.grants).toEqual([]);
    expect(state.operations).toEqual([]);
  }, 30_000);

  it.runIf(process.platform === 'win32')('completes the next exclusive update while a released lock still has shared readers', async () => {
    const dir = await privateTestDirectory('keepany-mcp-delete-pending-'); dirs.push(dir);
    const path = join(dir, 'state.json'), storage = new FileAuthorityStorage(path);
    await storage.update(state => { state.audit.push({ id: 'confirmed-before-contention', at: 1, grantId: 'synthetic', action: 'list', outcome: 'allowed' }); });
    const owner = await nativePrivateFiles.transaction(path);
    // A shared-delete observer extends the real Windows delete-pending window
    // between the releasing owner's disposition change and its final close.
    const observer = await open(`${path}.lock`, 'r');
    try {
      await owner.release();
      await expect(storage.update(state => {
        state.audit.push({ id: 'confirmed-after-contention', at: 2, grantId: 'synthetic', action: 'list', outcome: 'allowed' });
      })).resolves.toBeUndefined();
      expect(observer.fd).toBeGreaterThanOrEqual(0);
      expect((await storage.read()).audit.map(row => row.id)).toEqual(['confirmed-before-contention', 'confirmed-after-contention']);
    } finally { await observer.close(); await owner.release(); }
  }, 20_000);

  it('keeps a crashed owner lock and fails closed without altering confirmed state', async () => {
    const dir = await privateTestDirectory('keepany-mcp-crash-'); dirs.push(dir);
    const path = join(dir, 'state.json');
    const storage = new FileAuthorityStorage(path);
    await storage.update(state => { state.audit.push({ id: 'confirmed', at: 1, grantId: 'synthetic', action: 'list', outcome: 'allowed' }); });
    const before = await storage.read();
    const script = "import {nativePrivateFiles as n} from './packages/mcp/src/node-private-files.ts';import {open} from 'node:fs/promises';const p=process.argv[1];if(process.platform==='win32')await n.transaction(p);else await open(p+'.lock','wx',0o600);process.stdout.write('ready\\n');await new Promise(()=>{});";
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script, path], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      await new Promise<void>((resolve, reject) => { const timeout = setTimeout(() => reject(Error('child-ready-timeout')), 10_000); child.stdout.once('data', () => { clearTimeout(timeout); resolve(); }); child.once('error', reject); });
      const closed = once(child, 'close'); child.kill('SIGKILL'); await closed;
      await expect(storage.update(state => { state.audit.length = 0; })).rejects.toThrow('authority-locked');
      expect(await storage.read()).toEqual(before);
    } finally { child.kill('SIGKILL'); }
  }, 30_000);

  it.runIf(process.platform === 'win32')('rejects an oversized update without replacing the last complete authority history', async () => {
    const dir = await privateTestDirectory('keepany-mcp-size-'); dirs.push(dir);
    const path = join(dir, 'state.json'), storage = new FileAuthorityStorage(path);
    await storage.update(state => { state.audit.push({ id: 'original-audit', at: 1, grantId: 'synthetic', action: 'list', outcome: 'allowed' }); });
    const before = await readFile(path, 'utf8'), identity = await nativePrivateFiles.inspect(path);
    await expect(storage.update(state => { state.audit.push({ id: '中'.repeat(3 * 1024 * 1024), at: 2, grantId: 'synthetic', action: 'list', outcome: 'allowed' }); })).rejects.toThrow('authority-file-too-large');
    expect(await nativePrivateFiles.inspect(path)).toBe(identity);
    expect(await readFile(path, 'utf8')).toBe(before);
    expect((await storage.read()).audit.map(row => row.id)).toEqual(['original-audit']);
  }, 30_000);

  it('reads back a committed operation after force terminating its acknowledging writer', async () => {
    const dir = await privateTestDirectory('keepany-mcp-ack-'); dirs.push(dir);
    const path = join(dir, 'state.json');
    const script = "import {FileAuthorityStorage} from './packages/mcp/src/file-storage.ts';const s=new FileAuthorityStorage(process.argv[1]);await s.update(state=>{state.operations.push({operationId:'confirmed-op',grantId:'grant',previewId:'preview',patchHash:'hash',assetId:'asset',state:'applied',createdAt:1,completedAt:2});});process.stdout.write('committed\\n');setInterval(()=>{},1000);";
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script, path], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(Error('child-commit-timeout')), 10_000); child.stdout.once('data', () => { clearTimeout(timer); resolve(); }); child.once('error', reject); });
      const closed = once(child, 'close'); child.kill('SIGKILL'); await closed;
      expect((await new FileAuthorityStorage(path).read()).operations).toEqual([{ operationId: 'confirmed-op', grantId: 'grant', previewId: 'preview', patchHash: 'hash', assetId: 'asset', state: 'applied', createdAt: 1, completedAt: 2 }]);
    } finally { child.kill('SIGKILL'); }
  }, 30_000);
});
