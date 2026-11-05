import { Unlink } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Asset } from "../../../../packages/domain/src";
import { useAppContext } from "../view-shared";
import { PasswordVaultPanel } from "./PasswordVaultPanel";
import type { PasswordVaultEntrySummary } from "./PasswordVaultProvider";
import { Button } from "./ui/button";

/** Use the same history, stale checks and unlink confirmation as the account list. */
export function AccountDetailActions({ asset, entry, privateOnly = false, onUnlink }: { asset: Asset; entry?: PasswordVaultEntrySummary; privateOnly?: boolean; onUnlink?: () => void }) {
	const { t } = useTranslation();
	const { data, notify } = useAppContext();
	return <div className="account-unlink-control"><PasswordVaultPanel assets={data.assets} notify={notify} renderDetailActions={tools =>
        <Button className="account-unlink-action" size="small" disabled={tools.busy || !entry || (privateOnly && !onUnlink)} onClick={() => { if (privateOnly) onUnlink?.(); else if (entry) tools.unlink(entry, asset); }}><Unlink size={16} />{t("pwVaultUnlink")}</Button>
    } /></div>;
}
