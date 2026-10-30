import { openProjectDetails } from "./helpers/project-details";
import { openBackupPage } from "./helpers/backup-restore";
import { execFileSync, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { strFromU8, unzipSync } from 'fflate';
import { passwordVaultCopy } from '../../apps/web/src/password-vault-copy';
import { decryptBackup } from '../../packages/local-db/src/backup-crypto';
import type * as VaultEngine from '../../packages/password-vault/src/engine';
import { activeWorkerSource, originalImage, startPackage, stopPackage, unusedPort } from './helpers/portable-upgrade';
import { selectChoice } from './helpers/select-choice';
import { openVaultAccess, revealPasswordEntries } from './helpers/vault-access';
import { openBackupRestorePanel } from './helpers/backup-restore';

// Published baselines must include aliases, asset links and encrypted import drafts.
// The older 8f9a1b5 fixture cannot establish password-vault compatibility.
const oldCommit = process.env.KEEPANY_UPGRADE_BASE_COMMIT ?? '64b98e7874a2fdd8d43c8e60de72a25de5800b25';
if (!/^[a-f0-9]{40}$/i.test(oldCommit)) throw Error('KEEPANY_UPGRADE_BASE_COMMIT must be a full 40-hex commit SHA');
const oldBrand = process.env.KEEPANY_UPGRADE_BASE_BRAND ?? 'KeepAny';
if (oldBrand !== 'KeepAny' && oldBrand !== 'StackPerch') throw Error('KEEPANY_UPGRADE_BASE_BRAND must be KeepAny or StackPerch');
const master = 'Synthetic brand upgrade master 2026!';
const backupPassword = 'Synthetic brand upgrade outer backup!';
const loginPassword = 'Synthetic upgrade login only!42';
const alias = 'synthetic-upgrade-alias';
const draftSource = 'Synthetic pending app\npending@example.test\nSynthetic pending password!42';
const draftNote = 'Synthetic reviewed note retained across branding';
const sha256 = (bytes: Buffer | string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const t = (key: string) => passwordVaultCopy[key]?.[1] ?? key;
test.skip(process.env.KEEPANY_BRAND_UPGRADE !== '1', 'Run with playwright.brand-upgrade.config.ts and a built portable preview');

type Release = {
  productName: string;
  sourceCommit: string;
  sourceDirty: boolean;
  applicationRoutes: string[];
  webFiles: Array<{ path: string; sha256: string }>;
};

function extractCandidate(root: string, directory: string) {
  const explicit = process.env.KEEPANY_PREVIEW_ARCHIVE;
  const preview = join(root, 'dist', 'preview');
  const archive = explicit ? resolve(explicit) : join(preview, readdirSync(preview)
    .filter(name => name.endsWith('.zip'))
    .sort((a, b) => statSync(join(preview, b)).mtimeMs - statSync(join(preview, a)).mtimeMs)[0] ?? '');
  if (!archive.endsWith('.zip')) throw Error('Build a portable preview or set KEEPANY_PREVIEW_ARCHIVE to its ZIP');
  const entries = unzipSync(new Uint8Array(readFileSync(archive)));
  const releaseEntry = Object.keys(entries).filter(name => /^[^/]+\/RELEASE\.json$/.test(name));
  if (releaseEntry.length !== 1) throw Error('Expected one portable package root');
  const prefix = releaseEntry[0].slice(0, -'RELEASE.json'.length);
  // Only runtime files are needed. Extracting the archive proves the supplied ZIP,
  // rather than silently using a sibling build directory.
  for (const [path, bytes] of Object.entries(entries)) {
    if (!path.startsWith(prefix)) throw Error('Portable archive contains an unexpected root');
    const relative = path.slice(prefix.length);
    if (relative.includes('\\') || relative.split('/').includes('..')) throw Error('Invalid portable archive path');
    if (!relative.startsWith('web/') && !['RELEASE.json', 'preview-server.mjs'].includes(relative)) continue;
    if (relative.endsWith('/')) continue;
    const target = resolve(directory, relative);
    if (!target.startsWith(`${resolve(directory)}${sep}`)) throw Error('Invalid portable extraction target');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  return JSON.parse(readFileSync(join(directory, 'RELEASE.json'), 'utf8')) as Release;
}

let engineRuntime: Promise<typeof VaultEngine> | undefined;
async function inspectKdbx(bytes: Uint8Array) {
  // Same bundled read-only Node inspection pattern used by the vault fixtures.
  engineRuntime ??= build({ entryPoints: ['packages/password-vault/src/engine.ts'], bundle: true,
    platform: 'node', format: 'cjs', write: false }).then(result => {
    const module = { exports: {} };
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(
      createRequire(join(process.cwd(), 'package.json')), module, module.exports);
    return module.exports as typeof VaultEngine;
  });
  const engine = await engineRuntime;
  const key = engine.credentials(master);
  const db = await engine.loadDatabase(bytes, key);
  try {
    const entries = [...db.getDefaultGroup().allEntries()].filter(entry => !engine.isTrash(db, entry));
    const drafts = entries.map(entry => engine.draftOf(entry));
    const fieldHashes = entries.map(entry => ({ id: entry.uuid.id,
      fields: [...entry.fields].map(([name, value]) => ({ name,
        hash: sha256(typeof value === 'string' ? value : value.getText()) })).sort((a, b) => a.name.localeCompare(b.name)),
    })).sort((a, b) => a.id.localeCompare(b.id));
    const metadataHashes = [...db.meta.customData].map(([name, item]) => ({ name,
      hash: sha256(String(item.value ?? '')) })).sort((a, b) => a.name.localeCompare(b.name));
    const encryptedDraft = engine.readImportDraft(db);
    return { ids: drafts.map(entry => entry.id),
      linkedAssetIds: drafts.map(entry => entry.linkedAssetIds),
      aliasCount: drafts.reduce((count, entry) => count + (entry.usernameAliases?.length ?? 0), 0),
      loginHash: sha256(drafts[0]?.password ?? ''),
      aliasHash: sha256(drafts[0]?.usernameAliases?.[0] ?? ''),
      fieldHashes, metadataHashes,
      importDraftHash: encryptedDraft === null ? null : sha256(encryptedDraft),
      draftHash: sha256(JSON.stringify(drafts)),
    };
  } finally {
    engine.clearDatabase(db);
    engine.clearCredentials(key);
  }
}

async function addAsset(page: Page, origin: string, kind: 'project' | 'account', name: string) {
  await page.goto(`${origin}/assets/${kind}`);
  await page.getByRole('main').getByRole('button', { name: 'Add', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByText(name, { exact: true }).first().click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  return new URL(page.url()).pathname;
}

async function downloadVault(page: Page, path: string) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: t('pwVaultExport'), exact: true }).click();
  await (await download).saveAs(path);
  return inspectKdbx(new Uint8Array(readFileSync(path)));
}

async function unlock(page: Page) {
  await openVaultAccess(page);
  await page.locator('#password-vault-unlock-master').fill(master);
  await page.getByRole('button', { name: t('pwVaultUnlock'), exact: true }).click();
  await expect(page.locator('.password-vault-toolbar')).toBeVisible();
  await revealPasswordEntries(page);
}

async function checkDraft(page: Page) {
  await page.getByRole('button', { name: t('pwSmartTitle'), exact: true }).click();
  const importer = page.locator('.password-smart-import');
  await expect(importer.locator('.pw-work-list-row')).toHaveCount(1);
  // Hash comparisons ensure assertion errors do not print passwords or raw source.
  expect(sha256(await importer.locator(".pw-work-editor [id$='-notes']").first().inputValue())).toBe(sha256(draftNote));
  await page.getByRole('dialog', { name: t('pwSmartTitle'), exact: true })
    .getByRole('button', { name: 'Close', exact: true }).first().click();
  await page.getByRole('button', { name: t('pwSmartCloseKeepDraft'), exact: true }).click();
  await expect(importer).toHaveCount(0);
}

test('published assets, vault fields, import draft and backup survive the current KeepAny portable upgrade', async () => {
  const root = process.cwd();
  const directory = mkdtempSync(join(tmpdir(), 'keepany-stackperch-upgrade-'));
  const oldPackage = join(directory, 'old-package');
  const newPackage = join(directory, 'new-package');
  const profile = join(directory, 'same-origin-profile');
  const port = await unusedPort();
  const origin = `http://127.0.0.1:${port}`;
  const project = `Synthetic upgrade project ${crypto.randomUUID().slice(0, 8)}`;
  const account = 'Synthetic upgrade account';
  const entryName = 'Synthetic linked login';
  const oldBackup = join(directory, 'old-backup.ka1');
  const errors: string[] = [];
  let context: BrowserContext | undefined;
  let restoredContext: BrowserContext | undefined;
  let oldService: ChildProcess | undefined;
  let newService: ChildProcess | undefined;
  let stage = 'prepare packages';
  let compatibilityFailure: Error | undefined;
  let cleanupFailure: Error | undefined;
  try {
    mkdirSync(join(oldPackage, 'web'), { recursive: true });
    const release = extractCandidate(root, newPackage);
    expect(release.productName).toBe('KeepAny');
    // The published fixed package retains historical resources and exceeds the
    // original fixture's stdout buffer. Write its archive to this temporary tree.
    const oldArchive = join(directory, 'published-web.tar');
    execFileSync('git', ['archive', '--output', oldArchive, oldCommit, 'release/web'], { cwd: root });
    const extracted = spawnSync('tar', ['-xf', oldArchive, '-C', join(oldPackage, 'web'), '--strip-components=2']);
    if (extracted.status !== 0) throw Error('Published baseline web extraction failed');
    cpSync(join(newPackage, 'preview-server.mjs'), join(oldPackage, 'preview-server.mjs'));
    writeFileSync(join(oldPackage, 'RELEASE.json'), JSON.stringify({ version: `published-${oldCommit.slice(0, 12)}`,
      productName: oldBrand, sourceCommit: oldCommit, applicationRoutes: release.applicationRoutes }));
    for (const file of release.webFiles) expect(sha256(readFileSync(join(newPackage, 'web', file.path)))).toBe(file.sha256);
    for (const packageRoot of [oldPackage, newPackage]) {
      const manifest = JSON.parse(readFileSync(join(packageRoot, 'web', 'manifest.webmanifest'), 'utf8'));
      expect(manifest).toMatchObject({ id: '/', start_url: '/', scope: '/' });
    }
    const entry = (path: string) => readFileSync(path, 'utf8').match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)?.[1];
    const oldEntry = entry(join(oldPackage, 'web', 'index.html'));
    const newEntry = entry(join(newPackage, 'web', 'index.html'));
    expect(oldEntry).toBeTruthy(); expect(newEntry).toBeTruthy(); expect(newEntry).not.toBe(oldEntry);
    const oldWorkerHash = sha256(readFileSync(join(oldPackage, 'web', 'sw.js')));
    const newWorkerHash = sha256(readFileSync(join(newPackage, 'web', 'sw.js')));
    expect(newWorkerHash).not.toBe(oldWorkerHash);

    stage = 'seed old UI and a saved language opposite to browser locale';
    oldService = await startPackage(oldPackage, port);
    context = await chromium.launchPersistentContext(profile, { locale: 'zh-CN', acceptDownloads: true,
      viewport: { width: 1280, height: 900 } });
    context.setDefaultTimeout(12_000);
    const page = context.pages()[0] ?? await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/settings`);
    await expect(page).toHaveTitle(oldBrand);
    await expect(page.locator('.brand strong')).toHaveText(oldBrand);
    await selectChoice(page.getByRole('combobox', { name: '语言', exact: true }), 'en');
    await expect(page.getByRole('heading', { name: 'Language', exact: true })).toBeVisible();
    const projectPath = await addAsset(page, origin, 'project', project);
    const projectId = projectPath.split('/').at(-1)!;
    const imageBase64 = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
      const pen = canvas.getContext('2d'); if (!pen) throw Error('Canvas missing');
      pen.fillStyle = '#237bc4'; pen.fillRect(0, 0, 16, 16);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const imageBytes = Buffer.from(imageBase64, 'base64');
    await openProjectDetails(page);
    await page.getByLabel('Add image').setInputFiles({ name: 'synthetic-upgrade.png', mimeType: 'image/png', buffer: imageBytes });
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
    expect(sha256(Buffer.from(await originalImage(page)))).toBe(sha256(imageBytes));
    const accountPath = await addAsset(page, origin, 'account', account);
    const accountId = accountPath.split('/').at(-1)!;

    stage = 'create linked old KDBX entry with alias and encrypted import draft';
    await page.getByRole('link', { name: 'Manage this account’s passwords', exact: true }).click();
    await page.locator('#password-vault-master').fill(master);
    await page.locator('#password-vault-master-confirm').fill(master);
    await page.getByRole('button', { name: t('pwVaultCreate'), exact: true }).click();
    await expect(page.locator('.password-vault-toolbar')).toBeVisible();
    await page.getByRole('button', { name: t('pwVaultNewEntry'), exact: true }).click();
    await page.locator('#password-vault-entry-title').fill(entryName);
    await page.locator('#password-vault-entry-username').fill('synthetic-login@example.test');
    await page.locator('#password-vault-entry-password').fill(loginPassword);
    await page.getByRole('dialog').getByRole('button', { name: t('pwVaultAddIdentifier'), exact: true }).click();
    await page.getByRole('dialog').locator('.pw-smart-identifier-row input').last().fill(alias);
    await expect(page.locator('.password-vault-linked-chip')).toContainText(account);
    await page.getByRole('button', { name: t('pwVaultSaveEntry'), exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.getByRole('button', { name: t('pwSmartTitle'), exact: true }).click();
    const importer = page.locator('.password-smart-import');
    await importer.locator('#pw-smart-source').fill(draftSource);
    await importer.getByRole('button', { name: 'Recognize on device', exact: true }).click();
    await expect(importer.locator('.pw-work-list-row')).toHaveCount(1);
    await importer.locator(".pw-work-editor [id$='-notes']").first().fill(draftNote);
    await expect(page.locator('.pw-smart-draft-status')).toHaveText(t('pwSmartDraftSaved'));
    await page.getByRole('dialog', { name: t('pwSmartTitle'), exact: true })
      .getByRole('button', { name: 'Close', exact: true }).first().click();
    await page.getByRole('button', { name: t('pwSmartCloseKeepDraft'), exact: true }).click();
    await expect(importer).toHaveCount(0);
    const oldVault = await downloadVault(page, join(directory, 'old-vault.kdbx'));
    expect(oldVault.ids).toHaveLength(1);
    expect(oldVault.linkedAssetIds).toEqual([[accountId]]);
    expect(oldVault.aliasCount).toBe(1);
    expect(oldVault.loginHash).toBe(sha256(loginPassword));
    expect(oldVault.aliasHash).toBe(sha256(alias));
    expect(oldVault.importDraftHash).not.toBeNull();
    expect(oldVault.fieldHashes[0].fields.map(field => field.name)).toEqual(expect.arrayContaining([
      'KeepAny.LinkedAssetIds', 'KeepAny.UsernameAliases',
    ]));
    expect(oldVault.metadataHashes.map(field => field.name)).toEqual(expect.arrayContaining([
      'KeepAny.ContentRevision', 'KeepAny.ImportDraft',
    ]));

    stage = 'download the published UI backup before replacing the package';
    await page.goto(`${origin}/intake`);
    await openBackupPage(page); await page.locator('#backup-password').fill(backupPassword);
    await page.getByRole('button', { name: 'Create backup', exact: true }).click();
    const backupDownload = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Save backup file', exact: true }).click();
    await (await backupDownload).saveAs(oldBackup);
    const backupBytes = new Uint8Array(readFileSync(oldBackup));
    expect(Buffer.from(backupBytes.slice(0, 8)).toString()).toBe('KEEPANY1');
    const entries = unzipSync(await decryptBackup(backupBytes, backupPassword));
    const records = JSON.parse(strFromU8(entries['records.json'])) as Array<{ type: string; payload: string }>;
    const assets = records.filter(row => row.type === 'asset').map(row => JSON.parse(row.payload));
    expect(assets.map(asset => asset.id).sort()).toEqual([projectId, accountId].sort());
    const oldProject = assets.find(asset => asset.id === projectId);
    expect(oldProject.attachments).toHaveLength(1);
    expect(sha256(entries[`files/${oldProject.attachments[0]}`])).toBe(sha256(imageBytes));
    expect(await inspectKdbx(entries['password-vault.kdbx'])).toEqual(oldVault);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    expect(sha256(await activeWorkerSource(context, origin))).toBe(oldWorkerHash);
    const oldDatabaseNames = await page.evaluate(async () => (await indexedDB.databases()).map(db => db.name).sort());

    stage = 'close the published PWA and reopen the same origin under KeepAny';
    for (const tab of context.pages()) await tab.close();
    await context.close(); context = undefined;
    await stopPackage(oldPackage, oldService); oldService = undefined;
    newService = await startPackage(newPackage, port);
    context = await chromium.launchPersistentContext(profile, { locale: 'zh-CN', acceptDownloads: true,
      viewport: { width: 1280, height: 900 } });
    context.setDefaultTimeout(12_000);
    const upgraded = context.pages()[0] ?? await context.newPage();
    upgraded.on('pageerror', error => errors.push(error.message));
    await upgraded.goto(`${origin}${projectPath}`);
    await expect(upgraded.getByRole('heading', { name: project, exact: true })).toBeVisible();
    await upgraded.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
    await expect.poll(async () => {
      try { return sha256(await activeWorkerSource(context!, origin)); } catch { return 'worker-transition'; }
    }, { timeout: 30_000, intervals: [250, 500, 1000] }).toBe(newWorkerHash);
    await upgraded.reload();
    await expect.poll(() => upgraded.locator('script[type="module"]').getAttribute('src')).toBe(newEntry);
    await expect(upgraded.locator('.brand strong')).toHaveText('KeepAny');
    await expect(upgraded).toHaveTitle('KeepAny');
    expect(sha256(Buffer.from(await originalImage(upgraded)))).toBe(sha256(imageBytes));
    expect(await upgraded.evaluate(async () => (await indexedDB.databases()).map(db => db.name).sort())).toEqual(oldDatabaseNames);
    await upgraded.goto(`${origin}/settings`);
    await expect(upgraded.getByRole('combobox', { name: 'Language', exact: true })).toHaveAttribute('data-value', 'en');
    expect(await upgraded.evaluate(() => localStorage.getItem('keepany-language'))).toBe('en');
    await upgraded.goto(`${origin}${accountPath}`);
    await expect(upgraded.getByRole('heading', { name: account, exact: true })).toBeVisible();
    await upgraded.goto(`${origin}/assets/vault`);
    await unlock(upgraded);
    await expect(upgraded.locator('.password-vault-entry-list .password-vault-entry')).toHaveCount(1);
    const upgradedVault = await downloadVault(upgraded, join(directory, 'upgraded-vault.kdbx'));
    expect(upgradedVault).toEqual(oldVault);
    await checkDraft(upgraded);

    stage = 'restore the old KA1 into an independent clean KeepAny browser';
    restoredContext = await chromium.launchPersistentContext(join(directory, 'clean-restore-profile'), {
      locale: 'en-US', acceptDownloads: true, viewport: { width: 390, height: 844 } });
    restoredContext.setDefaultTimeout(12_000);
    const restored = restoredContext.pages()[0] ?? await restoredContext.newPage();
    restored.on('pageerror', error => errors.push(error.message));
    await restored.goto(`${origin}/assets/project`);
    await expect(restored.getByText(project, { exact: true })).toHaveCount(0);
    await restored.goto(`${origin}/assets/vault`);
    await expect(restored.locator('#password-vault-master')).toBeVisible();
    await restored.goto(`${origin}/intake`);
    await openBackupRestorePanel(restored);
    await openBackupPage(restored); await restored.locator('#backup-password').fill(backupPassword);
    await restored.locator('#restore-file').setInputFiles(oldBackup);
    await restored.getByRole('button', { name: 'Preview', exact: true }).first().click();
    await restored.getByRole('button', { name: /Confirm ·/ }).click();
    await expect(restored.getByText(/Restored \d+ records/)).toBeVisible();
    await restored.goto(`${origin}${projectPath}`);
    await expect(restored.getByRole('heading', { name: project, exact: true })).toBeVisible();
    expect(sha256(Buffer.from(await originalImage(restored)))).toBe(sha256(imageBytes));
    await restored.reload();
    await expect(restored.getByRole('heading', { name: project, exact: true })).toBeVisible();
    expect(sha256(Buffer.from(await originalImage(restored)))).toBe(sha256(imageBytes));
    await restored.goto(`${origin}${accountPath}`);
    await expect(restored.getByRole('heading', { name: account, exact: true })).toBeVisible();
    await restored.goto(`${origin}/assets/vault`);
    await unlock(restored);
    expect(await downloadVault(restored, join(directory, 'restored-vault.kdbx'))).toEqual(oldVault);
    await checkDraft(restored);
    expect(errors).toEqual([]);
    console.log(JSON.stringify({ oldCommit, oldBrand, newCommit: release.sourceCommit, sourceDirty: release.sourceDirty,
      oldWorkerHash, newWorkerHash, oldEntry, newEntry, assetIds: [projectId, accountId],
      vaultEntryIds: oldVault.ids, aliasCount: oldVault.aliasCount, importDraftHash: oldVault.importDraftHash,
      imageSha256: sha256(imageBytes), backupSha256: sha256(backupBytes),
      recordCount: records.length, platform: process.platform, sameOriginUpgrade: true, cleanBackupRestore: true }, null, 2));
  } catch (error) {
    // Keep failure stage useful without dumping draft/source/password field values.
    const sourceLocation = error instanceof Error ? error.stack?.split('\n')
      .find(line => line.trimStart().startsWith('at ') && line.includes('stackperch-upgrade.spec.ts'))?.trim() : undefined;
    compatibilityFailure = Error(`KeepAny compatibility failed at: ${stage}${sourceLocation ? ` (${sourceLocation})` : ''}`);
  } finally {
    // Attempt every cleanup even if a browser or server fails to close.
    const cleanup = await Promise.allSettled([
      restoredContext?.close(), context?.close(), stopPackage(oldPackage, oldService), stopPackage(newPackage, newService),
    ]);
    const cleanupErrors = cleanup.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    const target = resolve(directory);
    if (!target.startsWith(`${resolve(tmpdir())}${sep}keepany-stackperch-upgrade-`)) {
      cleanupErrors.push(Error('Compatibility cleanup target escaped its allocated temporary directory'));
    } else {
      try { rmSync(target, { recursive: true, force: true }); }
      catch (error) { cleanupErrors.push(error); }
    }
    if (cleanupErrors.length) cleanupFailure = Error('An isolated compatibility fixture did not stop cleanly', {
      cause: new AggregateError(cleanupErrors),
    });
  }
  if (compatibilityFailure && cleanupFailure)
    throw new AggregateError([compatibilityFailure, cleanupFailure], 'Compatibility and fixture cleanup both failed');
  if (compatibilityFailure) throw compatibilityFailure;
  if (cleanupFailure) throw cleanupFailure;
});
