import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	Link,
	Outlet,
	useNavigate,
	useRouterState,
} from "@tanstack/react-router";
import {
	Background,
	Controls,
	MarkerType,
	ReactFlow,
	type Edge,
	type Node,
} from "@xyflow/react";
import {
	DndContext,
	PointerSensor,
	KeyboardSensor,
	closestCenter,
	useSensor,
	useSensors,
	type DragEndEvent,
} from "@dnd-kit/core";
import {
	SortableContext,
	horizontalListSortingStrategy,
	sortableKeyboardCoordinates,
	useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	ArchiveRestore,
	ArrowLeft,
	Bell,
	Boxes,
	Check,
	CircleHelp,
	CloudOff,
	GripVertical,
	LayoutDashboard,
	Menu,
	Plus,
	Search,
	Settings,
	Shield,
	Sparkles,
	Trash2,
	WalletCards,
	X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
	type Asset,
	type AssetKind,
	type Submission,
	type Task,
	actualCharge,
	dueOnCycle,
	monthlyAmount,
} from "../../../packages/domain/src";
import {
	cleanupUnreferencedFile,
	fileUrl,
	putFile,
	restoreEntity,
	save,
} from "../../../packages/local-db/src";
import { useData, seed, type Data } from "./data";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import {
	SortableNav,
	type SortableNavItem,
} from "./components/navigation/SortableNav";
import { AssetEditor, AiDialog, IntakeTools, TaskEditor } from "./workflows";

type AppContextValue = {
	data: Data;
	search: string;
	setSearch: (s: string) => void;
	notify: (s: string) => void;
};
const AppContext = createContext<AppContextValue | null>(null);
function useAppContext() {
	const value = useContext(AppContext);
	if (!value) throw Error("missing-app-context");
	return value;
}
const kinds: AssetKind[] = [
	"project",
	"account",
	"subscription",
	"item",
	"vault",
];
const icons = {
	project: Boxes,
	account: Shield,
	subscription: WalletCards,
	item: ArchiveRestore,
	vault: Shield,
};
const builtins: Record<AssetKind, string[]> = {
	project: ["website", "repository", "tool"],
	account: ["email", "phone", "social"],
	subscription: ["software", "service"],
	item: ["device", "other"],
	vault: ["other"],
};
function validKind(value: string): AssetKind {
	return kinds.includes(value as AssetKind) ? (value as AssetKind) : "project";
}
function money(amount: number, currency: string, lang: string) {
	return new Intl.NumberFormat(lang, {
		style: "currency",
		currency,
		maximumFractionDigits: currency === "JPY" ? 0 : 2,
	}).format(amount / (currency === "JPY" ? 1 : 100));
}
function date(value: string, lang: string) {
	if (!value) return "—";
	const time = new Date(`${value}T12:00:00`);
	return Number.isNaN(time.getTime())
		? value
		: new Intl.DateTimeFormat(lang, { dateStyle: "medium" }).format(time);
}
function niceCategory(value: string, t: (s: string) => string) {
	return builtins.project
		.concat(builtins.account, builtins.subscription, builtins.item)
		.includes(value)
		? t(value)
		: value;
}
function liveAssets(data: Data) {
	return data.assets.filter((a) => !a.deleted);
}

