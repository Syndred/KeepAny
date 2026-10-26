import { expect, type Locator, type Page } from "@playwright/test";

export function activeAccountGraph(page: Page) {
	return page.locator(".account-family-graph.graph:visible");
}

export function accountGraphCanvas(page: Page) {
	return activeAccountGraph(page).locator(".react-flow");
}

export async function setAccountRelationDetailsOpen(page: Page, open = true) {
	const details = page.locator("details.account-relation-details");
	await expect(details).toHaveCount(1);
	if (
		(await details.evaluate(
			(element) => (element as HTMLDetailsElement).open,
		)) !== open
	)
		await details.locator(":scope > summary").click();
	await expect(details).toHaveJSProperty("open", open);
	return details;
}

export async function waitForAccountGraphLayout(
	page: Page,
	expected: { nodes?: number; edges?: number } = {},
) {
	const graph = activeAccountGraph(page);
	await expect(graph).toHaveCount(1);
	await expect(graph).toHaveAttribute("aria-busy", "false");
	await expect(graph).toHaveAttribute("data-layout-ready", "true");
	if (expected.nodes !== undefined)
		await expect(graph.locator(".react-flow__node")).toHaveCount(
			expected.nodes,
		);
	if (expected.edges !== undefined)
		await expect(graph.locator(".react-flow__edge-path")).toHaveCount(
			expected.edges,
		);
	await expect
		.poll(
			() =>
				graph.evaluate(async (element) => {
					const signature = () =>
						JSON.stringify([
							element.getAttribute("data-layout-ready"),
							...[
								...element.querySelectorAll<HTMLElement>(".react-flow__node"),
							].map((node) => [
								node.dataset.id,
								node.style.transform,
								node.offsetWidth,
								node.offsetHeight,
							]),
							...[...element.querySelectorAll(".react-flow__edge-path")].map(
								(path) => path.getAttribute("d"),
							),
						]);
					const before = signature();
					await new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
					);
					return (
						before === signature() &&
						element.getAttribute("data-layout-ready") === "true" &&
						[
							...element.querySelectorAll<SVGPathElement>(
								".react-flow__edge-path",
							),
						].every(
							(path) => !!path.getAttribute("d") && path.getTotalLength() > 0,
						)
					);
				}),
			{
				message:
					"The current asynchronous layout and routed paths have settled",
			},
		)
		.toBe(true);
	return graph;
}

export async function clickAccountGraphBlank(page: Page) {
	const graph = await waitForAccountGraphLayout(page);
	const canvas = graph.locator(".react-flow");
	await canvas.scrollIntoViewIfNeeded();
	let at: { x: number; y: number } | null = null;
	await expect
		.poll(
			async () => {
				at = await canvas.evaluate((element) => {
					const frame = element.getBoundingClientRect();
					const blank = (x: number, y: number) => {
						const hit = document.elementFromPoint(x, y);
						return (
							hit?.classList.contains("react-flow__pane") ||
							!!hit?.closest(".react-flow__background")
						);
					};
					for (
						let y = Math.ceil(Math.max(8, frame.top + 8));
						y < Math.min(innerHeight - 8, frame.bottom - 8);
						y += 8
					)
						for (
							let x = Math.ceil(Math.max(8, frame.left + 8));
							x < Math.min(innerWidth - 8, frame.right - 8);
							x += 8
						)
							if (
								[-2, 0, 2].every((dx) =>
									[-2, 0, 2].every((dy) => blank(x + dx, y + dy)),
								)
							)
								return { x, y };
					return null;
				});
				if (!at) return false;
				await page.mouse.move(at.x, at.y);
				return canvas.evaluate(
					(_, point) =>
						[-2, 0, 2].every((dx) =>
							[-2, 0, 2].every((dy) => {
								const hit = document.elementFromPoint(
									point.x + dx,
									point.y + dy,
								);
								return (
									hit?.classList.contains("react-flow__pane") ||
									!!hit?.closest(".react-flow__background")
								);
							}),
						),
					at,
				);
			},
			{
				message:
					"A real blank canvas area remains free of nodes and edges after hover",
			},
		)
		.toBe(true);
	if (!at) throw Error("account-graph-blank-area-missing");
	await page.mouse.click(
		(at as { x: number; y: number }).x,
		(at as { x: number; y: number }).y,
	);
}

