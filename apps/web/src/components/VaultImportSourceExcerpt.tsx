import { Eye, EyeOff } from "lucide-react";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import type { buildVaultImportSourceExcerpt } from "../vault-import-source";
import { Button } from "./ui/button";

type SourceExcerpt = ReturnType<typeof buildVaultImportSourceExcerpt>;

export function VaultImportSourceExcerpt({
	excerpt,
	source,
	disabled,
	onEdit,
}: {
	excerpt: SourceExcerpt;
	source: string;
	disabled: boolean;
	onEdit: (selection: { start: number; end: number }) => void;
}) {
	const { t } = useTranslation();
	const [revealed, setRevealed] = useState(false);
	return (
		<div
			className="pw-smart-source-excerpt"
			data-source-start={
				source.slice(0, excerpt.selection.start).replace(/\r\n?/g, "\n").length
			}
			data-source-end={
				source.slice(0, excerpt.selection.end).replace(/\r\n?/g, "\n").length
			}
			data-source-revealed={revealed}
		>
			<strong>{t("pwSmartSourceExcerpt")}</strong>
			{(excerpt.title || excerpt.username) && (
				<p className="pw-smart-source-context">
					{[excerpt.title, excerpt.username].filter(Boolean).join(" · ")}
				</p>
			)}
			<pre className="pw-smart-source-text">
				{excerpt.rows.map((row, index) => (
					<Fragment key={row.lineNumber}>
						{index > 0 &&
							row.lineNumber > excerpt.rows[index - 1].lineNumber + 1 && (
								<span className="pw-smart-source-gap" aria-hidden="true">
									{"…\n"}
								</span>
							)}
						<span
							className="pw-smart-source-line"
							data-highlighted={row.focused}
							data-hidden={!revealed && row.maskedText !== row.text}
						>
							{revealed ? row.text : row.maskedText}
							{index < excerpt.rows.length - 1 ? "\n" : ""}
						</span>
					</Fragment>
				))}
			</pre>
			<div className="actions">
				<Button
					variant="ghost"
					onClick={() => setRevealed((value) => !value)}
					aria-expanded={revealed}
					disabled={disabled}
				>
					{revealed ? <EyeOff size={15} /> : <Eye size={15} />}
					{t(revealed ? "pwSmartSourceHide" : "pwSmartSourceShow")}
				</Button>
				<Button
					variant="ghost"
					onClick={() => onEdit(excerpt.selection)}
					disabled={disabled}
				>
					{t("pwSmartSourceEdit")}
				</Button>
			</div>
		</div>
	);
}
