export const workspaceReturnKey = "keepany-workspace-return";
export function readCatalogRecordReturn(recordId: string, categories: readonly {id:string}[], wallet = false): {wallet:boolean;categoryId?:string} {
 try {
  const saved = JSON.parse(sessionStorage.getItem('keepany-catalog-record-return') ?? 'null');
  if(saved?.recordId !== recordId)return {wallet};
  return {wallet:saved.wallet === true,categoryId:typeof saved.categoryId === 'string' && categories.some(c=>c.id===saved.categoryId) ? saved.categoryId : undefined};
 } catch {return {wallet};}
}
export type WorkspaceReturn = { view: "all" | "domains" | "item" | "subscription" | "wallet"; assetId: string; query: string; scrollY: number };

export function readWorkspaceReturn(assetId?: string): WorkspaceReturn | null {
	try {
		const value: unknown = JSON.parse(sessionStorage.getItem(workspaceReturnKey) ?? "null");
		if (!value || typeof value !== "object") return null;
		const row = value as Partial<WorkspaceReturn>;
		if ((!["all","domains","item","subscription","wallet"].includes(row.view ?? "")) || typeof row.assetId !== "string" ||
			(assetId !== undefined && row.assetId !== assetId) || typeof row.query !== "string" ||
			typeof row.scrollY !== "number" || !Number.isFinite(row.scrollY) || row.scrollY < 0) return null;
		return row as WorkspaceReturn;
	} catch { return null; }
}