export async function expectReadableAccountGraph(
	page: Page,
	options: { all?: boolean; nodeId?: string; centered?: boolean } = {},
) {
	const graph = await waitForAccountGraphLayout(page);
	await accountGraphCanvas(page).scrollIntoViewIfNeeded();
	const nodes = options.all
		? graph.locator(".react-flow__node")
		: options.nodeId
			? graph.locator(`.react-flow__node[data-id="${options.nodeId}"]`)
			: graph.locator(".react-flow__node.asset-graph-center");
	if (!options.all) await expect(nodes).toHaveCount(1);
	else await expect(nodes).not.toHaveCount(0);
	await expect
		.poll(
			async () => {
				const issues: string[] = [];
				for (const node of await nodes.all()) {
					issues.push(
						...(await node.evaluate((element) => {
							const issues: string[] = [];
							const frame = element
								.closest(".react-flow")
								?.getBoundingClientRect();
							const bounds = element.getBoundingClientRect();
							const viewport = element.closest(".react-flow__viewport");
							const transform = new DOMMatrix(
								viewport ? getComputedStyle(viewport).transform : undefined,
							);
							const scale = Math.hypot(transform.a, transform.b);
							const id = element.getAttribute("data-id");
							if (
								!frame ||
								bounds.left < frame.left - 1 ||
								bounds.right > frame.right + 1 ||
								bounds.top < frame.top - 1 ||
								bounds.bottom > frame.bottom + 1
							)
								issues.push(`${id}: card is clipped`);
							for (const [selector, minimum] of [
								[".asset-graph-label strong", 12],
								[".asset-graph-label small", 11],
							] as const) {
								const text = element.querySelector<HTMLElement>(selector);
								if (!text) {
									if (selector.endsWith("strong"))
										issues.push(`${id}: name is missing`);
									continue;
								}
								const rect = text.getBoundingClientRect();
								const font =
									Number.parseFloat(getComputedStyle(text).fontSize) * scale;
								const baseFont = selector.endsWith("strong") ? 14 : 12;
								if (
									Math.abs(
										Number.parseFloat(getComputedStyle(text).fontSize) -
											baseFont,
									) > 0.01
								)
									issues.push(
										`${id}: base text size differs from ${baseFont}px`,
									);
								if (font < minimum - 0.01)
									issues.push(`${id}: ${selector} is ${font.toFixed(2)}px`);
								if (
									rect.width <= 0 ||
									rect.height <= 0 ||
									rect.left < bounds.left - 1 ||
									rect.right > bounds.right + 1 ||
									rect.top < bounds.top - 1 ||
									rect.bottom > bounds.bottom + 1
								)
									issues.push(`${id}: text is outside the card`);
								const hit = document.elementFromPoint(
									rect.x + rect.width / 2,
									rect.y + rect.height / 2,
								);
								if (hit?.closest(".react-flow__node") !== element)
									issues.push(`${id}: text is obscured`);
							}
							return issues;
						})),
					);
				}
				return issues;
			},
			{
				message:
					"Names remain at least 12px, identifiers 11px, and complete cards fit the reading viewport",
			},
		)
		.toEqual([]);
	if (options.centered ?? (!options.all && !options.nodeId)) {
		const current = graph.locator(".asset-graph-center");
		await expect
			.poll(
				async () => {
					const [frame, node] = await Promise.all([
						accountGraphCanvas(page).boundingBox(),
						current.boundingBox(),
					]);
					return (
						!!frame &&
						!!node &&
						Math.abs(node.x + node.width / 2 - frame.x - frame.width / 2) <=
							3 &&
						Math.abs(node.y + node.height / 2 - frame.y - frame.height / 2) <= 3
					);
				},
				{ message: "The current account is centered in the usable canvas" },
			)
			.toBe(true);
	}
}

export async function expectAllAccountGraphNodesInFrame(page: Page) {
	const graph = await waitForAccountGraphLayout(page);
	await expect
		.poll(
			() =>
				graph.locator(".react-flow").evaluate((canvas) => {
					const bounds = canvas.getBoundingClientRect();
					const nodes = [...canvas.querySelectorAll(".react-flow__node")];
					return (
						nodes.length > 0 &&
						nodes.every((node) => {
							const rect = node.getBoundingClientRect();
							return (
								rect.left >= bounds.left - 1 &&
								rect.right <= bounds.right + 1 &&
								rect.top >= bounds.top - 1 &&
								rect.bottom <= bounds.bottom + 1
							);
						})
					);
				}),
			{
				message:
					"Overview includes every node; this does not certify text readability",
			},
		)
		.toBe(true);
}

