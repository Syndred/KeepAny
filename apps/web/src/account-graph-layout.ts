import ELK, { type ElkNode, type ElkPoint } from "elkjs/lib/elk.bundled.js";
import type { Asset, Relation } from "../../../packages/domain/src";
import { accountFamilyGraph } from "./account-family-graph";

export interface AccountGraphHandle {
	id: string;
	side: "left" | "right";
	type: "source" | "target";
	x: number;
	y: number;
}
export interface AccountGraphNodeLayout {
	x: number;
	y: number;
	width: number;
	height: number;
	handles: AccountGraphHandle[];
}
export interface AccountGraphEdgeLayout {
	points: { x: number; y: number }[];
	sourceHandle: string;
	targetHandle: string;
}
export interface AccountGraphLayout {
	nodes: Map<string, AccountGraphNodeLayout>;
	edges: Map<string, AccountGraphEdgeLayout>;
	bounds: { x: number; y: number; width: number; height: number };
}

type Point = { x: number; y: number };
type Side = -1 | 0 | 1;
type Pair = { key: string; from: string; to: string };
type ModelNode = {
	id: string;
	internalId: string;
	side: Side;
	depth: number;
	width: number;
	height: number;
	ports: Map<string, { id: string; x: number; y: number }>;
	handles: Map<string, AccountGraphHandle>;
};
type ModelEdge = Pair & {
	internalId: string;
	layoutFrom: string;
	layoutTo: string;
	fromPort: string;
	toPort: string;
	reversed: boolean;
	sourceHandle: string;
	targetHandle: string;
};
type Model = { rootId: string; nodes: Map<string, ModelNode>; edges: ModelEdge[]; twin: boolean };

const elk = new ELK();
const margin = 16;
const gap = 24;
const epsilon = 0.01;
const cache = new Map<string, Promise<AccountGraphLayout>>();
const maxCacheEntries = 16;
const emptyLayout = (): AccountGraphLayout => ({ nodes: new Map(), edges: new Map(), bounds: { x: 0, y: 0, width: 0, height: 0 } });
const pairKey = (from: string, to: string) => JSON.stringify([from, to]);
const samePoint = (a: Point, b: Point) => Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon;

function buildModel(rootId: string, ids: string[], pairs: Pair[], compact = ids.length > 24): Model {
	const adjacency = new Map(ids.map((id) => [id, new Set<string>()]));
	for (const pair of pairs) {
		adjacency.get(pair.from)?.add(pair.to);
		adjacency.get(pair.to)?.add(pair.from);
	}
	const depth = new Map([[rootId, 0]]);
	const side = new Map<string, Side>([[rootId, 0]]);
	const first = [...(adjacency.get(rootId) ?? [])].sort();
	const branchOf = new Map<string, string>();
	for (const id of first) {
		depth.set(id, 1);
		branchOf.set(id, id);
	}
	const frontier = [...first];
	for (let index = 0; index < frontier.length; index++) {
		const parent = frontier[index];
		for (const id of [...(adjacency.get(parent) ?? [])].sort()) {
			if (depth.has(id)) continue;
			depth.set(id, (depth.get(parent) ?? 0) + 1);
			branchOf.set(id, branchOf.get(parent) ?? parent);
			frontier.push(id);
		}
	}
	// Count each node only in its first BFS branch, even when branches share edges.
	const weights = new Map(first.map((id) => [id, 0]));
	for (const id of frontier) {
		const branch = branchOf.get(id);
		if (branch) weights.set(branch, (weights.get(branch) ?? 0) + 1);
	}
	const branchSides = new Map<string, Side>();
	let leftWeight = 0, rightWeight = 0;
	// Keep branches intact; one dominant branch can still produce an asymmetric family.
	for (const [id, weight] of [...weights].sort(([a, aw], [b, bw]) => bw - aw || a.localeCompare(b))) {
		const branchSide = leftWeight <= rightWeight ? -1 : 1;
		branchSides.set(id, branchSide);
		if (branchSide === -1) leftWeight += weight;
		else rightWeight += weight;
	}
	for (const id of frontier) side.set(id, branchSides.get(branchOf.get(id) ?? id) ?? -1);
	const nodes = new Map(ids.map((id, index): [string, ModelNode] => {
		const current = id === rootId;
		return [id, {
			id, internalId: `n-${index}`, side: side.get(id) ?? 0, depth: depth.get(id) ?? 0,
			width: compact ? current ? 180 : 160 : 190,
			height: current ? 76 : compact ? 60 : 64,
			ports: new Map(), handles: new Map(),
		}];
	}));
	const compare = (left: string, right: string) => {
		const a = nodes.get(left), b = nodes.get(right);
		return (a ? a.side * a.depth : 0) - (b ? b.side * b.depth : 0) || left.localeCompare(right);
	};
	const keys = new Set(pairs.map((pair) => pair.key));
	const edges = pairs.map((pair, index): ModelEdge => {
		const reversed = compare(pair.from, pair.to) > 0;
		const layoutFrom = reversed ? pair.to : pair.from, layoutTo = reversed ? pair.from : pair.to;
		const source = nodes.get(layoutFrom), target = nodes.get(layoutTo);
		if (!source || !target) throw Error("account-graph-layout-unavailable");
		const reciprocal = keys.has(pairKey(pair.to, pair.from));
		const offset = reciprocal ? reversed ? 8 : -8 : 0;
		const fromPort = reciprocal ? `p-${index}-east` : `${source.internalId}-east`;
		const toPort = reciprocal ? `p-${index}-west` : `${target.internalId}-west`;
		source.ports.set(fromPort, { id: fromPort, x: source.width, y: source.height / 2 + offset });
		target.ports.set(toPort, { id: toPort, x: 0, y: target.height / 2 + offset });
		const sourceSide = reversed ? "left" : "right", targetSide = reversed ? "right" : "left";
		const sourceHandle = `source-${sourceSide}-${offset}`, targetHandle = `target-${targetSide}-${offset}`;
		const actualSource = nodes.get(pair.from), actualTarget = nodes.get(pair.to);
		if (!actualSource || !actualTarget) throw Error("account-graph-layout-unavailable");
		actualSource.handles.set(sourceHandle, { id: sourceHandle, type: "source", side: sourceSide, x: reversed ? 0 : actualSource.width, y: actualSource.height / 2 + offset });
		actualTarget.handles.set(targetHandle, { id: targetHandle, type: "target", side: targetSide, x: reversed ? actualTarget.width : 0, y: actualTarget.height / 2 + offset });
		return { ...pair, internalId: `e-${index}`, layoutFrom, layoutTo, fromPort, toPort, reversed, sourceHandle, targetHandle };
	});
	const twin = !edges.some((edge) => {
		const from = nodes.get(edge.from)?.side ?? 0, to = nodes.get(edge.to)?.side ?? 0;
		return from !== 0 && to !== 0 && from !== to;
	});
	return { rootId, nodes, edges, twin };
}