export function AppShell() {
	const data = useData();
	const { t } = useTranslation();
	const [search, setSearch] = useState("");
	const [toast, setToast] = useState("");
	const [ai, setAi] = useState(false);
	const [mobile, setMobile] = useState(false);
	const [narrow, setNarrow] = useState(
		() => window.matchMedia("(max-width: 760px)").matches,
	);
	const [pendingNavOrder, setPendingNavOrder] = useState<string[] | null>(null);
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	useEffect(() => {
		const query = window.matchMedia("(max-width: 760px)");
		const update = () => setNarrow(query.matches);
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	}, []);
	useEffect(() => {
		if (!toast) return;
		const timer = window.setTimeout(() => setToast(""), 4500);
		return () => window.clearTimeout(timer);
	}, [toast]);
	const matches = search.trim()
		? liveAssets(data)
				.filter((a) =>
					`${a.name} ${a.tags.join(" ")} ${a.url} ${a.username}`
						.toLowerCase()
						.includes(search.toLowerCase()),
				)
				.slice(0, 6)
		: [];
	const context = useMemo(
		() => ({ data, search, setSearch, notify: setToast }),
		[data, search],
	);
	const openTasks = data.tasks.filter((x) => !x.done && !x.deleted).length;
	const navigation: SortableNavItem[] = [
		{ id: "overview", to: "/", label: t("overview"), icon: LayoutDashboard },
		{
			id: "tasks",
			to: "/tasks",
			label: t("tasks"),
			icon: Bell,
			badge: openTasks,
		},
		...kinds.map((kind) => ({
			id: kind,
			to: `/assets/${kind}`,
			label: t(kind),
			icon: icons[kind],
		})),
		{ id: "intake", to: "/intake", label: t("intake"), icon: Plus },
		{ id: "trash", to: "/trash", label: t("trash"), icon: Trash2 },
	];
	const savedNavOrder = data.preferences.find(
		(p) => p.id === "sidebarOrder",
	)?.value;
	const navOrder =
		pendingNavOrder ??
		(Array.isArray(savedNavOrder)
			? savedNavOrder.filter((id): id is string => typeof id === "string")
			: []);
	useEffect(() => {
		if (
			pendingNavOrder &&
			Array.isArray(savedNavOrder) &&
			pendingNavOrder.join("\u0000") === savedNavOrder.join("\u0000")
		)
			setPendingNavOrder(null);
	}, [pendingNavOrder, savedNavOrder]);
	const orderedNavigation = [...navigation].sort((a, b) => {
		const ai = navOrder.indexOf(a.id),
			bi = navOrder.indexOf(b.id);
		return (
			(ai < 0 ? navigation.length : ai) - (bi < 0 ? navigation.length : bi)
		);
	});
	return (
		<AppContext.Provider value={context}>
			<div className="shell">
				<aside
					className={`sidebar ${mobile ? "open" : ""}`}
					inert={narrow && !mobile}
					aria-hidden={narrow && !mobile}
				>
					<div className="brand">
						<span className="brand-mark">K</span>
						<div>
							<strong>KeepAny</strong>
							<small>{t("offline")}</small>
						</div>
						<Button
							className="mobile-close"
							variant="ghost"
							size="icon"
							onClick={() => setMobile(false)}
							aria-label={t("close")}
						>
							<X size={18} />
						</Button>
					</div>
					<nav className="nav" aria-label={t("navigation")}>
						<SortableNav
							items={orderedNavigation}
							activePath={pathname}
							onOrderChange={(ids) => {
								setPendingNavOrder(ids);
								void save("preference", {
									id: "sidebarOrder",
									value: ids,
								}).catch(() => {
									setPendingNavOrder(null);
									setToast(t("error"));
								});
							}}
							onNavigate={() => setMobile(false)}
						/>
					</nav>
					<div className="side-bottom">
						<Link to="/settings" onClick={() => setMobile(false)}>
							<Settings size={18} />
							{t("settings")}
						</Link>
						<div className="side-status">
							<CloudOff size={15} />
							{t("local")}
						</div>
					</div>
				</aside>
				{mobile && (
					<button
						type="button"
						className="mobile-scrim"
						aria-label={t("close")}
						onClick={() => setMobile(false)}
					/>
				)}
				<div className="main">
					<header className="topbar">
						<Button
							className="mobile-menu"
							variant="ghost"
							size="icon"
							onClick={() => setMobile(true)}
							aria-label={t("navigation")}
						>
							<Menu size={20} />
						</Button>
						<div className="top-search">
							<Search size={17} />
							<input
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								placeholder={t("search")}
								aria-label={t("search")}
							/>
							{search && (
								<Button
									variant="ghost"
									size="icon"
									onClick={() => setSearch("")}
									aria-label={t("close")}
								>
									<X size={15} />
								</Button>
							)}
							{matches.length > 0 && (
								<div className="search-results">
									{matches.map((asset) => (
										<Link
											key={asset.id}
											to="/assets/$kind/$id"
											params={{ kind: asset.kind, id: asset.id }}
											onClick={() => setSearch("")}
										>
											<strong>{asset.name}</strong>
											<small>{t(asset.kind)}</small>
										</Link>
									))}
								</div>
							)}
						</div>
						<div className="top-actions">
							<Button variant="ghost" onClick={() => setAi(true)}>
								<Sparkles size={17} />
								<span>{t("assistant")}</span>
							</Button>
							<Link
								to="/intake"
								className="button primary"
								aria-label={t("intake")}
							>
								<Plus size={18} />
							</Link>
						</div>
					</header>
					{data.loading ? (
						<main className="page">
							<div className="notice" role="status">
								{t("loading")}
							</div>
						</main>
					) : (
						<Outlet />
					)}
				</div>
			</div>
			{data.error && (
				<div className="toast error" role="alert">
					{t("error")}
				</div>
			)}
			{toast && (
				<div className="toast" role="status">
					{toast}
				</div>
			)}
			{ai && (
				<AiDialog assets={liveAssets(data)} onClose={() => setAi(false)} />
			)}
		</AppContext.Provider>
	);
}

function PageTitle({
	eyebrow,
	title,
	subtitle,
	action,
}: {
	eyebrow?: string;
	title: string;
	subtitle?: string;
	action?: React.ReactNode;
}) {
	return (
		<div className="page-header">
			<div>
				{eyebrow && <div className="eyebrow">{eyebrow}</div>}
				<h1>{title}</h1>
				{subtitle && <p className="subtitle">{subtitle}</p>}
			</div>
			{action && <div className="actions">{action}</div>}
		</div>
	);
}

export function Overview() {
	const { data } = useAppContext();
	const { t, i18n } = useTranslation();
	const assets = liveAssets(data);
	const open = data.tasks.filter((x) => !x.done && !x.deleted);
	const upcoming = assets
		.filter((a) => a.kind === "subscription" && a.dueDate)
		.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
		.slice(0, 4);
	const totals = new Map<string, number>();
	for (const a of assets.filter(
		(x) => x.kind === "subscription" && x.status === "active",
	))
		totals.set(a.currency, (totals.get(a.currency) || 0) + monthlyAmount(a));
	return (
		<main className="page">
			<PageTitle
				eyebrow="KeepAny"
				title={t("overview")}
				subtitle={t("summary")}
				action={
					<Link className="button primary" to="/intake">
						<Plus size={17} />
						{t("add")}
					</Link>
				}
			/>
			<div className="stat-grid">
				<div className="card stat">
					<span>{t("assetCount")}</span>
					<strong>{assets.length}</strong>
				</div>
				<div className="card stat">
					<span>{t("openTasks")}</span>
					<strong>{open.length}</strong>
				</div>
				<div className="card stat">
					<span>{t("monthly")}</span>
					<strong>
						{totals.size
							? [...totals]
									.map(([c, n]) => money(n, c, i18n.language))
									.join(" · ")
							: "—"}
					</strong>
					<small>{t("balance")}</small>
				</div>
			</div>
			<div className="card-grid">
				<section className="card">
					<div className="card-header">
						<h2>{t("tasks")}</h2>
						<Link to="/tasks">{t("all")} →</Link>
					</div>
					{open.length ? (
						<div className="list">
							{open.slice(0, 5).map((task) => (
								<div className="list-row" key={task.id}>
									<Bell size={18} />
									<div>
										<strong>{task.name}</strong>
										<small>{date(task.dueDate, i18n.language)}</small>
									</div>
								</div>
							))}
						</div>
					) : (
						<Empty />
					)}
				</section>
				<section className="card">
					<div className="card-header">
						<h2>{t("due")}</h2>
						<Link to="/assets/$kind" params={{ kind: "subscription" }}>
							{t("all")} →
						</Link>
					</div>
					{upcoming.length ? (
						<div className="list">
							{upcoming.map((a) => (
								<Link
									className="list-row"
									key={a.id}
									to="/assets/$kind/$id"
									params={{ kind: a.kind, id: a.id }}
								>
									<WalletCards size={18} />
									<div>
										<strong>{a.name}</strong>
										<small>{date(a.dueDate, i18n.language)}</small>
									</div>
									<b>{money(a.amount, a.currency, i18n.language)}</b>
								</Link>
							))}
						</div>
					) : (
						<Empty />
					)}
				</section>
			</div>
			<section className="card">
				<div className="card-header">
					<h2>{t("recent")}</h2>
				</div>
				{assets.length ? (
					<div className="list">
						{[...assets]
							.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
							.slice(0, 6)
							.map((a) => (
								<AssetRow key={a.id} asset={a} />
							))}
					</div>
				) : (
					<Empty />
				)}
			</section>
		</main>
	);
}

