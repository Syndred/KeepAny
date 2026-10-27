import { getConnectedEdges, type Edge, type Node } from "@xyflow/react";
import type { Asset, Relation } from "../../../packages/domain/src";

export type GraphCamera = { x: number; y: number; zoom: number; anchorId?: string; offsetX?: number; offsetY?: number };
export type GraphViewState = {
	filter: string; scope: "direct" | "family"; selected: string | null; detailsOpen: boolean;
	positions: Record<string, { x: number; y: number }>;
	removed?: string[];
	camera?: GraphCamera; expandedCamera?: GraphCamera;
};
// Presentation state is tab-local and never enters asset records, backups or sync.
const viewStates = new Map<string, GraphViewState>();
const returnTrail: { from: { id: string; kind: Asset["kind"] }; to: string }[] = [];
export function graphViewState(id: string): GraphViewState {
	let state = viewStates.get(id);
	if (!state) {
		state = { filter: "", scope: "direct", selected: null, detailsOpen: false, positions: {} };
		viewStates.set(id, state);
		if (viewStates.size > 64) viewStates.delete(viewStates.keys().next().value ?? "");
	}
	return state;
}
export function rememberGraphVisit(from: Asset, to: Asset) {
	if (from.id === to.id) return;
	// Following a node continues the current connection scope. Keep the
	// destination's own filter/camera and the source's return state separate.
	const scope = graphViewState(from.id).scope;
	graphViewState(to.id).scope = scope;
	if (returnTrail.at(-1)?.to !== from.id) returnTrail.length = 0;
	returnTrail.push({ from: { id: from.id, kind: from.kind }, to: to.id });
	if (returnTrail.length > 32) returnTrail.shift();
}
export function graphReturnTarget(id: string) { return returnTrail.at(-1)?.to === id ? returnTrail.at(-1)?.from : undefined; }
export function consumeGraphReturn(id: string) {
	const target = graphReturnTarget(id);
	if (target) returnTrail.pop();
	return target;
}

/** Recovery is a separate historical view; tombstones never bridge the active graph. */
export function recoverableGraphRelations(root: string, assets: Asset[], relations: Relation[]): Relation[] {
	const historicalAssets = new Map(assets.filter(asset => !asset.purged).map(asset => [asset.id, { ...asset, deleted: false }]));
	const historicalRelations = relations.filter(relation => !relation.purged).map(relation => ({ ...relation, deleted: false }));
	const ids = new Set(accountFamilyGraph(root, historicalAssets, historicalRelations).relations.map(relation => relation.id));
	return relations.filter(relation => relation.deleted && !relation.purged && ids.has(relation.id));
}

/** Expand using the same React Flow endpoints as the account graph; deleted nodes cannot bridge families. */
export function accountFamilyGraph(
	root: string,
	assets: Map<string, Asset>,
	relations: Relation[],
) {
	const liveAssets = new Map([...assets].filter(([, asset]) => !asset.deleted));
	if (!liveAssets.has(root)) return { relations: [], neighbors: [] };
	const edges: Edge[] = relations
		.filter((r) => !r.deleted && r.from !== r.to && liveAssets.has(r.from) && liveAssets.has(r.to))
		.map((r) => ({ id: r.id, source: r.from, target: r.to }));
	const levels = new Map([[root, 0]]);
	let frontier = [root];
	while (frontier.length) {
		const connected = getConnectedEdges(
			frontier.map(
				(id) => ({ id, position: { x: 0, y: 0 }, data: {} }) satisfies Node,
			),
			edges,
		);
		const next: string[] = [];
		for (const edge of connected)
			for (const id of [edge.source, edge.target])
				if (!levels.has(id)) {
					const parent =
						levels.get(edge.source) ?? levels.get(edge.target) ?? 0;
					levels.set(id, parent + 1);
					next.push(id);
				}
		frontier = next;
	}
	const included = relations.filter(
		(r) => !r.deleted && r.from !== r.to && levels.has(r.from) && levels.has(r.to),
	);
	const includedAssets = [...levels.keys()].map((id) => liveAssets.get(id)).filter((asset): asset is Asset => !!asset);
	return {
		relations: included,
		neighbors: includedAssets.filter((asset) => asset.id !== root),
	};
}
