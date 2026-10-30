import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readCandidate, selectCandidate } from './lib/portable-candidate.mjs';

const [argument, directory, ...extra] = process.argv.slice(2);
if (extra.length) throw Error('Usage: node scripts/check-cleanup-ux.mjs [portable-zip] [new-evidence-directory]');
const candidate = readCandidate(selectCandidate({ argument, archiveOnly: true }));
if (candidate.release.sourceDirty) throw Error('Use a clean compiled candidate.');
const output = resolve(directory ?? 'test-results/cleanup-ux-ci');
if (existsSync(output) && readdirSync(output).length) throw Error('Use a new evidence directory; original failures are preserved.');
mkdirSync(output, { recursive: true });
const env = { ...process.env, KEEPANY_PREVIEW_ARCHIVE: candidate.input, KEEPANY_QA_OUTPUT: join(output, 'run'), KEEPANY_EVIDENCE_DIR: join(output, 'screenshots') };
delete env.KEEPANY_PREVIEW_DIRECTORY;
const run = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.cleanup-ux.config.ts'], { env, stdio: 'inherit', timeout: 10 * 60_000 });
if (run.error) throw run.error;
if (run.status !== 0) process.exit(run.status ?? 1);
const report = JSON.parse(readFileSync(join(output, 'run', 'results.json'), 'utf8'));
const specs = [];
function collect(suite) { specs.push(...(suite.specs ?? [])); for (const child of suite.suites ?? []) collect(child); }
for (const suite of report.suites) collect(suite);
const check = (condition, message) => { if (!condition) throw Error(message); };
check(!report.errors?.length && report.stats.unexpected === 0 && report.stats.skipped === 0, 'Incomplete browser run.');
const own = specs.filter(spec => spec.file.replaceAll('\\', '/').endsWith('cleanup-ux.spec.ts'));
for (const id of ['UX01', 'UX02', 'UX03', 'UX04', 'UX06', 'UX07', 'UX08', 'AI01']) check(own.some(spec => spec.title.includes(id)), `Missing coverage: ${id}`);
const index = candidate.release.webFiles.find(file => file.path === 'index.html').sha256;
for (const spec of own) for (const test of spec.tests) {
 check(test.status === 'expected' && test.results.length === 1 && test.results[0].status === 'passed', `Unclosed result: ${spec.title}`);
 const attachment = test.results[0].attachments.find(item => item.name === 'candidate');
 check(attachment, `Missing candidate receipt: ${spec.title}`);
 const identity = JSON.parse(attachment.body ? Buffer.from(attachment.body, 'base64').toString('utf8') : readFileSync(attachment.path, 'utf8'));
 check(identity.sourceCommit === candidate.release.sourceCommit && identity.sourceDirty === false && identity.archiveSha256 === candidate.archiveSha256 && identity.indexSha256 === index, 'Mixed candidate evidence.');
}
const screenshots = [];
for (const language of ['zh-CN', 'en']) for (const width of [390, 768, 1280, 1920, 2560]) {
 check(own.some(spec => spec.title.startsWith(`VR01 ${language} ${width} `)), 'Missing language/viewport case.');
 for (const state of ['capture-hover', 'capture-focus', 'ai-disabled', 'backup', 'project-collapsed', 'project-graph', 'project-media', 'project-menu', 'global-menu', 'project-minimal', 'project-long-edit', 'project-long']) {
  const path = join(output, 'screenshots', `${language}-${width}-${state}.png`), bytes = readFileSync(path);
  check(bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', 'Invalid screenshot.');
  screenshots.push({ file: path, sha256: createHash('sha256').update(bytes).digest('hex') });
 }
}
writeFileSync(join(output, 'receipt.json'), JSON.stringify({ schema: 'keepany.cleanup-ux-check.v1', sourceCommit: candidate.release.sourceCommit, archiveSha256: candidate.archiveSha256, indexSha256: index, automatedCases: specs.length, screenshots, machineVerdict: 'passed', humanVisualReview: 'separate', controllerJourney: 'separate', independentReview: 'separate' }, null, 2));
console.log(`Current-candidate workflow integrity passed: ${specs.length} cases, ${screenshots.length} screenshot digests. Human review remains separate.`);
