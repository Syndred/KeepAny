import { getConnectedEdges, type Edge, type Node } from "@xyflow/react";
import type { Asset, Relation } from "../../../packages/domain/src";

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
