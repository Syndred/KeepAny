import ELK, { type ElkLayoutArguments, type ElkNode } from "elkjs/lib/elk.bundled.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newAsset, type Asset, type Relation } from "../../../packages/domain/src";
import { layoutAccountGraph, type AccountGraphLayout } from "./account-graph-layout";

const asset = (id: string): Asset => ({ ...newAsset("account"), id, name: id });
const relation = (from: string, to: string, id = `${from}-${to}`): Relation => ({ id, from, to, label: "Login email", createdAt: "", verifiedAt: "", deleted: false });
const key = (from: string, to: string) => JSON.stringify([from, to]);
function star(total: number, prefix = "star") {
	const root = `${prefix}-root`, assets = [asset(root), ...Array.from({ length: total - 1 }, (_, index) => asset(`${prefix}-service-${String(index).padStart(2, "0")}`))];
	return { root, assets, relations: assets.slice(1).map((entry) => relation(entry.id, root)) };
}
function verifyGeometry(layout: AccountGraphLayout, relations: Relation[]) {
	const nodes = [...layout.nodes.values()];
	expect(layout.edges.size).toBe(new Set(relations.map((entry) => key(entry.from, entry.to))).size);
	for (const [index, a] of nodes.entries()) {
		expect([a.x, a.y, a.width, a.height].every(Number.isFinite)).toBe(true);
		expect(a.x).toBeGreaterThanOrEqual(layout.bounds.x);
		expect(a.y).toBeGreaterThanOrEqual(layout.bounds.y);
		expect(a.x + a.width).toBeLessThanOrEqual(layout.bounds.x + layout.bounds.width);
		expect(a.y + a.height).toBeLessThanOrEqual(layout.bounds.y + layout.bounds.height);
		for (const b of nodes.slice(index + 1)) expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
	}
	for (const pair of new Map(relations.map((entry) => [key(entry.from, entry.to), entry])).values()) {
		const edge = layout.edges.get(key(pair.from, pair.to)), source = layout.nodes.get(pair.from), target = layout.nodes.get(pair.to);
		expect(edge).toBeDefined(); expect(source).toBeDefined(); expect(target).toBeDefined();
		if (!edge || !source || !target) throw Error("Missing layout endpoint");
		const from = source.handles.find((handle) => handle.id === edge.sourceHandle), to = target.handles.find((handle) => handle.id === edge.targetHandle);
		expect(from?.type).toBe("source"); expect(to?.type).toBe("target");
		if (!from || !to) throw Error("Missing layout handle");
		expect(edge.points[0]).toEqual({ x: source.x + from.x, y: source.y + from.y });
		expect(edge.points.at(-1)).toEqual({ x: target.x + to.x, y: target.y + to.y });
		expect(from.x).toBe(from.side === "left" ? 0 : source.width);
		expect(to.x).toBe(to.side === "left" ? 0 : target.width);
		for (let index = 1; index < edge.points.length; index++) {
			const a = edge.points[index - 1], b = edge.points[index];
			expect([a.x, a.y, b.x, b.y].every(Number.isFinite)).toBe(true);
			expect(a.x === b.x || a.y === b.y).toBe(true);
			const steps = Math.ceil(Math.hypot(a.x - b.x, a.y - b.y) / 4);
			for (let step = 1; step < steps; step++) {
				const x = a.x + (b.x - a.x) * step / steps, y = a.y + (b.y - a.y) * step / steps;
				expect(nodes.some((node) => x > node.x + 0.01 && x < node.x + node.width - 0.01 && y > node.y + 0.01 && y < node.y + node.height - 0.01), `Path ${pair.from} → ${pair.to} stays outside every card`).toBe(false);
			}
		}
	}
}
function snapshot(layout: AccountGraphLayout) {
	return { nodes: [...layout.nodes].sort(([a], [b]) => a.localeCompare(b)), edges: [...layout.edges].sort(([a], [b]) => a.localeCompare(b)), bounds: layout.bounds };
}
function centeredReadingScale(layout: AccountGraphLayout, rootId: string, viewport: { width: number; height: number }) {
	const root = layout.nodes.get(rootId);
	if (!root) throw Error("Missing current account");
	const x = root.x + root.width / 2, y = root.y + root.height / 2, bounds = layout.bounds;
	return Math.min(1, viewport.width / (Math.max(x - bounds.x, bounds.x + bounds.width - x) * 2 + 16), viewport.height / (Math.max(y - bounds.y, bounds.y + bounds.height - y) * 2 + 16));
}
function hasExclusivePointerPatch(layout: AccountGraphLayout, edgeKey: string, zoom: number) {
	type Point = { x: number; y: number };
	const route = layout.edges.get(edgeKey)?.points;
	if (!route) return false;
	const distance = (point: Point, path: Point[]) => Math.min(...path.slice(1).map((b, index) => {
		const a = path[index], dx = b.x - a.x, dy = b.y - a.y;
		const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
		return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
	}));
	const otherRoutes = [...layout.edges].filter(([entry]) => entry !== edgeKey).map(([, edge]) => edge.points);
	for (let index = 1; index < route.length; index++) {
		const a = route[index - 1], b = route[index], length = Math.hypot(b.x - a.x, b.y - a.y);
		for (let offset = 1; offset < length; offset += 1 / zoom) {
			const center = { x: Math.round((a.x + (b.x - a.x) * offset / length) * zoom) / zoom, y: Math.round((a.y + (b.y - a.y) * offset / length) * zoom) / zoom };
			// React Flow's 20px layout-space hit stroke must contain all nine screen-space points,
			// with no other edge or card able to receive any of those pointer events.
			if ([-2, 0, 2].every((dx) => [-2, 0, 2].every((dy) => {
				const point = { x: center.x + dx / zoom, y: center.y + dy / zoom };
				return distance(point, route) < 10 && otherRoutes.every((path) => distance(point, path) > 10)
					&& [...layout.nodes.values()].every((node) => point.x < node.x || point.x > node.x + node.width || point.y < node.y || point.y > node.y + node.height);
			}))) return true;
		}
	}
	return false;
}
afterEach(() => vi.restoreAllMocks());

