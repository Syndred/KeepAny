import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	VaultMappedField,
	VaultMappedLine,
} from "../vault-import-mapping";
import { Button } from "./ui/button";
import { Select, SelectOption } from "./ui/select";
import "../vault-import-mapping-table.css";

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
		<div className="pw-smart-mapping pw-import-mapping-table">
			<div className="pw-import-map-heading">
				<p>{t("pwSmartMapHint")}</p>
				<Button
					type="button"
					variant="ghost"
					aria-pressed={revealed}
					onClick={() => setRevealed((value) => !value)}
				>
					{revealed ? <EyeOff size={16} /> : <Eye size={16} />}
					{t(revealed ? "pwSmartMapHide" : "pwSmartMapShow")}
				</Button>
			</div>
			<div className="pw-import-map-scroll">
				<table className="pw-import-map-table">
					<thead>
						<tr className="pw-import-map-columns">
							{[
								"pwSmartMapLineColumn",
								"pwSmartMapContentColumn",
								"pwSmartMapFieldColumn",
								"pwSmartMapStartColumn",
							].map((key) => (
								<th key={key} scope="col">
									{t(key)}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((row, index) => (
							<tr
								className="pw-smart-map-line"
								key={row.lineNumber}
								data-source-line={row.lineNumber}
								data-entry-start={row.startsEntry}
							>
								<td className="pw-import-map-line-number">{row.lineNumber}</td>
								<td className="field">
									<input
										id={`pw-map-value-${row.lineNumber}`}
										aria-label={t("pwSmartIssueLine", { line: row.lineNumber })}
										type={revealed ? "text" : "password"}
										value={row.value}
										onChange={(event) =>
											update(row.lineNumber, { value: event.target.value })
										}
										autoComplete="off"
										spellCheck={false}
									/>
								</td>
								<td className="field">
									<Select
										contentClassName="pw-smart-select-menu"
										id={`pw-map-field-${row.lineNumber}`}
										aria-label={t("pwSmartMapField", { line: row.lineNumber })}
										value={row.field}
										onValueChange={(value) =>
											update(row.lineNumber, {
												field: value as VaultMappedField,
											})
										}
									>
										<SelectOption value="">
											{t("pwSmartMapUnassigned")}
										</SelectOption>
										{Object.entries(fields).map(([field, key]) => (
											<SelectOption key={field} value={field}>
												{t(key)}
											</SelectOption>
										))}
										<SelectOption value="ignore">
											{t("pwSmartMapIgnore")}
										</SelectOption>
									</Select>
								</td>
								<td className="pw-import-map-start">
									<input
										type="checkbox"
										aria-label={t("pwSmartMapStart", { line: row.lineNumber })}
										checked={row.startsEntry}
										disabled={index === 0}
										onChange={(event) =>
											update(row.lineNumber, {
												startsEntry: event.target.checked,
											})
										}
									/>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<div className="actions pw-smart-footer">
				<Button onClick={onBack}>{t("pwSmartEditSource")}</Button>
				{onBackToReview && (
					<Button onClick={onBackToReview}>{t("pwSmartBackToReview")}</Button>
				)}
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
