/** Project the old per-kind sidebar preferences without rewriting stored data. */
export const workspaceNavIds = ["overview", "tasks", "assets", "accounts"];
export const workspaceGroupIds = ["assets", "accounts"];
const members: Record<string, string[]> = {
	assets: ["project", "item", "subscription"],
	accounts: ["account", "vault"],
};

export function workspaceNavId(id: string): string | undefined {
	if (workspaceNavIds.includes(id)) return id;
	return workspaceGroupIds.find((group) => members[group].includes(id));
}

export function workspaceNavOrder(value: unknown): string[] {
	const saved = Array.isArray(value)
		? value.flatMap((id) => typeof id === "string" ? workspaceNavId(id) ?? [] : [])
		: [];
	return [...new Set([...saved, ...workspaceNavIds])];
}

export function workspaceNavHidden(value: unknown): string[] {
	const saved = new Set(Array.isArray(value) ? value.filter((id) => typeof id === "string") : []);
	const hidden = workspaceNavIds.filter((id) => id !== "overview" &&
		(saved.has(id) || !!members[id]?.every((member) => saved.has(member))));
	return workspaceGroupIds.every((id) => hidden.includes(id))
		? hidden.filter((id) => id !== "assets") : hidden;
}

export function workspacePathGroup(path: string): "assets" | "accounts" | undefined {
	if (path === "/accounts" || /^\/assets\/(account|vault)(\/|$)/.test(path)) return "accounts";
	if (path === "/assets" || path === "/finance" || /^\/assets\/(project|item|subscription|domains)(\/|$)/.test(path)) return "assets";
	return undefined;
}
