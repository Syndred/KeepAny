import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";

/** Extra sign-in identifiers belong to the same credential, not separate accounts. */
export function VaultLoginIdentifiers({
	idPrefix,
	values = [],
	disabled,
	onChange,
}: {
	idPrefix: string;
	values?: string[];
	disabled: boolean;
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
	const rows = values.map((value, index) => ({
		value,
		index,
		key: keys[index],
	}));
	return (
		<div className="pw-smart-identifiers">
			{rows.map(({ value, index, key }) => (
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
			<div className="pw-smart-identifier-actions">
				<Button
					type="button"
					onClick={() => {
						setRowKeys([...keys, crypto.randomUUID()]);
						onChange([...values, ""]);
					}}
					disabled={disabled || values.length >= 20}
				>
					<Plus size={16} /> {t("pwVaultAddIdentifier")}
				</Button>
			</div>
			<p className="pw-smart-hint">{t("pwVaultIdentifiersHint")}</p>
		</div>
	);
}
