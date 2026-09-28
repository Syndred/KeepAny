import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const check = process.argv.includes('--check');
const sha256 = data => createHash('sha256').update(data).digest('hex');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const rootPackage = await readJson(resolve(root, 'package.json'));
const lockSha256 = sha256(await readFile(resolve(root, 'pnpm-lock.yaml')));
const rootLicenseSha256 = sha256(await readFile(resolve(root, 'LICENSE')));
if (rootLicenseSha256 !== 'd8a6cc31abc16b6748c7a21f21611f5a1ec33f67d22ca23d7da1c19b95496bee') {
  throw new Error('Root LICENSE differs from the recorded SPDX AGPL-3.0-only text; review its provenance before regenerating');
}
const previousSbom = await readJson(resolve(root, 'SBOM.spdx.json')).catch(() => null);
const previousLock = previousSbom?.annotations?.[0]?.comment?.match(/pnpm-lock\.yaml SHA-256: ([a-f0-9]{64})/)?.[1];
const created = previousLock === lockSha256 && previousSbom.creationInfo?.created
  ? previousSbom.creationInfo.created
  : new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const grouped = JSON.parse(execFileSync('pnpm', ['licenses', 'list', '--json'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
}));

const packages = [];
for (const [pnpmLicense, entries] of Object.entries(grouped)) {
  for (const entry of entries) {
    if (entry.versions.length !== entry.paths.length) throw new Error(`Version/path mismatch: ${entry.name}`);
    for (let i = 0; i < entry.versions.length; i++) {
      const directory = entry.paths[i];
      const metadata = await readJson(resolve(directory, 'package.json'));
      if (metadata.name !== entry.name || metadata.version !== entry.versions[i]) {
        throw new Error(`Installed package mismatch: ${entry.name}@${entry.versions[i]}`);
      }
      const names = await readdir(directory);
      const legalNames = names.filter(name => /^(license|licence|copying|notice)(\.|$)/i.test(name)).sort();
      const legalFiles = [];
      for (const name of legalNames) {
        const bytes = await readFile(resolve(directory, name));
        legalFiles.push({ path: `${relative(root, directory)}/${name}`, sha256: sha256(bytes) });
      }
      const repository = typeof metadata.repository === 'string'
        ? metadata.repository
        : metadata.repository?.url ?? null;
      const declaration = typeof metadata.license === 'string' ? metadata.license : null;
      packages.push({
        name: metadata.name,
        version: metadata.version,
        declaredLicense: declaration,
        pnpmLicense,
        repository,
        repositoryDirectory: metadata.repository?.directory ?? null,
        homepage: metadata.homepage ?? null,
        metadataPath: `${relative(root, directory)}/package.json`,
        legalFiles,
        missingLicenseText: !legalNames.some(name => /^(license|licence|copying)(\.|$)/i.test(name)),
        directScope: Object.hasOwn(rootPackage.dependencies ?? {}, metadata.name) ? 'production'
          : Object.hasOwn(rootPackage.devDependencies ?? {}, metadata.name) ? 'development' : null,
      });
    }
  }
}
packages.sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'));
const distinctIds = new Set(packages.map(pkg => `${pkg.name}@${pkg.version}`));
if (distinctIds.size !== packages.length) throw new Error('Duplicate installed package name/version; review pnpm peer variants before publishing this SBOM');
for (const name of [...Object.keys(rootPackage.dependencies ?? {}), ...Object.keys(rootPackage.devDependencies ?? {})]) {
  if (!packages.some(pkg => pkg.name === name)) throw new Error(`Direct dependency missing from installed inventory: ${name}`);
}
const missing = packages.filter(pkg => pkg.missingLicenseText);
const escapeCell = value => String(value ?? '未提供').replaceAll('|', '\\|').replaceAll('\n', ' ');
const pkgName = pkg => `${pkg.name}@${pkg.version}`;
const fileSummary = pkg => pkg.legalFiles.length
  ? pkg.legalFiles.map(file => `\`${file.path}\` (SHA-256 \`${file.sha256}\`)`).join('<br>')
  : '包根目录无 LICENSE/LICENCE/COPYING/NOTICE';

