import {
	lazy,
	Suspense,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
	Box,
	CreditCard,
	ExternalLink,
	Globe,
	Plus,
	Repeat2,
	ArrowRight,
	Link2,
	MoreHorizontal,
} from "lucide-react";
import type { Asset, History, Relation } from "../../../../packages/domain/src";
import { detailDates } from "../unified-detail-dates";
import { useLocalDay } from "../use-local-day";
import { TaskRow } from "../TaskRow";
import { useRouterState } from "@tanstack/react-router";
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
} from "./ui/dropdown-menu";
import { detailHistoryRows, detailEventDate } from "../unified-detail-data";
import {
	fileUrl,
	localRepository,
	save,
	saveRelationIfCurrent,
} from "../../../../packages/local-db/src";
import { assetNotes } from "../asset-notes";
import { date, money, useAppContext } from "../view-shared";
import {
	historyCny,
	readSubscriptionRates,
	subscriptionRatesId,
} from "../subscription-cny";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectOption } from "./ui/select";
import { Dialog } from "./ui/dialog";
import { DatePicker } from "./ui/date-picker";
import "../unified-asset-detail.css";

const TaskEditor = lazy(() =>
	import("../workflow-task-editor").then((module) => ({
		default: module.TaskEditor,
	})),
);

export function UnifiedDetailHeader({
	asset,
	category,
	state,
	actions,
}: {
	asset: Asset;
	category: string;
	state: string;
	actions: ReactNode;
}) {
	const Icon = asset.walletCard
		? CreditCard
		: asset.kind === "item"
			? Box
			: asset.kind === "subscription"
				? Repeat2
				: Globe;
	return (
		<header className="unified-detail-header">
			<div className="unified-detail-identity">
				<span className="unified-detail-symbol">
					<Icon aria-hidden="true" />
				</span>
				<div>
					<h1>{asset.name}</h1>
					<div className="unified-detail-labels">
						<span>{category}</span>
						<span className="unified-detail-state">{state}</span>
					</div>
				</div>
			</div>
			<div className="actions">{actions}</div>
		</header>
	);
}

export function UnifiedDetailColumns({
	header,
	info,
	description,
	history,
	tasks,
	asset,
}: {
	header: ReactNode;
	info: ReactNode;
	description: ReactNode;
	history: ReactNode;
	tasks: ReactNode;
	asset: Asset;
}) {
	return (
		<div className="unified-detail-layout">
			<section className="card unified-detail-main">
				{header}
				<div className="unified-detail-overview">
					<UnifiedDetailMetrics asset={asset} />
					{info}
				</div>
				{description}
			</section>
			<div className="unified-detail-secondary">
				{history}
				{tasks}
			</div>
		</div>
	);
}

