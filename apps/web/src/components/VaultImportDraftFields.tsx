import { Eye, EyeOff, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { VaultEntryDraft } from "../../../../packages/password-vault/src";
import { Button } from "./ui/button";
import { VaultImportPasteButton } from "./VaultImportPasteButton";
import { VaultLoginIdentifiers } from "./VaultLoginIdentifiers";
import "../vault-import-fields.css";

export type VaultImportDraftField =
	| "title"
	| "username"
	| "usernameAliases"
	| "password"
	| "url"
	| "notes";

export function VaultImportDraftFields({
	idPrefix,
	draft,
	disabled,
	readOnlyIdentity = false,
	compact = true,
	validationErrors = {},
	onChange,
}: {
	idPrefix: string;
	draft: VaultEntryDraft;
	disabled: boolean;
	readOnlyIdentity?: boolean;
	compact?: boolean;
	validationErrors?: Partial<Record<VaultImportDraftField, string>>;
	onChange: (field: VaultImportDraftField, value: string | string[]) => void;
}) {
	const { t } = useTranslation();
	const [revealed, setRevealed] = useState(false);
	const [urlExpanded, setUrlExpanded] = useState(!!draft.url);
	const multilinePassword = /[\r\n]/.test(draft.password);
	useEffect(() => {
		if (draft.url) setUrlExpanded(true);
	}, [draft.url]);
	return (
		<div className={compact ? "pw-import-draft-fields" : undefined}>
			{readOnlyIdentity && (
				<p className="pw-smart-hint">{t("pwSmartSavedEntryHint")}</p>
			)}
			<div className="pw-smart-fields">
				<div className="field pw-smart-field-title">
					<label htmlFor={`${idPrefix}-title`}>{t("pwVaultTitleField")}</label>
					<div className="pw-import-input-control">
						<input
							id={`${idPrefix}-title`}
							aria-invalid={!!validationErrors.title}
							aria-describedby={
								validationErrors.title ? `${idPrefix}-title-error` : undefined
							}
							value={draft.title}
							placeholder={t("pwVaultNamePlaceholder")}
							onChange={(event) => onChange("title", event.target.value)}
							disabled={disabled}
							readOnly={readOnlyIdentity}
							autoComplete="off"
							spellCheck={false}
							maxLength={256}
						/>
						<VaultImportPasteButton
							label={t("pwVaultTitleField")}
							value={draft.title ?? ""}
							disabled={disabled || readOnlyIdentity}
							onPaste={(value) => onChange("title", value)}
						/>
					</div>
					{validationErrors.title && (
						<small
							className="pw-import-field-error"
							id={`${idPrefix}-title-error`}
						>
							{validationErrors.title}
						</small>
					)}
				</div>
				<div
					className="pw-import-identifiers"
					data-has-aliases={!!draft.usernameAliases?.length}
				>
					<VaultLoginIdentifiers
						compact={compact}
						clipboardPaste
						idPrefix={idPrefix}
						values={draft.usernameAliases}
						disabled={disabled}
						primary={{
							id: `${idPrefix}-username`,
							value: draft.username,
							readOnly: readOnlyIdentity,
							onChange: (value) => onChange("username", value),
						}}
						onChange={(values) => onChange("usernameAliases", values)}
					/>
				</div>
				<div className="field pw-smart-field-password">
					<label htmlFor={`${idPrefix}-password`}>
						{t("pwSmartPasswordOptional")}
					</label>
					<div className="pw-import-input-control">
						<div className="pw-smart-password">
							{multilinePassword ? (
								<textarea
									id={`${idPrefix}-password`}
									aria-invalid={!!validationErrors.password}
									aria-describedby={
										validationErrors.password
											? `${idPrefix}-password-error`
											: undefined
									}
									value={
										revealed
											? draft.password
											: draft.password
													.split(/\r\n|\r|\n/)
													.map(() => "••••••••")
													.join("\n")
									}
									readOnly={!revealed}
									onChange={(event) => onChange("password", event.target.value)}
									disabled={disabled}
									autoComplete="off"
									spellCheck={false}
									rows={Math.min(6, draft.password.split(/\r\n|\r|\n/).length)}
								/>
							) : (
								<input
									id={`${idPrefix}-password`}
									aria-invalid={!!validationErrors.password}
									aria-describedby={
										validationErrors.password
											? `${idPrefix}-password-error`
											: undefined
									}
									value={draft.password}
									placeholder={t("pwSmartPasswordPlaceholder")}
									type={revealed ? "text" : "password"}
									onPaste={(event) => {
										const value = event.clipboardData.getData("text/plain");
										if (!/[\r\n]/.test(value)) return;
										event.preventDefault();
										const input = event.currentTarget;
										onChange(
											"password",
											draft.password.slice(0, input.selectionStart ?? 0) +
												value +
												draft.password.slice(
													input.selectionEnd ?? draft.password.length,
												),
										);
									}}
									onChange={(event) => onChange("password", event.target.value)}
									disabled={disabled}
									autoComplete="new-password"
									spellCheck={false}
								/>
							)}
							<Button
								type="button"
								size="icon"
								variant="ghost"
								aria-label={t(
									revealed ? "pwVaultHidePassword" : "pwVaultShowPassword",
								)}
								onClick={() => setRevealed((value) => !value)}
								disabled={disabled}
							>
								{revealed ? <EyeOff size={16} /> : <Eye size={16} />}
							</Button>
						</div>
						<VaultImportPasteButton
							label={t("pwVaultPasswordField")}
							value={draft.password}
							disabled={disabled}
							onPaste={(value) => onChange("password", value)}
						/>
					</div>
					{validationErrors.password && (
						<small
							className="pw-import-field-error"
							id={`${idPrefix}-password-error`}
						>
							{validationErrors.password}
						</small>
					)}
				</div>
			</div>
			<div className="pw-smart-optional">
				<div className="pw-smart-fields">
					<div className="field pw-smart-field-notes">
						<div className="pw-smart-field-heading">
							<label htmlFor={`${idPrefix}-notes`}>
								{t("pwVaultNotesOptionalField")}
							</label>
							{!urlExpanded && (
								<Button
									type="button"
									size="small"
									variant="ghost"
									className="pw-smart-add-url"
									onClick={() => setUrlExpanded(true)}
									disabled={disabled || readOnlyIdentity}
								>
									<Plus size={15} /> {t("pwVaultAddUrl")}
								</Button>
							)}
						</div>
						<div className="pw-import-input-control">
							<textarea
								id={`${idPrefix}-notes`}
								value={draft.notes}
								placeholder={t("pwSmartNotesPlaceholder")}
								onChange={(event) => onChange("notes", event.target.value)}
								disabled={disabled}
								autoComplete="off"
								spellCheck={false}
								rows={2}
							/>
							<VaultImportPasteButton
								label={t("pwVaultNotesField")}
								value={draft.notes ?? ""}
								disabled={disabled}
								onPaste={(value) => onChange("notes", value)}
							/>
						</div>
					</div>
					{urlExpanded && (
						<div className="field pw-smart-field-url">
							<label htmlFor={`${idPrefix}-url`}>
								{t("pwVaultUrlOptionalField")}
							</label>
							<div className="pw-import-input-control">
								<input
									id={`${idPrefix}-url`}
									aria-invalid={!!validationErrors.url}
									aria-describedby={
										validationErrors.url ? `${idPrefix}-url-error` : undefined
									}
									value={draft.url}
									onChange={(event) => onChange("url", event.target.value)}
									disabled={disabled}
									readOnly={readOnlyIdentity}
									autoComplete="off"
									spellCheck={false}
									placeholder="https://"
								/>
								<VaultImportPasteButton
									label={t("pwVaultUrlField")}
									value={draft.url ?? ""}
									disabled={disabled || readOnlyIdentity}
									onPaste={(value) => onChange("url", value)}
								/>
							</div>
							{validationErrors.url && (
								<small
									className="pw-import-field-error"
									id={`${idPrefix}-url-error`}
								>
									{validationErrors.url}
								</small>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