const notice = [
  '# KeepAny 第三方依赖声明与核查状态',
  '',
  '本清单由 `node scripts/phase0/generate-legal-artifacts.mjs` 根据当前 `pnpm-lock.yaml`、实际安装树和各包 `package.json` 生成。它记录包内许可声明和包根目录中的许可/NOTICE 文件指纹；并非法律兼容性结论或可直接分发的完整第三方许可证正文包。',
  '',
  `- 锁文件 SHA-256：\`${lockSha256}\``,
  `- 已安装包版本：${packages.length}；直接运行依赖：${packages.filter(pkg => pkg.directScope === 'production').length}；直接开发依赖：${packages.filter(pkg => pkg.directScope === 'development').length}。`,
  `- 包根目录缺少许可证正文：${missing.length}。各项仍需按发布版本核对上游正文、版权和特殊 NOTICE。`,
  '- 项目源码许可证：根目录 `LICENSE` 为 AGPL-3.0-only；发布前仍需由版权持有人确认，并完成依赖兼容性复核。',
  '- 本轮未复制 HomeInventory、Wallos、DomainMOD、Homebox 的业务源码；该四项仅在 `docs/03-开源业务模块复用审计.md` 中作为候选和参考登记。',
  '',
  '## 缺少包内许可证正文的逐项记录',
  '',
  '| 已安装包 | 包内声明 | 安装元数据与来源 | 未解决项 |',
  '|---|---|---|---|',
  ...missing.map(pkg => `| \`${escapeCell(pkgName(pkg))}\` | \`${escapeCell(pkg.declaredLicense ?? pkg.pnpmLicense)}\` | \`${escapeCell(pkg.metadataPath)}\`；仓库：${escapeCell(pkg.repository)}${pkg.repositoryDirectory ? `；目录：\`${escapeCell(pkg.repositoryDirectory)}\`` : ''} | 包根目录无许可证正文；尚未核对该发布版本对应上游正文、版权与 NOTICE。 |`),
  '',
  '## 全部已安装包版本与文件指纹',
  '',
  '下表的“声明”取自实际安装包的 `package.json`，不是经过人工裁定的最终许可。文件指纹仅覆盖包根目录，未覆盖嵌套源码头或打包产物。',
  '',
  '| 包 | 直接依赖 | 声明 | 包根目录法律文件（相对仓库路径和 SHA-256） |',
  '|---|---|---|---|',
  ...packages.map(pkg => `| \`${escapeCell(pkgName(pkg))}\` | ${pkg.directScope ?? '传递依赖'} | \`${escapeCell(pkg.declaredLicense ?? pkg.pnpmLicense)}\` | ${fileSummary(pkg)} |`),
].join('\n');

const snapshot = [
  '# 依赖版本与许可证快照',
  '',
  `生成时间：${created}。数据来自当前 \`pnpm-lock.yaml\`、\`pnpm licenses list --json\` 和实际安装包的 \`package.json\`/包根目录文件；下表是已安装的直接依赖，而非 npm \`latest\` 候选。生成命令：\`node scripts/phase0/generate-legal-artifacts.mjs\`；校验命令：\`node scripts/phase0/generate-legal-artifacts.mjs --check\`。`,
  '',
  `- 锁文件 SHA-256：\`${lockSha256}\`。根许可证文本 SHA-256：\`${rootLicenseSha256}\`。`,
  `- 已安装包版本：${packages.length}；其中直接运行依赖 ${packages.filter(pkg => pkg.directScope === 'production').length}，直接开发依赖 ${packages.filter(pkg => pkg.directScope === 'development').length}。同名不同版本分别计数。`,
  `- 包根目录无许可证正文：${missing.length} 个，见 [NOTICE 逐项来源与缺口](../NOTICE.md#缺少包内许可证正文的逐项记录)。`,
  '- 机器可读清单：[SPDX 2.3 SBOM](../SBOM.spdx.json)。包根目录法律文件及 SHA-256 见 [NOTICE](../NOTICE.md)。这里的声明取自包元数据，不等于经过人工审定的许可证兼容性。',
  '',
  '| 直接包 | 已安装版本 | 用途 | 包内声明 |',
  '|---|---|---|---|',
  ...packages.filter(pkg => pkg.directScope).map(pkg => `| \`${escapeCell(pkg.name)}\` | \`${escapeCell(pkg.version)}\` | ${pkg.directScope === 'production' ? '运行' : '开发'} | \`${escapeCell(pkg.declaredLicense ?? pkg.pnpmLicense)}\` |`),
  '',
  '## 核查边界与发布待办',
  '',
  '- 根目录 `LICENSE` 采用 [SPDX 发布的 AGPL-3.0-only 正文](https://github.com/spdx/license-list-data/blob/main/text/AGPL-3.0-only.txt)。项目版权持有人需确认最终授权选择及版权标注；仅有正文文件不完成发布法律审核。',
  '- `NOTICE` 和 `SBOM` 覆盖当前本地安装树，包含传递依赖和开发依赖；并非生产浏览器/服务端产物的裁剪清单。`SBOM` 的 `licenseConcluded`、`copyrightText`、`downloadLocation` 均为 `NOASSERTION`，因为尚未完成逐文件裁定、版权提取和对应 tarball 核对。',
  '- 对缺正文包逐项核对上游该版本的许可正文和版权；核对 Apache-2.0 依赖是否有应保留的 `NOTICE`，以及实际发布 bundle 中的第三方声明。当前不能把“元数据有 SPDX 标识”当作“再分发材料齐全”。',
  '- 第三方业务应用当前只作方案与数据格式参考；一旦复制或改编源码，需先固定上游 commit、原路径、具体文件许可证及保留的测试，见 [复用审计](03-开源业务模块复用审计.md)。',
  '- 原先的 npm `latest` 核查仅用于技术选型，不代表当前已安装版本；例如本项目已锁定 `dexie@4.4.2`、`@modelcontextprotocol/server@2.1.0`。',
].join('\n');