export function UnifiedDetailMetrics({ asset }: { asset: Asset }) {
	const { t, i18n } = useTranslation();
	const dates = detailDates(asset, useLocalDay());
	const wallet = asset.walletCard;
	const walletUses = wallet?.type === "countPass";
	const showWalletValue =
		!!wallet &&
		(walletUses || wallet.type === "storedValue" || wallet.type === "gift");
	const walletValue = walletUses ? wallet?.remainingUses : wallet?.balanceMinor;
	const showRemaining = asset.kind !== "project" || !!asset.dueDate;
	const showElapsed =
		asset.kind === "item" ||
		asset.kind === "subscription" ||
		(asset.kind === "project" && (!wallet || !!dates.startedDate));
	const remainingLabel = dates.warrantyBlocked
		? `itemWarranty_${asset.itemWarrantyStatus}`
		: dates.inactive
			? "detailRecordedDate"
			: dates.remaining === null
				? "detailDateMissing"
				: dates.remaining < 0
					? asset.kind === "item"
						? "detailWarrantyExpired"
						: "detailOverdue"
					: dates.remaining === 0
						? asset.kind === "item"
							? "detailWarrantyToday"
							: "detailDueToday"
						: asset.kind === "item"
							? asset.itemWarrantyStatus === "inWarranty"
								? "detailWarrantyRemaining"
								: "detailWarrantyRecordedRemaining"
							: "detailDueRemaining";
	return (
		<div className="unified-detail-metrics">
			{showWalletValue && (
				<div className="unified-detail-metric" data-metric="wallet-primary">
					<div>
						<span>{t(walletUses ? "walletRemaining" : "walletBalance")}</span>
						{walletValue != null && (
							<strong>
								{walletUses
									? walletValue
									: money(walletValue, "CNY", i18n.language)}
							</strong>
						)}
						{walletUses && walletValue != null && (
							<span>{t("detailWalletUsesUnit")}</span>
						)}
					</div>
					{walletValue == null && <small>{t("itemStatusUnrecorded")}</small>}
				</div>
			)}
			{showRemaining && (
				<div className="unified-detail-metric" data-metric="remaining">
					<div>
						<span>{t(remainingLabel)}</span>
						{!dates.inactive &&
						!dates.warrantyBlocked &&
						dates.remaining !== null &&
						dates.remaining !== 0 ? (
							<>
								<strong>{Math.abs(dates.remaining)}</strong>
								<span>{t("detailDaysUnit")}</span>
							</>
						) : null}
					</div>
					<small>
						{dates.remainingDate
							? `${t(asset.kind === "item" ? "warrantyDate" : asset.walletCard ? "walletExpiry" : "dueDate")} ${date(dates.remainingDate, i18n.language)}`
							: t("itemStatusUnrecorded")}
					</small>
				</div>
			)}
			{showElapsed ? (
				<div className="unified-detail-metric" data-metric="elapsed">
					<div>
						<span>
							{t(
								dates.elapsed === null
									? "detailStartMissing"
									: dates.elapsed < 0
										? "detailStartsIn"
										: asset.status === "paused" || dates.inactive
											? "detailSinceStart"
											: asset.kind === "item"
												? "detailServed"
												: "detailUsed",
							)}
						</span>
						{dates.elapsed !== null ? (
							<>
								<strong>{Math.abs(dates.elapsed)}</strong>
								<span>{t("detailDaysUnit")}</span>
							</>
						) : null}
					</div>
					<small>
						{dates.startedDate
							? `${t(asset.kind === "item" ? "itemStartDate" : asset.kind === "subscription" ? "detailSubscriptionStart" : "detailUsageStart")} ${date(dates.startedDate, i18n.language)}`
							: t("itemStatusUnrecorded")}
					</small>
				</div>
			) : null}
		</div>
	);
}

export function UnifiedDetailDescription({
	asset,
	children,
	actions,
	accountId,
	readOnly = false,
}: {
	asset: Asset;
	children: ReactNode;
	actions?: ReactNode;
	accountId?: string;
	readOnly?: boolean;
}) {
	const { t } = useTranslation();
	const notes = assetNotes(asset);
	const description = [asset.description, notes]
		.filter(
			(value, index, values) =>
				value.trim() &&
				values.findIndex((other) => other.trim() === value.trim()) === index,
		)
		.join("\n\n");
	return (
		<section className="unified-detail-description">
			<dl className="unified-detail-record-fields">
				{asset.tags.length > 0 && (
					<div>
						<dt>{t("detailTags")}</dt>
						<dd className="unified-detail-tags">
							{asset.tags.map((tag) => (
								<span key={tag}>{tag}</span>
							))}
						</dd>
					</div>
				)}
				<UnifiedDetailRelations
					asset={asset}
					accountId={accountId}
					readOnly={readOnly}
				/>
				{asset.url && (
					<div>
						<dt>{t("url")}</dt>
						<dd>
							{/^https?:\/\//i.test(asset.url) ? (
								<a href={asset.url} target="_blank" rel="noopener noreferrer">
									{asset.url}
								</a>
							) : (
								asset.url
							)}
						</dd>
					</div>
				)}
				<div>
					<dt>{t("detailDescription")}</dt>
					<dd className="unified-detail-text">{description || t("none")}</dd>
				</div>
			</dl>
			<div className="unified-detail-media">
				{children}
				<div className="unified-detail-media-actions">{actions}</div>
			</div>
		</section>
	);
}

