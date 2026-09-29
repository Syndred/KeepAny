import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
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
    const digest = createHash('sha256').update(await readFile(absolute)).digest('hex');
    if (digest !== material.sha256) fail(`material ${material.id} sha256 mismatch: expected ${material.sha256}, got ${digest}`);
  } catch (error) {
    fail(`material ${material.id} cannot be read: ${error.message}`);
  }
  if (!material.source || typeof material.source !== 'object') fail(`material ${material.id} lacks upstream source metadata`);
  else {
    for (const field of ['repository', 'commit', 'path', 'downloadUrl', 'mapping']) {
      if (typeof material.source[field] !== 'string' || material.source[field].length === 0) {
        fail(`material ${material.id} source.${field} is missing`);
      }
    }
    if (!/^[a-f0-9]{40}$/.test(material.source.commit)) fail(`material ${material.id} source.commit is not a pinned commit`);
  }
}
const packageIds = new Set();
let verifiedCount = 0;
let unresolvedCount = 0;
for (const item of packages) {
  const key = packageKey(item);
  if (!item || typeof item !== 'object' || !item.name || !item.version) {
    fail('package entry must include name and version');
    continue;
  }
  if (packageIds.has(key)) fail(`duplicate package entry: ${key}`);
  packageIds.add(key);
  if (!['verified', 'unresolved'].includes(item.status)) fail(`${key} has invalid status`);
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
    }
    if (!item.upstream || !Array.isArray(item.upstream.materials)) fail(`${key} lacks upstream.materials provenance`);
  } else {
    unresolvedCount += 1;
    if (typeof item.reason !== 'string' || item.reason.trim().length === 0) fail(`${key} is unresolved but has no reason`);
    if (item.materials) fail(`${key} is unresolved and must not claim materials`);
  }
}

if (manifest.scope?.packageCount !== packages.length) fail(`scope packageCount ${manifest.scope?.packageCount} does not match ${packages.length}`);
if (manifest.scope?.verifiedPackageCount !== verifiedCount) fail(`scope verifiedPackageCount does not match ${verifiedCount}`);
if (manifest.scope?.unresolvedPackageCount !== unresolvedCount) fail(`scope unresolvedPackageCount does not match ${unresolvedCount}`);
if (manifest.bundle?.verifiedSourceMaterialCount !== materials.length) fail('bundle verifiedSourceMaterialCount does not match materials length');
if (manifest.bundle?.unresolvedPackageCount !== unresolvedCount) fail('bundle unresolvedPackageCount does not match unresolved package count');

const textRoot = resolve(root, 'legal/third-party/texts');
try {
  for (const entry of await readdir(textRoot, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const candidate = `legal/third-party/texts/${entry.name}`;
    if (!materialPaths.has(candidate)) fail(`unindexed legal text file: ${candidate}`);
  }
} catch (error) {
  fail(`cannot inspect legal/third-party/texts: ${error.message}`);
}

if (errors.length > 0) {
  console.error(`Third-party license material verification failed (${errors.length} error${errors.length === 1 ? '' : 's'}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Verified ${materials.length} checked-in license text file${materials.length === 1 ? '' : 's'} for ${packages.length} package versions (${verifiedCount} verified, ${unresolvedCount} unresolved).`);
}
