import { expectKeyboardFocusRing } from "./helpers/focus-contract";
import { mkdirSync, readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import type { Asset, Relation } from "../../packages/domain/src";
import type { RecordRow } from "../../packages/local-db/src";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";
import type { ReviewedCandidate } from "../../packages/local-db/src/intake-review";
import {
	aiServer,
	checkLayout,
	evidence,
	labels,
	model,
	syntheticKey,
} from "./helpers/ai-workflow";
import { selectChoice } from "./helpers/select-choice";
import { setAccountRelationDetailsOpen } from "./helpers/account-graph";

const password = "synthetic-bulk-account-links-backup-password";
const email = "reader@example.test";
const phone = "+15551234567";
const sourceLines = [
	`Portal: https://portal.example.test/dashboard (gmail)`,
	`Hosting: https://hosting.example.test/account (gmail)`,
	`Phone console: https://phone.example.test/console (${phone})`,
	"Database: https://database.example.test/dashboard (GitHub)",
];
const sourceText = `${sourceLines.join("\n")}\ngmail=${email}`;

// Same real .ka1 download/decrypt path used by intake-review-backup.spec.ts.
// No database seeding or development module injection: writes enter through UI.
async function download(page: Page, zh: boolean, filename: string) {
	await page.locator("#backup-password").fill(password);
	await page
		.getByRole("button", {
			name: zh ? "创建备份" : "Create backup",
			exact: true,
		})
		.click();
	const link = page.getByRole("link", {
		name: zh ? "保存备份文件" : "Save backup file",
	});
	await expect(link).toBeVisible();
	const downloading = page.waitForEvent("download");
	await link.click();
	const result = await downloading;
	expect(result.suggestedFilename()).toMatch(/\.ka1$/);
	const path = test.info().outputPath(filename);
	await result.saveAs(path);
	const bytes = readFileSync(path);
	expect(bytes.subarray(0, 8).toString()).toBe("KEEPANY1");
	const entries = unzipSync(
		await decryptBackup(new Uint8Array(bytes), password),
	);
	const rows = JSON.parse(strFromU8(entries["records.json"])) as RecordRow[];
	const candidates = JSON.parse(
		strFromU8(entries["intake-review.json"]),
	) as ReviewedCandidate[];
	return {
		path,
		rows,
		candidates,
		assets: rows
			.filter((row) => row.type === "asset")
			.map((row) => JSON.parse(row.payload) as Asset),
		relations: rows
			.filter((row) => row.type === "relation")
			.map((row) => JSON.parse(row.payload) as Relation),
	};
}

for (const language of ["zh-CN", "en"] as const) {
	for (const width of [390, 1280]) {
		test(`${language} ${width}px bulk confirmation retains failures and links shared account identifiers once`, async ({
			browser,
		}) => {
			const zh = language === "zh-CN",
				copy = labels[language];
			const mock = await aiServer();
			const context = await browser.newContext({
				locale: zh ? "zh-CN" : "en-US",
				viewport: { width, height: 844 },
				acceptDownloads: true,
			});
			await context.addInitScript(
				(value) => localStorage.setItem("keepany-language", value),
				language,
			);
			const page = await context.newPage();
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			try {
				await page.goto("/settings#assistant");
				const settings = page.locator(".ai-settings-panel");
				await selectChoice(
					settings.locator("#ai-settings-provider"),
					"compatible",
				);
				await settings.locator("#ai-settings-url").fill(mock.baseURL);
				await settings.locator("#ai-settings-model").fill(model);
				await selectChoice(
					settings.locator("#ai-settings-key-source"),
					"session",
				);
				await settings.locator("#ai-settings-api-key").fill(syntheticKey);
				await settings
					.getByRole("button", { name: copy.saveSettings, exact: true })
					.click();
				await expect(
					settings.getByRole("status").filter({ hasText: copy.ready }),
				).toBeVisible();
				await page
					.locator(".top-actions")
					.getByRole("link", { name: copy.intake, exact: true })
					.click();
				const importer = page.locator(".ai-import-panel");
				mock.responses.push(
					JSON.stringify({
						text: "",
						records: [
							{
								kind: "account",
								name: "Portal",
								url: "https://portal.example.test/dashboard",
								username: email,
								description: "Gmail",
								evidence: sourceLines[0],
							},
							{
								kind: "account",
								name: "Hosting",
								url: "https://hosting.example.test/account",
								username: email,
								description: "Gmail",
								evidence: sourceLines[1],
							},
							{
								kind: "account",
								name: "Phone console",
								url: "https://phone.example.test/console",
								username: phone,
								evidence: sourceLines[2],
							},
							{
								kind: "account",
								name: "Database",
								url: "https://database.example.test/dashboard",
								username: "",
								description: "GitHub",
								evidence: sourceLines[3],
							},
						],
					}),
				);
				await importer.locator("#ai-import-text").fill(sourceText);
				await importer
					.getByRole("button", { name: copy.generate, exact: true })
					.click();
				const batch = page.locator(".intake-review-batch");
				const rows = batch.locator(".intake-review-row");
				await expect(rows).toHaveCount(4);
				const selectAll = batch.getByRole("checkbox", {
					name: zh ? "全选待确认" : "Select all pending",
					exact: true,
				});
				const byName = (name: string) =>
					rows.filter({
						has: page.locator(`input[id$="-name"][value="${name}"]`),
					});
				const portalId = await byName("Portal").getAttribute("id");
				const hostingId = await byName("Hosting").getAttribute("id");
				const phoneId = await byName("Phone console").getAttribute("id");
				const databaseId = await byName("Database").getAttribute("id");
				const portal = page.locator(`#${portalId}`),
					hosting = page.locator(`#${hostingId}`),
					phoneRow = page.locator(`#${phoneId}`),
					database = page.locator(`#${databaseId}`);
				for (const name of ["Portal", "Hosting", "Phone console", "Database"]) {
					await expect(
						batch.getByRole("checkbox", {
							name: zh ? `选择 ${name}` : `Select ${name}`,
							exact: true,
						}),
					).not.toBeChecked();
				}
				await hosting.getByLabel(copy.name, { exact: true }).fill("");
				await selectAll.check();
				await expect(
					batch.getByRole("button", {
						name: zh ? "确认所选（4）" : "Confirm selected (4)",
						exact: true,
					}),
				).toBeEnabled();
				await database.getByRole("checkbox").uncheck();
				await expect(selectAll).not.toBeChecked();
				await batch
					.getByRole("button", {
						name: zh ? "确认所选（3）" : "Confirm selected (3)",
						exact: true,
					})
					.click();
				await expect(portal.locator(".chip")).toHaveText(copy.confirmed);
				await expect(phoneRow.locator(".chip")).toHaveText(copy.confirmed);
				await expect(hosting.locator(".chip")).toHaveText(
					zh ? "待确认" : "Pending",
				);
				await expect(hosting.getByRole("alert")).toContainText(
					zh
						? "请核对名称、网址和字段长度。"
						: "Check the name, URL and field lengths.",
				);
				await expect(database.locator(".chip")).toHaveText(
					zh ? "待确认" : "Pending",
				);
				await expect(database.getByRole("checkbox")).not.toBeChecked();
				await expect(database.locator('input[id$="-username"]')).toHaveValue(
					"",
				);
				await checkLayout(page, batch, width);
				const partial = await download(page, zh, "partial-bulk.ka1");
				expect(
					partial.candidates.filter((row) => row.status === "accepted"),
				).toHaveLength(2);
				expect(
					partial.candidates.filter((row) => row.status === "pending"),
				).toHaveLength(2);
				expect(partial.assets).toHaveLength(4);
				expect(
					partial.assets.some(
						(asset) => asset.name === "Hosting" || asset.name === "Database",
					),
				).toBe(false);
				expect(partial.relations).toHaveLength(2);
				await hosting.getByLabel(copy.name, { exact: true }).fill("Hosting");
				await selectAll.check();
				await batch
					.getByRole("button", {
						name: zh ? "确认所选（2）" : "Confirm selected (2)",
						exact: true,
					})
					.click();
				await expect(rows.locator(".chip")).toHaveText([
					copy.confirmed,
					copy.confirmed,
					copy.confirmed,
					copy.confirmed,
				]);
				const saved = await download(page, zh, "completed-bulk.ka1");
				expect(saved.assets).toHaveLength(6);
				expect(saved.relations).toHaveLength(3);
				expect(saved.candidates.every((row) => row.status === "accepted")).toBe(
					true,
				);
				const emailNodes = saved.assets.filter(
					(asset) => asset.category === "email",
				);
				const phoneNodes = saved.assets.filter(
					(asset) => asset.category === "phone",
				);
				expect(emailNodes).toHaveLength(1);
				expect(phoneNodes).toHaveLength(1);
				expect(emailNodes[0]).toMatchObject({
					name: email,
					username: email,
					accountProvider: "example.test",
				});
				expect(phoneNodes[0]).toMatchObject({ name: phone, username: phone });
				const service = (name: string) => {
					const asset = saved.assets.find((entry) => entry.name === name);
					if (!asset) throw Error(`Missing saved service: ${name}`);
					return asset;
				};
				for (const name of ["Portal", "Hosting"]) {
					expect(
						saved.relations.filter(
							(relation) =>
								relation.from === service(name).id &&
								relation.to === emailNodes[0].id,
						),
					).toEqual([
						expect.objectContaining({
							label: zh ? "登录邮箱" : "Login email",
							source: zh ? "文字或表格内容" : "Text or spreadsheet content",
							verifiedAt: "",
							deleted: false,
						}),
					]);
				}
				expect(
					saved.relations.filter(
						(relation) =>
							relation.from === service("Phone console").id &&
							relation.to === phoneNodes[0].id,
					),
				).toEqual([
					expect.objectContaining({
						label: zh ? "登录手机号" : "Login phone",
						source: zh ? "文字或表格内容" : "Text or spreadsheet content",
						verifiedAt: "",
						deleted: false,
					}),
				]);
				expect(service("Database")).toMatchObject({
					username: "",
					description: "GitHub",
				});
				expect(
					saved.relations.some(
						(relation) => relation.from === service("Database").id,
					),
				).toBe(false);
				expect(saved.assets.some((asset) => asset.name === "GitHub")).toBe(
					false,
				);
				const completeLinks = batch.getByRole("button", {
					name: zh ? "补齐账号关系" : "Complete account links",
					exact: true,
				});
				await completeLinks.click();
				await expect(
					batch
						.getByRole("status")
						.filter({ hasText: zh ? "新增 0 条关系" : "Added 0 links" }),
				).toBeVisible();
				await completeLinks.click();
				await expect(completeLinks).toBeEnabled();
				const repeated = await download(page, zh, "repeated-links.ka1");
				expect(repeated.rows).toEqual(saved.rows);
				expect(repeated.candidates).toEqual(saved.candidates);
				mkdirSync(evidence, { recursive: true });
				await batch.screenshot({
					path: `${evidence}/bulk-links-${language}-${width}.png`,
				});
				await portal
					.getByRole("link", {
						name: new RegExp(zh ? "^查看已保存资料" : "^View saved record"),
					})
					.click();
				await expect(page).toHaveURL(`/assets/account/${service("Portal").id}`);
				const facts = page.locator(".account-facts-grid");
				await expect(facts).toContainText(email);
				let details = await setAccountRelationDetailsOpen(page);
				await expect(details).toContainText(zh ? "登录邮箱" : "Login email");
				await expect(details.locator(".relation-row")).toHaveCount(1);
				await expect(facts).not.toContainText(zh ? "登录邮箱" : "Login email");
				await page.reload();
				await expect(facts).toContainText(email);
				details = await setAccountRelationDetailsOpen(page);
				await expect(
					details.locator(`a[href="/assets/account/${emailNodes[0].id}"]`),
				).toBeVisible();
				const website = facts.getByRole("link", { name: service("Portal").url, exact: true });
				const binding = details.locator(`a[href="/assets/account/${emailNodes[0].id}"]`);
				for (const link of [website, binding]) {
					await expect(link).toHaveCSS("color", "rgb(23, 36, 58)");
					await expect(link).toHaveCSS("background-color", "rgb(255, 240, 184)");
					await expect(link).toHaveCSS("text-decoration-color", "rgb(255, 210, 76)");
					await expect(link.locator(":scope > span, :scope > strong")).toHaveCSS("color", "rgb(23, 36, 58)");
					expect(await link.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
					await link.hover();
					await expect(link).toHaveCSS("background-color", "rgb(255, 210, 76)");
					await expect(link).toHaveCSS("color", "rgb(23, 36, 58)");
					await expect(link.locator(":scope > span, :scope > strong")).toHaveCSS("color", "rgb(23, 36, 58)");
					await page.mouse.move(0, 0);
					await link.press("Tab");
					await page.keyboard.press("Shift+Tab");
					await expect(link).toBeFocused();
					await expectKeyboardFocusRing(link);
					await expect(link).toHaveCSS("background-color", "rgb(255, 210, 76)");
					await expect(link).toHaveCSS("outline-style", "solid");
				}
				await details.screenshot({ path: `${evidence}/account-links-${language}-${width}.png` });
				await details
					.locator(`a[href="/assets/account/${emailNodes[0].id}"]`)
					.click();
				await expect(page).toHaveURL(`/assets/account/${emailNodes[0].id}#account-relations`);
				details = await setAccountRelationDetailsOpen(page);
				await expect(details).toContainText("Portal");
				await expect(details).toContainText("Hosting");
				await expect(details.locator(".relation-row")).toHaveCount(2);
				await checkLayout(page, facts, width);
				await page.screenshot({
					path: `${evidence}/shared-email-${language}-${width}.png`,
					fullPage: true,
				});
				await details.getByRole("link", { name: "Portal", exact: true }).click();
				await expect(page).toHaveURL(`/assets/account/${service("Portal").id}#account-relations`);
				await setAccountRelationDetailsOpen(page);
				await expect(binding).toHaveCSS("color", "rgb(23, 36, 58)");
				await checkLayout(page, facts, width);
				await facts.screenshot({ path: `${evidence}/account-links-return-${language}-${width}.png` });
				const restoredContext = await browser.newContext({
					locale: zh ? "zh-CN" : "en-US",
					viewport: { width, height: 844 },
					acceptDownloads: true,
				});
				await restoredContext.addInitScript(
					(value) => localStorage.setItem("keepany-language", value),
					language,
				);
				try {
					const restored = await restoredContext.newPage();
					restored.on("pageerror", (error) => errors.push(error.message));
					await restored.goto("/intake");
					await expect(restored.locator(".intake-review-row")).toHaveCount(0);
					await restored.locator("#backup-password").fill(password);
					await restored.locator("#restore-file").setInputFiles(saved.path);
					await restored
						.getByRole("button", { name: zh ? "预览" : "Preview", exact: true })
						.first()
						.click();
					const confirm = restored.getByRole("button", {
						name: /^(确认|Confirm) · 9$/,
					});
					await expect(confirm).toBeVisible();
					await confirm.click();
					await expect(restored.locator(".intake-review-row")).toHaveCount(4);
					await restored.reload();
					const restoredBackup = await download(
						restored,
						zh,
						"restored-bulk.ka1",
					);
					expect(restoredBackup.rows).toEqual(saved.rows);
					expect(restoredBackup.candidates).toEqual(saved.candidates);
					await restored.goto(`/assets/account/${service("Portal").id}`);
					await expect(restored.locator(".account-facts-grid")).toContainText(
						email,
					);
					const restoredDetails = await setAccountRelationDetailsOpen(restored);
					await expect(restoredDetails).toContainText(
						zh ? "登录邮箱" : "Login email",
					);
					await expect(restoredDetails.locator(".relation-row")).toHaveCount(1);
					await checkLayout(
						restored,
						restored.locator(".account-facts-grid"),
						width,
					);
				} finally {
					await restoredContext.close();
				}
				expect(mock.requests).toHaveLength(1);
				expect(mock.requests[0].body.messages.at(-1)?.content).toContain(
					sourceText,
				);
				expect(errors).toEqual([]);
			} finally {
				await context.close();
				await mock.close();
			}
		});
	}
}
