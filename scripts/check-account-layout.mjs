import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const root = resolve('dist/preview');
const candidates = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name.endsWith('-portable'));
if (candidates.length !== 1) throw Error('Build one fresh portable candidate in CI or set KEEPANY_PREVIEW_DIRECTORY and run Playwright directly.');
const candidate = join(root, candidates[0].name);
const evidence = 'test-results/account-layout-ci';
const env = { ...process.env, KEEPANY_PREVIEW_DIRECTORY: candidate, KEEPANY_RELEASE_TEST_PORT: '4230', KEEPANY_EVIDENCE_DIR: evidence };
delete env.KEEPANY_LAYOUT_REUSE;
for (const args of [
  ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.account-layout.config.ts', 'tests/e2e/account-password-layout.spec.ts'],
  ['scripts/verify-account-layout-evidence.mjs', evidence, candidate],
]) {
  const run = spawnSync(process.execPath, args, { env, stdio: 'inherit' });
  if (run.status !== 0) process.exit(run.status ?? 1);
}