describe("account graph layout", () => {
	it.each([12, 24, 49])("balances a %i-account shared mailbox on both sides with readable fit candidates", async (total) => {
		const fixture = star(total), viewport = total === 49 ? { width: 1230, height: 740 } : { width: 1100, height: 560 };
		const layout = await layoutAccountGraph(fixture.root, fixture.assets, fixture.relations, viewport);
		verifyGeometry(layout, fixture.relations);
		const root = layout.nodes.get(fixture.root);
		if (!root) throw Error("Missing current account");
		const left = [...layout.nodes].filter(([id, node]) => id !== fixture.root && node.x + node.width <= root.x), right = [...layout.nodes].filter(([id, node]) => id !== fixture.root && node.x >= root.x + root.width);
		expect(left.length + right.length).toBe(total - 1);
		expect(Math.abs(left.length - right.length)).toBeLessThanOrEqual(1);
		expect(root.x + root.width / 2).toBeCloseTo(layout.bounds.width / 2, 0);
		expect(Math.abs(root.y + root.height / 2 - layout.bounds.height / 2)).toBeLessThanOrEqual(1);
		const zoom = Math.min(1, viewport.width / layout.bounds.width, viewport.height / layout.bounds.height);
		expect(zoom * 14).toBeGreaterThanOrEqual(total === 12 ? 14 : 13);
		expect(zoom * 12).toBeGreaterThanOrEqual(total === 12 ? 12 : 11);
		expect(centeredReadingScale(layout, fixture.root, viewport)).toBeGreaterThanOrEqual(11 / 12);
		for (const entry of fixture.assets.slice(1)) expect(layout.nodes.get(entry.id)?.width).toBe(total > 24 ? 160 : 190);
		const sourceSides = new Set(fixture.relations.map((entry) => {
			const edge = layout.edges.get(key(entry.from, entry.to));
			return layout.nodes.get(entry.from)?.handles.find((handle) => handle.id === edge?.sourceHandle)?.side;
		}));
		expect(sourceSides).toEqual(new Set(["left", "right"]));
	});
	it.each([0, 1, 9])("fits the 12-account reciprocal/cross-side family at a 964×570 stage using responsive compact cards (ID order %i)", async (seed) => {
		const names = ["mail", "phoneA", "phoneB", "docs", "code", "design", "hosting", "video", "analytics", "shop", "learning", "tracker"];
		const ids = new Map(names.map((name, index) => [name, `responsive-${seed}-${String((index + seed) % names.length).padStart(2, "0")}`]));
		const id = (name: string) => ids.get(name) ?? name;
		const assets = names.map((name) => asset(id(name)));
		const pairs = [...names.slice(3).map((name) => [name, "mail"]), ["docs", "mail"], ["code", "phoneA"], ["design", "phoneB"], ["mail", "phoneA"], ["phoneA", "code"], ["mail", "docs"]];
		const relations = pairs.map(([from, to], index) => relation(id(from), id(to), `responsive-${seed}-${index}`));
		const viewport = { width: 964, height: 570 };
		const initial = await layoutAccountGraph(id("mail"), assets, relations, viewport);
		const root = initial.nodes.get(id("mail"));
		if (!root) throw Error("Missing responsive graph root");
		const left = names.slice(3).find((name) => (initial.nodes.get(id(name))?.x ?? Infinity) < root.x);
		const right = names.slice(3).find((name) => (initial.nodes.get(id(name))?.x ?? -Infinity) > root.x);
		if (!left || !right) throw Error("Missing responsive graph bank");
		relations.push(relation(id(left), id(right), `responsive-cross-${seed}`));
		const layout = await layoutAccountGraph(id("mail"), assets, relations, viewport);
		verifyGeometry(layout, relations);
		expect(layout.nodes.size).toBe(12);
		expect(layout.nodes.get(id("docs"))?.width).toBe(160);
		expect(layout.nodes.get(id("mail"))?.width).toBe(180);
		const scale = centeredReadingScale(layout, id("mail"), viewport);
		expect(scale).toBeGreaterThan(11 / 12);
		const current = layout.nodes.get(id("mail"));
		if (!current) throw Error("Missing compact graph root");
		const center = { x: current.x + current.width / 2, y: current.y + current.height / 2 };
		for (const node of layout.nodes.values()) {
			const x = viewport.width / 2 + (node.x - center.x) * scale, y = viewport.height / 2 + (node.y - center.y) * scale;
			expect(x).toBeGreaterThanOrEqual(8); expect(y).toBeGreaterThanOrEqual(8);
			expect(x + node.width * scale).toBeLessThanOrEqual(viewport.width - 8);
			expect(y + node.height * scale).toBeLessThanOrEqual(viewport.height - 8);
		}
	});
	it.each([
		...[-1, 1, 8, 11].map((seed) => ({ seed, width: 318, height: 570, zoom: 0.28 })),
		...[-2, ...Array.from({ length: 16 }, (_, index) => index)].map((seed) => ({ seed, width: 1219, height: 685, zoom: 1 })),
	])("keeps the mailbox edge independently selectable in a reciprocal/cross-side overview at width $width (ID order $seed)", async ({ seed, width, height, zoom }) => {
		const names = ["mail", "phoneA", "phoneB", "docs", "code", "design", "hosting", "video", "analytics", "shop", "learning", "tracker"];
		// Preserve the relative ID order from the real desktop failure without copying browser IDs.
		const capturedOrder = ["mail", "analytics", "design", "code", "hosting", "learning", "shop", "phoneB", "phoneA", "docs", "tracker", "video"];
		const order = seed === -2 ? capturedOrder : seed === -1 ? ["phoneA", "hosting", "docs", "video", "code", "analytics", "shop", "learning", "tracker", "design", "phoneB", "mail"] : [...names];
		let random = seed + 29;
		if (seed >= 0) for (let index = order.length - 1; index > 0; index--) {
			random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
			const other = random % (index + 1);
			[order[index], order[other]] = [order[other], order[index]];
		}
		const ids = new Map(order.map((name, index) => [name, `pointer-${seed}-${String(index).padStart(2, "0")}`]));
		const id = (name: string) => ids.get(name) ?? name;
		const assets = names.map((name) => asset(id(name)));
		const pairs = [...names.slice(3).map((name) => [name, "mail"]), ["docs", "mail"], ["code", "phoneA"], ["design", "phoneB"], ["mail", "phoneA"], ["phoneA", "code"], ["mail", "docs"]];
		const relations = pairs.map(([from, to], index) => relation(id(from), id(to), `pointer-${seed}-${index}`));
		const viewport = { width, height };
		const initial = await layoutAccountGraph(id("mail"), assets, relations, viewport), root = initial.nodes.get(id("mail"));
		if (!root) throw Error("Missing pointer graph root");
		const left = names.slice(3).find((name) => (initial.nodes.get(id(name))?.x ?? Infinity) < root.x);
		const right = names.slice(3).find((name) => (initial.nodes.get(id(name))?.x ?? -Infinity) > root.x);
		if (!left || !right) throw Error("Missing pointer graph bank");
		if (seed === -1) expect([left, right]).toEqual(["docs", "hosting"]);
		if (seed === -2) expect([left, right]).toEqual(["docs", "code"]);
		relations.push(relation(id(left), id(right), `pointer-cross-${seed}`));
		const layout = await layoutAccountGraph(id("mail"), assets, relations, viewport);
		verifyGeometry(layout, relations);
		const fittedZoom = Math.min(1, viewport.width / (layout.bounds.width + 16), viewport.height / (layout.bounds.height + 16));
		expect(hasExclusivePointerPatch(layout, key(id("docs"), id("mail")), zoom)).toBe(true);
		expect(hasExclusivePointerPatch(layout, key(id("docs"), id("mail")), fittedZoom)).toBe(true);
	});
	it("is stable across collection ordering, multiple purposes and fresh metadata", async () => {
		const fixture = star(12, "stable"), backup = structuredClone(fixture);
		const first = await layoutAccountGraph(fixture.root, fixture.assets, fixture.relations, { width: 1100, height: 560 });
		const reordered = await layoutAccountGraph(fixture.root, [...fixture.assets].reverse(), [...fixture.relations].reverse().concat({ ...fixture.relations[0], id: "another-purpose", label: "Recovery phone" }), { width: 1100, height: 560 });
		expect(snapshot(reordered)).toEqual(snapshot(first));
		expect(fixture).toEqual(backup);
		const root = first.nodes.get(fixture.root);
		if (root) root.x = -999;
		first.edges.clear();
		expect(snapshot(await layoutAccountGraph(fixture.root, fixture.assets, fixture.relations, { width: 1100, height: 560 }))).toEqual(snapshot(reordered));
	});
	it("balances unique BFS branch weights [11, 10, 1, 1] as 12/11 instead of 21/2", async () => {
		const rootId = "weighted-root", ids = [rootId], relations: Relation[] = [];
		for (const [index, weight] of [11, 10, 1, 1].entries()) {
			const branch = `weighted-${String.fromCharCode(97 + index)}`;
			ids.push(branch); relations.push(relation(branch, rootId));
			for (let leaf = 1; leaf < weight; leaf++) {
				const id = `${branch}-${String(leaf).padStart(2, "0")}`;
				ids.push(id); relations.push(relation(id, branch));
			}
		}
		const assets = ids.map(asset);
		const layout = await layoutAccountGraph(rootId, assets, relations, { width: 1100, height: 560 });
		verifyGeometry(layout, relations);
		const root = layout.nodes.get(rootId);
		if (!root) throw Error("Missing weighted graph root");
		const left = [...layout.nodes].filter(([id, node]) => id !== rootId && node.x + node.width <= root.x).map(([id]) => id);
		const right = [...layout.nodes].filter(([id, node]) => id !== rootId && node.x >= root.x + root.width).map(([id]) => id);
		expect([left.length, right.length]).toEqual([12, 11]);
		expect(left).toEqual(expect.arrayContaining(["weighted-a", "weighted-d"]));
		expect(right).toEqual(expect.arrayContaining(["weighted-b", "weighted-c"]));
		const reordered = await layoutAccountGraph(rootId, [...assets].reverse(), [...relations].reverse(), { width: 1101, height: 560 });
		expect(snapshot(reordered)).toEqual(snapshot(layout));
	});
	it("keeps cycle and reciprocal records in their actual directions with separate ports", async () => {
		const ids = ["cycle-a", "cycle-b", "cycle-c", "cycle-d"];
		const relations = [relation(ids[0], ids[1]), relation(ids[1], ids[0]), relation(ids[1], ids[2]), relation(ids[2], ids[0]), relation(ids[2], ids[3])];
		const layout = await layoutAccountGraph(ids[0], ids.map(asset), relations, { width: 1100, height: 560 });
		verifyGeometry(layout, relations);
		const forward = layout.edges.get(key(ids[0], ids[1])), reverse = layout.edges.get(key(ids[1], ids[0]));
		expect(forward?.points).not.toEqual(reverse ? [...reverse.points].reverse() : []);
		for (const pair of relations.slice(0, 2)) {
			const edge = layout.edges.get(key(pair.from, pair.to));
			const node = layout.nodes.get(pair.from), handle = node?.handles.find((handle) => handle.id === edge?.sourceHandle);
			expect(Math.abs((handle?.y ?? 0) - (node?.height ?? 0) / 2)).toBe(8);
		}
	});
	it("routes shared email/phone, cross-side paths and multi-hop chains without dropping purposes", async () => {
		const ids = ["email", "phone", ...Array.from({ length: 10 }, (_, index) => `mixed-${index}`)];
		const pairs = [["mixed-0", "email"], ["mixed-0", "phone"], ["phone", "mixed-0"], ["email", "phone"], ["phone", "email"], ["mixed-1", "mixed-2"], ["mixed-2", "email"], ["mixed-3", "mixed-4"], ["mixed-4", "mixed-5"], ["mixed-5", "phone"], ["mixed-6", "email"], ["mixed-7", "phone"], ["mixed-8", "email"], ["mixed-9", "phone"]];
		const relations = pairs.map(([from, to]) => relation(from, to));
		const layout = await layoutAccountGraph("email", ids.map(asset), relations, { width: 1100, height: 560 });
		verifyGeometry(layout, relations);
		expect(layout.nodes.size).toBe(12);
		expect(layout.edges.size).toBe(14);
	});
	it("excludes deleted, missing, self and disconnected records without altering input", async () => {
		const assets = [asset("live-root"), asset("live-b"), { ...asset("deleted"), deleted: true }, asset("outside")];
		const relations = [relation("live-root", "live-b"), relation("live-b", "deleted"), relation("deleted", "outside"), relation("live-root", "missing"), relation("live-root", "live-root"), { ...relation("live-b", "outside"), deleted: true }];
		const layout = await layoutAccountGraph("live-root", assets, relations, { width: 0, height: Number.NaN });
		expect([...layout.nodes.keys()].sort()).toEqual(["live-b", "live-root"]);
		verifyGeometry(layout, relations.slice(0, 1));
		const empty = await layoutAccountGraph("deleted", assets, relations, { width: 1100, height: 560 });
		expect(empty.nodes.size).toBe(0); expect(empty.edges.size).toBe(0); expect(empty.bounds.width).toBe(0);
	});
	it.each([24, 49])("audits mixed %i-account cross-side families with cycles and shared identities", async (total) => {
		const identities = ["mixed-email-1", "mixed-email-2", "mixed-phone-1", "mixed-phone-2"];
		const services = Array.from({ length: total - identities.length }, (_, index) => `mixed-service-${String(index).padStart(2, "0")}`);
		const pairs = services.map((id, index) => [id, identities[index % identities.length]]);
		services.forEach((id, index) => { if (index % 3 === 0) pairs.push([id, identities[(index + 1) % identities.length]]); });
		pairs.push([identities[0], identities[1]], [identities[1], identities[2]], [identities[2], identities[0]], [identities[0], services[0]], [services[1], services[2]], [services[2], services[3]]);
		const relations = pairs.map(([from, to]) => relation(from, to));
		const assets = [...identities, ...services].map(asset);
		const layout = await layoutAccountGraph(identities[0], assets, relations, { width: 1230, height: 740 });
		verifyGeometry(layout, relations);
		expect(layout.nodes.size).toBe(total);
		expect([...layout.edges.keys()].sort()).toEqual([...new Set(relations.map((entry) => key(entry.from, entry.to)))].sort());
	});
	it.each([318, 1230])("shares ordinary center ports instead of making 48 mailbox handles at viewport width %i", async (width) => {
		const fixture = star(49, `handles-${width}`);
		const layout = await layoutAccountGraph(fixture.root, fixture.assets, fixture.relations, { width, height: 740 });
		verifyGeometry(layout, fixture.relations);
		expect(layout.nodes.get(fixture.root)?.handles).toHaveLength(2);
		for (const node of layout.nodes.values()) for (const handle of node.handles) expect(handle.y).toBe(node.height / 2);
	});
	it("falls back to audited NONE routes when all split routes are malformed", async () => {
		const prototype = ELK.prototype as InstanceType<typeof ELK>;
		const original = prototype.layout, calls: string[] = [];
		vi.spyOn(prototype, "layout").mockImplementation(function <T extends ElkNode>(this: InstanceType<typeof ELK>, graph: T, args?: ElkLayoutArguments): Promise<T> {
			const strategy = graph.layoutOptions?.["org.eclipse.elk.layered.layerUnzipping.strategy"] ?? "";
			calls.push(strategy);
			return original.call(this, graph, args).then((result) => {
				if (strategy === "ALTERNATING" && result.edges?.[0]?.sections?.[0]) result.edges[0].sections[0].startPoint.x = Number.NaN;
				return result as T;
			});
		});
		const fixture = star(24, "fallback");
		const layout = await layoutAccountGraph(fixture.root, fixture.assets, fixture.relations, { width: 1100, height: 560 });
		verifyGeometry(layout, fixture.relations);
		expect(calls).toContain("ALTERNATING"); expect(calls).toContain("NONE");
	});
	it("rejects every invalid candidate rather than rendering unverified routes", async () => {
		const prototype = ELK.prototype as InstanceType<typeof ELK>;
		const original = prototype.layout;
		vi.spyOn(prototype, "layout").mockImplementation(function <T extends ElkNode>(this: InstanceType<typeof ELK>, graph: T, args?: ElkLayoutArguments): Promise<T> {
			return original.call(this, graph, args).then((result) => {
				if (result.edges?.[0]?.sections?.[0]) result.edges[0].sections[0].startPoint.x = Number.NaN;
				return result as T;
			});
		});
		const fixture = star(12, "unavailable");
		await expect(layoutAccountGraph(fixture.root, fixture.assets, fixture.relations, { width: 1100, height: 560 })).rejects.toThrow("account-graph-layout-unavailable");
	});
});
