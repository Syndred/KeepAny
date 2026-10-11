import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';

// Acceptance must exercise the shipped server from an already verified,
// extracted package. Never fall back to Vite or development source.
let directory;
let temporary;
if (process.env.KEEPANY_PREVIEW_DIRECTORY) directory = resolve(process.env.KEEPANY_PREVIEW_DIRECTORY);
else if (process.env.KEEPANY_PREVIEW_ARCHIVE) {
  const archive = resolve(process.env.KEEPANY_PREVIEW_ARCHIVE);
  const bytes = await readFile(archive);
  const expected = (await readFile(`${archive}.sha256`, 'utf8')).split(/\s+/)[0];
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw Error('Portable archive checksum mismatch.');
  const files = unzipSync(bytes);
  const roots = new Set();
  for (const path of Object.keys(files)) {
    if (path.startsWith('/') || path.includes('\\') || path.split('/').some(part => part === '..' || part === '.')) throw Error('Unsafe portable archive path.');
    roots.add(path.split('/')[0]);
  }
  if (roots.size !== 1) throw Error('Portable archive must have one root folder.');
  temporary = await mkdtemp(join(tmpdir(), 'keepany-portable-e2e-'));
  for (const [path, bytes] of Object.entries(files)) {
    const destination = join(temporary, path);
    await mkdir(join(destination, '..'), { recursive: true });
    await writeFile(destination, bytes);
  }
  directory = join(temporary, [...roots][0]);
} else throw Error('Set KEEPANY_PREVIEW_DIRECTORY or KEEPANY_PREVIEW_ARCHIVE.');
const release = JSON.parse(await readFile(join(directory, 'RELEASE.json'), 'utf8'));
if (release.schema !== 'keepany.portable-preview.v1') throw Error('Not a portable preview package.');
const child = spawn(process.execPath, [join(directory, 'preview-server.mjs'), 'start', '--port', process.env.KEEPANY_RELEASE_TEST_PORT ?? '4391', '--no-open'], { cwd: directory, stdio: 'inherit' });
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; child.kill(signal); });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', async code => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
  process.exitCode = stopping ? 0 : code ?? 1;
});
