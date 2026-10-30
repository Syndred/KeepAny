import { assetSchema, type Asset } from "../../../packages/domain/src";
import { localRepository, type LocalRepository } from "../../../packages/local-db/src";
import type { VaultEntryDraft, VaultSession } from "../../../packages/password-vault/src";
import { normalizeDraft } from "../../../packages/password-vault/src/engine";
import { saveAccountWithIdentityLinks, AccountIdentitySavePending } from "./account-identity-save";
import type { AccountLinkLabel } from "./vault-account-links";
import { withFilledVaultIdentifiers } from "./vault-entry-identifiers";

export function mergedAccountDraft(asset: Asset | undefined, entry: VaultEntryDraft | null): VaultEntryDraft {
	return { ...entry, title: entry?.title ?? asset?.name ?? "", username: entry?.username ?? asset?.username ?? "", usernameAliases: [...(entry?.usernameAliases ?? [])], password: entry?.password ?? "", notes: entry?.notes ?? "", url: entry?.url || asset?.url || "", linkedAssetIds: [...(entry?.linkedAssetIds ?? [])] };
}

export type AccountEditProgress = { account: Asset | null; accountChanged: boolean; pendingEntry?: VaultEntryDraft };
const sameEntry = (a: VaultEntryDraft, b: VaultEntryDraft) => JSON.stringify(normalizeDraft(a)) === JSON.stringify(normalizeDraft(b));
const publicFields = ["category", "accountProvider", "contact", "description", "tags", "status", "accountProfileVerifiedAt", "notes", "longDescription"] as const;

/** One editor, two existing stores. Never publish a password, aliases or private notes. */
export async function saveMergedAccount({ original, originalEntry, baseProfile, profile, draft, session, progress, label, repository, newLogin = false }: {
	original?: Asset; originalEntry: VaultEntryDraft | null; baseProfile: Asset; profile: Asset; draft: VaultEntryDraft;
	session: VaultSession | null; progress: AccountEditProgress; label: AccountLinkLabel; repository?: LocalRepository; newLogin?: boolean;
}) {
	if (session?.getSnapshot().status !== "unlocked") throw Error("vault-locked");
	const baseline = mergedAccountDraft(original, originalEntry);
	const titleChanged = draft.title !== baseline.title, usernameChanged = draft.username !== baseline.username, urlChanged = draft.url !== baseline.url;
	const metadataChanged = publicFields.some(field => JSON.stringify(profile[field]) !== JSON.stringify(baseProfile[field]));
	const persistAccount = Boolean(original || metadataChanged || progress.account);
	const syncTitle = !newLogin && titleChanged && (!originalEntry || original?.name === originalEntry.title);
	const syncUsername = !newLogin && usernameChanged && (!originalEntry || original?.username === originalEntry.username);
	const syncUrl = !newLogin && urlChanged && (!originalEntry || original?.url === baseline.url);
	const next = persistAccount ? assetSchema.parse({ ...profile, name: syncTitle || !original ? draft.title.trim() : original.name, username: syncUsername || !original ? draft.username : original.username, url: syncUrl || !original ? draft.url.trim() : original.url, updatedAt: new Date().toISOString() }) : null;
	if (draft.url) {
		try { const url = new URL(draft.url); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw Error(); }
		catch { throw Error("account-entry-url"); }
	}
	const proposed = normalizeDraft({ ...withFilledVaultIdentifiers(draft), id: originalEntry?.id, title: titleChanged || !originalEntry ? draft.title.trim() : originalEntry.title, url: urlChanged || !originalEntry ? draft.url.trim() : originalEntry.url, linkedAssetIds: [...new Set([...(next ? [next.id] : []), ...draft.linkedAssetIds])] });
	function currentEntry() {
		if (session?.getSnapshot().status !== "unlocked") throw Error("vault-locked");
		if (!originalEntry?.id) return null;
		const current = session.readEntry(originalEntry.id);
		if (!sameEntry(current, originalEntry) && !(progress.pendingEntry && sameEntry(current, progress.pendingEntry))) throw Error("vault-stale");
		return current;
	}
	currentEntry();
	const repo = repository ?? await localRepository();
	if (original) {
		const current = await repo.get<Asset>("asset", original.id), expected = progress.account ?? original;
		if (!current || JSON.stringify(assetSchema.parse(current)) !== JSON.stringify(assetSchema.parse(expected))) throw Error("asset-stale");
	}
	const publicChanged = !original || metadataChanged || syncTitle || syncUsername || syncUrl || progress.accountChanged;
	if (next && publicChanged) {
		try { progress.account = await saveAccountWithIdentityLinks(progress.account ?? original ?? null, next, label, repo); progress.accountChanged = true; }
		catch (error) { if (error instanceof AccountIdentitySavePending) { progress.account = error.savedAccount; progress.accountChanged = true; } throw error; }
	}
	const current = currentEntry();
	if (current && sameEntry(current, proposed)) return;
	if (!originalEntry && progress.pendingEntry) {
		const candidates = session.getSnapshot().entries.map(entry => session.readEntry(entry.id)).filter(entry => sameEntry({ ...entry, id: undefined }, { ...progress.pendingEntry!, id: undefined }));
		if (candidates.length > 1) throw Error("vault-stale");
		if (candidates[0]) {
			if (sameEntry({ ...candidates[0], id: undefined }, proposed)) return;
			progress.pendingEntry = { ...proposed, id: candidates[0].id };
			await session.saveEntryIfCurrent(progress.pendingEntry, candidates[0]); return;
		}
	}
	progress.pendingEntry = proposed;
	await session.saveEntryIfCurrent(proposed, current);
}

/** The switch cycles identifiers too; deleting one must not delete its siblings. */
export async function removeAccountLogin(session: VaultSession, expected: VaultEntryDraft, username: string, accountId?: string) {
	if (session.getSnapshot().status !== "unlocked" || !expected.id) throw Error("vault-locked");
	const current = session.readEntry(expected.id);
	if (!sameEntry(current, expected)) throw Error("vault-stale");
	await session.removeLoginIdentifier(expected.id, username, session.getSnapshot().contentRevision ?? "", accountId);
}
