import { Input } from "./ui/input";
import { Eye, EyeOff, KeyRound, Lock, ShieldCheck, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { MIN_MASTER_PASSWORD_LENGTH as MIN_MASTER_LENGTH } from "../../../../packages/password-vault/src/policy";
export function EmptyState({
    accounts = false,
	busy,
	master,
	masterConfirm,
	showMaster,
	setMaster,
	setMasterConfirm,
	setShowMaster,
	onCreate,
	onImport,
}: {
    accounts?: boolean;
	busy: boolean;
	master: string;
	masterConfirm: string;
	showMaster: boolean;
	setMaster: (value: string) => void;
	setMasterConfirm: (value: string) => void;
	setShowMaster: (value: boolean) => void;
	onCreate: (event: React.FormEvent<HTMLFormElement>) => void;
	onImport: () => void;
}) {
	const { t } = useTranslation();
	return (
		<div className="password-vault-empty-state">
			<div className="password-vault-empty-icon">
				<ShieldCheck size={28} />
			</div>
			<h3>{t(accounts ? "accountSetUpTitle" : "pwVaultEmptyTitle")}</h3>
			<p>{t(accounts ? "accountSetUpHint" : "pwVaultEmptyHint")}</p>
			<form className="password-vault-master-form" onSubmit={onCreate}>
				<div className="field">
					<label htmlFor="password-vault-master">
						{t("pwVaultMasterPassword")}
					</label>
					<div className="password-vault-password-input">
						<Input
							id="password-vault-master"
							type={showMaster ? "text" : "password"}
							value={master}
							onChange={(event) => setMaster(event.target.value)}
							autoComplete="new-password"
							disabled={busy}
							required
							minLength={MIN_MASTER_LENGTH}
							aria-describedby="password-vault-create-master-risk"
						/>
						<Button
							type="button"
							size="icon"
							variant="ghost"
							aria-label={t(
								showMaster ? "pwVaultHidePassword" : "pwVaultShowPassword",
							)}
							onClick={() => setShowMaster(!showMaster)}
							disabled={busy}
						>
							{showMaster ? <EyeOff size={17} /> : <Eye size={17} />}
						</Button>
					</div>
				</div>
				<div className="field">
					<label htmlFor="password-vault-master-confirm">
						{t("pwVaultMasterPasswordConfirm")}
					</label>
					<Input
						id="password-vault-master-confirm"
						type="password"
						value={masterConfirm}
						onChange={(event) => setMasterConfirm(event.target.value)}
						autoComplete="new-password"
						disabled={busy}
						required
						minLength={MIN_MASTER_LENGTH}
					/>
				</div>
				<p className="notice" id="password-vault-create-master-risk" role="note">
					{t("pwVaultShortMasterRisk")}
				</p>
				<div className="actions">
					<Button type="submit" variant="primary" disabled={busy}>
						<ShieldCheck size={16} /> {t(accounts ? "accountSetUp" : "pwVaultCreate")}
					</Button>
					<Button type="button" disabled={busy} onClick={onImport}>
						<Upload size={16} /> {t("pwVaultImportEmpty")}
					</Button>
				</div>
			</form>
		</div>
	);
}

export function LockedState({
    accounts = false,
	busy,
	master,
	showMaster,
	setMaster,
	setShowMaster,
	onUnlock,
}: {
    accounts?: boolean;
	busy: boolean;
	master: string;
	showMaster: boolean;
	setMaster: (value: string) => void;
	setShowMaster: (value: boolean) => void;
	onUnlock: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
	const { t } = useTranslation();
	return (
		<div className="password-vault-unlock">
			<div className="password-vault-empty-icon">
				<Lock size={26} />
			</div>
			<h3>{t(accounts ? "accountUnlockTitle" : "pwVaultLockedTitle")}</h3>
			<p>{t(accounts ? "accountUnlockHint" : "pwVaultLockedHint")}</p>
			<form className="password-vault-master-form" onSubmit={onUnlock}>
				<div className="field">
					<label htmlFor="password-vault-unlock-master">
						{t("pwVaultMasterPassword")}
					</label>
					<div className="password-vault-password-input">
						<Input
							id="password-vault-unlock-master"
							type={showMaster ? "text" : "password"}
							value={master}
							onChange={(event) => setMaster(event.target.value)}
							autoComplete="current-password"
							disabled={busy}
							required
						/>
						<Button
							type="button"
							size="icon"
							variant="ghost"
							aria-label={t(
								showMaster ? "pwVaultHidePassword" : "pwVaultShowPassword",
							)}
							onClick={() => setShowMaster(!showMaster)}
							disabled={busy}
						>
							{showMaster ? <EyeOff size={17} /> : <Eye size={17} />}
						</Button>
					</div>
				</div>
				<div className="actions">
					<Button type="submit" variant="primary" disabled={busy}>
						<Lock size={16} /> {t(accounts ? "accountUnlockAction" : "pwVaultUnlock")}
					</Button>
				</div>
			</form>
			<p className="password-vault-security-note">
				<KeyRound size={15} /> {t("pwVaultForgotHint")}
			</p>
		</div>
	);
}
