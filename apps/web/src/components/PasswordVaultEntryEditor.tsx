import { Textarea } from "./ui/textarea";
import { Input } from "./ui/input";
import { Check, Eye, EyeOff, WandSparkles, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Asset } from "../../../../packages/domain/src";
import { type PasswordVaultEntryDraft } from "./PasswordVaultProvider";
import { Button } from "./ui/button";
import { Select, SelectOption } from "./ui/select";
import { VaultLoginIdentifiers } from "./VaultLoginIdentifiers";
import { VaultImportFieldActions } from "./VaultImportFieldActions";

export function EntryEditor({
	draft,
	busy,
	assets,
	assetsById,
	showPassword,
	selectedAssetId,
	setDraft,
	setShowPassword,
	setSelectedAssetId,
	onGenerate,
	onPasswordCopyError,
	titleCompanion,
	afterFields,
	vaultAccess,
	vaultUnlocked = true,
	unified = false,
	onCancel,
	error,
	t,
}: {
	draft: PasswordVaultEntryDraft;
	busy: boolean;
	assets: Asset[];
	assetsById: Map<string, Asset>;
	showPassword: boolean;
	selectedAssetId: string;
	setDraft: React.Dispatch<
		React.SetStateAction<PasswordVaultEntryDraft | null>
	>;
	setShowPassword: (value: boolean) => void;
	setSelectedAssetId: (value: string) => void;
	onGenerate: () => void;
	onPasswordCopyError: (value: string) => void;
	titleCompanion?: ReactNode;
	afterFields?: ReactNode;
	vaultAccess?: ReactNode;
	vaultUnlocked?: boolean;
	unified?: boolean;
	onCancel?: () => void;
	error?: string;
	t: (key: string, options?: Record<string, unknown>) => string;
}) {
	const [urlExpanded, setUrlExpanded] = useState(unified || Boolean(draft.url));
	const update = <K extends keyof PasswordVaultEntryDraft>(
		key: K,
		value: PasswordVaultEntryDraft[K],
	) =>
		setDraft((current) => (current ? { ...current, [key]: value } : current));
	const availableAssets = assets.filter(
		(asset) => !draft.linkedAssetIds.includes(asset.id),
	);
	return (
		<>
			<div className="password-vault-editor-grid">
				<div className="field">
					<label htmlFor="password-vault-entry-title">
						{t("pwVaultTitleField")}
					</label>
					<div className="pw-import-input-control">
						<Input
							id="password-vault-entry-title"
							value={draft.title}
							onChange={(event) => update("title", event.target.value)}
							disabled={busy}
							required
							maxLength={160}
						/>
						<VaultImportFieldActions
							label={t("pwVaultTitleField")}
							value={draft.title}
							disabled={busy}
							onPaste={(value) => update("title", value)}
						/>
					</div>
				</div>
				{titleCompanion}
				<VaultLoginIdentifiers
					clipboardPaste
					aliasesEnabled={vaultUnlocked}
					idPrefix="password-vault-entry"
					values={draft.usernameAliases}
					disabled={busy}
					primary={{
						id: "password-vault-entry-username",
						value: draft.username,
						autoComplete: "username",
						maxLength: 300,
						onChange: (value) => update("username", value),
					}}
					onChange={(values) => update("usernameAliases", values)}
				/>
				{vaultUnlocked ? <div className="field password-vault-password-field password-vault-secret-field">
					<label htmlFor="password-vault-entry-password">
						{t("pwVaultPasswordOptionalField")}
					</label>
					<div className="pw-import-input-control">
						<div className="password-vault-password-input">
							{/[\r\n]/.test(draft.password) ? (
								<Textarea
									id="password-vault-entry-password"
									value={showPassword ? draft.password : "••••••••"}
									readOnly={!showPassword}
									onChange={(event) => update("password", event.target.value)}
									disabled={busy}
									autoComplete="off"
									spellCheck={false}
									rows={3}
								/>
							) : (
								<Input
									id="password-vault-entry-password"
									type={showPassword ? "text" : "password"}
									value={draft.password}
									onChange={(event) => update("password", event.target.value)}
									disabled={busy}
									autoComplete="new-password"
									placeholder={t("pwVaultPasswordPlaceholder")}
								/>
							)}
							<Button
								type="button"
								size="icon"
								variant="ghost"
								aria-label={t(
									showPassword ? "pwVaultHidePassword" : "pwVaultShowPassword",
								)}
								onClick={() => setShowPassword(!showPassword)}
								disabled={busy}
							>
								{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
							</Button>
							<Button
								type="button"
								size="icon"
								variant="ghost"
								aria-label={t("pwVaultGeneratePassword")}
								onClick={onGenerate}
								disabled={busy}
							>
								<WandSparkles size={17} />
							</Button>
						</div>
						<VaultImportFieldActions
							label={t("pwVaultPasswordField")}
							copyLabel={t("pwVaultCopyPassword")}
							onCopyError={onPasswordCopyError}
							value={draft.password}
							disabled={busy}
							onPaste={(value) => update("password", value)}
						/>
					</div>
				</div> : vaultAccess}
				<div className="password-vault-more-info password-vault-optional">
					<div className="password-vault-more-info-fields">
						{vaultUnlocked && <div className="field password-vault-notes-field">
							<div className="pw-smart-field-heading">
								<label htmlFor="password-vault-entry-notes">
									{t(unified ? "accountEntryPrivateNotes" : "pwVaultNotesOptionalField")}
								</label>
								{!urlExpanded && (
									<Button
										type="button"
										variant="ghost"
										size="small"
										className="pw-smart-add-url"
										onClick={() => setUrlExpanded(true)}
										disabled={busy}
									>
										{t("pwVaultAddUrl")}
									</Button>
								)}
							</div>
							<div className="pw-import-input-control">
								<Textarea
									id="password-vault-entry-notes"
									value={draft.notes}
									onChange={(event) => update("notes", event.target.value)}
									disabled={busy}
									rows={4}
									maxLength={20000}
								/>
								<VaultImportFieldActions
									label={t("pwVaultNotesField")}
									value={draft.notes ?? ""}
									disabled={busy}
									onPaste={(value) => update("notes", value)}
								/>
							</div>
						</div>}
						{urlExpanded && (
							<div className="field">
								<label htmlFor="password-vault-entry-url">
									{t("pwVaultUrlOptionalField")}
								</label>
								<div className="pw-import-input-control">
									<Input
										id="password-vault-entry-url"
										type="url"
										value={draft.url}
										onChange={(event) => update("url", event.target.value)}
										disabled={busy}
										inputMode="url"
										autoComplete="url"
										placeholder="https://"
									/>
									<VaultImportFieldActions
										label={t("pwVaultUrlField")}
										value={draft.url ?? ""}
										disabled={busy}
										onPaste={(value) => update("url", value)}
									/>
								</div>
							</div>
						)}
					</div>
				</div>
			</div>
			{afterFields}
			{vaultUnlocked && <div className="field password-vault-linked-picker">
				<label htmlFor="password-vault-entry-asset">
					{t("pwVaultLinkedAssets")}
				</label>
				<small>{t("pwVaultLinkedAssetsHint")}</small>
				<Select
					id="password-vault-entry-asset"
					value={selectedAssetId}
					onValueChange={(value) => {
						setSelectedAssetId("");
						if (value)
							update("linkedAssetIds", [...draft.linkedAssetIds, value]);
					}}
					disabled={busy}
				>
					<SelectOption value="">{t("pwVaultChooseAsset")}</SelectOption>
					{availableAssets.map((asset) => (
						<SelectOption key={asset.id} value={asset.id}>
							{asset.name} · {t(asset.kind)}
						</SelectOption>
					))}
				</Select>
				{draft.linkedAssetIds.length > 0 && (
					<div className="password-vault-linked-picker-list">
						{draft.linkedAssetIds.map((id) => (
							<span className="password-vault-linked-chip" key={id}>
								{assetsById.get(id)?.name ?? t("pwVaultAssetUnavailable")}
								<Button
									type="button"
									size="icon"
									variant="ghost"
									aria-label={t("pwVaultRemoveAsset", {
										name:
											assetsById.get(id)?.name ?? t("pwVaultAssetUnavailable"),
									})}
									onClick={() =>
										update(
											"linkedAssetIds",
											draft.linkedAssetIds.filter((assetId) => assetId !== id),
										)
									}
									disabled={busy}
								>
									<X size={13} />
								</Button>
							</span>
						))}
					</div>
				)}
			</div>}
			{error && <p className="field-error" role="alert">{error}</p>}
			<div className="actions password-vault-editor-actions">
				{onCancel && <Button type="button" disabled={busy} onClick={onCancel}>{t("cancel")}</Button>}
				<Button type="submit" variant="primary" disabled={busy}>
					<Check size={16} /> {t(unified ? "save" : "pwVaultSaveEntry")}
				</Button>
			</div>
		</>
	);
}