async function runElk(model: Model, split: number, side?: Side): Promise<AccountGraphLayout> {
	const nodes = [...model.nodes.values()].filter((node) => side === undefined || node.id === model.rootId || node.side === side);
	const ids = new Set(nodes.map((node) => node.id));
	const edges = model.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
	const output = await elk.layout<ElkNode>({
		id: "account-graph",
		layoutOptions: {
			"org.eclipse.elk.algorithm": "layered",
			"org.eclipse.elk.direction": "RIGHT",
			"org.eclipse.elk.edgeRouting": "ORTHOGONAL",
			"org.eclipse.elk.spacing.nodeNode": String(gap),
			"org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers": String(gap),
			"org.eclipse.elk.padding": `[top=${margin},left=${margin},bottom=${margin},right=${margin}]`,
			"org.eclipse.elk.layered.layerUnzipping.strategy": split === 1 ? "NONE" : "ALTERNATING",
			"org.eclipse.elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
			"org.eclipse.elk.layered.mergeEdges": "false",
			"org.eclipse.elk.randomSeed": "1",
		},
		children: nodes.map((node): ElkNode => ({
			id: node.internalId, width: node.width, height: node.height,
			layoutOptions: {
				"org.eclipse.elk.portConstraints": "FIXED_POS",
				"org.eclipse.elk.layered.layerUnzipping.layerSplit": String(node.id === model.rootId ? 1 : split),
				"org.eclipse.elk.layered.layerUnzipping.resetOnLongEdges": "false",
			},
			ports: [...node.ports.values()].map((port) => ({ ...port, width: 0, height: 0 })),
		})),
		edges: edges.map((edge) => ({ id: edge.internalId, sources: [edge.fromPort], targets: [edge.toPort] })),
	});
	const placed = new Map((output.children ?? []).map((node) => [node.id, node]));
	const routed = new Map((output.edges ?? []).map((edge) => [edge.id, edge]));
	const result = emptyLayout();
	for (const node of nodes) {
		const position = placed.get(node.internalId);
		if (typeof position?.x !== "number" || typeof position.y !== "number") throw Error("account-graph-layout-unavailable");
		result.nodes.set(node.id, { x: position.x, y: position.y, width: node.width, height: node.height, handles: [...node.handles.values()].map((handle) => ({ ...handle })) });
	}
	for (const edge of edges) {
		const sections = routed.get(edge.internalId)?.sections;
		if (!sections?.length) throw Error("account-graph-layout-unavailable");
		const points: Point[] = [];
		for (const section of sections) {
			const segment: ElkPoint[] = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
			if (points.length && !samePoint(points[points.length - 1], segment[0])) throw Error("account-graph-layout-unavailable");
			for (const point of segment) if (!points.length || !samePoint(points[points.length - 1], point)) points.push({ ...point });
		}
		if (edge.reversed) points.reverse();
		result.edges.set(edge.key, { points, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle });
	}
	return result;
}

