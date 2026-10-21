import type { VaultEntryDraft } from "../../../packages/password-vault/src";
import type { VaultImportCandidate } from "./vault-import-model";

export function resolveVaultImportTarget(
	targetId: string | null | undefined,
	targets: VaultImportCandidate[],
) {
	return targetId
		? (targets.find((target) => target.id === targetId) ??
				targets.find((target) => target.aliasIds?.includes(targetId)))
		: undefined;
}

/** Keep each missing target's edits under its original key, separate from new. */
export function orphanedVaultImportTargets<
	T extends { targetId: string | null },
>(
	entries: Iterable<readonly [string, T]>,
	targets: VaultImportCandidate[],
): (readonly [string, T])[] {
	return [...entries].filter(
		([, state]) =>
			!!state.targetId && !resolveVaultImportTarget(state.targetId, targets),
	);
}

export function copyVaultImportDraft(draft: VaultEntryDraft): VaultEntryDraft {
	const copy = {
		...draft,
		linkedAssetIds: [...draft.linkedAssetIds],
		...(draft.usernameAliases
			? { usernameAliases: [...draft.usernameAliases] }
			: {}),
	};
	delete copy.id;
	return copy;
}
