import { chromium } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const root = process.cwd();
const out = resolve('docs/qa/2026-10-29/accounts-single-entry/independent-before');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 1050 }, locale: 'zh-CN' });
const page = await context.newPage();
const events = [];
page.on('pageerror', error => events.push(error.message));
const result = { source: 'http://127.0.0.1:4397', sourceOnly: true, head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), tests: [], events };
try {
  await page.goto(`${result.source}/accounts`);
  await page.locator('#password-vault-master').fill('SyntheticIndependentMaster2026!');
  await page.locator('#password-vault-master-confirm').fill('SyntheticIndependentMaster2026!');
  await page.getByRole('button', { name: '创建密码库', exact: true }).click();
  await page.locator('.password-vault-toolbar').waitFor();
  await page.screenshot({ path: join(out, 'two-global-adds.png'), fullPage: true });
  const adds = await page.locator('.password-vault-header button, .password-vault-toolbar .password-vault-new').count();
  result.tests.push({ id: 'SE01', expected: 1, actual: adds, verdict: adds === 1 ? 'pass' : 'fail', detail: 'Header account create and toolbar password create both present.' });
  await page.locator('.password-vault-header').getByRole('button', { name: '新增', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('dialog').getByRole('textbox', { name: '服务商', exact: true }).waitFor();
  await page.screenshot({ path: join(out, 'ordinary-account-form.png'), fullPage: true });
  const accountHasPassword = await page.locator('#password-vault-entry-password').count();
  result.tests.push({ id: 'SE03-account', expected: 'same form has password', actual: accountHasPassword, verdict: accountHasPassword ? 'pass' : 'fail' });
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('.password-vault-toolbar .password-vault-new').click();
  await page.getByRole('dialog').waitFor();
  await page.locator('#password-vault-entry-title').waitFor();
  await page.screenshot({ path: join(out, 'password-form-missing-account-fields.png'), fullPage: true });
  const labels = await page.getByRole('dialog').locator('label').allTextContents();
  const missing = ['分类', '服务商', '联系方式', '用途', '状态', '账号资料核实日期', '标签（逗号分隔）'].filter(label => !labels.includes(label));
  result.tests.push({ id: 'SE03-password', expected: 'all previous account fields in password form', actual: labels, missing, verdict: missing.length ? 'fail' : 'pass' });
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  const trash = page.locator('.password-vault-trash-open');
  await trash.click();
  result.tests.push({ id: 'SE07-redundant-trigger', expected: 'no duplicate top trigger', actual: { triggers: await trash.count(), belowVisible: await page.locator('#vault-trash').isVisible(), url: page.url() }, verdict: 'fail', detail: 'Top trigger redundant with visible lower region. This assertion does not claim every click is unresponsive.' });
  result.sourceFiles = {};
  for (const name of ['apps/web/src/page-workspaces.tsx', 'apps/web/src/components/PasswordVaultPanel.tsx', 'apps/web/src/components/PasswordVaultEntryEditor.tsx']) result.sourceFiles[name] = createHash('sha256').update(await readFile(resolve(name))).digest('hex');
} catch (error) {
  result.preparationError = String(error);
  await page.screenshot({ path: join(out, 'preparation-error.png'), fullPage: true });
  process.exitCode = 2;
} finally {
  await writeFile(join(out, 'result.json'), JSON.stringify(result, null, 2));
  await context.close();
  await browser.close();
}
console.log(JSON.stringify(result, null, 2));
