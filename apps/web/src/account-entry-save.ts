import { assetSchema, newAsset, type Asset } from "../../../packages/domain/src";
import {
	localRepository,
	type LocalRepository,
} from "../../../packages/local-db/src";
import type {
	VaultEntryDraft,
	VaultSession,
} from "../../../packages/password-vault/src";
import { normalizeDraft } from "../../../packages/password-vault/src/engine";
import {
	AccountIdentitySavePending,
	saveAccountWithIdentityLinks,
} from "./account-identity-save";
import type { AccountLinkLabel } from "./vault-account-links";
import { withFilledVaultIdentifiers } from "./vault-entry-identifiers";

// A stable account ID is the recovery key across the two independent stores.
// No password, aliases or private notes are copied into an ordinary asset.
export type AccountEntryProgress = {
	account: Asset | null;
	needsVault: boolean;
};

export type AccountTemplate = Pick<Asset, "name" | "url" | "category">;

/** Copy only the service template, never its identity, secrets or connections. */
export function accountFromTemplate(template: AccountTemplate) {
	const profile = { ...newAsset("account"), name: template.name, url: template.url, category: template.category };
	const draft: VaultEntryDraft = { title: template.name, url: template.url, username: "", usernameAliases: [], password: "", notes: "", linkedAssetIds: [] };
	return { profile, draft };
}

export function accountFromEntry(
	profile: Asset,
	entry: VaultEntryDraft,
): Asset {
	return assetSchema.parse({
		...profile,
		kind: "account",
		name: entry.title.trim(),
		username: entry.username,
		url: entry.url.trim(),
		updatedAt: new Date().toISOString(),
	});
}

export async function saveAccountEntry({
	profile,
	draft,
	session,
	progress,
	label,
	repository,
}: {
	profile: Asset;
	draft: VaultEntryDraft;
	session: VaultSession | null;
	progress: AccountEntryProgress;
	label: AccountLinkLabel;
	repository?: LocalRepository;
}): Promise<void> {
	if (draft.url) {
		try {
			const url = new URL(draft.url);
			if (
				!["http:", "https:"].includes(url.protocol) ||
				url.username ||
				url.password
			)
				throw Error("invalid-url");
		} catch {
			throw Error("account-entry-url");
		}
	}
	const next = accountFromEntry(profile, draft);
	const hasPrivateFields = !!(
		draft.password ||
		draft.notes ||
		draft.usernameAliases?.some((value) => value.trim()) ||
		draft.linkedAssetIds.length
	);
	const unlocked = session?.getSnapshot().status === "unlocked";
	if (hasPrivateFields && !unlocked) throw Error("vault-locked");
	progress.needsVault ||= !!unlocked || hasPrivateFields;
	if (progress.needsVault && !unlocked) throw Error("vault-locked");
	if (progress.needsVault)
		normalizeDraft({
			...withFilledVaultIdentifiers(draft),
			title: next.name,
			linkedAssetIds: [...new Set([next.id, ...draft.linkedAssetIds])],
		});
	const repo = repository ?? (await localRepository());
	try {
		progress.account = await saveAccountWithIdentityLinks(
			progress.account,
			next,
			label,
			repo,
		);
	} catch (error) {
		if (error instanceof AccountIdentitySavePending)
			progress.account = error.savedAccount;
		throw error;
	}
	if (!progress.needsVault) return;
	if (session?.getSnapshot().status !== "unlocked")
		throw Error("vault-locked");
	// A write can reach disk just before a tab locks. Re-read after unlock and
	// reuse the entry bound to this unique account instead of creating a duplicate.
	const existing = session
		.getSnapshot()
		.entries.filter((entry) => entry.linkedAssetIds.includes(next.id));
	if (
		existing.length > 1 ||
		session
			.getSnapshot()
			.trash.some((entry) => entry.linkedAssetIds.includes(next.id))
	)
		throw Error("vault-stale");
	await session.saveEntry({
		...withFilledVaultIdentifiers(draft),
		id: existing[0]?.id,
		title: next.name,
		username: next.username,
		url: next.url,
		linkedAssetIds: [...new Set([next.id, ...draft.linkedAssetIds])],
	});
}
