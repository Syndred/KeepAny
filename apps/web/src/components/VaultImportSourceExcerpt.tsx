import { ChevronDown, ChevronUp, Copy, Eye, EyeOff } from "lucide-react";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import type { VaultImportCandidate } from "../vault-import-model";
import {
	readVaultImportSourceSelection,
	type VaultImportQuickFillField,
} from "../vault-import-quick-fill";
import {
	getVaultImportSourceLineSelection,
	type VaultImportSourceExcerpt as SourceExcerpt,
} from "../vault-import-source";
import { Button } from "./ui/button";

export function VaultImportSourceExcerpt({
	excerpt,
	source,
	disabled,
	candidates = [],
	readOnlyIdentity = false,
	onAssign,
}: {
	excerpt: SourceExcerpt;
	source: string;
	disabled: boolean;
	candidates?: VaultImportCandidate[];
	readOnlyIdentity?: boolean;
	onAssign?: (field: VaultImportQuickFillField, value: string) => void;
}) {
	const { t } = useTranslation();
	const SourceLine = onAssign ? "label" : "span";
	const [revealed, setRevealed] = useState(false);
	const [sourceOpen, setSourceOpen] = useState(
		() => !onAssign || window.innerWidth >= 900,
	);
	const [selected, setSelected] = useState<Set<number>>(() => new Set());
	const [copyStatus, setCopyStatus] = useState("");
	function selectedValue(
		field?: VaultImportQuickFillField,
	): string | undefined {
		const numbers = [...selected].sort((a, b) => a - b);
		if (!numbers.length)
			return readVaultImportSourceSelection(source, excerpt.selection);
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
	return (
		<section
			className={`pw-smart-source-excerpt${onAssign ? " pw-smart-source-disclosure" : ""}`}
			data-source-start={
				source.slice(0, excerpt.selection.start).replace(/\r\n?/g, "\n").length
			}
			data-source-end={
				source.slice(0, excerpt.selection.end).replace(/\r\n?/g, "\n").length
			}
			data-source-revealed={revealed}
		>
			<div className="pw-smart-source-heading">
				{onAssign ? (
					<Button
						type="button"
						variant="ghost"
						className="pw-smart-source-toggle"
						aria-expanded={sourceOpen}
						aria-controls={`${excerpt.id}-content`}
						onClick={() => setSourceOpen((value) => !value)}
					>
						{sourceOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}{" "}
						{t("pwSmartSourceExcerpt")}
					</Button>
				) : (
					<strong>{t("pwSmartSourceExcerpt")}</strong>
				)}
				{onAssign && (
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
				)}
			</div>
			{(excerpt.title || excerpt.username) && (
				<p className="pw-smart-source-context">
					{[excerpt.title, excerpt.username].filter(Boolean).join(" · ")}
				</p>
			)}
			<div
				id={`${excerpt.id}-content`}
				hidden={!sourceOpen}
				className="pw-smart-source-content"
			>
				<pre className="pw-smart-source-text">
					{excerpt.rows.map((row, index) => (
						<Fragment key={row.lineNumber}>
							{index > 0 && (
								<span
									className={
										row.lineNumber > excerpt.rows[index - 1].lineNumber + 1
											? "pw-smart-source-gap"
											: "pw-smart-source-separator"
									}
									aria-hidden="true"
								>
									{row.lineNumber > excerpt.rows[index - 1].lineNumber + 1
										? "\n…\n"
										: "\n"}
								</span>
							)}
							<SourceLine
								className="pw-smart-source-line"
								data-highlighted={row.focused}
								data-hidden={!revealed && row.maskedText !== row.text}
							>
								{onAssign && (
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
								<span className="pw-smart-source-value">
									{revealed ? row.text : row.maskedText}
								</span>
							</SourceLine>
						</Fragment>
					))}
				</pre>
				<div className="actions pw-smart-source-visibility">
					<Button
						type="button"
						variant="ghost"
						onClick={() => setRevealed((value) => !value)}
						aria-expanded={revealed}
						disabled={disabled}
					>
						{revealed ? <EyeOff size={15} /> : <Eye size={15} />}
						{t(revealed ? "pwSmartSourceHide" : "pwSmartSourceShow")}
					</Button>
				</div>
				{onAssign && (
					<div className="pw-smart-source-assignment">
						<p className="pw-smart-hint">
							{selected.size
								? t("pwSmartSourceSelected", { count: selected.size })
								: t("pwSmartSourceSelectHint")}
						</p>
						{selected.size > 0 && (
							<div className="actions pw-smart-source-field-actions">
								{(
									[
										["title", "pwSmartFillTitle"],
										["username", "pwSmartFillUsername"],
										["password", "pwSmartFillPassword"],
										["notes", "pwSmartFillNotes"],
									] as const
								).map(([field, label]) => (
									<Button
										type="button"
										key={field}
										size="small"
										disabled={
											disabled ||
											(readOnlyIdentity &&
												(field === "title" || field === "username"))
										}
										onClick={() => {
											const value = selectedValue(field);
											if (value !== undefined) onAssign(field, value);
										}}
									>
										{t(label)}
									</Button>
								))}
							</div>
						)}
					</div>
				)}
			</div>
			{copyStatus && (
				<span role="status" className="pw-smart-hint">
					{copyStatus}
				</span>
			)}
		</section>
	);
}
