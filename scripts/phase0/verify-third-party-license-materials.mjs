import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const release = process.argv.includes('--release');
const manifestPath = resolve(root, 'legal/third-party/manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const errors = [];
const isSha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = message => errors.push(message);
const packageKey = item => `${item?.name}@${item?.version}`;

if (manifest?.schema !== 'keepany.third-party-license-materials.v1') {
  fail(`manifest schema must be keepany.third-party-license-materials.v1`);
}
if (manifest?.scope?.platformIndependent !== true) {
  fail('manifest scope must declare platformIndependent=true');
}
if (!Array.isArray(manifest?.materials)) fail('manifest materials must be an array');
if (!Array.isArray(manifest?.packages)) fail('manifest packages must be an array');

const materials = Array.isArray(manifest?.materials) ? manifest.materials : [];
const packages = Array.isArray(manifest?.packages) ? manifest.packages : [];
const materialIds = new Set();
const materialPaths = new Set();
const materialBytes = new Map();
const materialById = new Map(materials.map(material => [material.id, material]));

for (const material of materials) {
  if (!material || typeof material !== 'object') {
    fail('material entry must be an object');
    continue;
  }
  if (!material.id || materialIds.has(material.id)) fail(`duplicate or empty material id: ${material.id ?? '<empty>'}`);
  materialIds.add(material.id);
  if (!isSha256(material.sha256)) fail(`material ${material.id} has invalid sha256`);
  if (typeof material.path !== 'string' || !material.path.startsWith('legal/third-party/')) {
    fail(`material ${material.id} path must be under legal/third-party`);
    continue;
  }
  const absolute = resolve(root, material.path);
  const relativePath = relative(root, absolute);
  const legalThirdPartyPrefix = ['legal', 'third-party'].join(sep) + sep;
  if (!relativePath.startsWith(legalThirdPartyPrefix)) {
    fail(`material ${material.id} path escapes legal/third-party: ${material.path}`);
    continue;
  }
  if (materialPaths.has(relativePath)) fail(`duplicate material path: ${relativePath}`);
  materialPaths.add(relativePath);
  try {
    const fileStat = await stat(absolute);
    if (!fileStat.isFile()) {
      fail(`material ${material.id} is not a regular file: ${material.path}`);
      continue;
    }
    const bytes = await readFile(absolute);
    materialBytes.set(material.id, bytes);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== material.sha256) fail(`material ${material.id} sha256 mismatch: expected ${material.sha256}, got ${digest}`);
  } catch (error) {
    fail(`material ${material.id} cannot be read: ${error.message}`);
  }
  if (!material.source || typeof material.source !== 'object') fail(`material ${material.id} lacks upstream source metadata`);
  else {
    const kind = material.source.kind ?? 'upstream-license-text';
    if (!['upstream-license-text', 'license-standard', 'npm-package-evidence', 'upstream-license-declaration'].includes(kind)) fail(`material ${material.id} has unsupported source.kind`);
    for (const field of ['repository', 'path', 'downloadUrl', 'mapping']) {
      if (typeof material.source[field] !== 'string' || material.source[field].length === 0) {
        fail(`material ${material.id} source.${field} is missing`);
      }
    }
    if (kind !== 'npm-package-evidence' && !/^[a-f0-9]{40}$/.test(material.source.commit)) fail(`material ${material.id} source.commit is not a pinned commit`);
    if (kind === 'license-standard' && (material.source.licenseId !== 'MIT' || material.source.repository !== 'https://github.com/spdx/license-list-data.git' || material.source.path !== 'text/MIT.txt')) fail(`material ${material.id} must identify the canonical SPDX MIT supplement`);
  }
}
const packageIds = new Set();
let verifiedCount = 0;
let supplementedCount = 0;
let unresolvedCount = 0;
for (const item of packages) {
  const key = packageKey(item);
  if (!item || typeof item !== 'object' || !item.name || !item.version) {
    fail('package entry must include name and version');
    continue;
  }
  if (packageIds.has(key)) fail(`duplicate package entry: ${key}`);
  packageIds.add(key);
  if (!['verified', 'declared-with-supplement', 'unresolved'].includes(item.status)) fail(`${key} has invalid status`);
  if (release && (typeof item.declaredLicense !== 'string' || !item.declaredLicense.trim() || ['NOASSERTION', 'NONE', 'UNLICENSED'].includes(item.declaredLicense))) fail(`${key} release requires an established license declaration`);
  if (!item.npm || typeof item.npm !== 'object') fail(`${key} lacks npm metadata`);
  else {
    for (const field of ['registry', 'tarball', 'integrity', 'shasum']) {
      if (typeof item.npm[field] !== 'string' || item.npm[field].length === 0) fail(`${key} npm.${field} is missing`);
    }
    if (!/^[a-f0-9]{40}$/.test(item.npm.shasum)) fail(`${key} npm.shasum is invalid`);
    if (!item.npm.integrity.startsWith('sha512-')) fail(`${key} npm.integrity is not sha512`);
  }
  if (item.status === 'verified') {
    verifiedCount += 1;
    if (!Array.isArray(item.materials) || item.materials.length === 0) fail(`${key} is verified but has no materials`);
    for (const materialId of item.materials ?? []) {
      if (!materialIds.has(materialId)) fail(`${key} references missing material ${materialId}`);
      const kind = materialById.get(materialId)?.source?.kind;
      if (kind && kind !== 'upstream-license-text') fail(`${key} verified original text must not reference a normative supplement or declaration evidence`);
    }
    if (!item.upstream || !Array.isArray(item.upstream.materials)) fail(`${key} lacks upstream.materials provenance`);
  } else if (item.status === 'declared-with-supplement') {
    supplementedCount += 1;
    if (item.declaredLicense !== 'MIT') fail(`${key} normative supplements currently support only an exact MIT declaration`);
    if (!Array.isArray(item.materials) || item.materials.length < 3) fail(`${key} supplement needs normative text and exact package/README evidence`);
    for (const materialId of item.materials ?? []) {
      if (!materialIds.has(materialId)) fail(`${key} references missing material ${materialId}`);
    }
    const standard = materialById.get(item.licenseSupplement);
    if (standard?.source?.kind !== 'license-standard' || standard.source.licenseId !== 'MIT' || !item.materials?.includes(item.licenseSupplement)) fail(`${key} lacks a referenced MIT normative supplement`);
    if (!materialBytes.get(item.licenseSupplement)?.toString('utf8').includes('Copyright (c) <year> <copyright holders>')) fail(`${key} normative supplement must preserve template placeholders without invented attribution`);
    if (item.upstreamLicenseTextStatus !== 'not-found' || !item.originalMissingReason || !item.copyrightStatus || !item.supplementNote) fail(`${key} must preserve missing upstream text and attribution boundaries`);
    if (item.npmEvidence?.tarballIntegrityVerified !== true) fail(`${key} lacks exact npm tarball integrity verification evidence`);
    for (const field of ['packageJson', 'readme']) {
      const id = item.npmEvidence?.[field];
      const evidence = materialById.get(id);
      if (!id || !item.materials?.includes(id) || evidence?.source?.kind !== 'npm-package-evidence') {
        fail(`${key} npmEvidence.${field} must reference an included original npm evidence material`);
        continue;
      }
      const source = evidence.source;
      if (source.npm?.name !== item.name || source.npm?.version !== item.version || source.npm?.integrity !== item.npm?.integrity || source.npm?.shasum !== item.npm?.shasum || source.downloadUrl !== item.npm?.tarball) fail(`${key} npmEvidence.${field} is not bound to the exact declared tarball`);
      if (field === 'packageJson') {
        if (source.path !== 'package/package.json') fail(`${key} package declaration must come from package/package.json`);
        try {
          const declaration = JSON.parse(materialBytes.get(id)?.toString('utf8') ?? '');
          if (declaration.name !== item.name || declaration.version !== item.version || declaration.license !== 'MIT') fail(`${key} original package declaration does not match name/version/MIT`);
          if (JSON.stringify(declaration.author ?? null) !== JSON.stringify(item.npmEvidence.author) || JSON.stringify(declaration.contributors ?? null) !== JSON.stringify(item.npmEvidence.contributors)) fail(`${key} attribution metadata does not match the unmodified package.json`);
        } catch { fail(`${key} original package declaration is not readable JSON`); }
      } else if (!/^package\/readme[^/]*$/i.test(source.path) || !/\bMIT\b/.test(materialBytes.get(id)?.toString('utf8') ?? '')) fail(`${key} original npm README lacks its MIT declaration`);
    }
    if (item.name === '@better-auth/utils') {
      const upstream = (item.materials ?? []).map(id => materialById.get(id)).find(material => material?.source?.kind === 'upstream-license-declaration');
      if (!upstream || upstream.source.commit !== item.upstreamCandidate?.commit || !/\bMIT\b/.test(materialBytes.get(upstream.id)?.toString('utf8') ?? '')) fail(`${key} lacks the pinned upstream README MIT declaration`);
    }
  } else {
    unresolvedCount += 1;
    if (typeof item.reason !== 'string' || item.reason.trim().length === 0) fail(`${key} is unresolved but has no reason`);
    if (item.materials) fail(`${key} is unresolved and must not claim materials`);
  }
}