/** All tasks stay visible; a reminder fragment focuses the matching row rather than duplicating it in a dialog. */
export function UnifiedDetailTasks({ assetId }: { assetId: string }) {
	const { data } = useAppContext(),
		{ t } = useTranslation();
	const [adding, setAdding] = useState(false);
	const hash = useRouterState({ select: (state) => state.location.hash });
	const tasks = data.tasks.filter(
		(task) => task.assetId === assetId && !task.deleted && !task.purged,
	);
	const hasTaskFragment = hash.startsWith("reminder-task-");
	let selected = "";
	if (hasTaskFragment) {
		try {
			selected = decodeURIComponent(hash.slice(14));
		} catch {
			/* invalid historical fragment */
		}
	}
	const targetExists = tasks.some((task) => task.id === selected);
	useEffect(() => {
		if (!hasTaskFragment || data.loading) return;
		const target = document.getElementById(
			targetExists ? `task-${selected}` : `asset-detail-tasks-${assetId}`,
		);
		target?.scrollIntoView({ block: "center", behavior: "instant" });
		target?.setAttribute("tabindex", "-1");
		target?.focus({ preventScroll: true });
	}, [hash, hasTaskFragment, selected, assetId, targetExists, data.loading]);
	return (
		<section
			className="card unified-detail-tasks"
			id={`asset-detail-tasks-${assetId}`}
			tabIndex={-1}
			aria-label={t("tasks")}
		>
			<header className="card-header">
				<h2>
					{t("tasks")}
					<span className="unified-detail-count">{tasks.length}</span>
				</h2>
				<Button size="small" variant="primary" onClick={() => setAdding(true)}>
					<Plus size={16} />
					{t("add")}
				</Button>
			</header>
			{hasTaskFragment && !targetExists && !data.loading && (
				<p role="status" className="unified-detail-empty">
					{t("reminderEntryMissing")}
				</p>
			)}
			<div className="unified-detail-task-list">
				{data.loading ? (
					<p role="status">{t("loading")}</p>
				) : tasks.length ? (
					tasks.map((task) => (
						<div
							className={
								task.id === selected ? "unified-detail-task-target" : ""
							}
							key={task.id}
						>
							<TaskRow task={task} hideRelated compact />
						</div>
					))
				) : (
					<p className="unified-detail-empty">{t("none")}</p>
				)}
			</div>
			{adding && (
				<Suspense fallback={<p role="status">{t("loading")}</p>}>
					<TaskEditor assetId={assetId} onClose={() => setAdding(false)} />
				</Suspense>
			)}
		</section>
	);
}

export function UnifiedDetailImage({
	id,
	label,
	actions,
}: {
	id: string;
	label: string;
	actions?: ReactNode;
}) {
	const { t } = useTranslation();
	const [state, setState] = useState({ url: "", error: false });
	useEffect(() => {
		let active = true,
			url = "";
		setState({ url: "", error: false });
		void fileUrl(id)
			.then((value) => {
				url = value;
				if (active) setState({ url: value, error: !value });
				else if (value) URL.revokeObjectURL(value);
			})
			.catch(() => {
				if (active) setState({ url: "", error: true });
			});
		return () => {
			active = false;
			if (url) URL.revokeObjectURL(url);
		};
	}, [id]);
	return (
		<figure className="unified-detail-photo">
			{state.url ? (
				<a
					href={state.url}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={t("detailOpenImage", { name: label })}
				>
					<img
						src={state.url}
						alt={label}
						onError={() => setState((current) => ({ ...current, error: true }))}
					/>
				</a>
			) : null}
			{state.error ? (
				<p role="alert">{t("uploadError")}</p>
			) : !state.url ? (
				<p role="status">{t("loading")}</p>
			) : null}
			<figcaption className="sr-only">{label}</figcaption>
			{actions ? (
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								size="icon"
								variant="ghost"
								aria-label={`${t("moreActions")} · ${label}`}
							/>
						}
					>
						<MoreHorizontal size={16} />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<div className="unified-detail-photo-actions">{actions}</div>
					</DropdownMenuContent>
				</DropdownMenu>
			) : null}
		</figure>
	);
}

