import { expect, type Page } from "@playwright/test";

export async function expectReadableAccountGraph(page: Page) {
	const graph = page.locator(".asset-relations-card .graph");
	const current = graph.locator(".react-flow__node.asset-graph-center");
	await expect(current).toHaveCount(1);
	await expect
		.poll(async () => (await current.boundingBox())?.width ?? 0)
		.toBeGreaterThanOrEqual(115);
	await expect
		.poll(async () => {
			const [frame, node] = await Promise.all([
				graph.boundingBox(),
				current.boundingBox(),
			]);
			if (!frame || !node) return false;
			const x = node.x + node.width / 2,
				y = node.y + node.height / 2;
			return (
				x >= frame.x &&
				x <= frame.x + frame.width &&
				y >= frame.y &&
				y <= frame.y + frame.height
			);
		})
		.toBe(true);
}

export async function exerciseAccountGraphControls(page: Page) {
	const viewport = page.locator(".asset-relations-card .react-flow__viewport");
	const initial = await viewport.getAttribute("style");
	await page.locator(".react-flow__controls-zoomin").click();
	await expect(viewport).not.toHaveAttribute("style", initial ?? "");
	const enlarged = await viewport.getAttribute("style");
	await page.locator(".react-flow__controls-zoomout").click();
	await expect(viewport).not.toHaveAttribute("style", enlarged ?? "");
	await page.locator(".react-flow__controls-fitview").click();
	await expect(viewport).toHaveAttribute("style", /scale\(/);
	await expectAllAccountGraphNodesInFrame(page);
	const viewActions = page.locator(".account-graph-view-actions");
	await expect(viewActions).toBeVisible();
	const fitAll = viewActions.getByRole("button", {
		name: /^(查看全图|Fit all)$/,
		exact: true,
	});
	const center = viewActions.getByRole("button", {
		name: /^(定位当前|Center account)$/,
		exact: true,
	});
	await expect(fitAll).toBeVisible();
	await expect(center).toBeVisible();
	await center.click();
	await expectReadableAccountGraph(page);
	await fitAll.click();
	await expectAllAccountGraphNodesInFrame(page);
	await center.click();
	await expectReadableAccountGraph(page);
}

async function expectAllAccountGraphNodesInFrame(page: Page) {
	await expect
		.poll(
			() =>
				page.locator(".asset-relations-card .graph").evaluate((graph) => {
					const bounds = graph.getBoundingClientRect();
					return [...graph.querySelectorAll(".react-flow__node")].every(
						(node) => {
							const rect = node.getBoundingClientRect();
							return (
								rect.left >= bounds.left - 1 &&
								rect.right <= bounds.right + 1 &&
								rect.top >= bounds.top - 1 &&
								rect.bottom <= bounds.bottom + 1
							);
						},
					);
				}),
			{ message: "Manual fit places every node inside the graph" },
		)
		.toBe(true);
}
