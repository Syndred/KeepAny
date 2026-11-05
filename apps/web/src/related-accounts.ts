import type { Asset, Relation } from "../../../packages/domain/src";
import { emailIdentifier, phoneIdentifier } from "../../../packages/domain/src/account-identity";
import type { VaultEntrySummary } from "../../../packages/password-vault/src";

export type RelatedAccountReason = "template" | "phone" | "email" | "name";
export type RelatedAccount = {
	key: string;
	assetId?: string;
	entryId?: string;
	name: string;
	username: string;
	reasons: RelatedAccountReason[];
	score: number;
};
export type RelatedAccountsInput = {
	asset: Asset;
	entry?: VaultEntrySummary;
	assets: readonly Asset[];
	entries: readonly VaultEntrySummary[];
	relations?: readonly Relation[];
};

const nameKey = (value: string) => value.trim().normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
function identifiers(values: readonly string[]) {
	const phones = new Set<string>(), emails = new Set<string>();
	for (const value of values) {
		const text = value.trim().normalize("NFKC");
		const phone = phoneIdentifier(text);
		if (phone) phones.add(phone);
		// Keep the local part exact: no provider-specific case, dot or +tag assumptions.
		if (emailIdentifier(text)) {
			const at = text.lastIndexOf("@");
			emails.add(`${text.slice(0, at)}@${text.slice(at + 1).toLowerCase()}`);
		}
	}
	return { phones, emails };
}
const overlaps = (first: ReadonlySet<string>, second: ReadonlySet<string>) => [...first].some(value => second.has(value));

/** Rank metadata only. Calling code supplies unlocked summaries and owns navigation. */
export function rankRelatedAccounts({ asset, entry, assets, entries }: RelatedAccountsInput, limit = 3): RelatedAccount[] {
	if (asset.deleted || asset.kind !== "account" || !Number.isSafeInteger(limit) || limit <= 0) return [];
	const liveAssets = new Map(assets.filter(row => !row.deleted && row.kind === "account").map(row => [row.id, row]));
	const liveEntries = new Map(entries.filter(row => !row.isAiKey).map(row => [row.id, row]));
	if (entry?.isAiKey || entry && !liveEntries.has(entry.id)) return [];
	const roots = new Map<string, string | null>();
	function root(id: string): string | null {
		const path: string[] = [], seen = new Set<string>();
		let current = id;
		while (true) {
			if (roots.has(current)) { const result = roots.get(current)!; for (const node of path) roots.set(node, result); return result; }
			if (seen.has(current)) { for (const node of path) roots.set(node, null); return null; }
			seen.add(current); path.push(current);
			const source = liveEntries.get(current)?.templateSourceId;
			if (!source) { for (const node of path) roots.set(node, current); return current; }
			current = source;
		}
	}
	const currentNames = new Set([asset.name, entry?.title ?? ""].map(nameKey).filter(Boolean));
	const currentIds = identifiers([asset.username, entry?.username ?? "", ...(entry?.usernameAliases ?? [])]);
	const currentRoot = entry ? root(entry.id) : null;
	const results = new Map<string, RelatedAccount>();
	function consider(candidate?: Asset, login?: VaultEntrySummary) {
		if (candidate?.id === asset.id || login && entry && login.id === entry.id || !candidate && !login) return;
		const names = [candidate?.name ?? "", login?.title ?? ""].map(nameKey).filter(Boolean);
		const ids = identifiers([candidate?.username ?? "", login?.username ?? "", ...(login?.usernameAliases ?? [])]);
		const reasons: RelatedAccountReason[] = [];
		if (currentRoot && login && root(login.id) === currentRoot) reasons.push("template");
		if (overlaps(currentIds.phones, ids.phones)) reasons.push("phone");
		if (overlaps(currentIds.emails, ids.emails)) reasons.push("email");
		if (names.some(name => currentNames.has(name))) reasons.push("name");
		if (!reasons.length) return;
		const score = reasons.reduce((sum, reason) => sum + ({ template: 120, phone: 80, email: 80, name: 30 })[reason], 0);
		const key = candidate ? `asset:${candidate.id}` : `entry:${login!.id}`;
		const next: RelatedAccount = { key, ...(candidate ? { assetId: candidate.id } : {}), ...(login ? { entryId: login.id } : {}), name: login?.title || candidate!.name, username: login?.username || candidate?.username || "", reasons, score };
		const existing = results.get(key);
		if (!existing || next.score > existing.score || next.score === existing.score && (next.entryId ?? "") < (existing.entryId ?? "")) results.set(key, next);
	}
	const linked = new Set<string>();
	for (const login of liveEntries.values()) {
		const targets = [...new Set(login.linkedAssetIds)].map(id => liveAssets.get(id)).filter((row): row is Asset => !!row);
		if (!targets.length) consider(undefined, login);
		for (const target of targets) { linked.add(target.id); consider(target, login); }
	}
	for (const candidate of liveAssets.values()) if (!linked.has(candidate.id)) consider(candidate);
	return [...results.values()].sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).slice(0, Math.min(limit, 20));
}
