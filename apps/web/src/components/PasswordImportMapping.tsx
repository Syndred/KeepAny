import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	VaultMappedField,
	VaultMappedLine,
} from "../vault-import-mapping";
import { Button } from "./ui/button";
import { Select, SelectOption } from "./ui/select";

export function PasswordImportMapping({
	rows,
	onChange,
	onReview,
	onBack,
	onBackToReview,
	reviewLabel,
}: {
	rows: VaultMappedLine[];
	onChange: (rows: VaultMappedLine[]) => void;
	onReview: () => void;
	onBack: () => void;
	onBackToReview?: () => void;
	reviewLabel?: string;
}) {
	const { t } = useTranslation();
	const [revealed, setRevealed] = useState(false);
	const fields = {
		title: "pwVaultTitleField",
		username: "pwVaultUsernameField",
		password: "pwVaultPasswordField",
		url: "pwVaultUrlField",
		notes: "pwVaultNotesField",
	};
	const update = (lineNumber: number, change: Partial<VaultMappedLine>) =>
		onChange(
			rows.map((row) =>
				row.lineNumber === lineNumber ? { ...row, ...change } : row,
			),
		);
	return (
		<div className="pw-smart-mapping">
			<p>{t("pwSmartMapHint")}</p>
			<Button variant="ghost" onClick={() => setRevealed((value) => !value)}>
				{revealed ? <EyeOff size={16} /> : <Eye size={16} />}
				{t(revealed ? "pwSmartMapHide" : "pwSmartMapShow")}
			</Button>
			{rows.map((row, index) => (
				<div
					className="pw-smart-map-line"
					key={row.lineNumber}
					data-source-line={row.lineNumber}
				>
					<label className="pw-smart-check">
						<input
							type="checkbox"
							checked={row.startsEntry}
							disabled={index === 0}
							onChange={(event) =>
								update(row.lineNumber, { startsEntry: event.target.checked })
							}
						/>
						{t("pwSmartMapStart", { line: row.lineNumber })}
					</label>
					<label className="field" htmlFor={`pw-map-value-${row.lineNumber}`}>
						<span>{t("pwSmartIssueLine", { line: row.lineNumber })}</span>
						<input
							id={`pw-map-value-${row.lineNumber}`}
							type={revealed ? "text" : "password"}
							value={row.value}
							onChange={(event) =>
								update(row.lineNumber, { value: event.target.value })
							}
							autoComplete="off"
							spellCheck={false}
						/>
					</label>
					<label className="field" htmlFor={`pw-map-field-${row.lineNumber}`}>
						<span>{t("pwSmartMapField", { line: row.lineNumber })}</span>
						<Select
							id={`pw-map-field-${row.lineNumber}`}
							value={row.field}
							onValueChange={(value) =>
								update(row.lineNumber, { field: value as VaultMappedField })
							}
						>
							<SelectOption value="">{t("pwSmartMapUnassigned")}</SelectOption>
							{Object.entries(fields).map(([field, key]) => (
								<SelectOption key={field} value={field}>
									{t(key)}
								</SelectOption>
							))}
							<SelectOption value="ignore">
								{t("pwSmartMapIgnore")}
							</SelectOption>
						</Select>
					</label>
				</div>
			))}
			<div className="actions pw-smart-footer">
				{onBackToReview && (
					<Button onClick={onBackToReview}>{t("pwSmartBackToReview")}</Button>
				)}
				<Button onClick={onBack}>{t("pwSmartEditSource")}</Button>
				<Button
					variant="primary"
					onClick={onReview}
					disabled={!rows.some((row) => row.field === "password")}
				>
					{reviewLabel ?? t("pwSmartMapReview")}
				</Button>
			</div>
		</div>
	);
}
