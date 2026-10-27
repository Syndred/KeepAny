export const workspaceReturnKey = "keepany-workspace-return";
export type WorkspaceReturn = { view: "all" | "domains"; assetId: string; query: string; scrollY: number };

export function readWorkspaceReturn(assetId?: string): WorkspaceReturn | null {
	try {
		const value: unknown = JSON.parse(sessionStorage.getItem(workspaceReturnKey) ?? "null");
		if (!value || typeof value !== "object") return null;
		const row = value as Partial<WorkspaceReturn>;
		if ((row.view !== "all" && row.view !== "domains") || typeof row.assetId !== "string" ||
			(assetId !== undefined && row.assetId !== assetId) || typeof row.query !== "string" ||
			typeof row.scrollY !== "number" || !Number.isFinite(row.scrollY) || row.scrollY < 0) return null;
		return row as WorkspaceReturn;
	} catch { return null; }
}