export async function expectAccountGraphGeometry(
	page: Page,
	expected?: Array<{ from: string; to: string }>,
) {
	const graph = await waitForAccountGraphLayout(page);
	if (expected) {
		const pairs = await graph
			.locator(".react-flow__edge")
			.evaluateAll((edges) =>
				edges
					.map((edge) =>
						JSON.stringify([
							edge.getAttribute("data-from"),
							edge.getAttribute("data-to"),
						]),
					)
					.sort(),
			);
		expect(pairs).toEqual(
			[
				...new Set(
					expected.map((edge) => JSON.stringify([edge.from, edge.to])),
				),
			].sort(),
		);
	}
	const problems = await graph.locator(".react-flow").evaluate((canvas) => {
		const problems: string[] = [];
		const nodes = [
			...canvas.querySelectorAll<HTMLElement>(".react-flow__node"),
		].map((node) => ({
			id: node.dataset.id,
			rect: node.getBoundingClientRect(),
			width: Number(node.dataset.nodeWidth),
			height: Number(node.dataset.nodeHeight),
			current: node.classList.contains("asset-graph-center"),
		}));
		const viewport = canvas.querySelector(".react-flow__viewport");
		const transform = new DOMMatrix(
			viewport ? getComputedStyle(viewport).transform : undefined,
		);
		const zoom = Math.hypot(transform.a, transform.b);
		for (const node of nodes) {
			const allowed = node.current
				? [
						[190, 76],
						[180, 76],
					]
				: [
						[190, 64],
						[160, 60],
					];
			if (
				!allowed.some(
					([width, height]) => node.width === width && node.height === height,
				) ||
				Math.abs(node.rect.width / zoom - node.width) > 1 ||
				Math.abs(node.rect.height / zoom - node.height) > 1
			)
				problems.push(
					`${node.id}: rendered card size differs from its layout size`,
				);
		}
		for (let i = 0; i < nodes.length; i++)
			for (const other of nodes.slice(i + 1)) {
				const a = nodes[i].rect,
					b = other.rect;
				if (
					!(
						a.right + 20 * zoom - 1 <= b.left ||
						b.right + 20 * zoom - 1 <= a.left ||
						a.bottom + 20 * zoom - 1 <= b.top ||
						b.bottom + 20 * zoom - 1 <= a.top
					)
				)
					problems.push(
						`${nodes[i].id}/${other.id}: cards have less than 20 layout pixels of separation`,
					);
			}
		for (const edge of canvas.querySelectorAll(".react-flow__edge")) {
			const from = edge.getAttribute("data-from"),
				to = edge.getAttribute("data-to");
			const source = nodes.find((node) => node.id === from)?.rect,
				target = nodes.find((node) => node.id === to)?.rect;
			const path = edge.querySelector<SVGPathElement>(".react-flow__edge-path");
			const matrix = path?.getScreenCTM();
			const name = `${from} → ${to}`;
			if (
				!source ||
				!target ||
				!path ||
				!matrix ||
				/NaN|Infinity/.test(path.getAttribute("d") ?? "")
			) {
				problems.push(`${name}: invalid route or endpoints`);
				continue;
			}
			const length = path.getTotalLength();
			if (!(length > 0) || !path.getAttribute("marker-end")?.includes("url(")) {
				problems.push(`${name}: missing path or target arrow`);
				continue;
			}
			const point = (distance: number) => {
				const p = path.getPointAtLength(distance);
				return new DOMPoint(p.x, p.y).matrixTransform(matrix);
			};
			const start = point(0),
				end = point(length),
				beforeEnd = point(
					Math.max(0, length - 4 / Math.hypot(matrix.a, matrix.b)),
				);
			const onSide = (p: DOMPoint, rect: DOMRect) =>
				(Math.abs(p.x - rect.left) <= 4 || Math.abs(p.x - rect.right) <= 4) &&
				p.y >= rect.top - 2 &&
				p.y <= rect.bottom + 2;
			if (!onSide(start, source) || !onSide(end, target))
				problems.push(`${name}: route joins the wrong source/target card`);
			if (
				Math.abs(end.x - target.left) <= 4
					? beforeEnd.x >= end.x
					: beforeEnd.x <= end.x
			)
				problems.push(
					`${name}: final path direction does not enter its target`,
				);
			const steps = Math.max(
				2,
				Math.ceil((length * Math.hypot(matrix.a, matrix.b)) / 2),
			);
			for (let step = 1; step < steps; step++) {
				const p = point((length * step) / steps);
				if (
					nodes.some(
						(node) =>
							p.x > node.rect.left + 2 &&
							p.x < node.rect.right - 2 &&
							p.y > node.rect.top + 2 &&
							p.y < node.rect.bottom - 2,
					)
				) {
					problems.push(`${name}: path crosses a card`);
					break;
				}
			}
		}
		return problems;
	});
	expect(
		problems,
		"Stored source/target direction, arrows and card avoidance survive the centered layout",
	).toEqual([]);
}

