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
} from "lucide-react";
import type { Asset, History, Relation } from "../../../../packages/domain/src";
import { detailHistoryRows } from "../unified-detail-data";
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

const Graph = lazy(() =>
	import("../account-family-graph-view").then((module) => ({
		default: module.AssetRelationGraph,
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
		<header className="page-header unified-detail-header">
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
	info,
	description,
	relations,
	history,
}: {
	info: ReactNode;
	description: ReactNode;
	relations: ReactNode;
	history: ReactNode;
}) {
	return (
		<div className="unified-detail-columns">
			<div className="unified-detail-left">
				{info}
				{description}
			</div>
			<div className="unified-detail-right">
				{relations}
				{history}
			</div>
		</div>
	);
}

export function UnifiedDetailDescription({
	asset,
	children,
	actions,
}: {
	asset: Asset;
	children: ReactNode;
	actions?: ReactNode;
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
		<section className="card unified-detail-description">
			<header className="card-header">
				<h2>{t("detailDescription")}</h2>
				{actions}
			</header>
			<p className="unified-detail-text">{description || t("none")}</p>
			{children}
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
					<ExternalLink size={15} aria-hidden="true" />
				</a>
			) : null}
			{state.error ? (
				<p role="alert">{t("uploadError")}</p>
			) : !state.url ? (
				<p role="status">{t("loading")}</p>
			) : null}
			<figcaption>{label}</figcaption>
			{actions ? <div className="actions">{actions}</div> : null}
		</figure>
	);
}

/** Uses only ordinary RxDB assets. Private KDBX entries never enter these relations. */
export function UnifiedDetailRelations({
	asset,
	owner,
}: {
	asset: Asset;
	owner?: Asset;
}) {
	const { data, notify } = useAppContext(),
		{ t } = useTranslation(),
		navigate = useNavigate();
	const [edge, setEdge] = useState<string | null>(null),
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
			.filter((row) => !row.deleted && row.kind !== "vault")
			.map((row) => [row.id, row]),
	);
	const relations: Relation[] = owner
		? [
				{
					id: `domain-owner:${asset.id}`,
					from: asset.id,
					to: owner.id,
					label: t("project"),
					createdAt: owner.createdAt,
					verifiedAt: "",
					deleted: false,
				},
			]
		: data.relations.filter(
				(row) =>
					!row.deleted &&
					(row.from === asset.id || row.to === asset.id) &&
					byId.has(row.from) &&
					byId.has(row.to),
			);
	const ids = new Set(relations.flatMap((row) => [row.from, row.to]));
	const assets = [
		asset,
		...[...ids]
			.filter((id) => id !== asset.id)
			.flatMap((id) => {
				const row = byId.get(id);
				return row ? [row] : [];
			}),
	];
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
		<section className="card unified-detail-relations">
			<header className="card-header">
				<h2>
					{t("detailRelationGraph")}{" "}
					<span className="unified-detail-count">
						{new Set(assets.map((row) => row.id)).size - 1}
					</span>
				</h2>
				{!owner ? (
					<Button
						size="small"
						variant="ghost"
						onClick={() => {
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
				) : null}
			</header>
			<Suspense
				fallback={
					<p className="unified-detail-empty" role="status">
						{t("loading")}
					</p>
				}
			>
				<Graph
					wrapLabels
					root={asset}
					assets={assets}
					relations={relations}
					matches={new Set()}
					selectedEdgeId={edge}
					onSelectEdge={setEdge}
					onVisit={(row) => {
						sessionStorage.setItem("keepany-relation-return-kind", asset.kind);
						sessionStorage.setItem("keepany-relation-return-id", row.id);
						void navigate({
							to: "/assets/$kind/$id",
							params: { kind: row.kind, id: row.id },
						});
					}}
					onDeleteRelations={
						owner
							? undefined
							: (rows) => {
									setError("");
									setRemove(rows);
								}
					}
				/>
			</Suspense>
			{adding ? (
				<Dialog
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
										await saveRelationIfCurrent(row, { ...row, deleted: true });
									}
									setRemove(null);
									setEdge(null);
								})
							}
						>
							{t("deleteRelation")}
						</Button>
					</div>
				</Dialog>
			) : null}
		</section>
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
				<h2>{t("history")}</h2>
				{children}
			</header>
			{rows.length ? (
				<ol className="unified-detail-events">
					{rows.map((row) => (
						<li key={row.id}>
							<time>
								{date(
									row.eventDate || row.billDate || row.createdAt.slice(0, 10),
									i18n.language,
								)}
							</time>
							<div>
								<strong>{title(row)}</strong>
								{row.amount !== undefined && row.currency ? (
									<span>
										{asset.kind === "subscription" && row.action === "renew"
											? historyCny(row, rates) === null
												? t("subscriptionCnyMissing")
												: money(historyCny(row, rates)!, "CNY", i18n.language)
											: money(row.amount, row.currency, i18n.language)}
									</span>
								) : null}
								{row.borrower ? (
									<span>
										{t("borrower")}: {row.borrower}
									</span>
								) : null}
								{row.expectedReturnDate ? (
									<span>
										{t("itemExpectedReturnDate")}:{" "}
										{date(row.expectedReturnDate, i18n.language)}
									</span>
								) : null}
								{row.source ? <span>{row.source}</span> : null}
								{row.note ? <p>{row.note}</p> : null}
							</div>
						</li>
					))}
				</ol>
			) : (
				<p className="unified-detail-empty">{t("none")}</p>
			)}
		</section>
	);
}
