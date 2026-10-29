import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { resources } from "../../apps/web/src/i18n";
import { portableCandidate } from "./helpers/portable-candidate";
import { openVaultAccess } from "./helpers/vault-access";

const master = "Synthetic FC22 toast layer master 2026!";
for (const locale of ["zh-CN", "en"] as const)
	for (const width of [390, 563, 768, 1280, 1920, 2560]) {
		test(`${locale} ${width} FC22 active success toast stays below modal actions`, async ({
			page,
		}, info) => {
			await page.setViewportSize({ width, height: 1050 });
			const t = (key: string) =>
				(resources[locale].translation as Record<string, string>)[key] ?? key;
			const { release, archiveSha256 } = portableCandidate();
			const receipt: Record<string, unknown> = {
				acceptanceIds: ["FC22-A", "FC22-B", "FC22-C"],
				classification:
					"isolated fictional actual compiled UI; real completed sample-login operation creates the toast; no injected toast or waiting for it to disappear",
				locale,
				width,
				sourceCommit: release.sourceCommit,
				sourceDirty: release.sourceDirty,
				archiveSha256,
			};
			try {
				await page.addInitScript(
					(language) => localStorage.setItem("keepany-language", language),
					locale,
				);
				await page.goto("/settings#advanced-settings");
				await page
					.getByRole("button", { name: t("loadSample"), exact: true })
					.click();
				await expect(
					page.getByRole("button", {
						name: t("sampleLibraryPresent"),
						exact: true,
					}),
				).toBeDisabled();
				await page.goto("/accounts");
				await openVaultAccess(page);
				await page.locator("#password-vault-master").fill(master);
				await page.locator("#password-vault-master-confirm").fill(master);
				await page
					.getByRole("button", { name: t("pwVaultCreate"), exact: true })
					.click();
				const toolbar = page.locator(".password-vault-toolbar");
				const samples = toolbar.getByRole("button", {
					name: t("sampleLogins"),
					exact: true,
				});
				await samples.click();
				await expect(samples).toHaveCount(0, { timeout: 30_000 });
				const originalHrefs = await page
					.locator("a.asset-account-card")
					.evaluateAll((nodes) =>
						nodes.map((node) => node.getAttribute("href")),
					);
				expect(originalHrefs).toHaveLength(8);
				const originalEntryIds = await page.locator(".password-vault-entry").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-entry-id")));
				receipt.originalHrefs = originalHrefs;
				const toast = page.locator('.toast[role="status"]');
				await expect(toast).toBeVisible();
				receipt.originalToastText = await toast.innerText();
				await page.screenshot({
					path: info.outputPath("toast-normal-page.png"),
				});
				await toolbar
					.getByRole("button", { name: t("pwVaultNewEntry"), exact: true })
					.click();
				const dialog = page.getByRole("dialog"),
					save = dialog.getByRole("button", {
						name: t("pwVaultSaveEntry"),
						exact: true,
					});
				await expect(dialog).toBeVisible();
				await expect(toast).toBeVisible();
				const geometry = await save.evaluate((button) => {
					const popup = button.closest('[role="dialog"]'),
						notice = document.querySelector('.toast[role="status"]'),
						backdrop = document.querySelector(".overlay");
					if (!popup || !notice || !backdrop)
						throw Error("Expected actual toast, modal and backdrop");
					const a = button.getBoundingClientRect(),
						b = notice.getBoundingClientRect();
					return {
						toastZ: Number(getComputedStyle(notice).zIndex),
						backdropZ: Number(getComputedStyle(backdrop).zIndex),
						dialogZ: Number(getComputedStyle(popup).zIndex),
						overlapArea:
							Math.max(
								0,
								Math.min(a.right, b.right) - Math.max(a.left, b.left),
							) *
							Math.max(
								0,
								Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
							),
						tap: { x: a.x + a.width / 2, y: a.y + a.height * 0.85 },
						button: { x: a.x, y: a.y, width: a.width, height: a.height },
						toastVisible: b.width > 0 && b.height > 0,
					};
				});
				receipt.geometry = geometry;
				await page.screenshot({
					path: info.outputPath("toast-and-dialog.png"),
				});
				await expect(toast).toBeVisible();
				if (process.env.KEEPANY_FC22_REQUIRE_OVERLAP === "1")
					expect(
						geometry.overlapArea,
						"Pre-fix failure must be actual overlapping UI",
					).toBeGreaterThan(0);
				expect(
					geometry.toastZ,
					"Page feedback must not paint over the modal or its actions",
				).toBeLessThan(geometry.backdropZ);
				expect(geometry.backdropZ).toBeLessThan(geometry.dialogZ);
				expect(geometry.button.width).toBeGreaterThanOrEqual(44);
				expect(geometry.button.height).toBeGreaterThanOrEqual(44);
				const hit = await save.evaluate((button, point) => {
					const element = document.elementFromPoint(point.x, point.y);
					return {
						insideDialog: !!element?.closest('[role="dialog"]'),
						insideToast: !!element?.closest(".toast"),
						exactSaveTarget: element?.closest("button") === button,
					};
				}, geometry.tap);
				expect(hit).toEqual({
					insideDialog: true,
					insideToast: false,
					exactSaveTarget: true,
				});
				receipt.modalTapUnobstructed = true;
				receipt.exactSaveTarget = hit.exactSaveTarget;
				let actualNativeInvalidEvents = 0;
				await page.exposeFunction("recordFc22Invalid", () => {
					actualNativeInvalidEvents += 1;
				});
				await dialog
					.locator("#password-vault-entry-title")
					.evaluate((input) => {
						input.addEventListener(
							"invalid",
							() => {
								void (
									window as unknown as { recordFc22Invalid(): Promise<void> }
								).recordFc22Invalid();
							},
							{ once: true },
						);
					});
				await page.mouse.click(geometry.tap.x, geometry.tap.y);
				await expect.poll(() => actualNativeInvalidEvents).toBeGreaterThan(0);
				receipt.actualNativeInvalidEvents = actualNativeInvalidEvents;
				await expect(dialog).toBeVisible();
				expect(
					await dialog
						.locator("#password-vault-entry-title")
						.evaluate(
							(node) => (node as HTMLInputElement).validity.valueMissing,
						),
				).toBe(true);
				await expect(toast).toBeVisible();
				await page.screenshot({
					path: info.outputPath("toast-and-required-error.png"),
				});
				await expect(toast).toBeVisible();
				receipt.toastVisibleThroughoutModalCheck = true;
				receipt.requiredInputStayedUnsaved = true;
				await dialog
					.getByRole("button", { name: t("close"), exact: true })
					.click();
				await expect(dialog).toBeHidden();
				expect(
					await page
						.locator("a.asset-account-card")
						.evaluateAll((nodes) =>
							nodes.map((node) => node.getAttribute("href")),
						),
				).toEqual(originalHrefs);
				receipt.assetIdentitiesPreserved = true;
				await page.reload();
				await openVaultAccess(page);
				await page.locator("#password-vault-unlock-master").fill(master);
				await page.getByRole("button", { name: t("pwVaultUnlock"), exact: true }).click();
				expect(await page.locator("a.asset-account-card").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")))).toEqual(originalHrefs);
				expect(await page.locator(".password-vault-entry").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-entry-id")))).toEqual(originalEntryIds);
				receipt.cancelAndReloadPreservedAssetsAndEntries = true;
				receipt.completed = true;
			} finally {
				writeFileSync(
					info.outputPath("toast-layer-receipt.json"),
					`${JSON.stringify(receipt, null, 2)}\n`,
				);
			}
		});
	}
