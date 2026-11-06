import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, MoreHorizontal, Pencil } from "lucide-react";
import { Button } from "./ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu";

/** Shared summary only. Each task owner retains its own state transition and editor. */
export function TaskSummaryCells({
	name,
	done,
	dueDate,
	summary,
	busy,
	onToggle,
	onEdit,
	toggleLabel,
	editLabel,
	toggleDisabled,
	editDisabled,
	menu,
}: {
	name: ReactNode;
	done: boolean;
	dueDate: string;
	summary?: ReactNode;
	busy: boolean;
	onToggle: () => void;
	onEdit: () => void;
	toggleLabel?: string;
	editLabel?: string;
	toggleDisabled?: boolean;
	editDisabled?: boolean;
	menu: ReactNode;
}) {
	const { t } = useTranslation();
	const toggle = toggleLabel ?? t(done ? "reopen" : "complete");
	const edit = editLabel ?? t("editTask");
	return (
		<>
			<Button
				size="icon"
				variant="ghost"
				className="task-complete-toggle"
				aria-pressed={done}
				aria-label={toggle}
				title={toggle}
				disabled={busy || toggleDisabled}
				onClick={onToggle}
			>
				<span className="task-status-check" aria-hidden="true">
					{done && <Check size={16} />}
				</span>
			</Button>
			<div className="impact-task-info">
				<strong className={done ? "done" : ""}>{name}</strong>
			</div>
			<time
				className="task-due-date"
				dateTime={dueDate || undefined}
				aria-label={`${t("date")}: ${dueDate ? dueDate.replaceAll("-", "/") : t("none")}`}
			>
				{dueDate ? dueDate.replaceAll("-", "/") : "—"}
			</time>
			<div className="compact-task-actions">
				<Button
					size="icon"
					variant="ghost"
					disabled={busy || editDisabled}
					onClick={onEdit}
					aria-label={edit}
					title={edit}
				>
					<Pencil size={18} aria-hidden="true" />
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								size="icon"
								variant="ghost"
								aria-label={t("moreActions")}
								disabled={busy}
							/>
						}
					>
						<MoreHorizontal size={18} />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">{menu}</DropdownMenuContent>
				</DropdownMenu>
			</div>
			{summary && <small className="task-summary-meta">{summary}</small>}
		</>
	);
}