function Empty({ hint = true }: { hint?: boolean }) {
	const { t } = useTranslation();
	return (
		<div className="empty">
			<CircleHelp size={24} />
			<strong>{t("empty")}</strong>
			{hint && <span>{t("emptyHint")}</span>}
		</div>
	);
}
function AssetRow({ asset }: { asset: Asset }) {
	const { t, i18n } = useTranslation();
	const Icon = icons[asset.kind];
	return (
		<Link
			className="list-row"
			to="/assets/$kind/$id"
			params={{ kind: asset.kind, id: asset.id }}
			onClick={() =>
				sessionStorage.setItem(
					`keepany-scroll-${asset.kind}`,
					String(window.scrollY),
				)
			}
		>
			<span className="row-icon">
				<Icon size={18} />
			</span>
			<div className="row-main">
				<strong>{asset.name}</strong>
				<small>
					{niceCategory(asset.category, t)}
					{asset.description ? ` · ${asset.description}` : ""}
				</small>
			</div>
			{asset.kind === "subscription" && (
				<b>{money(asset.amount, asset.currency, i18n.language)}</b>
			)}
			{asset.tags.slice(0, 2).map((tag) => (
				<span className="chip" key={tag}>
					{tag}
				</span>
			))}
		</Link>
	);
}

function SortablePill({
	id,
	label,
	active,
	onClick,
}: {
	id: string;
	label: string;
	active: boolean;
	onClick: () => void;
}) {
	const { t } = useTranslation();
	const { attributes, listeners, setNodeRef, transform, transition } =
		useSortable({ id });
	return (
		<div
			ref={setNodeRef}
			className="sortable-pill"
			style={{ transform: CSS.Transform.toString(transform), transition }}
		>
			<button
				type="button"
				className="drag-handle"
				{...attributes}
				{...listeners}
				aria-label={`${label} ${t("drag")}`}
			>
				<GripVertical size={14} />
			</button>
			<button
				type="button"
				className={active ? "active" : ""}
				aria-pressed={active}
				onClick={onClick}
			>
				{label}
			</button>
		</div>
	);
}
function CategoryStrip({
	kind,
	chosen,
	choose,
}: {
	kind: AssetKind;
	chosen: string;
	choose: (x: string) => void;
}) {
	const { data, notify } = useAppContext();
	const { t } = useTranslation();
	const categoryNames = [
		...builtins[kind],
		...data.categories
			.filter((c) => c.kind === kind && !c.deleted)
			.map((c) => c.name),
	].filter((v, i, a) => a.indexOf(v) === i);
	const preference = data.preferences.find(
		(p) => p.id === `categoryOrder-${kind}`,
	);
	const savedOrder = Array.isArray(preference?.value)
		? (preference.value as string[])
		: [];
	const ordered = [...categoryNames].sort((a, b) => {
		const ai = savedOrder.indexOf(a),
			bi = savedOrder.indexOf(b);
		return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
	});
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);
	const [manage, setManage] = useState(false);
	const [name, setName] = useState("");
	async function onDragEnd(e: DragEndEvent) {
		if (!e.over || e.active.id === e.over.id) return;
		const from = ordered.indexOf(String(e.active.id)),
			to = ordered.indexOf(String(e.over.id));
		const next = [...ordered];
		next.splice(to, 0, next.splice(from, 1)[0]);
		await save("preference", { id: `categoryOrder-${kind}`, value: next });
	}
	async function addCategory() {
		const trimmed = name.trim();
		if (!trimmed || categoryNames.includes(trimmed)) return;
		await save("category", {
			id: crypto.randomUUID(),
			kind,
			name: trimmed,
			order: categoryNames.length,
			deleted: false,
		});
		setName("");
		setManage(false);
		choose(trimmed);
		notify(t("saved"));
	}
	return (
		<>
			<div className="tabs">
				<button
					type="button"
					className={chosen === "" ? "active" : ""}
					onClick={() => choose("")}
				>
					{t("all")}
				</button>
				<DndContext
					sensors={sensors}
					collisionDetection={closestCenter}
					onDragEnd={onDragEnd}
				>
					<SortableContext
						items={ordered}
						strategy={horizontalListSortingStrategy}
					>
						{ordered.map((id) => (
							<SortablePill
								key={id}
								id={id}
								label={niceCategory(id, t)}
								active={chosen === id}
								onClick={() => choose(id)}
							/>
						))}
					</SortableContext>
				</DndContext>
				<Button variant="ghost" size="small" onClick={() => setManage(true)}>
					<Plus size={14} />
					{t("manage")}
				</Button>
			</div>
			{manage && (
				<Dialog title={t("category")} onClose={() => setManage(false)}>
					<div className="field">
						<label htmlFor="category-name">{t("categoryName")}</label>
						<input
							id="category-name"
							value={name}
							maxLength={60}
							onChange={(e) => setName(e.target.value)}
						/>
					</div>
					<div className="actions">
						<Button onClick={addCategory} disabled={!name.trim()}>
							{t("save")}
						</Button>
					</div>
					<div className="list">
						{data.categories
							.filter((c) => c.kind === kind && !c.deleted)
							.map((c) => (
								<div className="list-row" key={c.id}>
									<strong>{c.name}</strong>
									<Button
										variant="danger"
										size="small"
										onClick={async () => {
											await save("category", { ...c, deleted: true });
											if (chosen === c.name) choose("");
										}}
									>
										{t("remove")}
									</Button>
								</div>
							))}
					</div>
					<p className="subtitle">{t("categoryHelp")}</p>
				</Dialog>
			)}
		</>
	);
}