export async function panAccountGraphNodeIntoView(page: Page, id: string) {
	const graph = await waitForAccountGraphLayout(page);
	const node = graph.locator(`.react-flow__node[data-id="${id}"]`);
	await expect(node).toHaveCount(1);
	await graph.scrollIntoViewIfNeeded();
	for (let attempt = 0; attempt < 24; attempt++) {
		const movement = await node.evaluate((element) => {
			const canvas = element.closest(".react-flow");
			const frame = canvas?.getBoundingClientRect(),
				rect = element.getBoundingClientRect();
			if (!canvas || !frame) return null;
			const hit = document.elementFromPoint(
				rect.x + rect.width / 2,
				rect.y + rect.height / 2,
			);
			if (
				rect.left >= frame.left + 2 &&
				rect.right <= frame.right - 2 &&
				rect.top >= frame.top + 2 &&
				rect.bottom <= frame.bottom - 2 &&
				hit?.closest(".react-flow__node") === element
			)
				return { done: true, x: 0, y: 0, dx: 0, dy: 0 };
			const dx = Math.max(
				-frame.width * 0.45,
				Math.min(
					frame.width * 0.45,
					frame.x + frame.width / 2 - rect.x - rect.width / 2,
				),
			);
			const dy = Math.max(
				-frame.height * 0.45,
				Math.min(
					frame.height * 0.45,
					frame.y + frame.height / 2 - rect.y - rect.height / 2,
				),
			);
			const minimumX = Math.max(8, -dx + 8),
				maximumX = Math.min(frame.width - 8, frame.width - dx - 8);
			const minimumY = Math.max(8, -dy + 8),
				maximumY = Math.min(frame.height - 8, frame.height - dy - 8);
			for (let yOffset = minimumY; yOffset <= maximumY; yOffset += 8)
				for (let xOffset = minimumX; xOffset <= maximumX; xOffset += 8) {
					const x = frame.x + xOffset,
						y = frame.y + yOffset;
					const hit = document.elementFromPoint(x, y);
					if (
						hit?.classList.contains("react-flow__pane") ||
						hit?.closest(".react-flow__background")
					)
						return { done: false, x, y, dx, dy };
				}
			return null;
		});
		expect(
			movement,
			"A clear canvas area is available for panning",
		).not.toBeNull();
		if (!movement) throw Error("account-graph-pan-area-missing");
		if (movement.done) {
			await expectReadableAccountGraph(page, { nodeId: id, centered: false });
			return;
		}
		const viewport = graph.locator(".react-flow__viewport");
		const before = await viewport.getAttribute("style");
		await page.mouse.move(movement.x, movement.y);
		await page.mouse.down();
		await page.mouse.move(movement.x + movement.dx, movement.y + movement.dy, {
			steps: 6,
		});
		await page.mouse.up();
		await expect(viewport).not.toHaveAttribute("style", before ?? "");
	}
	throw Error(`account-graph-node-unreachable: ${id}`);
}

async function graphViewport(page: Page) {
	return activeAccountGraph(page)
		.locator(".react-flow__viewport")
		.evaluate((element) => {
			const matrix = new DOMMatrix(getComputedStyle(element).transform);
			return { x: matrix.e, y: matrix.f, zoom: Math.hypot(matrix.a, matrix.b) };
		});
}