function translate(layout: AccountGraphLayout, dx: number, dy: number) {
	for (const node of layout.nodes.values()) { node.x += dx; node.y += dy; }
	for (const edge of layout.edges.values()) for (const point of edge.points) { point.x += dx; point.y += dy; }
}
function setBounds(layout: AccountGraphLayout) {
	const xs: number[] = [], ys: number[] = [];
	for (const node of layout.nodes.values()) { xs.push(node.x, node.x + node.width); ys.push(node.y, node.y + node.height); }
	for (const edge of layout.edges.values()) for (const point of edge.points) { xs.push(point.x); ys.push(point.y); }
	if (!xs.length) return;
	translate(layout, margin - Math.min(...xs), margin - Math.min(...ys));
	layout.bounds = { x: 0, y: 0, width: Math.max(...xs) - Math.min(...xs) + margin * 2, height: Math.max(...ys) - Math.min(...ys) + margin * 2 };
}
async function candidate(model: Model, split: number) {
	if (!model.twin) {
		const result = await runElk(model, split);
		setBounds(result);
		return result;
	}
	const sides: Side[] = [-1, 1].filter((side): side is -1 | 1 => [...model.nodes.values()].some((node) => node.side === side));
	if (!sides.length) {
		const result = await runElk(model, 1);
		setBounds(result);
		return result;
	}
	const halves = await Promise.all(sides.map((side) => runElk(model, split, side)));
	const result = emptyLayout();
	for (const half of halves) {
		const root = half.nodes.get(model.rootId);
		if (!root) throw Error("account-graph-layout-unavailable");
		translate(half, -root.x - root.width / 2, -root.y - root.height / 2);
		for (const [id, node] of half.nodes) if (!result.nodes.has(id)) result.nodes.set(id, node);
		for (const [key, edge] of half.edges) result.edges.set(key, edge);
	}
	setBounds(result);
	return result;
}

function segmentEntersNode(a: Point, b: Point, node: AccountGraphNodeLayout) {
	let low = 0, high = 1;
	for (const [axis, size] of [["x", "width"], ["y", "height"]] as const) {
		const min = node[axis] + epsilon, max = node[axis] + node[size] - epsilon, delta = b[axis] - a[axis];
		if (!delta) { if (a[axis] < min || a[axis] > max) return false; }
		else {
			const first = (min - a[axis]) / delta, last = (max - a[axis]) / delta;
			low = Math.max(low, Math.min(first, last)); high = Math.min(high, Math.max(first, last));
			if (low > high) return false;
		}
	}
	return true;
}
function validGeometry(layout: AccountGraphLayout, model: Model) {
	if (layout.nodes.size !== model.nodes.size || layout.edges.size !== model.edges.length) return false;
	const nodes = [...layout.nodes.values()];
	for (let index = 0; index < nodes.length; index++) {
		const a = nodes[index];
		if (![a.x, a.y, a.width, a.height].every(Number.isFinite)) return false;
		for (const b of nodes.slice(index + 1)) if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) return false;
	}
	for (const relation of model.edges) {
		const edge = layout.edges.get(relation.key), source = layout.nodes.get(relation.from), target = layout.nodes.get(relation.to);
		if (!edge || !source || !target || edge.points.length < 2) return false;
		const from = source.handles.find((handle) => handle.id === edge.sourceHandle), to = target.handles.find((handle) => handle.id === edge.targetHandle);
		if (!from || !to || from.type !== "source" || to.type !== "target") return false;
		if (!samePoint(edge.points[0], { x: source.x + from.x, y: source.y + from.y }) || !samePoint(edge.points[edge.points.length - 1], { x: target.x + to.x, y: target.y + to.y })) return false;
		for (let index = 1; index < edge.points.length; index++) {
			const a = edge.points[index - 1], b = edge.points[index];
			if (![a.x, a.y, b.x, b.y].every(Number.isFinite) || Math.abs(a.x - b.x) > epsilon && Math.abs(a.y - b.y) > epsilon) return false;
			if (nodes.some((node) => segmentEntersNode(a, b, node))) return false;
		}
		const reciprocal = layout.edges.get(pairKey(relation.to, relation.from));
		if (reciprocal && edge.points.length === reciprocal.points.length && edge.points.every((point, index) => samePoint(point, reciprocal.points[reciprocal.points.length - 1 - index]))) return false;
	}
	return true;
}

