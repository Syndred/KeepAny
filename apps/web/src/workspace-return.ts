export const workspaceReturnKey = "keepany-workspace-return";
export type WorkspaceReturn = {
	view: "all" | "domains" | "overview" | "online" | "physical";
	category?: string;
	assetId: string;
	query: string;
	scrollY: number;
};

export function readWorkspaceReturn(assetId?: string): WorkspaceReturn | null {
	try {
		const value: unknown = JSON.parse(
			sessionStorage.getItem(workspaceReturnKey) ?? "null",
		);
		if (!value || typeof value !== "object") return null;
		const row = value as Partial<WorkspaceReturn>;
		if (
			!["all", "domains", "overview", "online", "physical"].includes(
				row.view ?? "",
			) ||
			typeof row.assetId !== "string" ||
			(assetId !== undefined && row.assetId !== assetId) ||
			(row.category !== undefined && typeof row.category !== "string") ||
			typeof row.query !== "string" ||
			typeof row.scrollY !== "number" ||
			!Number.isFinite(row.scrollY) ||
			row.scrollY < 0
		)
			return null;
		return row as WorkspaceReturn;
	} catch {
		return null;
	}
}