export function AssetList() {
	const { kind: rawKind } = (useRouterState({
		select: (s) => s.matches.at(-1)?.params,
	}) ?? {}) as { kind?: string };
	const kind = validKind(rawKind ?? "project");
	const { data, search } = useAppContext();
	const { t } = useTranslation();
	const [categories, setCategories] = useState<Record<string, string>>(() =>
		Object.fromEntries(
			kinds.map((k) => [
				k,
				sessionStorage.getItem(`keepany-category-${k}`) || "",
			]),
		),
	);
	const category = categories[kind] || "";
	const choose = (value: string) => {
		sessionStorage.setItem(`keepany-category-${kind}`, value);
		setCategories((prev) => ({ ...prev, [kind]: value }));
	};
	const [edit, setEdit] = useState(false);
	const assets = liveAssets(data).filter(
		(a) =>
			a.kind === kind &&
			(!category || a.category === category) &&
			(!search ||
				`${a.name} ${a.tags.join(" ")} ${a.url} ${a.username}`
					.toLowerCase()
					.includes(search.toLowerCase())),
	);
	const restored = useRef("");
	useEffect(() => {
		if (data.loading || !assets.length || restored.current === kind) return;
		restored.current = kind;
		const y = Number(sessionStorage.getItem(`keepany-scroll-${kind}`) || 0);
		if (y) {
			const frame = requestAnimationFrame(() => window.scrollTo(0, y));
			return () => cancelAnimationFrame(frame);
		}
	}, [kind, data.loading, assets.length]);
	return (
		<main className="page">
			<PageTitle
				eyebrow="KeepAny"
				title={t(kind)}
				subtitle={t("summary")}
				action={
					<Button variant="primary" onClick={() => setEdit(true)}>
						<Plus size={17} />
						{t("add")}
					</Button>
				}
			/>
			<CategoryStrip kind={kind} chosen={category} choose={choose} />
			<section className="card">
				{assets.length ? (
					<div className="list">
						{assets.map((a) => (
							<AssetRow asset={a} key={a.id} />
						))}
					</div>
				) : (
					<Empty hint={!search} />
				)}
			</section>
			{edit && (
				<AssetEditor
					kind={kind}
					categories={data.categories}
					onClose={() => setEdit(false)}
				/>
			)}
		</main>
	);
}

function ImageTile({ id }: { id: string }) {
	const [url, setUrl] = useState("");
	useEffect(() => {
		let current = "";
		fileUrl(id).then((v) => {
			current = v;
			setUrl(v);
		});
		return () => {
			if (current) URL.revokeObjectURL(current);
		};
	}, [id]);
	return url ? <img src={url} alt="" className="asset-image" /> : null;
}

function SubmissionRow({ submission }: { submission: Submission }) {
	const { t, i18n } = useTranslation();
	const { notify } = useAppContext();
	const [status, setStatus] = useState<Submission["status"]>(submission.status);
	const [evidence, setEvidence] = useState(submission.evidence);
	const [submittedAt, setSubmittedAt] = useState(submission.submittedAt);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const changed =
		status !== submission.status ||
		evidence !== submission.evidence ||
		submittedAt !== submission.submittedAt;
	async function store() {
		if (status !== "planned" && !evidence.trim()) {
			setError(t("evidenceRequired"));
			return;
		}
		if (status === "indexed" && !/^https?:\/\/\S+$/i.test(evidence.trim())) {
			setError(t("invalid"));
			return;
		}
		if (status !== "planned" && !submittedAt) {
			setError(t("submittedDateRequired"));
			return;
		}
		setBusy(true);
		setError("");
		try {
			const verifiedAt = ["indexed", "rejected"].includes(status)
				? new Date().toISOString().slice(0, 10)
				: "";
			await save("submission", {
				...submission,
				status,
				evidence: evidence.trim(),
				submittedAt: status === "planned" ? "" : submittedAt,
				verifiedAt,
			});
			notify(t("saved"));
		} catch {
			setError(t("error"));
		} finally {
			setBusy(false);
		}
	}
	return (
		<tr>
			<td>
				<a href={submission.url} target="_blank" rel="noopener noreferrer">
					{submission.name}
				</a>
			</td>
			<td>
				<select
					aria-label={`${submission.name} ${t("status")}`}
					value={status}
					onChange={(e) => setStatus(e.target.value as Submission["status"])}
				>
					{(
						[
							"planned",
							"submitted",
							"review",
							"indexed",
							"verify",
							"rejected",
						] as const
					).map((value) => (
						<option key={value} value={value}>
							{t(value)}
						</option>
					))}
				</select>
			</td>
			<td>
				<input
					type="date"
					aria-label={`${submission.name} ${t("submittedAt")}`}
					value={submittedAt}
					onChange={(e) => setSubmittedAt(e.target.value)}
				/>
			</td>
			<td>{date(submission.verifiedAt, i18n.language)}</td>
			<td>
				<input
					aria-label={`${submission.name} ${t("evidence")}`}
					value={evidence}
					onChange={(e) => setEvidence(e.target.value)}
				/>
				{error && (
					<small className="field-error" role="alert">
						{error}
					</small>
				)}
			</td>
			<td>
				<Button
					size="small"
					disabled={!changed || busy}
					onClick={() => void store()}
				>
					{t("save")}
				</Button>
			</td>
		</tr>
	);
}

