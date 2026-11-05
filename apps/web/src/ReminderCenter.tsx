import { Popover } from "@base-ui/react/popover";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
	ArrowLeft,
	Bell,
	CalendarDays,
	ChevronRight,
	Cloud,
	Laptop,
	Repeat2,
	X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Asset, Task } from "../../../packages/domain/src";
import { save } from "../../../packages/local-db/src";
import { TaskRow } from "./TaskRow";
import {
	buildReminderCenterItems,
	reminderReadPreference,
	resolveReminderTarget,
	type ReminderCenterItem,
} from "./reminder-center-model";
import {
	REMINDER_CENTER_EVENT,
	type ReminderCenterRequest,
} from "./reminder-navigation";
import { REMINDER_SETTINGS_ID, readReminderSettings } from "./reminders";
import { useLocalDay } from "./use-local-day";
import { AppContext, date, useAppContext } from "./view-shared";
import "./reminder-center.css";

function useSmallReminderScreen() {
	const [small, setSmall] = useState(
		() => window.matchMedia("(max-width: 760px)").matches,
	);
	useEffect(() => {
		const query = window.matchMedia("(max-width: 760px)");
		const changed = () => setSmall(query.matches);
		query.addEventListener("change", changed);
		return () => query.removeEventListener("change", changed);
	}, []);
	return small;
}

function taskTarget(task: Task, assets: readonly Asset[]) {
	const asset = assets.find(
		(row) =>
			row.id === task.assetId &&
			!row.deleted &&
			!row.purged &&
			row.kind !== "vault",
	);
	if (!asset) return null;
	const hash = `reminder-task-${encodeURIComponent(task.id)}`;
	return asset.walletCard
		? { to: "/records/$id" as const, params: { id: `asset:${asset.id}` }, hash }
		: {
				to: "/assets/$kind/$id" as const,
				params: { kind: asset.kind, id: asset.id },
				hash,
			};
}

const groups: ReminderCenterItem["group"][] = [
	"overdue",
	"today",
	"week",
	"later",
	"undated",
];
const groupKeys = {
	overdue: "reminderCenterGroupOverdue",
	today: "reminderCenterGroupToday",
	week: "reminderCenterGroupWeek",
	later: "reminderCenterGroupLater",
	undated: "reminderCenterGroupUndated",
};
const typeKeys = {
	task: "reminderCenterTask",
	renewal: "reminderCenterRenewal",
	warranty: "reminderCenterWarranty",
	date: "reminderCenterDate",
};