async function expectUsefulAccountGraphFit(page: Page) {
	await expectAllAccountGraphNodesInFrame(page);
	const fit = await graphViewport(page);
	expect(fit.zoom).toBeGreaterThan(0);
	expect(fit.zoom).toBeLessThanOrEqual(1.001);
	const coverage = await accountGraphCanvas(page).evaluate((canvas) => {
		const frame = canvas.getBoundingClientRect();
		const bounds = [
			...canvas.querySelectorAll(".react-flow__node, .react-flow__edge-path"),
		].map((element) => element.getBoundingClientRect());
		return Math.max(
			(Math.max(...bounds.map((rect) => rect.right)) -
				Math.min(...bounds.map((rect) => rect.left))) /
				frame.width,
			(Math.max(...bounds.map((rect) => rect.bottom)) -
				Math.min(...bounds.map((rect) => rect.top))) /
				frame.height,
		);
	});
	expect(
		fit.zoom >= 0.999 || coverage >= 0.8,
		"Fit uses the available canvas instead of leaving the whole graph unnecessarily tiny",
	).toBe(true);
	return fit;
}

export async function exerciseAccountGraphControls(page: Page) {
	const graph = await waitForAccountGraphLayout(page);
	await expect(graph.locator(".react-flow__controls-button")).toHaveCount(4);
	await expect(graph.locator(".react-flow__controls-fitview")).toHaveCount(0);
	const initial = await graphViewport(page);
	await graph.locator(".react-flow__controls-zoomin").click();
	await expect
		.poll(async () => (await graphViewport(page)).zoom)
		.toBeGreaterThan(initial.zoom);
	const enlarged = await graphViewport(page);
	await graph.locator(".react-flow__controls-zoomout").click();
	await expect
		.poll(async () => (await graphViewport(page)).zoom)
		.toBeLessThan(enlarged.zoom);
	for (const control of await graph
		.locator(".react-flow__controls-button")
		.all()) {
		const bounds = await control.boundingBox();
		expect(bounds?.width).toBeGreaterThanOrEqual(44);
		expect(bounds?.height).toBeGreaterThanOrEqual(44);
		const icon = await control.locator("svg").boundingBox();
		expect(icon?.width, "Navigation icons stay legible inside their touch targets").toBeGreaterThanOrEqual(18);
		expect(icon?.height).toBeGreaterThanOrEqual(18);
	}
	const actions = graph.locator(".account-graph-view-actions");
	await expect(actions).toBeVisible();
	await expect(actions.locator(".account-graph-view-toggle")).toHaveCount(1);
	await focusAccountGraph(page);
	await expectReadableAccountGraph(page);
	await fitAccountGraph(page);
	await expectUsefulAccountGraphFit(page);
	await focusAccountGraph(page);
	await expectReadableAccountGraph(page);
}

export async function focusAccountGraph(page: Page) {
	const graph = await waitForAccountGraphLayout(page);
	const focus = graph.getByRole("button", { name: /^(回到当前|Back to current)$/, exact: true });
	if (await focus.count() === 0) {
		// The combined view control can show Fit all inside its small center dead zone.
		// Enter its reading-focus state through the actual zoom control first.
		await graph.locator(".react-flow__controls-zoomout").click();
		await expect(focus).toBeVisible();
	}
	await focus.click();
}

export async function fitAccountGraph(page: Page) {
	await focusAccountGraph(page);
	await activeAccountGraph(page).getByRole("button", { name: /^(适应画布|Fit all)$/, exact: true }).click();
}

