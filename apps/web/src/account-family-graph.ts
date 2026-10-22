import { getConnectedEdges, type Edge, type Node } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import type { Asset, Relation } from "../../../packages/domain/src";

export const accountGraphNodeSize = { width: 230, height: 100 };

/** Give different destinations separate trunks inside the existing inter-column gap. */
export function accountGraphLaneCenter(sourceX: number, targetX: number, index: number, count: number) {
	const midpoint = (sourceX + targetX) / 2;
	const available = targetX - sourceX - 48;
	if (count <= 1 || available <= 0) return midpoint;
	const spacing = Math.min(32, available / (count - 1));
	return midpoint + (index - (count - 1) / 2) * spacing;
}

/** Use stored dependency direction for placement, not the currently opened account. */
export function accountGraphPositions(assets: Asset[], relations: Relation[]) {
	const graph = new dagre.graphlib.Graph();
	graph.setDefaultEdgeLabel(() => ({}));
	graph.setGraph({ rankdir: "LR", nodesep: 48, ranksep: 170, marginx: 32, marginy: 32 });
	for (const asset of [...assets].sort((a, b) => a.id.localeCompare(b.id)))
		graph.setNode(asset.id, { ...accountGraphNodeSize });
	for (const relation of [...relations].sort((a, b) => a.id.localeCompare(b.id)))
		if (graph.hasNode(relation.from) && graph.hasNode(relation.to) && relation.from !== relation.to)
			graph.setEdge(relation.from, relation.to);
	dagre.layout(graph);
	return new Map(assets.map((asset) => {
		const node = graph.node(asset.id);
		return [asset.id, { x: node.x - accountGraphNodeSize.width / 2, y: node.y - accountGraphNodeSize.height / 2 }];
	}));
}

/** Expand using the same React Flow endpoints as the account graph; deleted nodes cannot bridge families. */
export function accountFamilyGraph(
	root: string,
	assets: Map<string, Asset>,
	relations: Relation[],
) {
	const liveAssets = new Map([...assets].filter(([, asset]) => !asset.deleted));
	if (!liveAssets.has(root)) return { relations: [], positions: new Map<string, { x: number; y: number }>(), neighbors: [] };
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
		positions: accountGraphPositions(includedAssets, included),
		neighbors: includedAssets.filter((asset) => asset.id !== root),
	};
}
