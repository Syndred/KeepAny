import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { VaultEntryDraft } from "../../../../packages/password-vault/src";
import { Button } from "./ui/button";
import { VaultLoginIdentifiers } from "./VaultLoginIdentifiers";

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
	onChange,
}: {
	idPrefix: string;
	draft: VaultEntryDraft;
	disabled: boolean;
	readOnlyIdentity?: boolean;
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
		<>
			{readOnlyIdentity && (
				<p className="pw-smart-hint">{t("pwSmartSavedEntryHint")}</p>
			)}
			<div className="pw-smart-fields">
				{(["title", "username"] as const).map((field) => (
					<label
						className={`field pw-smart-field-${field}`}
						htmlFor={`${idPrefix}-${field}`}
						key={field}
					>
						<span>
							{t(
								field === "title"
									? "pwVaultTitleField"
									: "pwVaultUsernameField",
							)}
						</span>
						<input
							id={`${idPrefix}-${field}`}
							value={draft[field]}
							placeholder={
								field === "title" ? t("pwVaultNamePlaceholder") : undefined
							}
							onChange={(event) => onChange(field, event.target.value)}
							disabled={disabled}
							readOnly={readOnlyIdentity}
							autoComplete="off"
							spellCheck={false}
						/>
					</label>
				))}
				<VaultLoginIdentifiers
					idPrefix={idPrefix}
					values={draft.usernameAliases}
					disabled={disabled}
					onChange={(values) => onChange("usernameAliases", values)}
				/>
				<div className="field pw-smart-field-password">
					<label htmlFor={`${idPrefix}-password`}>
						{t("pwVaultPasswordField")}
					</label>
					<div className="pw-smart-password">
						{multilinePassword ? (
							<textarea
								id={`${idPrefix}-password`}
								value={revealed ? draft.password : "••••••••"}
								readOnly={!revealed}
								onChange={(event) => onChange("password", event.target.value)}
								disabled={disabled}
								autoComplete="off"
								spellCheck={false}
								rows={3}
							/>
						) : (
							<input
								id={`${idPrefix}-password`}
								value={draft.password}
								type={revealed ? "text" : "password"}
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
				</div>
			</div>
			<div className="pw-smart-optional">
				<div className="pw-smart-fields">
					{urlExpanded ? (
						<label
							className="field pw-smart-field-url"
							htmlFor={`${idPrefix}-url`}
						>
							<span>{t("pwVaultUrlOptionalField")}</span>
							<input
								id={`${idPrefix}-url`}
								value={draft.url}
								onChange={(event) => onChange("url", event.target.value)}
								disabled={disabled}
								readOnly={readOnlyIdentity}
								autoComplete="off"
								spellCheck={false}
							/>
						</label>
					) : (
						<div className="pw-smart-field-url">
							<Button
								type="button"
								onClick={() => setUrlExpanded(true)}
								disabled={disabled || readOnlyIdentity}
							>
								{t("pwVaultAddUrl")}
							</Button>
						</div>
					)}
					<label
						className="field pw-smart-field-notes"
						htmlFor={`${idPrefix}-notes`}
					>
						<span>{t("pwVaultNotesOptionalField")}</span>
						<textarea
							id={`${idPrefix}-notes`}
							value={draft.notes}
							onChange={(event) => onChange("notes", event.target.value)}
							disabled={disabled}
							autoComplete="off"
							spellCheck={false}
							rows={3}
						/>
					</label>
				</div>
			</div>
		</>
	);
}