export async function exerciseAccountGraphMiniMap(page: Page) {
	const graph = await waitForAccountGraphLayout(page);
	const minimap = graph.locator(".react-flow__minimap svg");
	await expect(minimap).toBeVisible();
	const nodeCount = await graph.locator(".react-flow__node").count();
	await expect(minimap.locator("rect.react-flow__minimap-node")).toHaveCount(
		nodeCount,
	);
	const mapIssues = await minimap.evaluate((svg) => {
		const issues: string[] = [];
		const outer = svg.closest(".account-family-graph");
		const nodes = [
			...(outer?.querySelectorAll<HTMLElement>(".react-flow__node") ?? []),
		].map((node) => {
			const matrix = new DOMMatrix(getComputedStyle(node).transform);
			return {
				x: matrix.e,
				y: matrix.f,
				width: Number(node.dataset.nodeWidth),
				height: Number(node.dataset.nodeHeight),
				current: node.classList.contains("asset-graph-center"),
				color: getComputedStyle(
					node.querySelector(".account-graph-card") ?? node,
				).backgroundColor,
			};
		});
		const background = getComputedStyle(
			svg.parentElement ?? svg,
		).backgroundColor;
		const root = nodes.find((node) => node.current);
		const luminance = (color: string) => {
			const values = color
				.match(/[\d.]+/g)
				?.slice(0, 3)
				.map((value) => {
					const channel = Number(value) / 255;
					return channel <= 0.04045
						? channel / 12.92
						: ((channel + 0.055) / 1.055) ** 2.4;
				});
			return values?.length === 3
				? 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2]
				: Number.NaN;
		};
		let rootCount = 0;
		for (const rect of svg.querySelectorAll<SVGRectElement>(
			"rect.react-flow__minimap-node",
		)) {
			const x = Number(rect.getAttribute("x")),
				y = Number(rect.getAttribute("y")),
				width = Number(rect.getAttribute("width")),
				height = Number(rect.getAttribute("height"));
			const node = nodes.find(
				(node) => Math.abs(node.x - x) < 0.1 && Math.abs(node.y - y) < 0.1,
			);
			if (
				!node ||
				!(width > 0 && height > 0) ||
				Math.abs(width - node.width) > 0.1 ||
				Math.abs(height - node.height) > 0.1
			) {
				issues.push("Map rectangle does not match an actual sized node");
				continue;
			}
			const rendered = rect.getBoundingClientRect();
			if (!(rendered.width > 0 && rendered.height > 0))
				issues.push("Map rectangle has no visible size");
			const fill = getComputedStyle(rect).fill;
			if (node.current) {
				rootCount++;
				if (fill !== root?.color)
					issues.push(
						"The current account does not keep its distinct map color",
					);
			} else {
				if (fill === root?.color)
					issues.push("Another account uses the current account's map color");
				const a = luminance(fill),
					b = luminance(background);
				const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
				if (!(contrast >= 3))
					issues.push(
						"Other accounts are too faint against the map background",
					);
			}
		}
		if (rootCount !== 1)
			issues.push("The map must contain exactly one current account");
		return issues;
	});
	expect(
		mapIssues,
		"The map renders all real account rectangles with distinguishable colors",
	).toEqual([]);
	await minimap.scrollIntoViewIfNeeded();
	const bounds = await minimap.boundingBox();
	if (!bounds) throw Error("account-graph-minimap-missing");
	const beforeClick = await graphViewport(page);
	await minimap.click({
		position: { x: bounds.width * 0.25, y: bounds.height * 0.2 },
	});
	await expect
		.poll(
			async () => {
				const after = await graphViewport(page);
				return Math.hypot(after.x - beforeClick.x, after.y - beforeClick.y);
			},
			{ message: "Clicking the map moves the actual graph viewport" },
		)
		.toBeGreaterThan(1);
	await page.mouse.move(
		bounds.x + bounds.width * 0.45,
		bounds.y + bounds.height * 0.45,
	);
	await page.mouse.down();
	try {
		const beforeDrag = await graphViewport(page);
		await page.mouse.move(
			bounds.x + bounds.width * 0.7,
			bounds.y + bounds.height * 0.7,
			{ steps: 6 },
		);
		await expect
			.poll(
				async () => {
					const after = await graphViewport(page);
					return Math.hypot(after.x - beforeDrag.x, after.y - beforeDrag.y);
				},
				{
					message: "Dragging the map moves the graph while the pointer is held",
				},
			)
			.toBeGreaterThan(1);
	} finally {
		await page.mouse.up();
	}
	await page.mouse.move(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2,
	);
	const beforeWheel = await graphViewport(page);
	await page.mouse.wheel(0, -160);
	await expect
		.poll(async () => (await graphViewport(page)).zoom, {
			message: "The map wheel actually increases the graph reading scale",
		})
		.toBeGreaterThan(beforeWheel.zoom);
	const wheelZoomed = await graphViewport(page);
	await page.mouse.wheel(0, 160);
	await expect
		.poll(async () => (await graphViewport(page)).zoom, {
			message:
				"The reverse map wheel actually decreases the graph reading scale",
		})
		.toBeLessThan(wheelZoomed.zoom);
	// The combined control treats a small offset/zoom as already near current.
	// Expose its return action with a real zoom step before requiring exact focus.
	const returnToCurrent = graph.getByRole("button", { name: /^(回到当前|Back to current)$/, exact: true });
	if (!(await returnToCurrent.count())) {
		await graph.getByRole("button", { name: /^(缩小|Zoom out)$/, exact: true }).click();
		await expect(returnToCurrent).toBeVisible();
	}
	await focusAccountGraph(page);
	await expectReadableAccountGraph(page);
}

