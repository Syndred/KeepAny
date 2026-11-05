import type { Asset } from "../../../packages/domain/src";
import type { LocalRepository } from "../../../packages/local-db/src";
import type { VaultSession, VaultEntryDraft } from "../../../packages/password-vault/src";
import { sameVaultDraft } from "../../../packages/password-vault/src/engine";
import { accountNotes, saveMergedAccount, type AccountEditProgress } from "./account-entry-edit";
import type { AccountLinkLabel } from "./vault-account-links";

/** The same account editor owns the public projection and the encrypted version. */
export type AccountHistoryRestoreProgress = AccountEditProgress & { originalEntry?: VaultEntryDraft };
export async function restoreAccountHistory({ session, entryId, index, expected, asset, progress, label, repository }: {
    session: VaultSession; entryId: string; index: number;
    expected: { contentRevision: string; at: string }; asset?: Asset;
    progress: AccountHistoryRestoreProgress; label: AccountLinkLabel; repository?: LocalRepository;
}) {
    const snapshot = session.getSnapshot();
    if (snapshot.status !== "unlocked") throw Error("vault-locked");
    const current = session.readEntry(entryId);
    const ownWriteApplied = !!(progress.pendingEntry && sameVaultDraft(current, progress.pendingEntry));
    if (snapshot.contentRevision !== expected.contentRevision && !ownWriteApplied) throw Error("vault-stale");
    const version = session.history(entryId)[index];
    if ((!version || version.at !== expected.at) && !ownWriteApplied) throw Error("vault-stale");
    if (!asset) { await session.restoreHistory(entryId, index, expected); return; }
    progress.originalEntry ??= current;
    const historical = ownWriteApplied ? progress.pendingEntry! : version.draft;
    await saveMergedAccount({ original: asset, originalEntry: progress.originalEntry, baseProfile: asset, profile: asset,
        draft: { ...historical, id: entryId, notes: accountNotes(asset, historical.notes) }, session, progress, label, repository });
}
