import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// This checks machine evidence only. Human visual review and owner/independent
// acceptance remain separate obligations; screenshot existence cannot prove them.
const [directoryArg, candidateArg] = process.argv.slice(2);
if (!directoryArg || !candidateArg) throw Error('Usage: node scripts/verify-account-layout-evidence.mjs <evidence-directory> <portable-directory>');
const directory = resolve(directoryArg), candidate = resolve(candidateArg);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const release = JSON.parse(await readFile(join(candidate, 'RELEASE.json'), 'utf8'));
const indexSha256 = sha(await readFile(join(candidate, 'web/index.html')));
const receipts = [];
let baselinePending = false;
for (const language of ['zh-CN', 'en']) for (const width of [390, 768, 1280, 1920, 2560]) {
  const name = `result-${language}-${width}.json`;
  const result = JSON.parse(await readFile(join(directory, name), 'utf8'));
  if (result.language !== language || result.width !== width || result.status !== 'passed'
    || !result.candidate.portable || result.candidate.indexSha256 !== indexSha256
    || !['AL01', 'AL02', 'AL10'].every(id => result.ids.includes(id)) || result.errors.length
    || result.maskLines !== 1 || result.usernameLines !== 1 || result.notes.valueWidth < result.notes.rowWidth * .6
    || result.cancelAndReloadPreserved !== true
    || !Array.isArray(result.savedEntryIds) || result.savedEntryIds.length === 0
    || result.savedEntryIds.some(id => typeof id !== 'string' || !id.trim())
    || new Set(result.savedEntryIds).size !== result.savedEntryIds.length
    || !Array.isArray(result.baselineCandidates) || result.baselineCandidates.length !== 2
    || new Set(result.baselineCandidates.map(item => item?.state)).size !== 2
    || !['expanded', 'collapsed'].every(state => result.baselineCandidates.some(item => item?.state === state))) throw Error(`Invalid or mismatched receipt: ${name}`);
  const evidence = [];
  for (const state of ['expanded', 'multiple', 'hover', 'focus', 'empty', 'toolbar']) {
    const path = `${state}-${language}-${width}.png`, bytes = await readFile(join(directory, path));
    if (bytes.length < 100 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw Error(`Invalid screenshot: ${path}`);
    evidence.push({ path, sha256: sha(bytes) });
  }
  const baselineCandidates = [];
  for (const image of result.baselineCandidates) {
    if (!['win32', 'linux', 'darwin'].includes(image.platform) || typeof image.browser !== 'string' || !image.browser.trim()
      || !['passed', 'pending-human-review'].includes(image.comparison)
      || typeof image.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(image.sha256)) throw Error(`Invalid baseline metadata: ${name}`);
    const imageName = `account-${language}-${width}-${image.state}.png`;
    const expectedName = `review-${image.platform}-${imageName}`;
    if (typeof image.path !== 'string' || resolve(image.path) !== join(directory, expectedName)
      || image.baseline !== `${image.platform}/accounts/${imageName}`) throw Error(`Mismatched baseline stage or path: ${name}`);
    const bytes = await readFile(join(directory, expectedName));
    if (bytes.length < 100 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || sha(bytes) !== image.sha256) throw Error(`Invalid or mismatched baseline PNG: ${expectedName}`);
    if (image.comparison === 'pending-human-review') baselinePending = true;
    baselineCandidates.push({ ...image, path: expectedName });
  }
  receipts.push({ path: name, sha256: sha(await readFile(join(directory, name))), evidence, baselineCandidates });
}
await writeFile(join(directory, 'machine-check.json'), JSON.stringify({ schema: 'keepany.account-layout-evidence.v2', status: 'passed', sourceCommit: release.sourceCommit, version: release.version, indexSha256, receipts, baselineComparison: baselinePending ? 'pending-human-review' : 'passed', finiteTestImprovementAcceptance: 'separate-required', manualVisual: 'separate-required', ownerExperience: 'separate-required', independentReview: 'separate-required' }, null, 2));
console.log(`Verified AL01/AL02 machine evidence for 10 language/width combinations against ${indexSha256}; baseline comparison ${baselinePending ? 'pending human review' : 'passed'}, finite test improvement and manual acceptance remain separate.`);
