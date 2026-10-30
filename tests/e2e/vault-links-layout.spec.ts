import { openBackupPage } from "./helpers/backup-restore";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import type { Asset, Relation } from "../../packages/domain/src";
import type { RecordRow } from "../../packages/local-db/src";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";
import { importVisualKdbxEntries, inspectVisualKdbx, visualCopy, visualMaster } from "./fixtures/password-smart-import-visual";
import { portableCandidate } from "./helpers/portable-candidate";
import { selectChoice } from "./helpers/select-choice";
import { openVaultAccess } from "./helpers/vault-access";
import { openAccountOption } from "./helpers/account-options";
import { resources } from "../../apps/web/src/i18n";

// Independent QA author. No product-state/scroll/CSS injection; all records are fictional.
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const sizes = [...[390, 563, 768, 1280, 1920, 2560].map(width => ({ width, height: 900 })), { width: 1280, height: 720 }];
for (const language of ["zh-CN", "en"] as const) for (const size of sizes) {
 test(`${language} ${size.width}x${size.height} FC24 selected bottom entry preserves dialog boundaries and saved identity`, async ({ page, request }, info) => {
  test.setTimeout(180000);
  const oldCopy = visualCopy(language), t = (key: string) => (resources[language].translation as Record<string,string>)[key] ?? oldCopy(key), { release, archiveSha256 } = portableCandidate();
  await page.setViewportSize(size);
  await page.addInitScript(value => localStorage.setItem("keepany-language", value), language);
  const folder = join(process.env.KEEPANY_LINKS_EVIDENCE ?? "test-results/vault-links-layout/evidence", `${language}-${size.width}-${size.height}`);
  mkdirSync(folder, { recursive: true });
  const steps: Record<string, unknown>[] = [], errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const pendingBaselines: Record<string, unknown>[] = [];
  const receipt: Record<string, unknown> = { schema: "keepany.vault-links-layout.case.v1", language, ...size, candidate: release.sourceCommit, sourceDirty: release.sourceDirty, archiveSha256, indexSha256: sha(await (await request.get("/")).body()), platform: process.platform, browser: page.context().browser()?.version(), screenshotBaseline: process.env.KEEPANY_REVIEWED_BASELINES ? "explicit-reviewed-directory" : "not-enabled-pending-human-review", pendingBaselines, preparation: "One unrelated ordinary account created by normal UI; twelve fictional Node VaultSession KDBX entries imported through the real file chooser; one normal edit creates prior history. Read-only .ka1/KDBX download inspection; no app DB injection.", steps, errors, status: "failed" };
  receipt.fixtureVersion = "unified-accounts-13";
  const toolbar = page.locator(".password-vault-toolbar"), dialog = page.locator(".vault-connect-dialog");
  const accounts = () => page.locator(".compact-account-card:not([data-private-only])").evaluateAll(nodes => nodes.map(node => `/assets/account/${node.getAttribute("data-account-id")}`).sort());
  let shot = 0;
  const capture = async (label: string) => { const name = `${String(shot++).padStart(3, "0")}-${label}`, path = join(folder, `${name}.png`); await page.screenshot({ path }); steps.push({ stage: "screenshot", name, label, path, sha256: sha(readFileSync(path)) }); };
  async function inspect(name: string) {
   const waiting = page.waitForEvent("download"); await openAccountOption(page,t,"pwVaultExport");
   const download = await waiting, path = info.outputPath(`${name}.kdbx`); await download.saveAs(path);
   try { return await inspectVisualKdbx(path); } finally { await download.delete(); }
  }
  async function metadata(name: string) {
   await page.goto("/intake");
   await openBackupPage(page); await page.locator("#backup-password").fill("Synthetic FC24 backup inspection 2026!");
   await page.getByRole("button", { name: language === "zh-CN" ? "创建备份" : "Create backup", exact: true }).click();
   const waiting = page.waitForEvent("download");
   await page.getByRole("link", { name: language === "zh-CN" ? "保存备份文件" : "Save backup file", exact: true }).click();
   const download = await waiting, path = info.outputPath(`${name}.ka1`); await download.saveAs(path);
   let rows: RecordRow[];
   try { const archive = unzipSync(await decryptBackup(new Uint8Array(readFileSync(path)), "Synthetic FC24 backup inspection 2026!")); rows = JSON.parse(strFromU8(archive["records.json"])) as RecordRow[]; }
   finally { await download.delete(); }
   const data = { assets: rows.filter(row => row.type === "asset").map(row => JSON.parse(row.payload) as Asset).sort((a,b) => a.id.localeCompare(b.id)), relations: rows.filter(row => row.type === "relation").map(row => JSON.parse(row.payload) as Relation).sort((a,b) => a.id.localeCompare(b.id)) };
   await page.goto("/accounts"); await openVaultAccess(page); await page.locator("#password-vault-unlock-master").fill(visualMaster); await page.getByRole("button", { name: t("accountUnlockAction"), exact: true }).click(); await expect(toolbar).toBeVisible();
   return data;
  }
  async function pointer(target: Locator) {
   await expect(target).toBeInViewport({ ratio: 1 }); await expect(target).toBeEnabled();
   const r = await target.boundingBox(); expect(r).toBeTruthy(); await page.mouse.click(r!.x + r!.width / 2, r!.y + r!.height / 2);
  }
  async function geometry(stage: string) {
   const result = await dialog.evaluate(node => {
    const rect = (element: Element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    const part = (selector: string) => rect(node.querySelector(selector)!);
    return { outer: { ...rect(node), scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, scrollTop: node.scrollTop }, header: part(":scope > header"), footer: part(".vault-connect-footer"), workspace: part(".vault-connect-workspace"), review: part(".vault-connect-review-pane"), viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth };
   });
   steps.push({ stage, ...result });
   await capture(stage);
   if (["selected", "matched"].includes(stage) && !pendingBaselines.some(row => row.stage === stage)) {
    const screenshot = steps.filter(row => row.stage === "screenshot").at(-1)!;
    const baselineName = `links-${language}-${size.width}x${size.height}-${stage}.png`;
    pendingBaselines.push({ stage, name: baselineName, path: screenshot.path, sha256: screenshot.sha256, candidate: release.sourceCommit, archiveSha256, platform: process.platform, browser: page.context().browser()?.version(), review: "pending-human-review" });
    if (process.env.KEEPANY_REVIEWED_BASELINES) await expect(page).toHaveScreenshot(baselineName, { animations: "disabled", maxDiffPixels: 0 });
   }
   expect(result.outer.scrollHeight, `${stage}: outerOverflow`).toBeLessThanOrEqual(result.outer.clientHeight + 1);
   expect(result.outer.scrollTop, `${stage}: outerScrollTop`).toBe(0);
   expect(result.documentWidth).toBeLessThanOrEqual(size.width);
   for (const r of [result.outer, result.header, result.footer]) { expect(r.left).toBeGreaterThanOrEqual(-1); expect(r.right).toBeLessThanOrEqual(size.width + 1); expect(r.top).toBeGreaterThanOrEqual(-1); expect(r.bottom).toBeLessThanOrEqual(size.height + 1); }
   await expect(dialog.locator(":scope > header").getByRole("button", { name: language === "zh-CN" ? "关闭" : "Close", exact: true })).toBeInViewport({ ratio: 1 });
   if (size.width > 760) { expect(result.review.top).toBeGreaterThanOrEqual(result.header.bottom - 1); expect(result.review.bottom).toBeLessThanOrEqual(result.footer.top + 1); }
  }
  async function selectBottom() {
   await openAccountOption(page,t,"pwConnectTitle"); await expect(dialog).toBeVisible();
   const choices = dialog.locator(".vault-connect-choice input"); await expect(choices).toHaveCount(13);
   await geometry("open");
   const scroll = dialog.locator(size.width <= 760 ? ".vault-connect-workspace" : ".vault-connect-accounts");
   const r = await scroll.boundingBox(); await page.mouse.move(r!.x + r!.width / 2, r!.y + r!.height / 2); await page.mouse.wheel(0, 2500);
   await pointer(choices.last()); await expect(choices.last()).toBeChecked();
   const selectedId = await choices.last().getAttribute("id"); steps.push({ stage: "selected-bottom", selectedId });
   await geometry("selected");
   await page.keyboard.press("Tab"); await capture("category-focus");
   await page.keyboard.press("Tab"); await capture("hint-focus");
   await geometry("focused");
   const match = dialog.getByRole("button", { name: t("pwConnectLocal"), exact: true });
   await expect(match).toBeInViewport({ ratio: 1 }); await match.hover(); await capture("match-hover"); await match.focus(); await capture("match-focus");
   const p = await match.boundingBox(); await page.mouse.move(p!.x + p!.width / 2, p!.y + p!.height / 2); await page.mouse.down(); await capture("match-pressed"); await page.mouse.up();
   await expect(dialog.locator(".vault-connect-suggestion")).toHaveCount(1);
   if (size.width <= 760) { const q = await scroll.boundingBox(); await page.mouse.move(q!.x + q!.width / 2, q!.y + q!.height / 2); await page.mouse.wheel(0, 2500); await expect(dialog.locator(".vault-connect-suggestion")).toBeInViewport({ ratio: 1 }); }
   else await expect(dialog.locator(".vault-connect-suggestion")).toBeInViewport({ ratio: 1 });
   await geometry("matched");
   return selectedId;
  }
  try {
   await page.goto("/accounts");
   const workspace = page.locator("main.unified-accounts-page");
   await page.locator("#password-vault-master").fill(visualMaster); await page.locator("#password-vault-master-confirm").fill(visualMaster); await page.getByRole("button", { name: t("accountSetUp"), exact: true }).click();
   await openAccountOption(page,t,"pwConnectTitle"); await expect(dialog).toBeVisible(); await expect(dialog.locator(".vault-connect-choice input")).toHaveCount(0); await geometry("empty"); await expect(dialog.locator(".vault-connect-footer").getByRole("button", { name: t("save"), exact: true })).toBeDisabled(); await pointer(dialog.locator(":scope > header").getByRole("button", { name: t("close"), exact: true }));
   await workspace.getByRole("button", { name: language === "zh-CN" ? "新增" : "Add", exact: true }).click();
   const accountEditor = page.getByRole("dialog"); await accountEditor.locator("#password-vault-entry-title").fill("Independent FC24 unrelated original"); await selectChoice(accountEditor.locator("#account-entry-category"), "other"); await accountEditor.locator("#password-vault-entry-username").fill("fc24-unrelated-user"); await accountEditor.getByRole("button", { name: language === "zh-CN" ? "保存" : "Save", exact: true }).click(); await expect(accountEditor).toBeHidden();
   const originalCard = workspace.locator(".compact-account-card").filter({ hasText: "Independent FC24 unrelated original" }); await expect(originalCard.getByText("fc24-unrelated-user", { exact: true })).toBeVisible();
   const originalId = await originalCard.getAttribute("data-account-id"), originalHref = `/assets/account/${originalId}`; expect(originalId).toBeTruthy();
   await openAccountOption(page,t,"pwConnectTitle"); await expect(dialog).toBeVisible(); await expect(dialog.locator(".vault-connect-choice input")).toHaveCount(1); await geometry("single"); await pointer(dialog.locator(".vault-connect-choice input")); await geometry("single-selected"); await pointer(dialog.locator(":scope > header").getByRole("button", { name: t("close"), exact: true }));
   for (let i = 0; i < 12; i++) {
    // Explicit Node fixture + actual KDBX file import leaves the publication contract untouched.
    await importVisualKdbxEntries(page, t, [{ title: `Independent FC24 ${i}`, username: `fc24-${i}@example.test`, password: "", notes: `Synthetic preserved note ${i}` }]);
   }
   const first = page.locator(".compact-account-card").filter({ has: page.getByRole("button", { name: "Independent FC24 0", exact: true }) });
   await first.getByRole("button", { name: t("edit"), exact: true }).click(); await page.locator("#password-vault-entry-notes").fill("Synthetic preserved edited note 0"); await page.getByRole("dialog").getByRole("button", { name: t("save"), exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
   const before = await inspect("before"), originalAccounts = await accounts(), beforeMetadata = await metadata("before"); expect(originalAccounts).toEqual([originalHref]); expect(beforeMetadata.assets).toHaveLength(1); expect(beforeMetadata.relations).toEqual([]); expect(before).toHaveLength(13); expect(before.some(row => row.history.length > 0)).toBe(true);
   const selected = await selectBottom();
   await pointer(dialog.locator(":scope > header").getByRole("button", { name: language === "zh-CN" ? "关闭" : "Close", exact: true })); await expect(dialog).toHaveCount(0); await expect(page.locator('.account-options-trigger')).toBeFocused();
   expect(await inspect("after-cancel")).toEqual(before); expect(await accounts()).toEqual(originalAccounts); expect(await metadata("after-cancel")).toEqual(beforeMetadata); steps.push({ stage: "cancel-preserved", fingerprint: sha(JSON.stringify(before)), metadataSha256: sha(JSON.stringify(beforeMetadata)), originalAccounts });
   expect(await selectBottom()).toBe(selected);
   await pointer(dialog.locator(".vault-connect-footer").getByRole("button", { name: language === "zh-CN" ? "保存" : "Save", exact: true })); await expect(dialog).toHaveCount(0);
   const saved = await inspect("saved"), savedAccounts = await accounts();
   expect(saved.map(row => row.draft.id).sort()).toEqual(before.map(row => row.draft.id).sort()); expect(savedAccounts.length).toBe(originalAccounts.length + 2);
   const modified = saved.filter(row => row.draft.linkedAssetIds.length > 0 && !before.find(old => old.draft.id === row.draft.id)!.draft.linkedAssetIds.length); expect(modified).toHaveLength(1); expect(modified[0].draft.linkedAssetIds).toHaveLength(1); expect(selected).toBe(`vault-connect-choice-${modified[0].draft.id}`);
   for (const row of saved) { const old = before.find(item => item.draft.id === row.draft.id)!; expect({ ...row.draft, linkedAssetIds: [] }).toEqual({ ...old.draft, linkedAssetIds: [] }); if(old.draft.linkedAssetIds.length)expect(row.draft.linkedAssetIds).toEqual(old.draft.linkedAssetIds); expect(row.history.slice(0, old.history.length)).toEqual(old.history); }
   const savedMetadata = await metadata("saved"), primaryId = modified[0].draft.linkedAssetIds[0];
   const primary = savedMetadata.assets.find(row => row.id === primaryId)!; expect(primary).toMatchObject({ kind: "account", name: modified[0].draft.title, username: modified[0].draft.username, url: modified[0].draft.url, deleted: false }); expect(primary.id).toMatch(/^pw-account-/);
   const identity = savedMetadata.assets.find(row => row.id !== primaryId && !beforeMetadata.assets.some(old => old.id === row.id))!; expect(identity).toMatchObject({ kind: "account", name: modified[0].draft.username, username: modified[0].draft.username, category: "email", accountProvider: "example.test", deleted: false }); expect(identity.id).toMatch(/^login-identity-/);
   expect(savedMetadata.assets).toHaveLength(3); for (const old of beforeMetadata.assets) expect(savedMetadata.assets.find(row => row.id === old.id)).toEqual(old);
   expect(savedMetadata.relations).toEqual([expect.objectContaining({ from: primary.id, to: identity.id, label: t("pwConnectKind_email"), deleted: false })]);
   expect(savedAccounts).toEqual(savedMetadata.assets.map(row => `/assets/account/${row.id}`).sort());
   await page.reload(); await openVaultAccess(page); await page.locator("#password-vault-unlock-master").fill(visualMaster); await page.getByRole("button", { name: t("accountUnlockAction"), exact: true }).click(); await expect(toolbar).toBeVisible();
   expect(await inspect("reloaded")).toEqual(saved); expect(await accounts()).toEqual(savedAccounts); await expect(page.locator(`.compact-account-card[data-account-id="${originalId}"]`)).toContainText("fc24-unrelated-user"); await capture("reloaded"); const reloadedMetadata = await metadata("reloaded"); expect(reloadedMetadata).toEqual(savedMetadata);
   steps.push({ stage: "saved-refreshed", ids: saved.map(row => row.draft.id).sort(), accounts: savedAccounts, originalAccounts, originalMetadata: beforeMetadata, savedMetadata, reloadedMetadata, linkedEntryId: modified[0].draft.id, linkedEntryTitle: modified[0].draft.title, linkedEntryUsername: modified[0].draft.username, linkedAssetIds: modified[0].draft.linkedAssetIds, primaryId: primary.id, identityId: identity.id, beforeSha256: sha(JSON.stringify(before)), savedSha256: sha(JSON.stringify(saved)), reloadedSha256: sha(JSON.stringify(saved)) });
   expect(errors).toEqual([]); receipt.status = "passed";
  } finally { writeFileSync(join(folder, "result.json"), JSON.stringify(receipt, null, 2)); }
 });
}