/** One shell entry, shared by the bell and all retained historical reminder links. */
export function ReminderCenter({
	feedback = "",
	onOpenChange,
}: {
	feedback?: string;
	onOpenChange?: (open: boolean) => void;
}) {
	const context = useAppContext();
	const { data } = context;
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const hash = useRouterState({ select: (state) => state.location.hash });
	const today = useLocalDay();
	const small = useSmallReminderScreen();
	const [open, setOpen] = useState(false);
	function changeOpen(next: boolean) {
		setOpen(next);
		onOpenChange?.(next);
	}
	const [tab, setTab] = useState<"all" | "unread">("all");
	const [scope, setScope] = useState<{ assetId?: string; overdue?: boolean }>(
		{},
	);
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
	const [request, setRequest] = useState<ReminderCenterRequest | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [taskFeedback, setTaskFeedback] = useState("");
	const inFlight = useRef(false);
	const interaction = useRef(0);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const navigationFocus = useRef<string | null>(null);
	function finalFocus() {
		if (navigationFocus.current === null) return triggerRef.current;
		const taskId = navigationFocus.current;
		const target =
			(taskId
				? document.getElementById(`task-${taskId}`)
				: document.querySelector<HTMLElement>(".unified-detail-metrics")) ??
			document.querySelector<HTMLElement>(
				".reminder-task-context, .unified-detail-tasks",
			);
		if (!target) return false;
		target.setAttribute("tabindex", "-1");
		target.scrollIntoView({ block: "center", behavior: "instant" });
		return target;
	}
	const headingRef = useRef<HTMLHeadingElement>(null);
	const bodyRef = useRef<HTMLDivElement>(null);
	const touchStart = useRef<number | null>(null);
	const bodyId = useId();
	const allTabId = useId();
	const unreadTabId = useId();
	const items = useMemo(
		() =>
			buildReminderCenterItems(
				data.assets,
				data.tasks,
				data.preferences,
				today,
			),
		[data.assets, data.tasks, data.preferences, today],
	);
	const settings = useMemo(
		() =>
			readReminderSettings(
				data.preferences.find((row) => row.id === REMINDER_SETTINGS_ID)?.value,
			),
		[data.preferences],
	);
	const unread = items.filter((item) => !item.read).length;
	const scopedItems = items.filter(
		(item) =>
			(!scope.assetId ||
				item.asset?.id === scope.assetId ||
				item.task?.assetId === scope.assetId) &&
			(!scope.overdue || item.group === "overdue"),
	);
	const scopedUnread = scopedItems.filter((item) => !item.read).length;
	const shown = scopedItems.filter((item) => tab === "all" || !item.read);
	const selectedTask = data.tasks.find(
		(task) => task.id === selectedTaskId && !task.deleted && !task.purged,
	);
	const scopedAsset = data.assets.find(
		(asset) => asset.id === scope.assetId && !asset.deleted && !asset.purged,
	);
	const latest = useRef({ data, items });
	latest.current = { data, items };

	function show(options: ReminderCenterRequest) {
		navigationFocus.current = null;
		setTaskFeedback("");
		interaction.current++;
		setTab(options.filter === "unread" ? "unread" : "all");
		setScope({
			assetId: options.assetId,
			overdue: options.filter === "overdue",
		});
		setSelectedTaskId(options.taskId ?? null);
		setRequest(options.taskId ? options : null);
		setError("");
		changeOpen(true);
	}
	useEffect(() => {
		const receive = (event: Event) => {
			const raw = (event as CustomEvent<ReminderCenterRequest>).detail;
			show({
				taskId: typeof raw?.taskId === "string" ? raw.taskId : undefined,
				assetId: typeof raw?.assetId === "string" ? raw.assetId : undefined,
				filter:
					raw?.filter === "unread" || raw?.filter === "overdue"
						? raw.filter
						: "all",
			});
		};
		window.addEventListener(REMINDER_CENTER_EVENT, receive);
		return () => window.removeEventListener(REMINDER_CENTER_EVENT, receive);
	}, []);
	useEffect(() => {
		// Source pages own their contextual task region. Only the legacy redirect's
		// overview fragment is interpreted by this panel.
		if (pathname === "/" && hash === "reminders") show({});
		else if (pathname === "/" && hash.startsWith("reminder-task-")) {
			let id = hash.slice("reminder-task-".length);
			try {
				id = decodeURIComponent(id);
			} catch {
				/* Show a recoverable missing-item state. */
			}
			show({ taskId: id });
		} else {
			interaction.current++;
			changeOpen(false);
			setSelectedTaskId(null);
			setRequest(null);
		}
	}, [pathname, hash]);
	useEffect(() => {
		if (open) bodyRef.current?.scrollTo({ top: 0 });
	}, [tab, scope.assetId, scope.overdue, selectedTaskId, open]);

	async function markRead(rows: readonly ReminderCenterItem[]) {
		const pending = rows.filter((item) => !item.read);
		if (!pending.length) return true;
		if (inFlight.current) return false;
		inFlight.current = true;
		setBusy(true);
		setError("");
		try {
			// Individual occurrence receipts retain independent writes from other tabs.
			// No task, renewal date, or completion record is modified here.
			for (const row of pending)
				await save("preference", await reminderReadPreference(row.signature));
			return true;
		} catch {
			setError(t("reminderCenterReadFailed"));
			return false;
		} finally {
			inFlight.current = false;
			setBusy(false);
		}
	}

	useEffect(() => {
		if (!request?.taskId || data.loading) return;
		const requested = request.taskId;
		const current = latest.current;
		const task = current.data.tasks.find(
			(row) => row.id === requested && !row.deleted && !row.purged,
		);
		const target = task ? taskTarget(task, current.data.assets) : null;
		setRequest(null);
		const item = current.items.find((row) => row.task?.id === requested);
		const activation = interaction.current;
		void markRead(item ? [item] : []).then(async (saved) => {
			if (!saved || activation !== interaction.current || !target) return;
			try {
				navigationFocus.current = requested;
				await navigate(target);
				setSelectedTaskId(null);
				changeOpen(false);
			} catch {
				navigationFocus.current = null;
				setError(t("reminderCenterLoadFailed"));
			}
		});
	}, [request, data.loading]);

	async function activate(item: ReminderCenterItem) {
		const activation = ++interaction.current;
		if (!(await markRead([item]))) return;
		if (activation !== interaction.current) return;
		const target = resolveReminderTarget(item);
		if (target) {
			try {
				navigationFocus.current = item.task?.id ?? "";
				await navigate(target);
				changeOpen(false);
			} catch {
				navigationFocus.current = null;
				setError(t("reminderCenterLoadFailed"));
			}
		} else if (item.task) {
			setTaskFeedback("");
			setSelectedTaskId(item.task.id);
		}
	}

	function itemDate(item: ReminderCenterItem) {
		if (item.days === null) return t("reminderCenterUndated");
		const label =
			item.days < 0
				? t("reminderCenterDaysOverdue", { count: -item.days })
				: item.days === 0
					? t("reminderCenterDueToday")
					: t("reminderCenterDaysRemaining", { count: item.days });
		return `${date(item.dueDate, i18n.language)} · ${label}`;
	}
	const emptyTitle = !settings.enabled
		? "reminderCenterDisabled"
		: tab === "unread"
			? "reminderCenterNoUnread"
			: scope.overdue
				? "reminderCenterNoOverdue"
				: "reminderCenterEmpty";
	return (
		<Popover.Root
			open={open}
			modal={small}
			triggerId="reminder-bell"
			onOpenChange={(next, details) => {
				if (!next && busy) {
					details.cancel();
					return;
				}
				interaction.current++;
				if (next) {
					navigationFocus.current = null;
					setTab("all");
					setScope({});
					setSelectedTaskId(null);
					setRequest(null);
					setError("");
				}
				changeOpen(next);
			}}
		>
			<Popover.Trigger
				id="reminder-bell"
				data-testid="reminder-bell"
				ref={triggerRef}
				className="top-icon-button reminder-center-trigger"
				aria-label={
					unread
						? t("reminderCenterOpenUnread", { count: unread })
						: t("reminderCenterOpen")
				}
				title={t("reminderCenterOpen")}
			>
				<Bell size={17} aria-hidden="true" />
				{unread > 0 && <i aria-hidden="true" />}
			</Popover.Trigger>
			<Popover.Portal>
				{small && <Popover.Backdrop className="reminder-center-backdrop" />}
				<Popover.Positioner
					className="reminder-center-positioner"
					side="bottom"
					align="end"
					sideOffset={10}
					collisionPadding={12}
				>
					<Popover.Popup
						className="reminder-center-popup"
						data-testid="reminder-center"
						initialFocus={headingRef}
						finalFocus={finalFocus}
						aria-describedby={undefined}
					>
						<div
							className="reminder-center-handle"
							aria-hidden="true"
							onTouchStart={(event) => {
								touchStart.current = event.touches[0]?.clientY ?? null;
							}}
							onTouchEnd={(event) => {
								if (
									!busy &&
									touchStart.current !== null &&
									(event.changedTouches[0]?.clientY ?? 0) - touchStart.current >
										60
								) {
									interaction.current++;
									changeOpen(false);
								}
								touchStart.current = null;
							}}
						>
							<span />
						</div>
						<header className="reminder-center-header">
							<Popover.Title ref={headingRef} tabIndex={-1}>
								{t("reminderCenterTitle")}
								{scopedUnread > 0 && (
									<span
										className="reminder-center-count"
										data-testid="reminder-unread-count"
										aria-label={t("reminderCenterUnreadCount", {
											count: scopedUnread,
										})}
									>
										{scopedUnread}
									</span>
								)}
							</Popover.Title>
							<button
								type="button"
								className="reminder-center-mark"
								disabled={
									busy || data.loading || !!data.error || scopedUnread === 0
								}
								onClick={() => void markRead(scopedItems)}
							>
								{t("reminderCenterMarkAllRead")}
							</button>
							<Popover.Close
								className="reminder-center-close"
								aria-label={t("close")}
								disabled={busy}
							>
								<X size={18} aria-hidden="true" />
							</Popover.Close>
						</header>
						{selectedTaskId === null && (
							<div
								className="reminder-center-tabs"
								role="tablist"
								aria-label={t("reminderCenterTitle")}
							>
								<button
									type="button"
									id={allTabId}
									role="tab"
									aria-selected={tab === "all"}
									aria-controls={bodyId}
									tabIndex={tab === "all" ? 0 : -1}
									onClick={() => setTab("all")}
									onKeyDown={(event) => {
										if (event.key === "ArrowRight" || event.key === "End") {
											event.preventDefault();
											setTab("unread");
											document.getElementById(unreadTabId)?.focus();
										}
									}}
								>
									{t("reminderCenterAll")}
								</button>
								<button
									type="button"
									id={unreadTabId}
									role="tab"
									aria-selected={tab === "unread"}
									aria-controls={bodyId}
									tabIndex={tab === "unread" ? 0 : -1}
									onClick={() => setTab("unread")}
									onKeyDown={(event) => {
										if (event.key === "ArrowLeft" || event.key === "Home") {
											event.preventDefault();
											setTab("all");
											document.getElementById(allTabId)?.focus();
										}
									}}
								>
									{t("reminderCenterUnread", { count: scopedUnread })}
								</button>
							</div>
						)}
						{(scope.assetId || scope.overdue) && selectedTaskId === null && (
							<div className="reminder-center-scope">
								<span>
									{scope.overdue
										? t("reminderCenterOverdueScope")
										: (scopedAsset?.name ?? t("reminderCenterStandalone"))}
								</span>
								<button type="button" onClick={() => setScope({})}>
									{t("reminderCenterShowAll")}
								</button>
							</div>
						)}
						{error && (
							<p className="reminder-center-error" role="alert">
								{error}
							</p>
						)}
						{feedback && (
							<p className="reminder-center-notice" role="status">
								{feedback}
							</p>
						)}
						<div
							ref={bodyRef}
							id={bodyId}
							data-testid="reminder-list"
							className="reminder-center-body"
							role={selectedTaskId === null ? "tabpanel" : undefined}
							aria-labelledby={
								selectedTaskId === null
									? tab === "all"
										? allTabId
										: unreadTabId
									: undefined
							}
							aria-busy={busy || data.loading}
						>
							{data.loading ? (
								<div className="reminder-center-empty" role="status">
									<Bell size={28} aria-hidden="true" />
									<strong>{t("loading")}</strong>
								</div>
							) : data.error ? (
								<div className="reminder-center-empty" role="alert">
									<strong>{t("reminderCenterLoadFailed")}</strong>
									<button
										type="button"
										className="button"
										onClick={() => window.location.reload()}
									>
										{t("reminderCenterReload")}
									</button>
								</div>
							) : selectedTaskId !== null ? (
								<section
									className="reminder-center-task-detail"
									aria-label={t("reminderCenterTaskDetail")}
								>
									<button
										type="button"
										className="reminder-center-back"
										onClick={() => {
											setSelectedTaskId(null);
											setError("");
										}}
									>
										<ArrowLeft size={16} aria-hidden="true" />
										{t("reminderCenterBackToList")}
									</button>
									{taskFeedback && (
										<p className="reminder-center-task-feedback" role="status">
											{taskFeedback}
										</p>
									)}
									{selectedTask ? (
										<AppContext.Provider
											value={{ ...context, notify: setTaskFeedback }}
										>
											<TaskRow
												key={selectedTask.id}
												task={selectedTask}
												compact
											/>
										</AppContext.Provider>
									) : (
										<p role="status">{t("reminderCenterMissingTask")}</p>
									)}
								</section>
							) : shown.length ? (
								groups.map((group) => {
									const rows = shown.filter((item) => item.group === group);
									return rows.length ? (
										<section
											className={`reminder-center-group is-${group}`}
											key={group}
											aria-label={t(groupKeys[group])}
										>
											<h3>{t(groupKeys[group])}</h3>
											{rows.map((item) => {
												const Icon =
													item.type === "renewal"
														? Cloud
														: item.type === "warranty" ||
																item.asset?.kind === "item"
															? Laptop
															: item.type === "task"
																? Repeat2
																: CalendarDays;
												return (
													<button
														type="button"
														key={item.id}
														className="reminder-center-row"
														data-reminder-id={item.id}
														data-read={item.read}
														disabled={busy}
														onClick={() => void activate(item)}
													>
														<span
															className={`reminder-center-unread-dot${item.read ? " is-read" : ""}`}
															aria-hidden="true"
														/>
														<span className="reminder-center-row-icon">
															<Icon size={20} aria-hidden="true" />
														</span>
														<span className="reminder-center-row-copy">
															<strong>{item.name}</strong>
															<span>
																{item.task
																	? item.asset
																		? `${item.asset.name} · ${t(item.asset.kind)}`
																		: t("reminderCenterStandalone")
																	: t(typeKeys[item.type])}
															</span>
															<time
																dateTime={item.dueDate || undefined}
																className={
																	item.days !== null && item.days < 0
																		? "is-overdue"
																		: undefined
																}
															>
																{itemDate(item)}
															</time>
														</span>
														<ChevronRight
															className="reminder-center-row-chevron"
															size={17}
															aria-hidden="true"
														/>
													</button>
												);
											})}
										</section>
									) : null;
								})
							) : (
								<div className="reminder-center-empty">
									<span className="reminder-center-empty-icon">
										<Bell size={30} aria-hidden="true" />
									</span>
									<strong>{t(emptyTitle)}</strong>
									<p>
										{t(
											!settings.enabled
												? "reminderCenterDisabledHint"
												: tab === "unread"
													? "reminderCenterNoUnreadHint"
													: "reminderCenterEmptyHint",
										)}
									</p>
								</div>
							)}
						</div>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}
