import type { VaultEntrySummary } from "../../../packages/password-vault/src";

/** Only unlocked summaries enter this function. Passwords never enter choices. */
export type AccountLoginChoice = { key: string; entry: VaultEntrySummary; username: string };

export function accountLoginChoices(entries: readonly VaultEntrySummary[]): AccountLoginChoice[] {
	return entries.flatMap((entry) => {
		const identifiers = [...new Set([entry.username, ...(entry.usernameAliases ?? [])].filter(Boolean))];
		return (identifiers.length ? identifiers : [""]).map((username, index) => ({ key: `${entry.id}:${index}`, entry, username }));
	});
}

export function preferredAccountLogin(choices: readonly AccountLoginChoice[], selectedKey: string, queries: readonly string[] = [], entryId?: string, matchesPublic?: (query: string) => boolean) {
	const selected = choices.find((choice) => choice.key === selectedKey);
	if (selected) return selected;
	const focused = entryId && choices.find((choice) => choice.entry.id === entryId);
	if (focused) return focused;
	const terms = queries.map((query) => query.trim().toLocaleLowerCase()).filter((query) => query && !matchesPublic?.(query));
	return (terms.length ? choices.find(({ entry, username }) => terms.every((query) => [entry.title, username, entry.url].some((value) => value.toLocaleLowerCase().includes(query)))) : undefined) ?? choices[0];
}

export function nextAccountLogin(choices: readonly AccountLoginChoice[], key: string) {
	return choices.length ? choices[(choices.findIndex((choice) => choice.key === key) + 1) % choices.length] : undefined;
}

export function accountHttpUrl(value: string) {
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
	} catch { return ""; }
}
