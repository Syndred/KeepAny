import { expect, test } from "@playwright/test";

const domainPath = `/@fs${process.cwd()}/packages/domain/src/index.ts`;
const repositoryPath = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;

for (const locale of ["zh-CN", "en-US"] as const) {
	test(`${locale} stale backlink editor preserves another tab's verified status and receipt`, async ({ browser }) => {
		const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
		const first = await context.newPage();
		const second = await context.newPage();
		const errors: string[] = [];
		first.on("pageerror", error => errors.push(error.message));
		second.on("pageerror", error => errors.push(error.message));
		const copy = locale === "zh-CN"
			? { check: "核验", save: "保存", cancel: "取消", update: "更新", conflict: "资料已在另一处更新" }
			: { check: "Verify", save: "Save", cancel: "Cancel", update: "Update", conflict: "This record changed elsewhere" };
		try {
			await first.goto("/assets/project");
			const ids = await first.evaluate(async ({ domainPath, repositoryPath }) => {
				const { newAsset, submissionSchema } = await import(domainPath);
				const { saveBatch } = await import(repositoryPath);
				const project = { ...newAsset("project"), name: "Concurrent backlink project" };
				const submission = submissionSchema.parse({ id: crypto.randomUUID(), assetId: project.id,
					name: "Atlas directory", url: "https://directory.example/atlas", status: "verify",
					submittedAt: "2026-09-28", verifiedAt: "", evidence: "Email receipt 42", deleted: false });
				await saveBatch([{ type: "asset", value: project }, { type: "submission", value: submission }]);
				return { projectId: project.id, submissionId: submission.id };
			}, { domainPath, repositoryPath });
			const detailUrl = `/assets/project/${ids.projectId}`;
			await Promise.all([first.goto(detailUrl), second.goto(detailUrl)]);
			for (const page of [first, second]) {
				await page.locator(".asset-backlinks-card summary").click();
				await expect(page.locator(".asset-backlinks-card tr").filter({ hasText: "Atlas directory" })).toBeVisible();
			}
			const firstRow = first.locator(".asset-backlinks-card tr").filter({ hasText: "Atlas directory" });
			const secondRow = second.locator(".asset-backlinks-card tr").filter({ hasText: "Atlas directory" });
			await firstRow.getByRole("button", { name: copy.check }).click();
			await firstRow.getByLabel(`Atlas directory ${locale === "zh-CN" ? "名称" : "Name"}`).fill("Stale directory title");
			await secondRow.getByRole("button", { name: copy.check }).click();
			await secondRow.getByRole("combobox").selectOption("indexed");
			await secondRow.getByLabel(`Atlas directory ${locale === "zh-CN" ? "依据" : "Evidence"}`).fill("https://directory.example/atlas/live");
			await secondRow.getByRole("button", { name: copy.save, exact: true }).click();
			await expect(secondRow.getByRole("combobox")).toHaveCount(0);
			await firstRow.getByRole("button", { name: copy.save, exact: true }).click();
			await expect(firstRow.getByRole("alert")).toContainText(copy.conflict);
			await expect(firstRow.getByRole("button", { name: copy.save, exact: true })).toBeDisabled();
			await first.screenshot({ path: `/private/tmp/keepany-backlink-conflict-${locale}.png`, fullPage: true });
			expect(await first.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
			let stored = await first.evaluate(async ({ repositoryPath, id }) => {
				const { localRepository } = await import(repositoryPath);
				return (await localRepository()).get("submission", id);
			}, { repositoryPath, id: ids.submissionId });
			expect(stored).toMatchObject({ name: "Atlas directory", status: "indexed",
				evidence: "https://directory.example/atlas/live", verifiedAt: expect.any(String) });
			await firstRow.getByRole("button", { name: copy.cancel }).click();
			await firstRow.getByRole("button", { name: copy.update }).click();
			await firstRow.getByLabel(`Atlas directory ${locale === "zh-CN" ? "名称" : "Name"}`).fill("Fresh directory title");
			await firstRow.getByRole("button", { name: copy.save, exact: true }).click();
			await expect(first.locator(".asset-backlinks-card tr").filter({ hasText: "Fresh directory title" })).toBeVisible();
			stored = await first.evaluate(async ({ repositoryPath, id }) => {
				const { localRepository } = await import(repositoryPath);
				return (await localRepository()).get("submission", id);
			}, { repositoryPath, id: ids.submissionId });
			expect(stored).toMatchObject({ name: "Fresh directory title", status: "indexed",
				evidence: "https://directory.example/atlas/live" });
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}
