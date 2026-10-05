import {
	ArrowLeftRight,
	Check,
	ChevronDown,
	Copy,
	Eye,
	EyeOff,
	FileText,
	Globe,
	LockKeyhole,
	UserRound,
} from "lucide-react";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import type { VaultImportCandidate } from "../vault-import-model";
import { parseVaultImportLine } from "../vault-import-model";
import {
	readVaultImportSourceSelection,
	type VaultImportQuickFillField,
} from "../vault-import-quick-fill";
import {
	getVaultImportSourceLineSelection,
	type VaultImportSourceExcerpt as SourceExcerpt,
} from "../vault-import-source";
import { Button } from "./ui/button";
import "../vault-import-source-card.css";

export function VaultImportSourceExcerpt({
	excerpt,
	source,
	disabled,
	candidates = [],
	onChangeTarget,
	compact = true,
}: {
	excerpt: SourceExcerpt;
	source: string;
	disabled: boolean;
	candidates?: VaultImportCandidate[];
	onChangeTarget?: () => void;
	compact?: boolean;
}) {
	const { t } = useTranslation();
	const [revealed, setRevealed] = useState(false);
	const [sourceOpen, setSourceOpen] = useState(true);
	const [copiedLine, setCopiedLine] = useState<number>();
	const [copyError, setCopyError] = useState(false);
	function copyValue(
		line: number,
		field?: Exclude<VaultImportQuickFillField, "usernameAliases">,
	) {
		// Prefer a verified field range, including complete multiline secrets.
		if (field)
			for (const candidate of candidates) {
				if (candidate.sourceSnapshot && candidate.sourceSnapshot !== source)
					continue;
				const reference = candidate.sourceFields?.[field];
				if (reference?.line !== line) continue;
				const value = readVaultImportSourceSelection(source, reference, {
					field,
					candidates: [candidate],
				});
				if (value !== undefined && value === candidate.draft[field])
					return value;
			}
		const selection = getVaultImportSourceLineSelection(source, line, line);
		return selection
			? readVaultImportSourceSelection(source, selection, { field, candidates })
			: undefined;
	}
	function rowField(line: number, text: string) {
		if (parseVaultImportLine(text).fields.length > 1) return undefined;
		const references = candidates.flatMap((candidate) =>
			Object.values(candidate.sourceFields ?? {}).filter(
				(reference) => reference?.line === line,
			),
		);
		if (
			new Set(
				references.map((reference) => `${reference?.start}:${reference?.end}`),
			).size > 1
		)
			return undefined;
		for (const candidate of candidates) {
			if (candidate.sourceSnapshot && candidate.sourceSnapshot !== source)
				continue;
			for (const field of [
				"title",
				"username",
				"password",
				"url",
				"notes",
			] as const) {
				if (candidate.sourceFields?.[field]?.line === line) return field;
			}
		}
		const fields = parseVaultImportLine(text).fields;
		return fields.length === 1 && fields[0].field !== "type"
			? fields[0].field
			: undefined;
	}
	return (
		<div className={compact ? "pw-import-source-card" : undefined}>
			<section
				className="pw-smart-source-excerpt"
				data-source-start={
					source.slice(0, excerpt.selection.start).replace(/\r\n?/g, "\n")
						.length
				}
				data-source-end={
					source.slice(0, excerpt.selection.end).replace(/\r\n?/g, "\n").length
				}
				data-source-revealed={revealed}
			>
				<div className="pw-smart-source-heading">
					<Button
						type="button"
						variant="ghost"
						className="pw-smart-source-toggle"
						aria-expanded={sourceOpen}
						aria-controls={`${excerpt.id}-content`}
						disabled={disabled}
						onClick={() => setSourceOpen((value) => !value)}
					>
						{t("pwSmartSourceExcerpt")}
						{!sourceOpen && <ChevronDown size={15} />}
					</Button>
					<div className="pw-import-source-actions">
						{onChangeTarget && (
							<Button
								type="button"
								size="small"
								variant="ghost"
								disabled={disabled}
								onClick={onChangeTarget}
							>
								<ArrowLeftRight size={16} />
								{t("pwSmartChangeTarget")}
							</Button>
						)}
						<Button
							type="button"
							variant="ghost"
							size="small"
							aria-expanded={revealed}
							disabled={disabled}
							onClick={() => setRevealed((value) => !value)}
						>
							{revealed ? <EyeOff size={16} /> : <Eye size={16} />}{" "}
							{t(revealed ? "pwVaultHidePassword" : "pwVaultShowPassword")}
						</Button>
					</div>
				</div>
				<div
					id={`${excerpt.id}-content`}
					hidden={!sourceOpen}
					className="pw-smart-source-content"
				>
					<div className="pw-smart-source-text">
						{excerpt.rows.map((row, index) => {
							const field = rowField(row.lineNumber, row.text);
							const Icon =
								field === "password"
									? LockKeyhole
									: field === "username"
										? UserRound
										: field === "url"
											? Globe
											: FileText;
							return (
								<Fragment key={row.lineNumber}>
									{index > 0 &&
										row.lineNumber > excerpt.rows[index - 1].lineNumber + 1 && (
											<span className="pw-smart-source-gap" aria-hidden="true">
												…
											</span>
										)}
									<div
										className="pw-smart-source-line"
										data-hidden={!revealed && row.maskedText !== row.text}
									>
										<Icon size={17} aria-hidden="true" />
										<span className="pw-smart-source-value">
											{revealed ? row.text : row.maskedText}
										</span>
										<Button
											type="button"
											size="icon"
											variant="ghost"
											aria-label={t("pwSmartCopySourceLine", {
												line: row.lineNumber,
											})}
											title={t(
												copiedLine === row.lineNumber
													? "pwVaultCopied"
													: "pwSmartSourceCopy",
											)}
											disabled={disabled}
											onClick={async () => {
												const value = copyValue(row.lineNumber, field);
												try {
													if (value === undefined)
														throw new Error("No source value");
													await navigator.clipboard.writeText(value);
													setCopiedLine(row.lineNumber);
													setCopyError(false);
												} catch {
													setCopyError(true);
												}
											}}
										>
											{copiedLine === row.lineNumber ? (
												<Check size={16} />
											) : (
												<Copy size={16} />
											)}
										</Button>
									</div>
								</Fragment>
							);
						})}
					</div>
				</div>
				{(copyError || copiedLine !== undefined) && (
					<span
						role="status"
						className={copyError ? "pw-smart-hint" : "pw-import-clipboard-sr"}
					>
						{t(copyError ? "pwSmartSourceCopyFailed" : "pwVaultCopied")}
					</span>
				)}
			</section>
		</div>
	);
}
