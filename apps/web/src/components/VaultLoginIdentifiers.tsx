import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";

/** Alternative identifiers share one credential; independent accounts stay separate. */
export function VaultLoginIdentifiers({
	idPrefix,
	values = [],
	disabled,
	primary,
	onChange,
}: {
	idPrefix: string;
	values?: string[];
	disabled: boolean;
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
			variant="ghost"
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
		<div className="pw-smart-identifiers">
			{primary ? (
				<div className="field pw-smart-primary-identifier">
					<div className="pw-smart-field-heading">
						<label htmlFor={primary.id}>{t("pwVaultUsernameField")}</label>
						{add}
					</div>
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
				</div>
			) : (
				<div className="pw-smart-identifier-actions">{add}</div>
			)}
			{values
				.map((value, index) => ({ value, index, key: keys[index] }))
				.map(({ value, index, key }) => (
					<div className="pw-smart-identifier-row" key={key}>
						<div className="field">
							<label htmlFor={`${idPrefix}-identifier-${index + 1}`}>
								{t("pwVaultOtherIdentifier", { count: index + 1 })}
							</label>
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
						</div>
						<Button
							type="button"
							size="icon"
							variant="ghost"
							aria-label={t("pwVaultRemoveIdentifier", { count: index + 1 })}
							onClick={() => {
								setRowKeys(keys.filter((_, i) => i !== index));
								onChange(values.filter((_, i) => i !== index));
							}}
							disabled={disabled}
						>
							<Trash2 size={16} />
						</Button>
					</div>
				))}
		</div>
	);
}
