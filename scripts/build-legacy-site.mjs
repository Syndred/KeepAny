import { build } from 'esbuild';
import { copyFile, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);
export const legacyStaticFiles = [
  'index.html', 'zh/index.html', 'assets/public.css', 'assets/overview-en.png',
  'assets/overview-zh.png', 'assets/stackperch.svg', 'assets/keepany.svg',
  'robots.txt', 'sitemap.xml', 'llms.txt',
];
const textFiles = ['robots.txt', 'sitemap.xml', 'llms.txt'];
const assetFiles = legacyStaticFiles.filter(path => path.startsWith('assets/'));

export function parseLegacyOptions(args) {
  const allowed = new Set(['--mode', '--mirror-source', '--public-source', '--source-revision']);
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!allowed.has(flag) || Object.hasOwn(values, flag) || !args[index + 1] || args[index + 1].startsWith('--')) throw Error(`Invalid argument: ${flag}`);
    values[flag] = args[index + 1];
  }
  if (!['mirror', 'redirect'].includes(values['--mode'])) throw Error('--mode must be mirror or redirect');
  if (!values['--mirror-source'] || !isAbsolute(values['--mirror-source'])) throw Error('--mirror-source must be an explicit absolute directory of published static documentation');
  if (values['--public-source'] && !isAbsolute(values['--public-source'])) throw Error('--public-source must be an absolute directory');
  if (values['--mode'] === 'mirror' && values['--public-source']) throw Error('--public-source applies only to redirect mode');
  if (values['--source-revision'] && !/^[a-f0-9]{40}$/.test(values['--source-revision'])) throw Error('--source-revision must be a full lowercase Git SHA');
  return { mode: values['--mode'], mirrorSource: resolve(values['--mirror-source']), publicSource: resolve(values['--public-source'] ?? join(root, 'dist/public-site')), output: join(root, 'dist/legacy-site'), sourceRevision: values['--source-revision'] };
}

