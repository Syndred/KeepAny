import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { VaultImportFieldActions } from "./VaultImportFieldActions";

/** Alternative identifiers share one credential; independent accounts stay separate. */
export function VaultLoginIdentifiers({
	idPrefix,
	values = [],
	disabled,
	primary,
	compact = false,
	clipboardPaste = false,
	onChange,
}: {
	idPrefix: string;
	values?: string[];
	disabled: boolean;
	compact?: boolean;
	clipboardPaste?: boolean;
	primary?: {
		id: string;
		value: string;
		readOnly?: boolean;
		autoComplete?: string;
		maxLength?: number;
		onChange: (value: string) => void;
	};
	onChange: (values: string[]) => void;
}) {
	const { t } = useTranslation();
	const [rowKeys, setRowKeys] = useState(() =>
		values.map(() => crypto.randomUUID()),
	);
	const keys = useMemo(
		() =>
			rowKeys.length === values.length
				? rowKeys
				: [
						...rowKeys.slice(0, values.length),
						...Array.from(
							{ length: Math.max(0, values.length - rowKeys.length) },
							() => crypto.randomUUID(),
						),
					],
		[rowKeys, values.length],
	);
	useEffect(() => {
		if (keys !== rowKeys) setRowKeys(keys);
	}, [keys, rowKeys]);
	const add = (
		<Button
			type="button"
			size="small"
			className="pw-smart-identifier-add"
			onClick={() => {
				setRowKeys([...keys, crypto.randomUUID()]);
				onChange([...values, ""]);
			}}
			disabled={disabled || values.length >= 20}
		>
			<Plus size={15} /> {t("pwVaultAddIdentifier")}
		</Button>
	);
	return (
		<div
			className={`pw-smart-identifiers${compact ? " pw-smart-identifiers-compact" : ""}`}
		>
			{primary ? (
				<div className="field pw-smart-primary-identifier">
					<div className="pw-smart-field-heading">
						<label htmlFor={primary.id}>
							{t(compact ? "pwSmartAccountField" : "pwVaultUsernameField")}
						</label>
						{add}
					</div>
					<div className="pw-import-input-control">
						<input
							id={primary.id}
							value={primary.value}
							onChange={(event) => primary.onChange(event.target.value)}
							disabled={disabled}
							readOnly={primary.readOnly}
							maxLength={primary.maxLength ?? 1024}
							autoComplete={primary.autoComplete ?? "off"}
							spellCheck={false}
						/>
						<VaultImportFieldActions
							label={t(
								compact ? "pwSmartAccountField" : "pwVaultUsernameField",
							)}
							value={primary.value}
							disabled={disabled}
							readOnly={primary.readOnly}
							onPaste={clipboardPaste ? primary.onChange : undefined}
						/>
					</div>
				</div>
			) : (
				<div className="pw-smart-identifier-actions">{add}</div>
			)}
			{values.length > 0 && (
				<div className="pw-smart-alias-list">
					<span className="pw-import-alias-caption">
						{t("pwSmartOtherIdentifiers")}
					</span>
					{values.map((value, index) => (
						<div className="pw-smart-identifier-row" key={keys[index]}>
							<div className="field">
								<label
									className="pw-import-clipboard-sr"
									htmlFor={`${idPrefix}-identifier-${index + 1}`}
								>
									{t("pwVaultOtherIdentifier", { count: index + 1 })}
								</label>
								<div className="pw-import-input-control">
									<input
										id={`${idPrefix}-identifier-${index + 1}`}
										value={value}
										onChange={(event) =>
											onChange(
												values.map((item, i) =>
													i === index ? event.target.value : item,
												),
											)
										}
										disabled={disabled}
										maxLength={1024}
										autoComplete="off"
										spellCheck={false}
									/>
									<VaultImportFieldActions
										label={t("pwVaultOtherIdentifier", { count: index + 1 })}
										value={value}
										disabled={disabled}
										onPaste={
											clipboardPaste
												? (text) =>
														onChange(
															values.map((item, i) =>
																i === index ? text : item,
															),
														)
												: undefined
										}
									>
										<Button
											type="button"
											size="icon"
											variant="danger"
											aria-label={t("pwVaultRemoveIdentifier", {
												count: index + 1,
											})}
											title={t("pwVaultRemoveIdentifier", { count: index + 1 })}
											onClick={() => {
												setRowKeys(keys.filter((_, i) => i !== index));
												onChange(values.filter((_, i) => i !== index));
											}}
											disabled={disabled}
										>
											<Trash2 size={16} />
										</Button>
									</VaultImportFieldActions>
								</div>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