export async function expectCanvasActionsOutsideStage(page: Page) {
	const graph = await waitForAccountGraphLayout(page);
	const navigation = graph.locator(".account-graph-navigation");
	await graph.locator(".account-graph-view-actions").scrollIntoViewIfNeeded();
	await expect(navigation).toBeVisible();
	await expect(navigation.locator(".react-flow__controls")).toHaveCount(1);
	await expect(navigation.locator(".react-flow__controls-button")).toHaveCount(
		4,
	);
	await expect(
		navigation.locator(".react-flow__controls-zoomin"),
	).toBeVisible();
	await expect(
		navigation.locator(".react-flow__controls-zoomout"),
	).toBeVisible();
	await expect(navigation.locator(".react-flow__controls-fitview")).toHaveCount(
		0,
	);
	const [actions, stage] = await Promise.all([
		graph.locator(".account-graph-view-actions").boundingBox(),
		graph.locator(".react-flow").boundingBox(),
	]);
	expect(actions && stage && actions.y + actions.height <= stage.y + 1).toBe(
		true,
	);
	for (const button of await graph
		.locator(".account-graph-view-actions .button")
		.all()) {
		const bounds = await button.boundingBox();
		expect(bounds && stage && bounds.y + bounds.height + 8 <= stage.y).toBe(
			true,
		);
	}
	for (const control of await navigation
		.locator(".react-flow__controls, .react-flow__minimap")
		.all()) {
		const bounds = await control.boundingBox();
		expect(
			bounds && stage && bounds.y + bounds.height <= stage.y,
			"Graph navigation occupies its own area above the account canvas",
		).toBe(true);
	}
	for (const control of await navigation
		.locator(".react-flow__controls-button")
		.all()) {
		const bounds = await control.boundingBox();
		expect(bounds?.width).toBeGreaterThanOrEqual(44);
		expect(bounds?.height).toBeGreaterThanOrEqual(44);
		const icon = await control.locator("svg").boundingBox();
		expect(icon?.width).toBeGreaterThanOrEqual(18);
		expect(icon?.height).toBeGreaterThanOrEqual(18);
	}
	const clipping = await graph
		.locator(".account-graph-view-actions")
		.evaluate((toolbar) => {
			const frame = toolbar.getBoundingClientRect();
			return [
				...toolbar.querySelectorAll("button, .react-flow__minimap"),
			].flatMap((control) => {
				const rect = control.getBoundingClientRect();
				const hit = document.elementFromPoint(
					rect.x + rect.width / 2,
					rect.y + rect.height / 2,
				);
				const issues: string[] = [];
				if (
					rect.left < frame.left ||
					rect.right > frame.right ||
					rect.left < 0 ||
					rect.right > innerWidth
				)
					issues.push(
						`${control.className}: horizontally clipped (${rect.left.toFixed(1)}–${rect.right.toFixed(1)} vs toolbar ${frame.left.toFixed(1)}–${frame.right.toFixed(1)})`,
					);
				if (!hit || !control.contains(hit))
					issues.push(
						"A graph navigation control is obscured at its interaction point",
					);
				return issues;
			});
		});
	expect(clipping).toEqual([]);
}

export async function visibleGraphNodeIds(graph: Locator) {
	return graph
		.locator(".react-flow__node")
		.evaluateAll((nodes) =>
			nodes.map((node) => node.getAttribute("data-id") ?? "").sort(),
		);
}