/** Uses only ordinary RxDB assets. Private KDBX entries never enter these relations. */
export function UnifiedDetailRelations({
	asset,
	accountId,
	readOnly = false,
}: {
	asset: Asset;
	accountId?: string;
	readOnly?: boolean;
}) {
	const { data, notify } = useAppContext(),
		{ t } = useTranslation(),
		navigate = useNavigate();
	const [managing, setManaging] = useState(false),
		[adding, setAdding] = useState(false);
	const [remove, setRemove] = useState<Relation[] | null>(null),
		[target, setTarget] = useState(""),
		[label, setLabel] = useState("");
	const [source, setSource] = useState(""),
		[verifiedAt, setVerifiedAt] = useState("");
	const [busy, setBusy] = useState(false),
		[error, setError] = useState("");
	const inFlight = useRef(false);
	const byId = new Map(
		data.assets
			.filter((row) => !row.deleted && !row.purged && row.kind !== "vault")
			.map((row) => [row.id, row]),
	);
	const relations = data.relations.filter(
		(row) =>
			!row.deleted &&
			(row.from === asset.id || row.to === asset.id) &&
			byId.has(row.from) &&
			byId.has(row.to),
	);
	const related = relations.map((relation) => ({
		relation,
		target: byId.get(relation.from === asset.id ? relation.to : relation.from)!,
	}));
	const accountIds = new Set(
		related
			.filter((row) => row.target.kind === "account")
			.map((row) => row.target.id),
	);
	if (accountId && byId.get(accountId)?.kind === "account")
		accountIds.add(accountId);
	const accounts = [...accountIds].map((id) => byId.get(id)!);
	function visit(row: Asset) {
		if (row.kind === "account") {
			sessionStorage.setItem(
				"keepany-detail-account-return",
				JSON.stringify({ accountId: row.id, path: window.location.pathname }),
			);
			sessionStorage.removeItem("keepany-relation-return-kind");
			sessionStorage.removeItem("keepany-relation-return-id");
		} else {
			sessionStorage.setItem("keepany-relation-return-kind", asset.kind);
			sessionStorage.setItem("keepany-relation-return-id", row.id);
		}
		void navigate({
			to: "/assets/$kind/$id",
			params: { kind: row.kind, id: row.id },
		});
	}
	async function run(action: () => Promise<void>) {
		if (inFlight.current) return;
		inFlight.current = true;
		setBusy(true);
		setError("");
		try {
			await action();
			notify(t("saved"));
		} catch (reason) {
			setError(
				t(
					reason instanceof Error && reason.message === "relation-duplicate"
						? "relationDuplicate"
						: reason instanceof Error && reason.message === "relation-stale"
							? "relationDisconnectError"
							: "error",
				),
			);
		} finally {
			inFlight.current = false;
			setBusy(false);
		}
	}
	return (
		<div className="unified-detail-relations">
			<dt>{t("detailRegisteredAccounts")}</dt>
			<dd>
				<div className="unified-detail-account-links">
					{accounts.length ? (
						accounts.map((account) => (
							<a
								key={account.id}
								href={`/assets/account/${encodeURIComponent(account.id)}`}
								onClick={(event) => {
									event.preventDefault();
									visit(account);
								}}
							>
								<strong>
									{account.name} <ArrowRight size={16} />
								</strong>
								{account.username && <span>{account.username}</span>}
							</a>
						))
					) : (
						<span>{t("none")}</span>
					)}
					{!readOnly && (
						<Button
							variant="ghost"
							size="icon"
							aria-label={t("catalogRelated")}
							onClick={() => setManaging(true)}
						>
							<Link2 size={16} />
						</Button>
					)}
				</div>
				{managing && (
					<Dialog
						title={t("catalogRelated")}
						onClose={() => setManaging(false)}
					>
						<div className="unified-detail-link-list">
							{related.length ? (
								related.map(({ relation, target }) => (
									<div key={relation.id}>
										<a
											href={`/assets/${target.kind}/${encodeURIComponent(target.id)}`}
											onClick={(event) => {
												event.preventDefault();
												visit(target);
											}}
										>
											<strong>{target.name}</strong>
											{target.username && <span>{target.username}</span>}
										</a>
										<span>{relation.label}</span>
										<Button
											variant="danger"
											size="small"
											onClick={() => {
												setManaging(false);
												setError("");
												setRemove([relation]);
											}}
										>
											{t("deleteRelation")}
										</Button>
									</div>
								))
							) : (
								<p>{t("none")}</p>
							)}
						</div>
						<Button
							onClick={() => {
								setManaging(false);
								setTarget("");
								setLabel("");
								setSource("");
								setVerifiedAt("");
								setError("");
								setAdding(true);
							}}
						>
							<Plus size={16} />
							{t("addRelation")}
						</Button>
					</Dialog>
				)}
				{adding ? (
					<Dialog
						className="unified-detail-dialog"
						title={t("addRelation")}
						closeDisabled={busy}
						onClose={() => {
							if (!inFlight.current) setAdding(false);
						}}
					>
						<form
							className="form-grid"
							onSubmit={(event) => {
								event.preventDefault();
								if (!target || !label.trim()) return;
								void run(async () => {
									if (!byId.has(target) || target === asset.id)
										throw Error("invalid");
									if (
										data.relations.some(
											(row) =>
												!row.deleted &&
												row.from === asset.id &&
												row.to === target &&
												row.label.trim().toLocaleLowerCase() ===
													label.trim().toLocaleLowerCase(),
										)
									)
										throw Error("relation-duplicate");
									await save("relation", {
										id: crypto.randomUUID(),
										from: asset.id,
										to: target,
										label: label.trim(),
										createdAt: new Date().toISOString(),
										source: source.trim() || undefined,
										verifiedAt,
										deleted: false,
									});
									setAdding(false);
								});
							}}
						>
							<label className="field" htmlFor="detail-relation-target">
								{t("catalogRelated")}
								<Select
									id="detail-relation-target"
									value={target}
									onValueChange={setTarget}
									disabled={busy}
								>
									<SelectOption value="">{t("none")}</SelectOption>
									{[...byId.values()]
										.filter((row) => row.id !== asset.id)
										.map((row) => (
											<SelectOption key={row.id} value={row.id}>
												{row.name}
												{row.username ? ` · ${row.username}` : ""}
											</SelectOption>
										))}
								</Select>
							</label>
							<label className="field" htmlFor="detail-relation-label">
								{t("relationLabel")}
								<Input
									id="detail-relation-label"
									maxLength={100}
									value={label}
									disabled={busy}
									onChange={(event) => setLabel(event.target.value)}
								/>
							</label>
							<label className="field" htmlFor="detail-relation-source">
								{t("relationSource")}
								<Input
									id="detail-relation-source"
									maxLength={500}
									value={source}
									disabled={busy}
									onChange={(event) => setSource(event.target.value)}
								/>
							</label>
							<label className="field" htmlFor="detail-relation-verified">
								{t("verifiedAt")}
								<DatePicker
									id="detail-relation-verified"
									value={verifiedAt}
									disabled={busy}
									onValueChange={setVerifiedAt}
								/>
							</label>
							{error ? <p role="alert">{error}</p> : null}
							<div className="actions">
								<Button
									type="button"
									disabled={busy}
									onClick={() => setAdding(false)}
								>
									{t("cancel")}
								</Button>
								<Button
									type="submit"
									variant="primary"
									disabled={busy || !target || !label.trim()}
								>
									{t("save")}
								</Button>
							</div>
						</form>
					</Dialog>
				) : null}
				{remove ? (
					<Dialog
						className="unified-detail-dialog"
						title={t("deleteRelation")}
						closeDisabled={busy}
						onClose={() => {
							if (!inFlight.current) setRemove(null);
						}}
					>
						<p>
							{remove.length === 1
								? t("deleteRelationConfirm", { label: remove[0].label })
								: t("relationDisconnectGroup", { count: remove.length })}
						</p>
						{error ? <p role="alert">{error}</p> : null}
						<div className="actions">
							<Button disabled={busy} onClick={() => setRemove(null)}>
								{t("cancel")}
							</Button>
							<Button
								variant="danger"
								disabled={busy}
								onClick={() =>
									void run(async () => {
										const repository = await localRepository();
										for (const row of remove) {
											if (
												(await repository.get<Relation>("relation", row.id))
													?.deleted
											)
												continue;
											await saveRelationIfCurrent(row, {
												...row,
												deleted: true,
											});
										}
										setRemove(null);
									})
								}
							>
								{t("deleteRelation")}
							</Button>
						</div>
					</Dialog>
				) : null}
			</dd>
		</div>
	);
}