if (manifest.scope?.packageCount !== packages.length) fail(`scope packageCount ${manifest.scope?.packageCount} does not match ${packages.length}`);
if (manifest.scope?.verifiedPackageCount !== verifiedCount) fail(`scope verifiedPackageCount does not match ${verifiedCount}`);
if ((manifest.scope?.supplementedPackageCount ?? 0) !== supplementedCount) fail(`scope supplementedPackageCount does not match ${supplementedCount}`);
if (manifest.scope?.unresolvedPackageCount !== unresolvedCount) fail(`scope unresolvedPackageCount does not match ${unresolvedCount}`);
const originalTextCount = materials.filter(material => !material.source?.kind || material.source.kind === 'upstream-license-text').length;
const standardCount = materials.filter(material => material.source?.kind === 'license-standard').length;
const declarationCount = materials.filter(material => ['npm-package-evidence', 'upstream-license-declaration'].includes(material.source?.kind)).length;
if (manifest.bundle?.verifiedSourceMaterialCount !== originalTextCount) fail('bundle verifiedSourceMaterialCount does not match upstream original text count');
if ((manifest.bundle?.standardLicenseMaterialCount ?? 0) !== standardCount) fail('bundle standardLicenseMaterialCount does not match normative text count');
if ((manifest.bundle?.declarationEvidenceMaterialCount ?? 0) !== declarationCount) fail('bundle declarationEvidenceMaterialCount does not match declaration evidence count');
if ((manifest.bundle?.supplementedPackageCount ?? 0) !== supplementedCount) fail('bundle supplementedPackageCount does not match supplemented package count');
if (manifest.bundle?.materialCount !== undefined && manifest.bundle.materialCount !== materials.length) fail('bundle materialCount does not match all materials length');
if (manifest.bundle?.unresolvedPackageCount !== unresolvedCount) fail('bundle unresolvedPackageCount does not match unresolved package count');
if (release && unresolvedCount > 0) {
  fail(`release requires complete third-party license materials; ${unresolvedCount} package version${unresolvedCount === 1 ? '' : 's'} remain unresolved: ${packages.filter(item => item.status === 'unresolved').map(packageKey).join(', ')}`);
}

const textRoot = resolve(root, 'legal/third-party/texts');
try {
  for (const entry of await readdir(textRoot, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const candidate = `legal/third-party/texts/${entry.name}`;
    if (!materialPaths.has(candidate)) fail(`unindexed legal text file: ${candidate}`);
  }
  if (supplementedCount > 0) {
    for (const entry of await readdir(resolve(root, 'legal/third-party/evidence'), { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const candidate = `legal/third-party/evidence/${entry.name}`;
      if (!materialPaths.has(candidate)) fail(`unindexed declaration evidence file: ${candidate}`);
    }
  }
} catch (error) {
  fail(`cannot inspect legal/third-party/texts: ${error.message}`);
}

if (errors.length > 0) {
  console.error(`Third-party license material verification failed (${errors.length} error${errors.length === 1 ? '' : 's'}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Verified ${materials.length} checked-in material files for ${packages.length} package versions (${verifiedCount} with upstream original text, ${supplementedCount} declared with labelled supplement, ${unresolvedCount} unresolved).`);
  if (unresolvedCount > 0) console.log('This verifies the material index only. It is not a passed release license gate; run with --release to enforce complete materials.');
}
