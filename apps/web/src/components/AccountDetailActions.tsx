import { Copy, History, Network, Unlink } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Asset } from "../../../../packages/domain/src";
import { accountHttpUrl } from "../account-login-choices";
import { useAppContext } from "../view-shared";
import { PasswordVaultPanel } from "./PasswordVaultPanel";
import type { PasswordVaultEntrySummary } from "./PasswordVaultProvider";
import { Button } from "./ui/button";

/** Use the same history, stale checks and unlink confirmation as the account list. */
export function AccountDetailActions({ asset, entry, privateOnly = false, onUnlink }: { asset: Asset; entry?: PasswordVaultEntrySummary; privateOnly?: boolean; onUnlink?: () => void }) {
	const { t } = useTranslation();
	const { data, notify } = useAppContext();
	const url = accountHttpUrl(entry?.url || asset.url);
	function viewRelations() {
		const target = document.getElementById("account-relations");
		target?.scrollIntoView({ block: "start", behavior: "smooth" });
		target?.focus({ preventScroll: true });
	}
	return <PasswordVaultPanel assets={data.assets} notify={notify} renderDetailActions={tools => <section className="card account-detail-actions" aria-label={t("moreActions")}>
		<h2>{t("moreActions")}</h2>
		<div className="actions">
			<Button disabled={tools.busy || !entry} onClick={() => entry && tools.history(entry)}><History size={16} />{t("pwVaultHistory")}</Button>
			<Button disabled={tools.busy || !entry || (privateOnly && !onUnlink)} onClick={() => { if (privateOnly) onUnlink?.(); else if (entry) tools.unlink(entry, asset); }}><Unlink size={16} />{t("pwVaultUnlink")}</Button>
			<Button disabled={tools.busy || !url} onClick={() => void tools.copy("pwVaultUrlField", url, Boolean(entry))}><Copy size={16} />{t("compactAccountCopyUrl")}</Button>
			<Button onClick={viewRelations}><Network size={16} />{t("accountViewRelations")}</Button>
		</div>
	</section>} />;
}
