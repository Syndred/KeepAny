import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { readCandidate, selectCandidate } from './lib/portable-candidate.mjs';
const output = resolve(process.argv[2] ?? 'test-results/sidebar-bottom-ci');
if (existsSync(output)) throw Error('Choose a new evidence directory; preserve earlier failures.');
mkdirSync(output, { recursive: true });
const web = process.env.KEEPANY_WEB_CANDIDATE;
const manifest = web ? JSON.parse(readFileSync(join(web, 'CANDIDATE.json'), 'utf8')) : readCandidate(selectCandidate()).release;
const sha = data => createHash('sha256').update(data).digest('hex');
const identity = manifest.webFiles.find(f => f.path === 'index.html')?.sha256;
if (!identity) throw Error('Missing compiled candidate identity.');
if (web) for (const file of manifest.webFiles) if (sha(readFileSync(join(web, file.path))) !== file.sha256) throw Error(`Candidate changed: ${file.path}`);
writeFileSync(join(output, 'candidate.json'), JSON.stringify({ sourceCommit: manifest.sourceCommit, sourceDirty: manifest.sourceDirty, indexSha256: identity, specSha256: sha(readFileSync('tests/e2e/sidebar-bottom.spec.ts')) }, null, 2));
const report = join(output, 'playwright.json');
const run = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', web ? 'playwright.catalog.config.ts' : 'playwright.portable-release.config.ts', 'tests/e2e/sidebar-bottom.spec.ts', '--reporter=json,line'], { env: { ...process.env, KEEPANY_EVIDENCE_DIR: join(output, 'browser'), PLAYWRIGHT_JSON_OUTPUT_FILE: report }, stdio: 'inherit', timeout: 240000 });
if (run.error || run.status !== 0) {
  writeFileSync(join(output, 'result.json'), JSON.stringify({ status: 'incomplete', exitCode: run.status, error: run.error?.message }));
  process.exitCode = 1;
} else {
  const data = JSON.parse(readFileSync(report, 'utf8')), tests = [];
  const walk = suites => suites.forEach(s => { for (const spec of s.specs ?? []) tests.push(...spec.tests); walk(s.suites ?? []); }); walk(data.suites);
  if (data.errors?.length || tests.length !== 12 || tests.some(t => t.status !== 'expected' || t.results.length !== 1 || t.results[0].status !== 'passed')) throw Error('Missing, failed, skipped or retried checks.');
  const receipts = tests.flatMap(t => t.results[0].attachments ?? []).filter(a => a.name === 'contract-results.json').map(a => JSON.parse(a.path ? readFileSync(a.path, 'utf8') : Buffer.from(a.body, 'base64').toString()));
  if (receipts.length !== 12 || receipts.some(r => r.candidate !== identity || r.result !== 'passed')) throw Error('Candidate or evidence mismatch.');
  for (const locale of ['zh-CN', 'en']) {
    for (const width of [390, 768, 1280, 1920, 1991]) if (!receipts.some(r => r.locale === locale && r.width === width && ['SB01','SB02','SB03'].every(id => r.ids.includes(id)))) throw Error(`Missing ${locale}/${width}`);
    if (!receipts.some(r => r.locale === locale && r.ids.includes('SB04'))) throw Error(`Missing long collection check: ${locale}`);
  }
  writeFileSync(join(output, 'result.json'), JSON.stringify({ status: 'machine-checks-passed', candidate: identity, tests: tests.length, manualVisual: 'separate', controller: 'separate', independentReview: 'separate' }, null, 2));
}