function clone(layout: AccountGraphLayout): AccountGraphLayout {
	return {
		nodes: new Map([...layout.nodes].map(([id, node]) => [id, { ...node, handles: node.handles.map((handle) => ({ ...handle })) }])),
		edges: new Map([...layout.edges].map(([id, edge]) => [id, { ...edge, points: edge.points.map((point) => ({ ...point })) }])),
		bounds: { ...layout.bounds },
	};
}
function readingScale(layout: AccountGraphLayout, rootId: string, viewport: { width: number; height: number }) {
	const root = layout.nodes.get(rootId);
	if (!root) return 0;
	const x = root.x + root.width / 2, y = root.y + root.height / 2;
	const width = Math.max(x - layout.bounds.x, layout.bounds.x + layout.bounds.width - x) * 2 + 16;
	const height = Math.max(y - layout.bounds.y, layout.bounds.y + layout.bounds.height - y) * 2 + 16;
	return Math.min(1, viewport.width / width, viewport.height / height);
}
async function calculate(model: Model, viewport: { width: number; height: number }) {
	const maxBank = Math.max(...[-1, 1].map((side) => [...model.nodes.values()].filter((node) => node.side === side).length));
	const nodeHeight = [...model.nodes.values()].find((node) => node.id !== model.rootId)?.height ?? 64;
	const rows = Math.max(1, Math.floor((viewport.height - margin * 2 + gap) / (nodeHeight + gap)));
	const preferred = Math.max(1, Math.min(4, Math.ceil(maxBank / rows)));
	const splits = [...new Set([preferred, preferred === 1 ? 2 : preferred - 1, 1])];
	let best: AccountGraphLayout | undefined, bestScore = -1;
	for (const split of splits) {
		try {
			const result = await candidate(model, split);
			if (!validGeometry(result, model)) continue;
			const score = readingScale(result, model.rootId, viewport);
			if (score > bestScore + 0.000001) { best = result; bestScore = score; }
			if (score >= 1) return result;
		} catch { /* A failed split cannot replace the standard layout fallback. */ }
	}
	if (!best) throw Error("account-graph-layout-unavailable");
	return best;
}

/** Layout direction is only a presentation choice. Returned paths always follow the stored relation. */
export async function layoutAccountGraph(rootId: string, assets: Asset[], relations: Relation[], viewport: { width: number; height: number }): Promise<AccountGraphLayout> {
	const live = new Map(assets.filter((asset) => !asset.deleted && asset.id).map((asset) => [asset.id, asset]));
	if (!live.has(rootId)) return emptyLayout();
	const family = accountFamilyGraph(rootId, live, relations);
	const ids = [rootId, ...family.neighbors.map((asset) => asset.id)].sort();
	const pairs = [...new Map(family.relations.map((relation) => {
		const key = pairKey(relation.from, relation.to);
		return [key, { key, from: relation.from, to: relation.to }] as const;
	})).values()].sort((a, b) => a.key.localeCompare(b.key));
	const size = {
		width: Number.isFinite(viewport.width) && viewport.width > 0 ? Math.max(1, Math.round(viewport.width)) : 1100,
		height: Number.isFinite(viewport.height) && viewport.height > 0 ? Math.max(1, Math.round(viewport.height)) : 560,
	};
	const key = JSON.stringify([rootId, ids, pairs.map((pair) => pair.key), size]);
	let pending = cache.get(key);
	if (!pending) {
		pending = (async () => {
			const natural = await calculate(buildModel(rootId, ids, pairs), size);
			if (ids.length >= 12 && ids.length <= 24 && readingScale(natural, rootId, size) < 11 / 12) {
				try {
					const compact = await calculate(buildModel(rootId, ids, pairs, true), size);
					if (readingScale(compact, rootId, size) > readingScale(natural, rootId, size) + 0.000001) return compact;
				} catch { /* Keep the valid natural layout if compact routing fails its audit. */ }
			}
			return natural;
		})();
		cache.set(key, pending);
		if (cache.size > maxCacheEntries) cache.delete(cache.keys().next().value ?? "");
		const current = pending;
		void pending.catch(() => { if (cache.get(key) === current) cache.delete(key); });
	} else { cache.delete(key); cache.set(key, pending); }
	return clone(await pending);
}