const uuid = `${lockSha256.slice(0, 8)}-${lockSha256.slice(8, 12)}-4${lockSha256.slice(13, 16)}-a${lockSha256.slice(17, 20)}-${lockSha256.slice(20, 32)}`;
const spdxId = index => `SPDXRef-Package-${index + 1}`;
const sbom = {
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: `KeepAny installed pnpm inventory ${lockSha256.slice(0, 12)}`,
  documentNamespace: `urn:uuid:${uuid}`,
  creationInfo: {
    creators: ['Tool: scripts/phase0/generate-legal-artifacts.mjs'],
    created,
    comment: 'Installed-tree snapshot; creation time is retained for the same lock SHA-256 so --check can compare deterministic output.',
  },
  annotations: [{ annotationDate: created, annotationType: 'OTHER', annotator: 'Tool: scripts/phase0/generate-legal-artifacts.mjs', comment: `pnpm-lock.yaml SHA-256: ${lockSha256}; installed package versions: ${packages.length}; missing root license text: ${missing.length}.` }],
  documentDescribes: packages.map((_, i) => spdxId(i)),
  packages: packages.map((pkg, i) => ({
    SPDXID: spdxId(i),
    name: pkg.name,
    versionInfo: pkg.version,
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: pkg.declaredLicense ?? 'NOASSERTION',
    copyrightText: 'NOASSERTION',
    sourceInfo: `Installed metadata: ${pkg.metadataPath}; package-root license/notice files: ${pkg.legalFiles.length ? pkg.legalFiles.map(file => `${file.path} sha256:${file.sha256}`).join('; ') : 'none'}; metadata repository: ${pkg.repository ?? 'NOASSERTION'}; direct scope: ${pkg.directScope ?? 'transitive'}.`,
    ...(pkg.homepage ? { homepage: pkg.homepage } : {}),
    ...(pkg.missingLicenseText ? { licenseComments: 'Installed package root lacks LICENSE/LICENCE/COPYING text; declared metadata is not an upstream-text verification.' } : {}),
  })),
  relationships: packages.map((_, i) => ({ spdxElementId: 'SPDXRef-DOCUMENT', relatedSpdxElement: spdxId(i), relationshipType: 'DESCRIBES' })),
};

const outputs = [
  ['NOTICE.md', `${notice}\n`],
  ['SBOM.spdx.json', `${JSON.stringify(sbom, null, 2)}\n`],
  ['docs/02-依赖版本与许可证快照.md', `${snapshot}\n`],
];
for (const [name, content] of outputs) {
  const path = resolve(root, name);
  if (check) {
    if (await readFile(path, 'utf8').catch(() => null) !== content) throw new Error(`${name} is stale; regenerate after package/lock changes`);
  } else {
    await writeFile(path, content);
  }
}
console.log(`${check ? 'Checked' : 'Generated'} ${packages.length} installed package versions; ${missing.length} missing package-root license texts; lock ${lockSha256.slice(0, 12)}.`);