export function AssetDetail() {
	const params = (useRouterState({ select: (s) => s.matches.at(-1)?.params }) ??
		{}) as { kind?: string; id?: string };
	const kind = validKind(params.kind ?? "project");
	const { data, notify } = useAppContext();
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const imageInput = useRef<HTMLInputElement>(null);
	const asset = data.assets.find(
		(a) => a.id === params.id && a.kind === kind && !a.deleted,
	);
	const [edit, setEdit] = useState(false);
	const [relationEdit, setRelationEdit] = useState(false);
	const [submissionEdit, setSubmissionEdit] = useState(false);
	const [taskEdit, setTaskEdit] = useState(false);
	const [uploading, setUploading] = useState(false);
	const [pendingImage, setPendingImage] = useState<File | null>(null);
	const [pendingImageUrl, setPendingImageUrl] = useState("");
	const [pendingImageStatus, setPendingImageStatus] = useState<
		"loading" | "ready" | "error"
	>("loading");
	useEffect(() => {
		setPendingImageStatus("loading");
		if (!pendingImage) {
			setPendingImageUrl("");
			return;
		}
		const url = URL.createObjectURL(pendingImage);
		setPendingImageUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [pendingImage]);
	const [relationTarget, setRelationTarget] = useState("");
	const [relationLabel, setRelationLabel] = useState("");
	const [submissionName, setSubmissionName] = useState("");
	const [submissionUrl, setSubmissionUrl] = useState("");
	const [historyNote, setHistoryNote] = useState("");
	const relations = data.relations.filter(
		(r) => !r.deleted && (r.from === asset?.id || r.to === asset?.id),
	);
	const related = relations
		.map((r) =>
			data.assets.find(
				(a) => a.id === (r.from === asset?.id ? r.to : r.from) && !a.deleted,
			),
		)
		.filter((x): x is Asset => !!x);
	const ownTasks = data.tasks.filter(
		(x) => !x.deleted && x.assetId === asset?.id,
	);
	const submissions = data.submissions.filter(
		(x) => !x.deleted && x.assetId === asset?.id,
	);
	const histories = data.history
		.filter((x) => !x.deleted && x.assetId === asset?.id)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	if (!asset)
		return (
			<main className="page">
				<PageTitle title={t("noMatches")} />
				<Link to="/assets/$kind" params={{ kind }}>
					{t("back")}
				</Link>
			</main>
		);
	const dueCharge =
		asset.kind === "subscription" && asset.dueDate
			? actualCharge(asset, asset.dueDate)
			: null;
	const run = async (fn: () => Promise<unknown>) => {
		try {
			await fn();
			notify(t("saved"));
		} catch {
			notify(t("error"));
		}
	};
	async function addRelation() {
		if (!asset) return;
		const target = data.assets.find((a) => a.id === relationTarget);
		if (!target || target.id === asset.id || !relationLabel.trim()) return;
		await save("relation", {
			id: crypto.randomUUID(),
			from: asset.id,
			to: target.id,
			label: relationLabel.trim(),
			createdAt: new Date().toISOString(),
			verifiedAt: "",
			deleted: false,
		});
		setRelationEdit(false);
		setRelationLabel("");
		setRelationTarget("");
	}
	async function addSubmission() {
		if (
			!asset ||
			!submissionName.trim() ||
			!/^https?:\/\//i.test(submissionUrl)
		)
			return;
		await save("submission", {
			id: crypto.randomUUID(),
			assetId: asset.id,
			name: submissionName.trim(),
			url: submissionUrl,
			status: "planned",
			submittedAt: "",
			verifiedAt: "",
			evidence: "",
			deleted: false,
		});
		setSubmissionEdit(false);
		setSubmissionName("");
		setSubmissionUrl("");
	}
	async function addImage(file: File) {
		if (!asset) return;
		setUploading(true);
		let fileId = "";
		try {
			fileId = await putFile(file);
			await save("asset", {
				...asset,
				attachments: [...asset.attachments, fileId],
				updatedAt: new Date().toISOString(),
			});
			setPendingImage(null);
			notify(t("saved"));
		} catch {
			if (fileId) await cleanupUnreferencedFile(fileId).catch(() => false);
			notify(t("uploadError"));
		} finally {
			setUploading(false);
		}
	}
	async function recordAction(
		action: "loan" | "return" | "renew" | "maintenance",
	) {
		if (!asset) return;
		const now = new Date().toISOString();
		let update = { ...asset, updatedAt: now };
		let note = historyNote.trim();
		if (action === "renew" && asset.dueDate) {
			const anchor = asset.billingAnchor || asset.dueDate;
			const count = (asset.renewalCount || 0) + 1;
			const charge = actualCharge(asset, asset.dueDate);
			update = {
				...update,
				billingAnchor: anchor,
				renewalCount: count,
				dueDate: dueOnCycle(anchor, asset.cycle, asset.interval, count),
			};
			note =
				note ||
				`${charge === null ? "—" : money(charge, asset.currency, i18n.language)} · ${asset.dueDate}`;
		}
		if (action === "loan")
			update = {
				...update,
				status: "loaned" as const,
				borrower: historyNote.trim(),
			};
		if (action === "return")
			update = { ...update, status: "active" as const, borrower: "" };
		await save("asset", update);
		await save("history", {
			id: crypto.randomUUID(),
			assetId: asset.id,
			action,
			note,
			createdAt: now,
			deleted: false,
		});
		setHistoryNote("");
	}
	async function createImpact() {
		if (!asset) return;
		for (const linked of related) {
			const key = `impact:${asset.id}:${linked.id}`;
			if (data.tasks.some((x) => !x.deleted && !x.done && x.dedupeKey === key))
				continue;
			await save("task", {
				id: crypto.randomUUID(),
				name: `${t("checkConnection")}: ${linked.name}`,
				assetId: linked.id,
				dueDate: "",
				done: false,
				completedAt: "",
				createdAt: new Date().toISOString(),
				dedupeKey: key,
				deleted: false,
			});
		}
		notify(t("saved"));
	}
	return (
		<main className="page">
			<div className="page-header">
				<div>
					<Link className="back-link" to="/assets/$kind" params={{ kind }}>
						<ArrowLeft size={16} />
						{t("back")}
					</Link>
					<div className="eyebrow">
						{t(kind)} · {niceCategory(asset.category, t)}
					</div>
					<h1>{asset.name}</h1>
					<p className="subtitle">
						{asset.description || asset.url || t("local")}
					</p>
				</div>
				<div className="actions">
					<Button onClick={() => setEdit(true)}>{t("edit")}</Button>
					<Button
						variant="danger"
						onClick={() => {
							if (window.confirm(t("deleteConfirm")))
								run(async () => {
									await save("asset", {
										...asset,
										deleted: true,
										updatedAt: new Date().toISOString(),
									});
									await navigate({ to: "/assets/$kind", params: { kind } });
								});
						}}
					>
						{t("delete")}
					</Button>
				</div>
			</div>
			<div className="detail-grid">
				<section className="card">
					<div className="card-header">
						<h2>{t("profile")}</h2>
					</div>
					<dl className="facts">
						<div>
							<dt>{t("category")}</dt>
							<dd>{niceCategory(asset.category, t) || "—"}</dd>
						</div>
						{asset.url && (
							<div>
								<dt>{t("url")}</dt>
								<dd>
									<a href={asset.url} target="_blank" rel="noopener noreferrer">
										{asset.url}
									</a>
								</dd>
							</div>
						)}
						{asset.username && (
							<div>
								<dt>{t("username")}</dt>
								<dd>{asset.username}</dd>
							</div>
						)}
						{asset.contact && (
							<div>
								<dt>{t("contact")}</dt>
								<dd>{asset.contact}</dd>
							</div>
						)}
						{asset.kind === "subscription" && (
							<>
								<div>
									<dt>{t("amount")}</dt>
									<dd>{money(asset.amount, asset.currency, i18n.language)}</dd>
								</div>
								<div>
									<dt>{t("monthly")}</dt>
									<dd>
										{money(monthlyAmount(asset), asset.currency, i18n.language)}
									</dd>
								</div>
								<div>
									<dt>{t("cycle")}</dt>
									<dd>
										{asset.interval} {t(asset.cycle)}
									</dd>
								</div>
								<div>
									<dt>{t("dueDate")}</dt>
									<dd>{date(asset.dueDate, i18n.language)}</dd>
								</div>
								<div>
									<dt>{t("actualCharge")}</dt>
									<dd>
										{dueCharge === null
											? "—"
											: money(dueCharge, asset.currency, i18n.language)}
									</dd>
								</div>
								{asset.trialEndsAt && (
									<div>
										<dt>{t("trialEndsAt")}</dt>
										<dd>{date(asset.trialEndsAt, i18n.language)}</dd>
									</div>
								)}
								{asset.discountUntil && (
									<div>
										<dt>{t("discountUntil")}</dt>
										<dd>
											{date(asset.discountUntil, i18n.language)} ·{" "}
											{money(
												asset.discountAmount,
												asset.currency,
												i18n.language,
											)}
										</dd>
									</div>
								)}
							</>
						)}
						{asset.kind === "item" && (
							<>
								<div>
									<dt>{t("purchaseDate")}</dt>
									<dd>{date(asset.purchaseDate, i18n.language)}</dd>
								</div>
								<div>
									<dt>{t("warrantyDate")}</dt>
									<dd>{date(asset.warrantyDate, i18n.language)}</dd>
								</div>
								<div>
									<dt>{t("location")}</dt>
									<dd>{asset.location || "—"}</dd>
								</div>
							</>
						)}
						{asset.status && (
							<div>
								<dt>{t("status")}</dt>
								<dd>
									<span className="chip">{t(asset.status)}</span>
								</dd>
							</div>
						)}
					</dl>
					{asset.tags.length > 0 && (
						<div className="chips">
							{asset.tags.map((tag) => (
								<span className="chip" key={tag}>
									{tag}
								</span>
							))}
						</div>
					)}
					{asset.longDescription && (
						<details className="more">
							<summary>{t("more")}</summary>
							<p>{asset.longDescription}</p>
						</details>
					)}
					{asset.notes && <p className="note">{asset.notes}</p>}
				</section>
				<section className="card">
					<div className="card-header">
						<h2>{t("attachments")}</h2>
						<Button
							size="small"
							disabled={uploading || asset.attachments.length >= 20}
							onClick={() => imageInput.current?.click()}
						>
							{uploading ? t("loading") : t("addPhoto")}
						</Button>
						<input
							ref={imageInput}
							type="file"
							accept="image/jpeg,image/png,image/webp,image/gif"
							hidden
							tabIndex={-1}
							aria-label={t("addPhoto")}
							onChange={(e) => {
								const file = e.target.files?.[0];
								if (file) {
									if (
										![
											"image/jpeg",
											"image/png",
											"image/webp",
											"image/gif",
										].includes(file.type) ||
										file.size === 0 ||
										file.size > 20 * 1024 * 1024
									)
										notify(t("uploadError"));
									else {
										setPendingImageUrl("");
										setPendingImageStatus("loading");
										setPendingImage(file);
									}
								}
								e.target.value = "";
							}}
						/>
					</div>
					{asset.attachments.length ? (
						<div className="image-grid">
							{asset.attachments.map((id) => (
								<div key={id} className="image-item">
									<ImageTile id={id} />
									<Button
										variant="danger"
										size="small"
										onClick={() =>
											run(async () => {
												await save("asset", {
													...asset,
													attachments: asset.attachments.filter(
														(x) => x !== id,
													),
													updatedAt: new Date().toISOString(),
												});
												await cleanupUnreferencedFile(id).catch(() => false);
											})
										}
									>
										{t("removeImage")}
									</Button>
								</div>
							))}
						</div>
					) : (
						<Empty hint={false} />
					)}
				</section>
			</div>
			<div className="detail-grid">
				<section className="card">
					<div className="card-header">
						<h2>{t("relations")}</h2>
						<Button
							variant="ghost"
							size="small"
							onClick={() => setRelationEdit(true)}
						>
							<Plus size={14} />
							{t("addRelation")}
						</Button>
					</div>
					{relations.length ? (
						<>
							<div className="graph">
								<ReactFlow
									fitView
									nodes={
										[
											{
												id: asset.id,
												position: { x: 180, y: 100 },
												data: { label: asset.name },
												type: "default",
											},
											...related.map((a, i) => ({
												id: a.id,
												position: {
													x: 20 + (i % 3) * 180,
													y: 240 + Math.floor(i / 3) * 110,
												},
												data: { label: a.name },
												type: "default",
											})),
										] as Node[]
									}
									edges={relations.map(
										(r) =>
											({
												id: r.id,
												source: r.from,
												target: r.to,
												label: r.label,
												markerEnd: { type: MarkerType.ArrowClosed },
											}) as Edge,
									)}
									onNodeClick={(_, node) => {
										const target = data.assets.find((a) => a.id === node.id);
										if (target)
											void navigate({
												to: "/assets/$kind/$id",
												params: { kind: target.kind, id: target.id },
											});
									}}
									nodesDraggable={false}
									nodesConnectable={false}
								>
									<Background />
									<Controls showInteractive={false} />
								</ReactFlow>
							</div>
							<div className="list">
								{related.map((a) => (
									<AssetRow key={a.id} asset={a} />
								))}
							</div>
						</>
					) : (
						<Empty hint={false} />
					)}
				</section>
				<section className="card">
					<div className="card-header">
						<h2>{t("tasks")}</h2>
						<Button
							variant="ghost"
							size="small"
							onClick={() => setTaskEdit(true)}
						>
							<Plus size={14} />
							{t("add")}
						</Button>
					</div>
					{ownTasks.length ? (
						<div className="list">
							{ownTasks.map((task) => (
								<TaskRow key={task.id} task={task} />
							))}
						</div>
					) : (
						<Empty hint={false} />
					)}
					{asset.kind === "account" && related.length > 0 && (
						<div className="notice">
							<strong>{t("impact")}</strong>
							<p>{t("impactHint")}</p>
							<Button size="small" onClick={() => void createImpact()}>
								{t("makeChecklist")}
							</Button>
						</div>
					)}
				</section>
			</div>
			{asset.kind === "project" && (
				<section className="card">
					<div className="card-header">
						<h2>{t("backlinks")}</h2>
						<Button
							variant="ghost"
							size="small"
							onClick={() => setSubmissionEdit(true)}
						>
							<Plus size={14} />
							{t("addSubmission")}
						</Button>
					</div>
					{submissions.length ? (
						<div className="table-wrap">
							<table>
								<thead>
									<tr>
										<th>{t("name")}</th>
										<th>{t("status")}</th>
										<th>{t("submittedAt")}</th>
										<th>{t("verifiedAt")}</th>
										<th>{t("evidence")}</th>
										<th>{t("operation")}</th>
									</tr>
								</thead>
								<tbody>
									{submissions.map((s) => (
										<SubmissionRow key={s.id} submission={s} />
									))}
								</tbody>
							</table>
						</div>
					) : (
						<Empty hint={false} />
					)}
				</section>
			)}
			{(asset.kind === "item" || asset.kind === "subscription") && (
				<section className="card">
					<div className="card-header">
						<h2>{t("history")}</h2>
					</div>
					<div className="toolbar">
						{asset.kind === "subscription" ? (
							<Button
								disabled={asset.status !== "active" || !asset.dueDate}
								onClick={() => void run(() => recordAction("renew"))}
							>
								{t("renew")}
							</Button>
						) : (
							<>
								<Button
									onClick={() =>
										void run(() =>
											recordAction(
												asset.status === "loaned" ? "return" : "loan",
											),
										)
									}
								>
									{t(asset.status === "loaned" ? "return" : "loan")}
								</Button>
								<Button
									onClick={() => void run(() => recordAction("maintenance"))}
								>
									{t("maintenance")}
								</Button>
							</>
						)}
						<input
							value={historyNote}
							onChange={(e) => setHistoryNote(e.target.value)}
							placeholder={asset.kind === "item" ? t("borrower") : t("notes")}
							aria-label={t("notes")}
						/>
					</div>
					{histories.length ? (
						<div className="list">
							{histories.map((h) => (
								<div className="list-row" key={h.id}>
									<Check size={17} />
									<div>
										<strong>{t(h.action)}</strong>
										<small>
											{new Intl.DateTimeFormat(i18n.language, {
												dateStyle: "medium",
											}).format(new Date(h.createdAt))}
											{h.note && ` · ${h.note}`}
										</small>
									</div>
								</div>
							))}
						</div>
					) : (
						<Empty hint={false} />
					)}
				</section>
			)}
			{edit && (
				<AssetEditor
					kind={kind}
					asset={asset}
					categories={data.categories}
					onClose={() => setEdit(false)}
				/>
			)}
			{taskEdit && (
				<TaskEditor assetId={asset.id} onClose={() => setTaskEdit(false)} />
			)}
			{relationEdit && (
				<Dialog title={t("addRelation")} onClose={() => setRelationEdit(false)}>
					<div className="form-grid">
						<div className="field">
							<label htmlFor="relation-target">{t("target")}</label>
							<select
								id="relation-target"
								value={relationTarget}
								onChange={(e) => setRelationTarget(e.target.value)}
							>
								<option value="">{t("selectAsset")}</option>
								{liveAssets(data)
									.filter((a) => a.id !== asset.id)
									.map((a) => (
										<option key={a.id} value={a.id}>
											{a.name}
										</option>
									))}
							</select>
						</div>
						<div className="field">
							<label htmlFor="relation-label">{t("relationLabel")}</label>
							<input
								id="relation-label"
								value={relationLabel}
								onChange={(e) => setRelationLabel(e.target.value)}
							/>
						</div>
					</div>
					<div className="actions">
						<Button
							variant="primary"
							disabled={!relationTarget || !relationLabel.trim()}
							onClick={() => void run(addRelation)}
						>
							{t("save")}
						</Button>
					</div>
				</Dialog>
			)}
			{submissionEdit && (
				<Dialog
					title={t("addSubmission")}
					onClose={() => setSubmissionEdit(false)}
				>
					<div className="form-grid">
						<div className="field">
							<label htmlFor="submission-name">{t("name")}</label>
							<input
								id="submission-name"
								value={submissionName}
								onChange={(e) => setSubmissionName(e.target.value)}
							/>
						</div>
						<div className="field">
							<label htmlFor="submission-url">{t("url")}</label>
							<input
								id="submission-url"
								type="url"
								value={submissionUrl}
								onChange={(e) => setSubmissionUrl(e.target.value)}
							/>
						</div>
					</div>
					<div className="actions">
						<Button
							variant="primary"
							disabled={
								!submissionName.trim() || !/^https?:\/\//i.test(submissionUrl)
							}
							onClick={() => void run(addSubmission)}
						>
							{t("save")}
						</Button>
					</div>
				</Dialog>
			)}
			{pendingImage && (
				<Dialog title={t("preview")} onClose={() => setPendingImage(null)}>
					{pendingImageUrl && (
						<img
							className="image-preview"
							src={pendingImageUrl}
							alt={pendingImage.name}
							onLoad={() => setPendingImageStatus("ready")}
							onError={() => setPendingImageStatus("error")}
						/>
					)}
					<p>{pendingImage.name}</p>
					{pendingImageStatus === "error" && (
						<p role="alert">{t("uploadError")}</p>
					)}
					<div className="actions">
						<Button onClick={() => setPendingImage(null)}>{t("cancel")}</Button>
						<Button
							variant="primary"
							disabled={uploading || pendingImageStatus !== "ready"}
							onClick={() => void addImage(pendingImage)}
						>
							{uploading ? t("loading") : t("confirm")}
						</Button>
					</div>
				</Dialog>
			)}
		</main>
	);
}

function TaskRow({ task }: { task: Task }) {
	const { t, i18n } = useTranslation();
	const { notify } = useAppContext();
	return (
		<div className="list-row">
			<Button
				size="icon"
				variant="ghost"
				aria-label={t(task.done ? "reopen" : "complete")}
				onClick={async () => {
					await save("task", {
						...task,
						done: !task.done,
						completedAt: task.done ? "" : new Date().toISOString(),
					});
					notify(t("saved"));
				}}
			>
				{task.done ? <Check size={18} /> : <span className="check-circle" />}
			</Button>
			<div>
				<strong className={task.done ? "done" : ""}>{task.name}</strong>
				<small>{date(task.dueDate, i18n.language)}</small>
			</div>
			<span className="chip">{t(task.done ? "done" : "pending")}</span>
		</div>
	);
}
export function TaskPage() {
	const { data } = useAppContext();
	const { t } = useTranslation();
	const [edit, setEdit] = useState(false);
	const tasks = data.tasks
		.filter((x) => !x.deleted)
		.sort(
			(a, b) =>
				Number(a.done) - Number(b.done) || a.dueDate.localeCompare(b.dueDate),
		);
	return (
		<main className="page">
			<PageTitle
				title={t("tasks")}
				action={
					<Button variant="primary" onClick={() => setEdit(true)}>
						<Plus size={17} />
						{t("newTask")}
					</Button>
				}
			/>
			<section className="card">
				{tasks.length ? (
					<div className="list">
						{tasks.map((task) => (
							<TaskRow task={task} key={task.id} />
						))}
					</div>
				) : (
					<Empty />
				)}
			</section>
			{edit && <TaskEditor onClose={() => setEdit(false)} />}
		</main>
	);
}
export function IntakePage() {
	const { t } = useTranslation();
	return (
		<main className="page">
			<PageTitle title={t("intake")} subtitle={t("storageHint")} />
			<IntakeTools />
		</main>
	);
}
export function TrashPage() {
	const { data, notify } = useAppContext();
	const { t } = useTranslation();
	const assets = data.assets.filter((a) => a.deleted);
	return (
		<main className="page">
			<PageTitle title={t("trash")} />
			<section className="card">
				{assets.length ? (
					<div className="list">
						{assets.map((a) => (
							<div className="list-row" key={a.id}>
								<Trash2 size={18} />
								<div>
									<strong>{a.name}</strong>
									<small>{t(a.kind)}</small>
								</div>
								<Button
									size="small"
									onClick={async () => {
										await restoreEntity("asset", a.id);
										notify(t("saved"));
									}}
								>
									{t("restore")}
								</Button>
							</div>
						))}
					</div>
				) : (
					<Empty hint={false} />
				)}
			</section>
		</main>
	);
}
export function SettingsPage() {
	const { data, notify } = useAppContext();
	const { t, i18n } = useTranslation();
	const [persistent, setPersistent] = useState<boolean | null>(null);
	const [requested, setRequested] = useState(false);
	useEffect(() => {
		void navigator.storage?.persisted?.().then(setPersistent);
	}, []);
	return (
		<main className="page">
			<PageTitle title={t("settings")} />
			<div className="card-grid">
				<section className="card padded">
					<h2>{t("language")}</h2>
					<select
						value={i18n.language}
						onChange={(e) => {
							const value = e.target.value;
							localStorage.setItem("keepany-language", value);
							void i18n.changeLanguage(value);
						}}
					>
						<option value="zh-CN">简体中文</option>
						<option value="en">English</option>
					</select>
				</section>
				<section className="card padded">
					<h2>{t("storage")}</h2>
					<p>{t("storageHint")}</p>
					<div className="actions">
						<Button
							onClick={async () => {
								const value = await navigator.storage?.persist?.();
								setRequested(true);
								setPersistent(Boolean(value));
								notify(t(value ? "persistent" : "persistDenied"));
							}}
						>
							{t("persist")}
						</Button>
						<Link className="button" to="/intake">
							{t("backup")}
						</Link>
					</div>
					{(persistent === true || requested) && (
						<small>{t(persistent ? "persistent" : "persistDenied")}</small>
					)}
				</section>
			</div>
			<section className="card padded">
				<h2>{t("trial")}</h2>
				<p>{t("emptyHint")}</p>
				<Button
					disabled={data.assets.length > 0}
					onClick={async () => {
						await seed();
						notify(t("saved"));
					}}
				>
					{t("loadSample")}
				</Button>
			</section>
		</main>
	);
}
