import {
	entitySchemas,
	historyReferenceIds,
	type Asset,
	type EntityType,
	type History,
	type Relation,
	type Task,
} from "../../domain/src";
import type { RecordRow } from "./index";

export type TrashTarget = { type: "asset" | "relation"; id: string };
export interface TrashPurgePlan {
	targets: TrashTarget[];
	rows: RecordRow[];
	at: number;
}

function payload(row: RecordRow) {
	return JSON.parse(row.payload) as Record<string, unknown>;
}

export function trashPurgeRows(
	rows: RecordRow[],
	targets: readonly TrashTarget[],
	allowPurged = false,
): RecordRow[] {
	if (!targets.length || targets.length > 10_000) throw Error("trash-invalid");
	const roots = new Set(targets.map((target) => `${target.type}:${target.id}`));
	if (
		roots.size !== targets.length ||
		targets.some((target) => !["asset", "relation"].includes(target.type))
	)
		throw Error("trash-invalid");
	for (const id of roots) {
		const row = rows.find((candidate) => candidate.id === id);
		const current = row && payload(row);
		if (!current?.deleted || (!allowPurged && current.purged))
			throw Error("trash-stale");
	}
	const assets = new Set(
		targets
			.filter((target) => target.type === "asset")
			.map((target) => target.id),
	);
	const relations = new Set(
		rows
			.filter(
				(row) =>
					row.type === "relation" &&
					(roots.has(row.id) ||
						[payload(row).from, payload(row).to].some((id) =>
							assets.has(String(id)),
						)),
			)
			.map((row) => String(payload(row).id)),
	);
	return rows
		.filter((row) => {
			if (roots.has(row.id)) return true;
			const value = payload(row);
			if (row.type === "relation") return relations.has(String(value.id));
			if (row.type === "history") return historyReferenceIds(value as unknown as History).some(id => assets.has(id));
			if (row.type === "submission")
				return assets.has(String(value.assetId));
			if (row.type === "task") {
				const task = value as unknown as Task;
				return (
					assets.has(task.assetId) ||
					[
						task.impactSnapshot?.accountId,
						task.impactSnapshot?.relatedAssetId,
						task.impactSnapshot?.fromAssetId,
						task.impactSnapshot?.toAssetId,
						task.projectWorkflow?.projectId,
						task.projectWorkflow?.sourceAssetId,
					].some((id) => !!id && assets.has(id)) ||
					(!!task.impactSnapshot &&
						relations.has(task.impactSnapshot.relationId))
				);
			}
			return false;
		})
		.sort((a, b) => a.id.localeCompare(b.id));
}

/** Keep a content-free deletion marker so sync/import cannot resurrect an erased record. */
export function redactedTrashRow(row: RecordRow, at: number): RecordRow {
	const previous = payload(row);
	const base = { id: previous.id, deleted: true, purged: true };
	const date = new Date(at).toISOString();
	let value: unknown;
	switch (row.type) {
		case "asset":
			value = {
				...base,
				kind: (previous as unknown as Asset).kind,
				name: "—",
				createdAt: date,
				updatedAt: date,
			};
			break;
		case "relation":
			value = {
				...base,
				from: (previous as unknown as Relation).from,
				to: (previous as unknown as Relation).to,
				label: "—",
				createdAt: date,
			};
			break;
		case "task":
			value = {
				...base,
				name: "—",
				assetId: previous.assetId,
				createdAt: date,
			};
			break;
		case "history":
			value = {
				...base,
				assetId: previous.assetId,
				action: "maintenance",
				note: "",
				createdAt: date,
			};
			break;
		case "submission":
			value = {
				...base,
				assetId: previous.assetId,
				name: "—",
				url: "https://deleted.invalid",
				status: "planned",
			};
			break;
		default:
			throw Error("trash-invalid");
	}
	return {
		...row,
		payload: JSON.stringify(entitySchemas[row.type as EntityType].parse(value)),
		updatedAt: at,
	};
}