export function UnifiedDetailHistory({
	asset,
	children,
}: {
	asset: Asset;
	children?: ReactNode;
}) {
	const { data } = useAppContext(),
		{ t, i18n } = useTranslation();
	const rates = readSubscriptionRates(
		data.preferences.find((row) => row.id === subscriptionRatesId)?.value,
	);
	const rows = detailHistoryRows(data.history, asset.id);
	function title(row: History) {
		return row.action === "itemStatus"
			? `${row.itemStatusBefore ? t(`itemStatus_${row.itemStatusBefore}`) : t("itemStatusUnrecorded")} → ${row.itemStatusAfter ? t(`itemStatus_${row.itemStatusAfter}`) : t("itemStatusUnrecorded")}`
			: ["expense", "topup", "refund", "balance"].includes(row.action)
				? row.title ||
					t(`financeAction${row.action[0].toUpperCase()}${row.action.slice(1)}`)
				: t(row.action);
	}
	return (
		<section className="card unified-detail-history">
			<header className="card-header">
				<h2>
					{t("history")}{" "}
					<span className="unified-detail-count">{rows.length}</span>
				</h2>
				{children}
			</header>
			{rows.length ? (
				<ol className="unified-detail-events">
					{rows.map((row) => (
						<li key={row.id}>
							<time dateTime={detailEventDate(row)}>
								{date(detailEventDate(row), i18n.language)}
							</time>
							<strong className={`unified-detail-event-type is-${row.action}`}>
								{title(row)}
							</strong>
							<div className="unified-detail-event-content">
								{row.renewalDueDate ? (
									<span>
										{t("detailRenewedUntil", {
											date: date(row.renewalDueDate, i18n.language),
										})}
									</span>
								) : row.action === "renew" && row.billDate ? (
									<span>
										{t("detailBilledDue", {
											date: date(row.billDate, i18n.language),
										})}
									</span>
								) : null}
								{row.borrower && (
									<span>
										{t("borrower")}: {row.borrower}
									</span>
								)}
								{row.expectedReturnDate && (
									<span>
										{t("itemExpectedReturnDate")}:{" "}
										{date(row.expectedReturnDate, i18n.language)}
									</span>
								)}
								{row.source && <span>{row.source}</span>}
								{row.note && <p>{row.note}</p>}
							</div>
							<span className="unified-detail-event-amount">
								{row.amount !== undefined && row.currency
									? asset.kind === "subscription" && row.action === "renew"
										? historyCny(row, rates) === null
											? t("subscriptionCnyMissing")
											: money(historyCny(row, rates)!, "CNY", i18n.language)
										: money(row.amount, row.currency, i18n.language)
									: ""}
							</span>
						</li>
					))}
				</ol>
			) : (
				<p className="unified-detail-empty">{t("none")}</p>
			)}
		</section>
	);
}
