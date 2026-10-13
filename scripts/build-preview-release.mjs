import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as bundleServer } from 'esbuild';
import { build as buildWeb } from 'vite';
import { zipSync } from 'fflate';
import { readApplicationRouteContract } from './preview-route-contract.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allowDirty = process.argv.slice(2).includes('--allow-dirty');
if (process.argv.slice(2).some(arg => arg !== '--allow-dirty')) throw Error('Usage: node scripts/build-preview-release.mjs [--allow-dirty]');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }).trim();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const sourceCommit = git(['rev-parse', 'HEAD']);
const sourceDirty = git(['status', '--porcelain', '--untracked-files=all']).length > 0;
if (sourceDirty && !allowDirty) throw Error('Commit reviewed source changes before packaging, or use --allow-dirty for an unpublished candidate.');
const rootPackage = await json(join(root, 'package.json'));
const version = `${rootPackage.version}-preview.${sourceCommit.slice(0, 12)}${sourceDirty ? '.dirty' : ''}`;
const releaseName = `StackPerch-${version}-portable`;
const directory = join(root, 'dist', 'preview', releaseName);
const webDirectory = join(root, 'apps', 'web', 'dist');
const epoch = Number(process.env.SOURCE_DATE_EPOCH ?? git(['show', '-s', '--format=%ct', 'HEAD']));
if (!Number.isInteger(epoch) || epoch < 315532800) throw Error('SOURCE_DATE_EPOCH must be a Unix timestamp after 1980.');
const archiveTime = new Date(epoch * 1000);
const sourcePathAllowed = path => /^(?:apps|packages|patches|scripts)\//.test(path)
  || /^legal\//.test(path)
  || /^release\/preview\//.test(path)
  || ['docs/试用指南.md', 'docs/evidence/2026-10-13/stackperch/onboarding-en-1280-sample.png', 'docs/evidence/2026-10-13/stackperch/onboarding-zh-1280-sample.png'].includes(path)
  || /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.json|(?:vite|vitest|playwright)[\w.-]*\.config\.[\w]+|LICENSE|NOTICE\.md|SBOM\.spdx\.json|SECURITY\.md|CONTRIBUTING\.md|README(?:\.en)?\.md|\.gitignore)$/.test(path);
const sourcePaths = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }).split('\0').filter(path => path && sourcePathAllowed(path)))].sort();
const sourceSnapshot = new Map();
for (const path of sourcePaths) {
  if (/(?:^|\/)(?:dist|node_modules)(?:\/|$)/.test(path)
    || (/(?:^|\/)\.env(?:\..*)?$/.test(path) && !path.endsWith('/.env.example'))) {
    throw Error(`Unexpected generated/private source path: ${path}`);
  }
  sourceSnapshot.set(path, await readFile(join(root, path)));
}
const distributedPackages = new Map();
const packageCache = new Map();
const applicationRoutes = await readApplicationRouteContract(root);
async function recordDependency(filename) {
  // Vite uses forward slashes on Windows; esbuild may use native separators.
  if (!filename.replaceAll('\\', '/').includes('/node_modules/')) return;
  let directory = dirname(filename.replace(/\?.*$/, ''));
  const visited = [];
  while (directory !== dirname(directory)) {
    if (packageCache.has(directory)) {
      const pkg = packageCache.get(directory);
      for (const item of visited) packageCache.set(item, pkg);
      if (pkg) distributedPackages.set(`${pkg.metadata.name}@${pkg.metadata.version}`, pkg);
      return;
    }
    visited.push(directory);
    try {
      const metadata = await json(join(directory, 'package.json'));
      if (typeof metadata.name === 'string' && typeof metadata.version === 'string') {
        const pkg = { directory, metadata };
        for (const item of visited) packageCache.set(item, pkg);
        distributedPackages.set(`${metadata.name}@${metadata.version}`, pkg);
        return;
      }
    } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
    directory = dirname(directory);
  }
}

