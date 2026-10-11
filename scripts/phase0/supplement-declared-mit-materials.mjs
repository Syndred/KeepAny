import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Preserve exact public package evidence and an explicitly labelled normative
// supplement. This does not invent an upstream LICENSE or a copyright holder.
const root = resolve(import.meta.dirname, '../..');
const manifestPath = resolve(root, 'legal/third-party/manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const spdxCommit = '31ba1a50e5397e00a304dbadc76531740e89ee48';
const sha = (algorithm, bytes, encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const fetchBytes = async url => {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Public material fetch failed: ${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
};
const expected = new Set([
  '@better-auth/utils@0.4.2', '@better-auth/utils@0.5.0', 'err-code@3.0.1',
  'get-browser-rtc@1.1.0', 'react-remove-scroll-bar@2.3.8',
]);
const pending = manifest.packages.filter(item => item.status === 'unresolved');
if (pending.some(item => !expected.has(`${item.name}@${item.version}`))) {
  throw new Error('Unexpected unresolved package; review its exact license before supplementing');
}
if (pending.length === 0) {
  console.log('No unresolved known MIT declarations to supplement.');
  process.exit(0);
}
await mkdir(resolve(root, 'legal/third-party/evidence'), { recursive: true });
const added = [];
const saveMaterial = async (id, path, bytes, source) => {
  await writeFile(resolve(root, path), bytes);
  const item = { id, path, sha256: sha('sha256', bytes), source };
  added.push(item);
  return item;
};
const standardId = 'spdx-MIT-normative-supplement';
const standardUrl = `https://raw.githubusercontent.com/spdx/license-list-data/${spdxCommit}/text/MIT.txt`;
const standard = await fetchBytes(standardUrl);
if (!standard.toString('utf8').includes('Copyright (c) <year> <copyright holders>')) {
  throw new Error('Review the normative SPDX MIT template before preserving it');
}
await saveMaterial(standardId, 'legal/third-party/texts/spdx-MIT-normative-supplement.txt', standard, {
  kind: 'license-standard', licenseId: 'MIT',
  repository: 'https://github.com/spdx/license-list-data.git', commit: spdxCommit,
  path: 'text/MIT.txt', downloadUrl: standardUrl,
  mapping: 'SPDX canonical MIT template; normative supplement only, not any package upstream LICENSE or copyright attribution',
});
const temporary = await mkdtemp(join(tmpdir(), 'keepany-license-evidence-'));
try {
  for (const item of pending) {
    const key = `${item.name}@${item.version}`;
    const archive = await fetchBytes(item.npm.tarball);
    if (sha('sha1', archive) !== item.npm.shasum || `sha512-${sha('sha512', archive, 'base64')}` !== item.npm.integrity) {
      throw new Error(`Exact npm tarball integrity mismatch: ${key}`);
    }
    const archivePath = join(temporary, 'package.tgz');
    await writeFile(archivePath, archive);
    const paths = execFileSync('tar', ['-tzf', archivePath], { encoding: 'utf8' }).trim().split('\n');
    const metadataBytes = execFileSync('tar', ['-xOzf', archivePath, 'package/package.json']);
    const metadata = JSON.parse(metadataBytes.toString('utf8'));
    if (metadata.name !== item.name || metadata.version !== item.version || metadata.license !== 'MIT' || item.declaredLicense !== 'MIT') {
      throw new Error(`Exact npm package declaration mismatch: ${key}`);
    }
    const readmePath = paths.find(path => /^package\/readme[^/]*$/i.test(path));
    if (!readmePath) throw new Error(`Exact npm README missing: ${key}`);
    const readmeBytes = execFileSync('tar', ['-xOzf', archivePath, readmePath]);
    if (!/\bMIT\b/.test(readmeBytes.toString('utf8'))) throw new Error(`Exact npm README lacks MIT declaration: ${key}`);
    const stem = `${item.name.replace(/^@/, '').replaceAll('/', '-')}-${item.version}`;
    const source = path => ({
      kind: 'npm-package-evidence', repository: item.repository.url,
      path, downloadUrl: item.npm.tarball,
      mapping: `Unmodified evidence from exact npm ${key} tarball after SHA-1 and SHA-512 verification; not an upstream LICENSE`,
      npm: { name: item.name, version: item.version, integrity: item.npm.integrity, shasum: item.npm.shasum },
    });
    const metadataId = `${stem}-package-declaration`;
    const readmeId = `${stem}-readme-declaration`;
    await saveMaterial(metadataId, `legal/third-party/evidence/${stem}-package.json`, metadataBytes, source('package/package.json'));
    await saveMaterial(readmeId, `legal/third-party/evidence/${stem}-README.md`, readmeBytes, source(readmePath));
    item.materials = [standardId, metadataId, readmeId];
    if (item.name === '@better-auth/utils') {
      const upstream = item.upstreamCandidate;
      const repository = upstream.repository.replace(/\.git$/, '');
      const url = `${repository.replace('https://github.com/', 'https://raw.githubusercontent.com/')}/${upstream.commit}/README.md`;
      const bytes = await fetchBytes(url);
      if (!/\bMIT\b/.test(bytes.toString('utf8'))) throw new Error(`Pinned upstream README lacks MIT declaration: ${key}`);
      const id = `${stem}-pinned-upstream-declaration`;
      await saveMaterial(id, `legal/third-party/evidence/${stem}-upstream-README.md`, bytes, {
        kind: 'upstream-license-declaration', repository: upstream.repository, commit: upstream.commit,
        path: 'README.md', downloadUrl: url,
        mapping: 'Exact npm SLSA provenance commit; original README declares MIT but is not a complete LICENSE notice',
      });
      item.materials.push(id);
    }
    item.status = 'declared-with-supplement';
    item.upstreamLicenseTextStatus = 'not-found';
    item.originalMissingReason = item.reason;
    delete item.reason;
    item.npmEvidence = {
      packageJson: metadataId, readme: readmeId,
      tarballIntegrityVerified: true,
      author: metadata.author ?? null,
      contributors: metadata.contributors ?? null,
    };
    item.licenseSupplement = standardId;
    item.copyrightStatus = 'No copyright notice supplied in exact npm package; original author metadata is preserved without treating it as copyright ownership.';
    item.supplementNote = 'Exact package.json and README declare MIT. SPDX canonical text is a labelled normative supplement, not an upstream package LICENSE. Template copyright placeholders remain unchanged; no copyright holder or year is invented.';
    console.log(`Preserved exact MIT declarations and labelled supplement for ${key}.`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
manifest.materials.push(...added);
manifest.scope.supplementedPackageCount = manifest.packages.filter(item => item.status === 'declared-with-supplement').length;
manifest.scope.unresolvedPackageCount = manifest.packages.filter(item => item.status === 'unresolved').length;
manifest.bundle.status = 'documented-with-normative-supplements';
manifest.bundle.materialCount = manifest.materials.length;
manifest.bundle.standardLicenseMaterialCount = manifest.materials.filter(item => item.source.kind === 'license-standard').length;
manifest.bundle.declarationEvidenceMaterialCount = manifest.materials.filter(item => ['npm-package-evidence', 'upstream-license-declaration'].includes(item.source.kind)).length;
manifest.bundle.supplementedPackageCount = manifest.scope.supplementedPackageCount;
manifest.bundle.unresolvedPackageCount = manifest.scope.unresolvedPackageCount;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
