import { useTranslation } from "react-i18next";
import type { Asset } from "../../../../packages/domain/src";
import {
	normalizeLoginIdentifier,
	type BlockedAccountLink,
} from "../vault-account-links";
import { Select, SelectOption } from "./ui/select";

export function VaultAccountLinkConflict({
	blocked,
	assets,
	disabled,
	onResolve,
}: {
	blocked: BlockedAccountLink;
	assets: Asset[];
	disabled: boolean;
	onResolve: (accountId: string) => void;
}) {
	const { t } = useTranslation();
	const { entry, conflict } = blocked;
	const candidates = assets.filter((asset) => {
		if (asset.kind !== "account" || asset.deleted) return false;
		if (conflict.scope === "identity")
			return (
				normalizeLoginIdentifier(asset.username || asset.name) ===
				conflict.identifier
			);
		return (
			conflict.reason !== "ambiguous" ||
			conflict.accounts.some((account) => account.id === asset.id)
		);
	});
	return (
		<section
			className="vault-connect-conflict"
			aria-label={t("pwConnectConflictFor", { name: entry.title })}
		>
			<div className="vault-connect-conflict-heading">
				<strong>{entry.title}</strong>
				<span className="vault-connect-primary">{entry.username}</span>
			</div>
			<p>{t(`pwConnectConflict_${conflict.scope}_${conflict.reason}`)}</p>
			{candidates.length > 0 && (
				<label className="field" htmlFor={`vault-connect-resolve-${entry.id}`}>
					<span>{t("pwConnectChooseExisting")}</span>
					<Select
						id={`vault-connect-resolve-${entry.id}`}
						value=""
						disabled={disabled}
						aria-label={t("pwConnectChooseExistingFor", { name: entry.title })}
						onValueChange={(id) => {
							if (id) onResolve(id);
						}}
					>
						<SelectOption value="">{t("pwConnectChooseAccount")}</SelectOption>
						{candidates.map((account) => (
							<SelectOption key={account.id} value={account.id}>
								{account.name}
								{account.username ? ` · ${account.username}` : ""}
							</SelectOption>
						))}
					</Select>
					{conflict.scope === "account" && (
						<small>{t("pwConnectChooseExistingEffect")}</small>
					)}
				</label>
			)}
		</section>
	);
}