// A fresh production build is the only web source. release/web is never read.
// Invoke the installed JavaScript CLI directly: Windows cannot exec pnpm.cmd.
execFileSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'], { cwd: root, stdio: 'inherit' });
const webModules = new Set();
await buildWeb({
  root: join(root, 'apps', 'web'),
  plugins: [{
    name: 'keepany-preview-license-inputs',
    generateBundle(_options, output) {
      for (const file of Object.values(output)) {
        if (file.type === 'chunk') for (const filename of Object.keys(file.modules)) webModules.add(filename);
      }
    },
  }],
});
for (const filename of webModules) await recordDependency(filename);
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
const serverBuild = await bundleServer({
  entryPoints: [join(root, 'scripts', 'preview-server.mjs')],
  outfile: join(directory, 'preview-server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  metafile: true,
  legalComments: 'linked',
  logLevel: 'warning',
});
for (const output of Object.values(serverBuild.metafile.outputs)) {
  for (const item of output.imports) {
    if (item.external && !item.path.startsWith('node:')) throw Error(`Unexpected runtime dependency: ${item.path}`);
  }
}
for (const filename of Object.keys(serverBuild.metafile.inputs)) await recordDependency(resolve(root, filename));

async function collectFiles(directory) {
  const files = new Map();
  async function walk(current) {
    for (const item of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const path = join(current, item.name);
      if (item.isDirectory()) await walk(path);
      else if (item.isFile()) files.set(relative(directory, path).split(sep).join('/'), await readFile(path));
      else throw Error(`Only regular files/directories are allowed in a preview: ${path}`);
    }
  }
  await walk(directory);
  return files;
}
async function put(path, bytes, executable = false) {
  const target = join(directory, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  if (executable) await chmod(target, 0o755);
}
const webFiles = await collectFiles(webDirectory);
if (!webFiles.has('index.html') || !webFiles.has('sw.js')) throw Error('Missing production web or PWA output.');
for (const [path, bytes] of webFiles) await put(`web/${path}`, bytes);
const templates = await collectFiles(join(root, 'release', 'preview'));
for (const [path, bytes] of templates) await put(path, bytes, path.endsWith('.sh'));
for (const action of ['start', 'stop']) await put(`${action}.command`, templates.get(`${action}.sh`), true);
for (const filename of ['LICENSE', 'NOTICE.md']) await copyFile(join(root, filename), join(directory, filename));
execFileSync(process.execPath, [join(root, 'scripts', 'phase0', 'verify-third-party-license-materials.mjs'), '--release'], { cwd: root, stdio: 'inherit' });
const legalFiles = await collectFiles(join(root, 'legal', 'third-party'));
for (const [path, bytes] of legalFiles) await put(`legal/third-party/${path}`, bytes);
const materials = await json(join(root, 'legal', 'third-party', 'manifest.json'));
const materialById = new Map(materials.materials.map(item => [item.id, item]));
const licenseRecords = new Map(materials.packages.map(item => [`${item.name}@${item.version}`, item]));

// Workbox emits a separate runtime outside Vite's chunk module inventory.
// Include the installed Workbox package family conservatively and label it.
const repositorySbom = await json(join(root, 'SBOM.spdx.json'));
for (const pkg of repositorySbom.packages.filter(pkg => pkg.name.startsWith('workbox-'))) {
  const metadataPath = pkg.sourceInfo?.match(/Installed metadata: ([^;]+)/)?.[1];
  if (!metadataPath) throw Error(`Missing Workbox metadata path: ${pkg.name}`);
  await recordDependency(resolve(root, metadataPath));
}
const licenses = [];
for (const [key, pkg] of [...distributedPackages].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
  const names = (await readdir(pkg.directory)).filter(name => /^(license|licence|copying|notice)(\.|$)/i.test(name));
  const licenseFiles = [];
  const folder = `${pkg.metadata.name.replaceAll('/', '+')}@${pkg.metadata.version}`;
  for (const filename of names) {
    const path = join(pkg.directory, filename);
    if (!(await stat(path)).isFile()) throw Error(`Unsupported license directory: ${path}`);
    const bytes = await readFile(path);
    const output = `legal/installed/${folder}/${filename}`;
    await put(output, bytes);
    licenseFiles.push({ path: output, sha256: sha256(bytes), kind: /^notice/i.test(filename) ? 'installed-notice' : 'installed-license-text' });
  }
  const upstream = licenseRecords.get(key);
  if (!names.some(name => /^(license|licence|copying)(\.|$)/i.test(name))) {
    if (!['verified', 'declared-with-supplement'].includes(upstream?.status) || !upstream.materials?.length) throw Error(`Release blocked by missing license text: ${key}`);
    for (const id of upstream.materials) {
      const material = materialById.get(id);
      if (!material || sha256(await readFile(join(root, material.path))) !== material.sha256) throw Error(`Invalid upstream material for ${key}: ${id}`);
      licenseFiles.push({ path: material.path, sha256: material.sha256, kind: material.source?.kind ?? 'upstream-license-text' });
    }
  }
  licenses.push({
    name: pkg.metadata.name, version: pkg.metadata.version,
    declaredLicense: pkg.metadata.license ?? 'NOASSERTION',
    inclusion: pkg.metadata.name.startsWith('workbox-') ? 'conservative PWA runtime family' : 'production browser or bundled local server input',
    ...(upstream ? { upstreamStatus: upstream.status } : {}),
    files: licenseFiles,
  });
}
const lockSha256 = sha256(await readFile(join(root, 'pnpm-lock.yaml')));
const licenseInventory = {
  schema: 'keepany.preview-license-inventory.v1', lockSha256,
  scope: 'Vite production chunk inputs, bundled local server inputs, plus the conservative installed Workbox family. Excludes development tools that are not included in the distributed executable.',
  unresolvedPackageCount: 0, packages: licenses,
};
await put('legal/preview-license-inventory.json', `${JSON.stringify(licenseInventory, null, 2)}\n`);
const packageIds = new Set(licenses.map(pkg => `${pkg.name}@${pkg.version}`));
const previewPackages = repositorySbom.packages.filter(pkg => packageIds.has(`${pkg.name}@${pkg.versionInfo}`));
if (previewPackages.length !== licenses.length) throw Error('Distributed dependency inventory differs from SBOM; regenerate repository legal artifacts.');
const spdxIds = new Set(previewPackages.map(pkg => pkg.SPDXID));
await put('SBOM.spdx.json', `${JSON.stringify({
  ...repositorySbom,
  name: `StackPerch portable preview ${version}`,
  documentNamespace: `https://github.com/Syndred/KeepAny/preview/${sourceCommit}/${lockSha256}`,
  creationInfo: { creators: ['Tool: scripts/build-preview-release.mjs'], created: archiveTime.toISOString(), comment: licenseInventory.scope },
  annotations: [],
  documentDescribes: [...spdxIds],
  packages: previewPackages,
  relationships: (repositorySbom.relationships ?? []).filter(item => (item.spdxElementId === 'SPDXRef-DOCUMENT' || spdxIds.has(item.spdxElementId)) && spdxIds.has(item.relatedSpdxElement)),
}, null, 2)}\n`);

// Corresponding source is included without historical bundles, production data,
// research/evidence artifacts, or local configuration files.
const sourceFiles = [];
for (const [path, bytes] of sourceSnapshot) {
  if (!(await readFile(join(root, path))).equals(bytes)) throw Error(`Source changed while building; retry after edits finish: ${path}`);
  await put(`source/${path}`, bytes);
  sourceFiles.push({ path, sha256: sha256(bytes) });
}
await put('source/SOURCE.md', `# Corresponding source / 对应源码\n\nCommit: ${sourceCommit}\nUncommitted changes included: ${sourceDirty}\n\n## Rebuild the application without Git / 无需 Git 重建应用\n\nFrom this source directory, with Node.js 22+ and pnpm ${rootPackage.packageManager?.split('@').at(-1)}:\n在此 source 目录安装开发依赖后即可重建 Web 应用：\n\n\`\`\`sh\npnpm install --frozen-lockfile\npnpm build\n\`\`\`\n\nThe result is apps/web/dist. This snapshot includes application source, local server, build scripts, patches, lockfile, SBOM and license materials. The public page source includes only its two fictional sample screenshots and the trial guide; use pnpm build:public-site to rebuild that separate documentation site. Unit tests colocated with the application source are retained. The root tests/e2e directory, historical release/web bundles, and other research/evidence files are excluded. The standalone snapshot supports the application build described above; full repository acceptance also requires the complete checkout and its development fixtures.\n产物位于 apps/web/dist。本快照包含应用、启动器、构建脚本、补丁、锁文件、SBOM 与许可材料；公开介绍页只附带两张虚构示例截图和试用指南，可用 pnpm build:public-site 单独重建。与应用源码同目录的单元测试随源码保留；根 tests/e2e 目录、历史 release/web 和其他研究/验收证据不随快照分发。此独立快照支持上述应用构建；完整仓库验收还需要完整检出及开发测试素材。\n\n## Repackage a release / 重建便携发布包\n\nThe portable packaging scripts require Git metadata and the complete reviewed repository. Do not run build:preview in this snapshot, which has no .git. For a clean release, check out the exact commit in a full repository and run:\n便携打包需要完整仓库和 Git 提交元数据，不能直接在此无 .git 的快照中执行 build:preview。正式干净版本请在完整仓库检出上述提交后运行：\n\n\`\`\`sh\ngit clone https://github.com/Syndred/KeepAny.git\ncd KeepAny\ngit checkout ${sourceCommit}\npnpm install --frozen-lockfile\npnpm build:preview\npnpm verify:preview\n\`\`\`\n\nA .dirty candidate includes uncommitted files identified by RELEASE.json sourceFiles; checking out its sourceCommit alone does not reproduce those candidate changes.\n.dirty 候选包含尚未提交的改动，由 RELEASE.json 的 sourceFiles 记录；仅检出 sourceCommit 不会重现这些未提交改动。\n`);
const release = {
  schema: 'keepany.portable-preview.v1', productName: 'StackPerch', previousName: 'KeepAny', version, sourceCommit, sourceDirty,
  sourceUrl: `https://github.com/Syndred/KeepAny/tree/${sourceCommit}`,
  reproducibleArchiveTimestamp: archiveTime.toISOString(),
  node: '>=22', defaultOrigin: 'http://127.0.0.1:4180',
  webSource: 'fresh apps/web/dist production build',
  applicationRoutes,
  webFiles: [...webFiles].map(([path, bytes]) => ({ path, sha256: sha256(bytes) })),
  sourceFiles, distributedDependencyCount: licenses.length,
  license: 'AGPL-3.0-only',
};
await put('RELEASE.json', `${JSON.stringify(release, null, 2)}\n`);
const deliveredFiles = await collectFiles(directory);
const sums = [...deliveredFiles].map(([path, bytes]) => `${sha256(bytes)}  ${path}`).join('\n');
await put('SHA256SUMS.txt', `${sums}\n`);
deliveredFiles.set('SHA256SUMS.txt', Buffer.from(`${sums}\n`));
const archiveFiles = {};
for (const [path, bytes] of deliveredFiles) {
  if (isAbsolute(path) || path.split('/').includes('..')) throw Error(`Invalid archive path: ${path}`);
  const executable = /^(?:start|stop)\.(?:command|sh)$/.test(path);
  archiveFiles[`${releaseName}/${path}`] = [bytes, { mtime: archiveTime, os: 3, attrs: ((executable ? 0o100755 : 0o100644) << 16) >>> 0 }];
}
const archivePath = `${directory}.zip`;
const archive = zipSync(archiveFiles, { level: 6 });
await writeFile(archivePath, archive);
await writeFile(`${archivePath}.sha256`, `${sha256(archive)}  ${releaseName}.zip\n`);
console.log(`Built ${archivePath}\n${webFiles.size} fresh web files; ${licenses.length} distributed dependency license records; ${sourceFiles.length} source files.\nSHA-256 ${sha256(archive)}`);
