import { getConnectedEdges, type Edge, type Node } from "@xyflow/react";
import type { Asset, Relation } from "../../../packages/domain/src";

/** Expand using the same React Flow endpoints as the account graph; deleted nodes cannot bridge families. */
export function accountFamilyGraph(
	root: string,
	assets: Map<string, Asset>,
	relations: Relation[],
) {
	const edges: Edge[] = relations
		.filter((r) => !r.deleted && assets.has(r.from) && assets.has(r.to))
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
		(r) => !r.deleted && levels.has(r.from) && levels.has(r.to),
	);
	const positions = new Map<string, { x: number; y: number }>();
	const layerCounts = new Map<number, number>();
	for (const level of levels.values())
		layerCounts.set(level, (layerCounts.get(level) ?? 0) + 1);
	const offsets = new Map<number, number>();
	for (const [id, level] of levels) {
		const offset = offsets.get(level) ?? 0;
		offsets.set(level, offset + 1);
		positions.set(id, {
			x: (offset - ((layerCounts.get(level) ?? 1) - 1) / 2) * 220,
			y: 100 + level * 170,
		});
	}
	return {
		relations: included,
		positions,
		neighbors: [...levels.keys()]
			.filter((id) => id !== root)
			.map((id) => assets.get(id))
			.filter((a): a is Asset => !!a),
	};
}
