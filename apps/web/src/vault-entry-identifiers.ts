import type { VaultEntryDraft } from "../../../packages/password-vault/src";

/** Blank optional form rows remain editable but do not become stored identifiers. */
export function withFilledVaultIdentifiers(
	draft: VaultEntryDraft,
): VaultEntryDraft {
	return {
		...draft,
		...(draft.usernameAliases
			? {
					usernameAliases: [
						...new Set(
							draft.usernameAliases.filter(
								(value) => value.trim() && value !== draft.username,
							),
						),
					],
				}
			: {}),
	};
}
