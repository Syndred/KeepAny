import { expect, test, type Page } from '@playwright/test';
import { selectChoice } from "./helpers/select-choice";

const repositoryModuleUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;
const domainModuleUrl = `/@fs${process.cwd()}/packages/domain/src/index.ts`;

async function createFixture(page: Page) {
  return page.evaluate(async ([domainUrl, repositoryUrl]) => {
    const { newAsset } = await import(domainUrl);
    const { saveBatch } = await import(repositoryUrl);
    const project = { ...newAsset('project'), name: 'Atlas Lab', description: 'Current product profile', url: 'https://atlas.example', projectDomains: [{ id: crypto.randomUUID(), name: 'atlas.example', registrar: 'Registry A', accountId: '', expiryDate: '2027-01-01', annualAmount: 12000, currency: 'CNY', autoRenew: 'on' }] };
    const account = { ...newAsset('account'), name: 'Atlas admin', username: 'admin@atlas.example' };
    const subscription = { ...newAsset('subscription'), name: 'Atlas hosting', amount: 9800, currency: 'CNY', dueDate: '2026-10-22' };
    const related = [account, subscription].map(asset => ({ id: crypto.randomUUID(), from: project.id, to: asset.id, label: 'managed by', createdAt: new Date().toISOString(), verifiedAt: '', deleted: false }));
    const submission = { id: crypto.randomUUID(), assetId: project.id, name: 'Atlas listing', url: 'https://directory.example/atlas', status: 'indexed', submittedAt: '', verifiedAt: '', evidence: '', deleted: false };
    await saveBatch([...([project, account, subscription].map(value => ({ type: 'asset' as const, value }))), ...related.map(value => ({ type: 'relation' as const, value })), { type: 'submission', value: submission }]);
    return project.id as string;
  }, [domainModuleUrl, repositoryModuleUrl]);
}

test('brand changes use one evidence-backed round and preserve its snapshot', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('keepany-language', 'en'));
  const projectId = await createFixture(page);
  await page.goto(`/assets/project/${projectId}`);
  await page.getByRole('link', { name: 'Review profile changes' }).click();
  await expect(page.getByRole('heading', { name: 'Review profile change impact' })).toBeVisible();
  await expect(page.locator('.project-workflow-preview-row')).toHaveCount(5);
  await page.getByLabel('Proposed name').fill('Atlas Studio');
  await page.getByRole('button', { name: 'Create action plan' }).click();
  await expect(page.locator('.project-workflow-task')).toHaveCount(5);
  await page.reload();
  await expect(page.locator('.project-workflow-task')).toHaveCount(5);
  await expect(page.locator('.project-workflow-before-after')).toContainText('Atlas Studio');
  await page.locator('.project-workflow-task').first().getByRole('button', { name: 'Record result' }).click();
  await page.locator('.project-workflow-task').first().getByLabel('Evidence or note').fill('Updated local project profile and checked title.');
  await page.locator('.project-workflow-task').first().getByRole('button', { name: 'Save result' }).click();
  await expect(page.locator('.project-workflow-task').first()).toContainText('Updated local project profile and checked title.');
  await page.getByRole('button', { name: 'Review records' }).click();
  await expect(page.locator('.project-workflow-report-counts')).toContainText('Pending: 4');
  await expect(page.locator('.project-workflow-report')).toContainText('This record does not confirm completion');
  await page.getByRole('button', { name: 'Back to actions' }).click();
  await expect(page.getByRole('button', { name: 'Start another round' })).toBeDisabled();
  await page.reload();
  await expect(page.locator('.project-workflow-task')).toHaveCount(5);
});

test('close and handover requires evidence, records blockers and gates local archive', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('keepany-language', 'en'));
  const projectId = await createFixture(page);
  await page.goto(`/assets/project/${projectId}`);
  await page.getByRole('link', { name: 'Close or hand over' }).click();
  await page.getByRole('button', { name: 'Create action plan' }).click();
  const tasks = page.locator('.project-workflow-task');
  await expect(tasks).toHaveCount(7);
  await expect(tasks.filter({ hasText: 'Atlas hosting' })).toContainText('98.00');
  await expect(tasks.filter({ hasText: 'Atlas hosting' })).toContainText('Oct 22, 2026');
  await expect(tasks.filter({ hasText: 'atlas.example' }).first()).toContainText('Registry A');
  await expect(tasks.filter({ hasText: 'atlas.example' }).first()).toContainText('Jan 1, 2027');
  await expect(tasks.last().getByRole('button', { name: 'Record result' })).toBeDisabled();
  await tasks.first().getByRole('button', { name: 'Record result' }).click();
  await selectChoice(tasks.first().getByLabel('Result'), 'blocked');
  await tasks.first().getByLabel('Evidence or note').fill('Backup destination unavailable');
  await tasks.first().getByRole('button', { name: 'Save result' }).click();
  await expect(tasks.first()).toContainText('Backup destination unavailable');
  await page.getByRole('button', { name: 'Review records' }).click();
  await expect(page.locator('.project-workflow-report-counts')).toContainText('Blocked, follow up: 1');
  await expect(page.getByRole('button', { name: 'Archive local project' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to actions' }).click();
  for (let index = 0; index < 6; index++) {
    const row = tasks.nth(index);
    await row.getByRole('button', { name: /Record result|Edit result/ }).click();
    await selectChoice(row.getByLabel('Result'), index === 0 ? 'done' : 'na');
    await row.getByLabel('Evidence or note').fill(`Verified item ${index} on its platform`);
    await row.getByRole('button', { name: 'Save result' }).click();
  }
  await expect(tasks.last().getByRole('button', { name: 'Record result' })).toBeEnabled();
  await tasks.last().getByRole('button', { name: 'Record result' }).click();
  await tasks.last().getByLabel('Evidence or note').fill('Handover complete; archive local record.');
  await tasks.last().getByRole('button', { name: 'Save result' }).click();
  await page.getByRole('button', { name: 'Review records' }).click();
  await expect(page.locator('.project-workflow-report')).toContainText('All checklist items have a record');
  await page.getByRole('button', { name: 'Archive local project' }).click();
  await expect(page.getByRole('dialog')).toContainText('does not stop external services');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm local archive' }).click();
  await expect(page.locator('.project-workflow-report')).toContainText('This local project is archived');
  await page.reload();
  await expect(page.locator('.project-workflow-task')).toHaveCount(7);
  await page.getByRole('button', { name: 'Review records' }).click();
  await expect(page.locator('.project-workflow-report')).toContainText('This local project is archived');
  await page.getByRole('button', { name: 'Back to actions' }).click();
  await expect(page.getByRole('button', { name: 'Start another round' })).toBeEnabled();
});
