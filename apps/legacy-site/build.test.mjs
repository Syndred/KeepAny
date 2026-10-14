import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildLegacySite, legacyStaticFiles, parseLegacyOptions } from '../../scripts/build-legacy-site.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fixture;
let oldSource;
let publicSource;
let output;

async function writeSource(directory, prefix) {
  await mkdir(join(directory, 'assets'), { recursive: true });
  await mkdir(join(directory, 'zh'), { recursive: true });
  for (const path of legacyStaticFiles) {
    const canonical = `https://syndred.github.io/${prefix}/${path.startsWith('zh/') ? 'zh/' : ''}`;
    const value = path.endsWith('.html') ? `<html><head><link rel="canonical" href="${canonical}"/></head><body><h1>StackPerch</h1></body></html>` : `${prefix}:${path}\0bytes`;
    await writeFile(join(directory, path), value);
  }
  // Deliberately unrelated data must never enter either deployment artifact.
  await writeFile(join(directory, 'private.kdbx'), 'not public');
}

beforeEach(async () => {
  await mkdir(join(root, 'dist'), { recursive: true });
  fixture = await mkdtemp(join(root, 'dist/legacy-builder-test-'));
  oldSource = join(fixture, 'old');
  publicSource = join(fixture, 'new');
  output = join(fixture, 'output');
  await writeSource(oldSource, 'KeepAny');
  await writeSource(publicSource, 'StackPerch');
});
afterEach(async () => { await rm(fixture, { recursive: true, force: true }); });

describe('compatibility builder', () => {
  it('copies only the published whitelist byte-for-byte to both mirror entries', async () => {
    const result = await buildLegacySite({ mode: 'mirror', mirrorSource: oldSource, output });
    expect(result.prefixes).toEqual(['KeepAny', 'StackPerch']);
    for (const prefix of result.prefixes) for (const file of legacyStaticFiles) expect(await readFile(join(output, prefix, file))).toEqual(await readFile(join(oldSource, file)));
    await expect(stat(join(output, 'KeepAny/private.kdbx'))).rejects.toThrow();
    expect(await readFile(join(output, '.nojekyll'), 'utf8')).toBe('');
    expect(JSON.parse(await readFile(join(output, 'TRACE.json'), 'utf8'))).toMatchObject({ mode: 'mirror', sourceRepository: 'https://github.com/Syndred/StackPerch', upstream: { license: 'MIT' } });
    expect(await readFile(join(output, 'LICENSE'), 'utf8')).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
  });

  it('removes the temporary new-name mirror and preserves old assets in redirect mode', async () => {
    await buildLegacySite({ mode: 'mirror', mirrorSource: oldSource, output });
    await buildLegacySite({ mode: 'redirect', mirrorSource: oldSource, publicSource, output });
    await expect(stat(join(output, 'StackPerch'))).rejects.toThrow();
    for (const file of legacyStaticFiles.filter(path => path.startsWith('assets/'))) expect(await readFile(join(output, 'KeepAny', file))).toEqual(await readFile(join(oldSource, file)));
    for (const file of ['robots.txt', 'sitemap.xml', 'llms.txt']) {
      expect(await readFile(join(output, file))).toEqual(await readFile(join(publicSource, file)));
      expect(await readFile(join(output, 'KeepAny', file))).toEqual(await readFile(join(publicSource, file)));
    }
    expect(await readFile(join(output, 'KeepAny/zh/index.html'), 'utf8')).toContain('https://syndred.github.io/StackPerch/zh/');
    expect(await readFile(join(output, 'assets/redirect-template-LICENSE.txt'), 'utf8')).toContain('MIT License');
  });

  it('rejects runtime or wrong-canonical sources before touching a completed output', async () => {
    await mkdir(output);
    await writeFile(join(output, 'retained.txt'), 'previous successful deployment');
    await writeFile(join(publicSource, 'index.html'), '<h1>Application</h1><script type="module" src="private-app.js"></script>');
    await expect(buildLegacySite({ mode: 'redirect', mirrorSource: oldSource, publicSource, output })).rejects.toThrow('Only readable static documentation');
    expect(await readFile(join(output, 'retained.txt'), 'utf8')).toBe('previous successful deployment');
    await writeSource(publicSource, 'KeepAny');
    await expect(buildLegacySite({ mode: 'redirect', mirrorSource: oldSource, publicSource, output })).rejects.toThrow('fixed official StackPerch canonical');
  });

  it('rejects symlinks and overlapping or unsafe output directories', async () => {
    await rm(join(oldSource, 'assets/overview-en.png'));
    await symlink(join(oldSource, 'private.kdbx'), join(oldSource, 'assets/overview-en.png'));
    await expect(buildLegacySite({ mode: 'mirror', mirrorSource: oldSource, output })).rejects.toThrow('regular whitelist files');
    await expect(buildLegacySite({ mode: 'mirror', mirrorSource: oldSource, output: oldSource })).rejects.toThrow('must not overlap');
    await expect(buildLegacySite({ mode: 'mirror', mirrorSource: oldSource, output: root })).rejects.toThrow('dedicated directory under dist');
  });

  it('accepts only explicit modes and absolute static source directories', () => {
    expect(parseLegacyOptions(['--mode', 'mirror', '--mirror-source', oldSource])).toMatchObject({ mode: 'mirror', mirrorSource: oldSource });
    for (const args of [[], ['--mode', 'anything', '--mirror-source', oldSource], ['--mode', 'mirror', '--mirror-source', './relative'], ['--mode', 'mirror', '--mirror-source', oldSource, '--site-url', '//evil.example'], ['--mode', 'mirror', '--mirror-source', oldSource, '--public-source', publicSource], ['--mode', 'redirect', '--mirror-source', oldSource, '--public-source', 'relative'], ['--mode', 'mirror', '--mode', 'redirect'], ['--mode', 'mirror', '--mirror-source', oldSource, '--source-revision', 'bad-sha']]) expect(() => parseLegacyOptions(args)).toThrow();
  });
});