async function validateStaticSource(source) {
  if (!isAbsolute(source) || !(await lstat(source)).isDirectory() || (await lstat(source)).isSymbolicLink()) throw Error('Static source must be an absolute regular directory');
  const sourceReal = await realpath(source);
  for (const forbidden of ['apps/web', 'release', 'dist/legacy-site']) {
    const directory = resolve(root, forbidden);
    if (sourceReal === directory || sourceReal.startsWith(`${directory}/`)) throw Error(`Static source cannot read ${forbidden}`);
  }
  for (const path of legacyStaticFiles) {
    const fullPath = join(source, path);
    for (const directory of new Set([dirname(fullPath), source])) {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw Error(`Static source contains a non-directory or symlink: ${path}`);
    }
    const info = await lstat(fullPath);
    if (!info.isFile() || info.isSymbolicLink()) throw Error(`Static source must contain regular whitelist files: ${path}`);
  }
  for (const path of ['index.html', 'zh/index.html']) {
    const html = await readFile(join(source, path), 'utf8');
    const scripts = html.match(/<script\b[^>]*>/gi) ?? [];
    if (!html.includes('<h1') || scripts.some(tag => !/type=["']application\/ld\+json["']/i.test(tag)) || /service-worker|serviceWorker|type=["']module["']/i.test(html)) throw Error(`Only readable static documentation is allowed: ${path}`);
  }
}

function validateOutput(output, sources) {
  const outputPath = resolve(output);
  const rel = relative(join(root, 'dist'), outputPath);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw Error('Compatibility output must be a dedicated directory under dist');
  for (const source of sources) {
    if (outputPath === resolve(source) || outputPath.startsWith(`${resolve(source)}/`) || resolve(source).startsWith(`${outputPath}/`)) throw Error('Compatibility source and output directories must not overlap');
  }
  return outputPath;
}

export async function buildLegacySite(options) {
  if (!['mirror', 'redirect'].includes(options.mode)) throw Error('Unsupported compatibility mode');
  const output = validateOutput(options.output ?? join(root, 'dist/legacy-site'), [options.mirrorSource, ...(options.mode === 'redirect' ? [options.publicSource] : [])]);
  // Validate all inputs before removing an older output or reading any content beyond the whitelist.
  await validateStaticSource(options.mirrorSource);
  if (options.mode === 'redirect') {
    await validateStaticSource(options.publicSource);
    for (const [path, canonical] of [['index.html', 'https://syndred.github.io/StackPerch/'], ['zh/index.html', 'https://syndred.github.io/StackPerch/zh/']]) {
      const html = await readFile(join(options.publicSource, path), 'utf8');
      if (!html.includes(`<link rel="canonical" href="${canonical}"`)) throw Error(`Redirect public source must use the fixed official StackPerch canonical: ${path}`);
    }
  }
  const sourceRevision = options.sourceRevision ?? (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  if (!/^[a-f0-9]{40}$/.test(sourceRevision)) throw Error('Source revision must be a full lowercase Git SHA');
  const sourceDirty = Boolean((await execFileAsync('git', ['status', '--porcelain'], { cwd: root })).stdout.trim());
  const snapshotSha256 = Object.fromEntries(await Promise.all(legacyStaticFiles.map(async path => [path, createHash('sha256').update(await readFile(join(options.mirrorSource, path))).digest('hex')])));
  const renderer = join(root, 'dist', `.legacy-site-renderer-${process.pid}-${Date.now()}.mjs`);
  await mkdir(join(root, 'dist'), { recursive: true });
  try {
    await build({ entryPoints: [join(root, 'apps/legacy-site/page.tsx')], outfile: renderer, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', jsx: 'automatic', loader: { '.css': 'empty' }, logLevel: 'warning' });
    const { renderLegacyRedirect, renderMirrorIndex, renderLegacyNotFound } = await import(pathToFileURL(renderer).href);
    await rm(output, { recursive: true, force: true });
    await mkdir(join(output, 'assets'), { recursive: true });
    await build({ entryPoints: [join(root, 'apps/legacy-site/styles.css')], outfile: join(output, 'assets/legacy.css'), bundle: true, minify: true, logLevel: 'warning' });
    await copyFile(join(root, 'apps/web/public/icons/stackperch.svg'), join(output, 'assets/stackperch.svg'));
    await copyFile(join(root, 'apps/legacy-site/vendor/LICENSE.txt'), join(output, 'assets/redirect-template-LICENSE.txt'));
    await copyFile(join(root, 'LICENSE'), join(output, 'LICENSE'));
    await writeFile(join(output, '.nojekyll'), '');
    const prefixes = options.mode === 'mirror' ? ['KeepAny', 'StackPerch'] : ['KeepAny'];
    for (const prefix of prefixes) {
      await mkdir(join(output, prefix, 'zh'), { recursive: true });
      await mkdir(join(output, prefix, 'assets'), { recursive: true });
      for (const file of options.mode === 'mirror' ? legacyStaticFiles : assetFiles) await copyFile(join(options.mirrorSource, file), join(output, prefix, file));
      if (options.mode === 'redirect') {
        await writeFile(join(output, prefix, 'index.html'), renderLegacyRedirect('en'));
        await writeFile(join(output, prefix, 'zh/index.html'), renderLegacyRedirect('zh-CN'));
        for (const file of textFiles) await copyFile(join(options.publicSource, file), join(output, prefix, file));
      }
    }
    await writeFile(join(output, 'index.html'), options.mode === 'mirror' ? renderMirrorIndex() : renderLegacyRedirect('en'));
    await writeFile(join(output, '404.html'), renderLegacyNotFound());
    for (const file of textFiles) await copyFile(join(options.mode === 'mirror' ? options.mirrorSource : options.publicSource, file), join(output, file));
    const provenance = { schema: 'stackperch.public-compatibility.v1', mode: options.mode, sourceRepository: 'https://github.com/Syndred/StackPerch', sourceRevision, sourceDirty, builder: 'scripts/build-legacy-site.mjs', previousSite: 'https://syndred.github.io/KeepAny/', officialSite: 'https://syndred.github.io/StackPerch/', copiedSnapshotSha256: snapshotSha256, upstream: { repository: 'https://github.com/jekyll/jekyll-redirect-from', commit: '839a7984eb00f70acd275fc825f7658711d3e8ce', template: 'lib/jekyll-redirect-from/redirect.html', license: 'MIT', retainedNotice: 'assets/redirect-template-LICENSE.txt' } };
    await writeFile(join(output, 'TRACE.json'), `${JSON.stringify(provenance, null, 2)}\n`);
    await writeFile(join(output, 'README.md'), `# StackPerch public compatibility site\n\nGenerated by [scripts/build-legacy-site.mjs](https://github.com/Syndred/StackPerch/blob/${sourceRevision}/scripts/build-legacy-site.mjs).\n\n- Stage: \`${options.mode}\`\n- Source revision: \`${sourceRevision}\`\n- Source had uncommitted changes: \`${sourceDirty}\`\n- Official site: <https://syndred.github.io/StackPerch/>\n- Previous public entry: <https://syndred.github.io/KeepAny/>\n- Build provenance and the copied public snapshot SHA-256 values: [TRACE.json](TRACE.json).\n\nThe generated React page and styles follow the StackPerch core's [AGPL-3.0-only license](LICENSE). Third-party icons and dependency styles retain their original licenses in the main repository's NOTICE and legal/third-party records. The redirect structure adapts jekyll-redirect-from, commit \`839a7984eb00f70acd275fc825f7658711d3e8ce\`, original \`lib/jekyll-redirect-from/redirect.html\`; copyright Parker Moore and jekyll-redirect-from contributors. Its [MIT notice](assets/redirect-template-LICENSE.txt) is retained. Changes add React static rendering, bilingual links and fixed same-origin location.replace preserving query and fragment. No Jekyll runtime is deployed.\n\nThis repository contains only generated public documentation and compatibility resources. Edit the builder in the main repository, then regenerate; deployment state must be verified separately.\n`);
    return { mode: options.mode, output, mirrorSource: options.mirrorSource, prefixes, copiedStaticFiles: prefixes.length * (options.mode === 'mirror' ? legacyStaticFiles.length : assetFiles.length) };
  } finally {
    await rm(renderer, { force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildLegacySite(parseLegacyOptions(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
