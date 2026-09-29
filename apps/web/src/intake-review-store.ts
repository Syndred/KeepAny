import Dexie, { type Table } from "dexie";
import type { Asset } from "../../../packages/domain/src";

export type ReviewedCandidate = {
	id: string;
	fileHash: string;
	fileName: string;
	rowNumber: number;
	source?: "pdf";
	sourceText?: string;
	kindSelected?: boolean;
	asset: Asset;
	status: "pending" | "accepted" | "ignored";
};

class IntakeReviewStore extends Dexie {
	rows!: Table<ReviewedCandidate, string>;
	constructor() {
		super("keepany-intake-review-v1");
		this.version(1).stores({ rows: "id, fileHash, status" });
	}
}

const store = new IntakeReviewStore();

export async function stageReviewedCandidates(rows: ReviewedCandidate[]): Promise<ReviewedCandidate[]> {
	if (!rows.length) return [];
	await store.transaction("rw", store.rows, async () => {
		for (const row of rows) {
			if (!(await store.rows.get(row.id))) await store.rows.add(row);
		}
	});
	return store.rows.where("fileHash").equals(rows[0].fileHash).sortBy("rowNumber");
}

export async function listReviewedCandidates(): Promise<ReviewedCandidate[]> {
	return (await store.rows.toArray()).sort((a, b) => a.fileName.localeCompare(b.fileName) || a.rowNumber - b.rowNumber);
}

export async function getReviewedCandidate(id: string): Promise<ReviewedCandidate | undefined> {
	return store.rows.get(id);
}

export async function editReviewedCandidate(id: string, asset: Asset, kindSelected?: boolean): Promise<boolean> {
	return store.transaction("rw", store.rows, async () => {
		const row = await store.rows.get(id);
		if (row?.status !== "pending") return false;
		await store.rows.put({ ...row, asset, kindSelected: kindSelected ?? row.kindSelected });
		return true;
	});
}

export async function decideReviewedCandidate(id: string, status: "accepted" | "ignored"): Promise<void> {
	await store.rows.where("id").equals(id).modify((row) => {
		if (row.status === "pending") row.status = status;
	});
}
