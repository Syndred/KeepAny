import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { expect, test } from 'vitest';
import { deterministicPwaBuild } from '../../apps/web/pwa-build-order';

test('PWA generation preserves revisions and emits identical bytes for different filesystem orders', async () => {
  const root = await mkdtemp(join(tmpdir(), 'keepany-pwa-order-'));
  try {
    await mkdir(join(root, 'public', 'icons'), { recursive: true });
    await writeFile(join(root, 'index.html'), '<html><head><title>KeepAny PWA order fixture</title></head><body></body></html>');
    const scripts = ['Z.js', 'a.js', '_bridge.js'];
    for (const name of scripts) await writeFile(join(root, 'public', name), `/* ${name} */`);
    const icons = ['icons/Z.svg', 'icons/a.svg'];
    for (const name of icons) await writeFile(join(root, 'public', name), `<svg><!-- ${name} --></svg>`);
    const extra = [
      { url: 'icons/z-extra.svg', revision: 'extra-z' },
      { url: 'icons/A-extra.svg', revision: 'extra-A' },
    ];
    const results: string[] = [];
    for (const reversed of [false, true]) {
      const outDir = join(root, reversed ? 'reverse' : 'forward');
      await build({
        configFile: false, root, logLevel: 'silent',
        plugins: [VitePWA({
          ...deterministicPwaBuild,
          mode: 'production', injectRegister: null, manifest: false,
          includeAssets: reversed ? [...icons].reverse() : icons,
          workbox: {
            ...deterministicPwaBuild.workbox,
            globPatterns: ['*.js', '*.html'],
            additionalManifestEntries: reversed ? [...extra].reverse() : [...extra],
            // Model both OS enumeration orders before the production ordering policy.
            manifestTransforms: [async entries => ({
              manifest: reversed ? entries.reverse() : entries,
              warnings: [],
            }), ...deterministicPwaBuild.workbox.manifestTransforms],
          },
        })],
        build: { outDir, minify: false },
      });
      results.push(await readFile(join(outDir, 'sw.js'), 'utf8'));
    }
    expect(results[1]).toBe(results[0]);
    const match = results[0].match(/precacheAndRoute\((\[.*?\])/);
    if (!match) throw Error('Expected generated Workbox precache list');
    const entries = JSON.parse(match[1].replace(/\b(url|revision):/g, '"$1":')) as { url: string; revision: string | null }[];
    const expected = new Map<string, string | null>(extra.map(entry => [entry.url, entry.revision]));
    for (const name of [...scripts, ...icons, 'index.html']) {
      const bytes = await readFile(join(root, name === 'index.html' ? 'forward/index.html' : `public/${name}`));
      expected.set(name, createHash('md5').update(bytes).digest('hex'));
    }
    expect(entries.map(entry => entry.url)).toEqual([
      'Z.js', '_bridge.js', 'a.js', 'index.html',
      'icons/A-extra.svg', 'icons/Z.svg', 'icons/a.svg', 'icons/z-extra.svg',
    ]);
    expect(entries).toHaveLength(expected.size);
    expect(new Map(entries.map(entry => [entry.url, entry.revision]))).toEqual(expected);
    expect(new Set(entries.map(entry => entry.url)).size).toBe(entries.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
