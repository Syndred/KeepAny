import {
	ArrowLeftRight,
	ChevronDown,
	ChevronUp,
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
import { Select, SelectOption } from "./ui/select";
import { TextLink } from "./ui/text-link";
import "../vault-import-source-card.css";

export function VaultImportSourceExcerpt({
	excerpt,
	source,
	disabled,
	candidates = [],
	readOnlyIdentity = false,
	onAssign,
	onChangeTarget,
	compact = true,
}: {
	excerpt: SourceExcerpt;
	source: string;
	disabled: boolean;
	candidates?: VaultImportCandidate[];
	readOnlyIdentity?: boolean;
	onAssign?: (field: VaultImportQuickFillField, value: string) => void;
	onChangeTarget?: () => void;
	compact?: boolean;
}) {
	const { t } = useTranslation();
	const [revealed, setRevealed] = useState(false);
	const [sourceOpen, setSourceOpen] = useState(true);
	const [selecting, setSelecting] = useState(false);
	const [selected, setSelected] = useState<Set<number>>(() => new Set());
	const [copyStatus, setCopyStatus] = useState("");
	const SourceLine = onAssign && selecting ? "label" : "div";
	function selectedValue(
		field?: VaultImportQuickFillField,
		numbers = [...selected].sort((a, b) => a - b),
	): string | undefined {
		if (!numbers.length)
			return readVaultImportSourceSelection(source, excerpt.selection, {
				field,
				candidates,
			});
		const blocks: number[][] = [];
		for (const number of numbers) {
			const previous = blocks.at(-1);
			if (previous && previous.at(-1) === number - 1) previous.push(number);
			else blocks.push([number]);
		}
		const values = blocks.map((block) => {
			const selection = getVaultImportSourceLineSelection(
				source,
				block[0],
				block[block.length - 1],
			);
			return selection
				? readVaultImportSourceSelection(source, selection, {
						field,
						candidates,
					})
				: undefined;
		});
		return values.some((value) => value === undefined)
			? undefined
			: values.join("\n");
	}
	function assign(field: VaultImportQuickFillField, numbers?: number[]) {
		const value = selectedValue(field, numbers);
		if (value !== undefined) onAssign?.(field, value);
	}
	function quickFillPassword(line: number) {
		// A proven password reference can span several source lines. Preserve its
		// exact value instead of reducing a multiline secret to its first line.
		for (const candidate of candidates) {
			if (candidate.sourceSnapshot && candidate.sourceSnapshot !== source)
				continue;
			const reference = candidate.sourceFields?.password;
			if (reference?.line !== line) continue;
			const value = readVaultImportSourceSelection(source, reference, {
				field: "password",
				candidates: [candidate],
			});
			if (value !== undefined && value === candidate.draft.password) {
				onAssign?.("password", value);
				return;
			}
		}
		assign("password", [line]);
	}
	function rowField(line: number, text: string) {
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
		return fields.length === 1 ? fields[0].field : undefined;
	}
	const fields = [
		["title", "pwVaultTitleField"],
		["username", "pwVaultUsernameField"],
		["password", "pwVaultPasswordField"],
		["notes", "pwVaultNotesField"],
		["usernameAliases", "pwSmartLoginIdentifierField"],
		["url", "pwVaultUrlField"],
	] as const;
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
							size="icon"
							aria-label={t("pwSmartSourceCopy")}
							disabled={disabled}
							onClick={async () => {
								const value = selectedValue();
								if (value === undefined) return;
								try {
									await navigator.clipboard.writeText(value);
									setCopyStatus(t("pwVaultCopied"));
								} catch {
									setCopyStatus(t("pwSmartSourceCopyFailed"));
								}
							}}
						>
							<Copy size={16} />
						</Button>
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
									<SourceLine
										className="pw-smart-source-line"
										data-selected={selected.has(row.lineNumber)}
										data-hidden={!revealed && row.maskedText !== row.text}
									>
										{onAssign && selecting && (
											<input
												type="checkbox"
												aria-label={t("pwSmartSourceSelectLine", {
													line: row.lineNumber,
												})}
												checked={selected.has(row.lineNumber)}
												disabled={disabled}
												onChange={(event) => {
													const next = new Set(selected);
													if (event.target.checked) next.add(row.lineNumber);
													else next.delete(row.lineNumber);
													setSelected(next);
												}}
											/>
										)}
										<Icon size={17} aria-hidden="true" />
										<span className="pw-smart-source-value">
											{revealed ? row.text : row.maskedText}
										</span>
										{onAssign && !selecting && field === "password" && (
											<Button
												type="button"
												size="small"
												disabled={disabled}
												onClick={() => quickFillPassword(row.lineNumber)}
											>
												{t("pwSmartFillPassword")}
											</Button>
										)}
									</SourceLine>
								</Fragment>
							);
						})}
					</div>
					{onAssign && selecting && (
						<div className="pw-import-source-assignment">
							<span className="pw-import-source-selected">
								{t("pwSmartSourceSelected", { count: selected.size })}
							</span>
							<Select
								value=""
								aria-label={t("pwSmartFillMenu")}
								disabled={disabled || selected.size === 0}
								onValueChange={(value) => {
									if (value) assign(value as VaultImportQuickFillField);
								}}
							>
								<SelectOption value="">{t("pwSmartFillMenu")}</SelectOption>
								{fields.map(([field, key]) => (
									<SelectOption
										key={field}
										value={field}
										disabled={
											readOnlyIdentity &&
											["title", "username", "url"].includes(field)
										}
									>
										{t(key)}
									</SelectOption>
								))}
							</Select>
						</div>
					)}
				</div>
				{copyStatus && (
					<span role="status" className="pw-smart-hint">
						{copyStatus}
					</span>
				)}
			</section>
			{onAssign && (
				<TextLink asChild>
					<button
						type="button"
						className="pw-import-source-select"
						disabled={disabled}
						aria-expanded={selecting}
						onClick={() => {
							setSelecting((value) => !value);
							setSourceOpen(true);
						}}
					>
						{t("pwSmartSelectSource")}
						{selecting && <ChevronUp size={14} />}
					</button>
				</TextLink>
			)}
		</div>
	);
}
