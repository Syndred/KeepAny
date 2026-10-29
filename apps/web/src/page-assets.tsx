import { Link, useNavigate } from "@tanstack/react-router";
import {
	ArrowRight,
	CalendarDays,
	Cloud,
	Clock,
	CreditCard,
	Globe,
	Package,
	Plus,
	Search,
	ShieldCheck,
	Wallet,
	Wrench,
} from "lucide-react";
import {
	lazy,
	Suspense,
	useEffect,
	useMemo,
	useState,
	type FormEvent,
	type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { historyAssetIds, type AssetKind } from "../../../packages/domain/src";
import { buildAssetExpenses } from "./asset-expenses";
import { AssetViewToggle, useAssetView } from "./components/AssetViewToggle";
import { AssetThumbnail } from "./components/AssetThumbnail";
import { MoneyTotal, RemainingDays } from "./components/AssetMetrics";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Select, SelectOption } from "./components/ui/select";
import { CategoryStrip, LibraryCard, ProjectCard } from "./page-asset-list";
import { matchesAssetSearch } from "./asset-search";
import { buildWorkspaceSummary } from "./workspace-summary";
import {
	date,
	Empty,
	liveAssets,
	money,
	niceCategory,
	PageTitle,
	useAppContext,
} from "./view-shared";
import { readWorkspaceReturn, workspaceReturnKey } from "./workspace-return";
import "./assets-workbench.css";

const AssetEditor = lazy(() =>
	import("./workflow-asset-editor").then((module) => ({
		default: module.AssetEditor,
	})),
);
export type AssetsSection = "overview" | "online" | "physical";
export function AssetsNavigation({ section }: { section?: AssetsSection }) {
	const { t } = useTranslation();
	return (
		<nav className="assets-section-nav" aria-label={t("assetsWorkspace")}>
			{(["overview", "online", "physical"] as const).map((value) => (
				<Button
					asChild
					key={value}
					variant={section === value ? "primary" : "ghost"}
				>
					<Link
						to={value === "overview" ? "/assets" : "/assets/$kind"}
						params={value === "overview" ? {} : { kind: value }}
						activeOptions={{ exact: true }}
						aria-current={section === value ? "page" : undefined}
					>
						{t(
							value === "overview"
								? "assetsOverview"
								: value === "online"
									? "assetsOnline"
									: "assetsPhysical",
						)}
					</Link>
				</Button>
			))}
		</nav>
	);
}
function Metric({
	icon,
	label,
	children,
	hint,
	accent,
}: {
	icon: ReactNode;
	label: string;
	children: ReactNode;
	hint?: string;
	accent?: boolean;
}) {
	return (
		<section
			className={`card assets-metric${accent ? " assets-metric-accent" : ""}`}
		>
			<span className="assets-metric-icon">{icon}</span>
			<div>
				<span>{label}</span>
				<strong>{children}</strong>
				{hint && <small>{hint}</small>}
			</div>
		</section>
	);
}
function localToday() {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function AssetsPage({
	section = "overview",
	initialCategory = "all",
}: {
	section?: AssetsSection;
	initialCategory?: string;
}) {
	const { data, search } = useAppContext();
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const today = localToday();
	const [month, setMonth] = useState(today.slice(0, 7));
	const assets = liveAssets(data).filter((asset) =>
		["project", "subscription", "item"].includes(asset.kind),
	);

	const expenses = useMemo(
		() =>
			buildAssetExpenses({
				assets: data.assets,
				history: data.history,
				today,
				month,
			}),
		[data.assets, data.history, today, month],
	);
	const summary = useMemo(
		() =>
			buildWorkspaceSummary({
				assets: data.assets,
				history: expenses.records,
				tasks: data.tasks,
				relations: data.relations,
				today,
			}),
		[data.assets, data.tasks, data.relations, expenses.records, today],
	);
	function savedContext() {
		const saved = readWorkspaceReturn();
		return saved?.view === section &&
			(initialCategory === "all" || saved.category === initialCategory)
			? saved
			: null;
	}

	const [category, setCategory] = useState(() => {
		const saved = savedContext();
		return saved?.view === section
			? (saved.category ?? initialCategory)
			: initialCategory;
	});
	const [subCategory, setSubCategory] = useState("");
	const [query, setQuery] = useState(
		() => sessionStorage.getItem(`keepany-assets-query-${section}`) ?? "",
	);
	const [tag, setTag] = useState("");
	const [status, setStatus] = useState("");
	const [location, setLocation] = useState("");
	const [assetView, setAssetView] = useAssetView();
	const [manage, setManage] = useState(false);
	const [createOpen, setCreateOpen] = useState(false);
	const [createKind, setCreateKind] = useState<
		"project" | "item" | "subscription" | "domain"
	>(section === "physical" ? "item" : "subscription");
	const [projectId, setProjectId] = useState("");
	const [editor, setEditor] = useState<AssetKind | null>(null);
	useEffect(() => {
		const saved = savedContext();
		setCategory(
			saved?.view === section
				? (saved.category ?? initialCategory)
				: initialCategory,
		);
		setSubCategory(
			saved?.subCategory ??
				(section === "physical"
					? (sessionStorage.getItem("keepany-category-item") ?? "")
					: ["project", "subscription"].includes(initialCategory)
						? (sessionStorage.getItem(`keepany-category-${initialCategory}`) ??
							"")
						: ""),
		);
		setTag(saved?.tag ?? "");
		setStatus(saved?.status ?? "");
		setLocation(saved?.location ?? "");
		setQuery(sessionStorage.getItem(`keepany-assets-query-${section}`) ?? "");
	}, [section, initialCategory]);
	useEffect(() => {
		const saved = savedContext();
		if (saved?.view !== section) return;
		const frame = requestAnimationFrame(() =>
			window.scrollTo(0, saved.scrollY),
		);
		return () => cancelAnimationFrame(frame);
	}, [section]);
	function remember(assetId: string) {
		sessionStorage.setItem(
			workspaceReturnKey,
			JSON.stringify({
				view: section,
				category,
				subCategory,
				tag,
				status,
				location,
				assetId,
				query,
				scrollY: window.scrollY,
			}),
		);
	}
	const physical = assets.filter((asset) => asset.kind === "item");
	const online = assets.filter((asset) => asset.kind !== "item");
	const projects = online.filter((asset) => asset.kind === "project");
	const domains = summary.domains;
	const onlineGroups = [
		{ id: "all", key: "all", count: online.length + domains.length },
		{
			id: "subscription",
			key: "subscription",
			count: online.filter((a) => a.kind === "subscription").length,
		},
		{ id: "project", key: "project", count: projects.length },
		{ id: "domains", key: "workspaceDomains", count: domains.length },
		{
			id: "software",
			key: "assetsSoftware",
			count: online.filter(
				(a) =>
					a.kind === "subscription" &&
					["software", "service"].includes(a.category),
			).length,
		},
	];
	const pool = section === "physical" ? physical : online;
	const tags = [...new Set(pool.flatMap((asset) => asset.tags))].sort();
	const locations = [
		...new Set(physical.map((a) => a.location).filter(Boolean)),
	].sort();
	const visible = pool.filter(
		(asset) =>
			(section === "physical" ||
				category === "all" ||
				category === asset.kind ||
				(category === "software" &&
					asset.kind === "subscription" &&
					["software", "service"].includes(asset.category))) &&
			category !== "domains" &&
			(!subCategory || asset.category === subCategory) &&
			(!tag || asset.tags.includes(tag)) &&
			(!location || asset.location === location) &&
			(!status ||
				(status === "loaned"
					? asset.status === "loaned"
					: asset.status !== "loaned" &&
						(asset.itemLifecycleStatus ?? "unrecorded") === status)) &&
			[search, query].every((value) => matchesAssetSearch(asset, value)),
	);
	const visibleDomains =
		section === "online" && ["all", "domains"].includes(category)
			? domains.filter(
					({ project, domain }) =>
						(!tag || project.tags.includes(tag)) &&
						[search, query].every(
							(value) =>
								!value.trim() ||
								[domain.name, domain.registrar, project.name]
									.join(" ")
									.toLocaleLowerCase()
									.includes(value.trim().toLocaleLowerCase()),
						),
				)
			: [];
	const warranty = physical.filter(
		(a) =>
			a.itemWarrantyStatus !== "notApplicable" &&
			a.itemWarrantyStatus !== "outOfWarranty" &&
			(a.warrantyDate
				? a.warrantyDate >= today
				: a.itemWarrantyStatus === "inWarranty"),
	).length;
	const maintenance = data.tasks
		.filter(
			(task) =>
				!task.deleted &&
				!task.done &&
				!task.impactSnapshot &&
				!!task.maintenancePlan &&
				physical.some((a) => a.id === task.assetId),
		)
		.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
	function create(event: FormEvent) {
		event.preventDefault();
		if (createKind === "domain") {
			if (!projects.some((a) => a.id === projectId)) return;
			setCreateOpen(false);
			remember(projectId);
			void navigate({
				to: "/assets/$kind/$id",
				params: { kind: "project", id: projectId },
				hash: "project-domains",
			});
		} else {
			setCreateOpen(false);
			setEditor(createKind);
		}
	}
	useEffect(() => {
		function select(event: Event) {
			const selection = (
				event as CustomEvent<{ kind: string; category: string }>
			).detail;
			if (
				selection &&
				((section === "physical" && selection.kind === "item") ||
					(section === "online" &&
						["project", "subscription"].includes(selection.kind)))
			) {
				if (section === "online") setCategory(selection.kind);
				setSubCategory(selection.category);
			}
		}
		window.addEventListener("keepany-category-select", select);
		return () => window.removeEventListener("keepany-category-select", select);
	}, [section, category]);
	const groupKind =
		section === "physical"
			? "item"
			: category === "project"
				? "project"
				: category === "subscription" || category === "software"
					? "subscription"
					: null;
	return (
		<main className="page assets-workbench">
			<PageTitle
				title={t("assetsWorkspace")}
				subtitle={t(
					section === "online"
						? "assetsOnlineSubtitle"
						: section === "physical"
							? "assetsPhysicalSubtitle"
							: "assetsSubtitle",
				)}
				action={
					<>
						<Button asChild>
							<Link to="/finance">{t("workspaceLedger")}</Link>
						</Button>
						<Button
							variant="primary"
							onClick={() => {
								setCreateKind(section === "physical" ? "item" : "subscription");
								setProjectId(projects[0]?.id ?? "");
								setCreateOpen(true);
							}}
						>
							<Plus size={17} />
							{t("workspaceAddAsset")}
						</Button>
					</>
				}
			/>
			<AssetsNavigation section={section} />
			{section !== "physical" && (
				<label className="assets-month">
					{t("assetsMonth")}
					<Input
						type="month"
						value={month}
						max={today.slice(0, 7)}
						onChange={(event) => {
							if (
								/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value) &&
								event.target.value <= today.slice(0, 7)
							)
								setMonth(event.target.value);
						}}
					/>
				</label>
			)}
			{section === "online" && (
				<div
					className="assets-category-pills"
					role="group"
					aria-label={t("assetsCategories")}
				>
					{onlineGroups.map((group) => (
						<Button
							key={group.id}
							variant={category === group.id ? "primary" : "default"}
							aria-pressed={category === group.id}
							onClick={() => {
								setCategory(group.id);
								setSubCategory("");
							}}
						>
							{t(group.key)} <span>{group.count}</span>
						</Button>
					))}
				</div>
			)}
			{section === "physical" && (
				<CategoryStrip
					kind="item"
					chosen={subCategory}
					choose={(value) => {
						setSubCategory(value);
						sessionStorage.setItem("keepany-category-item", value);
					}}
					showCounts
				/>
			)}
			<div className="assets-metrics">
				{section === "overview" ? (
					<>
						<Metric
							icon={<Wallet />}
							label={t("assetsMonthSpent")}
							hint={`${month} · ${t("assetsActual")}`}
							accent
						>
							<MoneyTotal
								totals={expenses.month}
								empty={t("assetsNoExpenses")}
							/>
						</Metric>
						<Metric
							icon={<CalendarDays />}
							label={t("assetsYearSpent")}
							hint={`${month.slice(0, 4)} · ${t("assetsActual")}`}
						>
							<MoneyTotal
								totals={expenses.year}
								empty={t("assetsNoExpenses")}
							/>
						</Metric>
					</>
				) : (
					<>
						<Metric
							icon={section === "physical" ? <Package /> : <Cloud />}
							label={t(
								section === "physical" ? "assetsPhysical" : "assetsOnline",
							)}
						>
							<span>
								{t(
									section === "physical"
										? "assetsPhysicalCount"
										: "assetsCount",
									{
										count:
											section === "physical"
												? physical.length
												: online.length + domains.length,
									},
								)}
							</span>
						</Metric>
						<Metric
							icon={<Wallet />}
							label={t(
								section === "physical"
									? "workspacePurchaseTotal"
									: "assetsMonthSpent",
							)}
							hint={t(
								section === "physical" ? "itemPurchasePrice" : "assetsActual",
							)}
						>
							<MoneyTotal
								totals={
									section === "physical"
										? expenses.purchases
										: expenses.monthOnline
								}
								empty={t("assetsNoExpenses")}
							/>
						</Metric>
					</>
				)}
				{section === "physical" ? (
					<>
						<Metric
							icon={<CalendarDays />}
							label={t("assetsMonthSpent")}
							hint={t("assetsActual")}
						>
							<MoneyTotal
								totals={expenses.monthPhysical}
								empty={t("assetsNoExpenses")}
							/>
						</Metric>
						<Metric icon={<ShieldCheck />} label={t("assetsWarranty")}>
							{t("assetsPhysicalCount", { count: warranty })}
						</Metric>
					</>
				) : (
					<>
						<Metric
							icon={<CreditCard />}
							label={t("assetsFixed")}
							hint={t("assetsPlan")}
						>
							<MoneyTotal totals={expenses.monthly} empty={t("assetsZero")} />
						</Metric>
						<Metric
							icon={<Clock />}
							label={t("assetsUpcoming")}
							hint={t("assetsEstimate")}
						>
							<MoneyTotal totals={expenses.upcoming} empty={t("assetsZero")} />
							{expenses.upcomingUnknownCount > 0 && (
								<small>
									{t("assetsUnknownRenewals", {
										count: expenses.upcomingUnknownCount,
									})}
								</small>
							)}
						</Metric>
					</>
				)}
			</div>
			{section === "overview" ? (
				<>
					<div className="assets-entry-grid">
						{(["online", "physical"] as const).map((value) => (
							<Link
								className={`card assets-entry assets-entry-${value}`}
								key={value}
								to="/assets/$kind"
								params={{ kind: value }}
							>
								<div>
									{value === "online" ? (
										<Cloud size={30} />
									) : (
										<Package size={30} />
									)}
									<span>
										<strong>
											{t(
												value === "online" ? "assetsOnline" : "assetsPhysical",
											)}
										</strong>
										<b>
											{t("assetsCount", {
												count:
													value === "online"
														? online.length + domains.length
														: physical.length,
											})}
										</b>
									</span>
									<ArrowRight />
								</div>
								<div className="assets-entry-categories">
									{value === "online"
										? onlineGroups.slice(1).map((g) => (
												<span key={g.id}>
													{t(g.key)} {g.count}
												</span>
											))
										: ["device", "appliance", "furniture", "other"].map(
												(key) => (
													<span key={key}>
														{t(key)}{" "}
														{physical.filter((a) => a.category === key).length}
													</span>
												),
											)}
								</div>
							</Link>
						))}
					</div>
					<div className="assets-dashboard-columns">
						<section className="card assets-ledger">
							<div className="card-header">
								<h2>{t("workspaceLedger")}</h2>
								<Button asChild size="small">
									<Link to="/finance">
										{t("assetsViewAll")} <ArrowRight size={14} />
									</Link>
								</Button>
							</div>
							{expenses.monthRecords.length ? (
								<div className="assets-table-scroll">
									<table>
										<thead>
											<tr>
												<th>{t("date")}</th>
												<th>{t("assetsExpenseItem")}</th>
												<th>{t("financeRelatedAsset")}</th>
												<th>{t("amount")}</th>
											</tr>
										</thead>
										<tbody>
											{expenses.monthRecords.slice(0, 6).map((entry) => (
												<tr key={entry.id}>
													<td>
														{date(
															entry.eventDate ||
																entry.billDate ||
																entry.createdAt.slice(0, 10),
															i18n.language,
														)}
													</td>
													<td>
														<Link
															to="/finance"
															hash={`finance-entry-${entry.id}`}
														>
															{entry.title ||
																t(
																	entry.action === "renew"
																		? "financeRenewalRecorded"
																		: "financeActionExpense",
																)}
														</Link>
													</td>
													<td>
														{historyAssetIds(entry)
															.map(
																(id) => assets.find((a) => a.id === id)?.name,
															)
															.filter(Boolean)
															.join(" · ")}
													</td>
													<td className="assets-money">
														{money(
															entry.amount!,
															entry.currency!,
															i18n.language,
														)}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							) : (
								<p className="subtitle">{t("assetsNoExpenses")}</p>
							)}
							<div className="assets-ledger-total">
								<span>
									{t("assetsExpenseCount", { count: expenses.monthRecords.length })}
								</span>
								<MoneyTotal totals={expenses.month} empty="—" />
							</div>
						</section>
						<section className="card assets-breakdown">
							<h2>{t("assetsDistribution")}</h2>
							{expenses.month.size ? (
								[...expenses.month].map(([currency, total]) => {
									const parts = [
										{
											key: "assetsOnline",
											value: expenses.monthOnline.get(currency) ?? 0n,
										},
										{
											key: "assetsPhysical",
											value: expenses.monthPhysical.get(currency) ?? 0n,
										},
										{
											key: "assetsShared",
											value: expenses.monthShared.get(currency) ?? 0n,
										},
									];
									const first =
										total > 0n
											? Number((parts[0].value * 10000n) / total) / 100
											: 0;
									const second =
										total > 0n
											? Number((parts[1].value * 10000n) / total) / 100
											: 0;
									return (
										<div className="assets-distribution" key={currency}>
											<div
												className="assets-donut"
												role="img"
												aria-label={`${currency} ${t("assetsDistribution")}`}
												style={{
													background: `conic-gradient(var(--assets-online) 0 ${first}%, var(--assets-physical) ${first}% ${first + second}%, var(--assets-shared) ${first + second}% 100%)`,
												}}
											>
												<span>{money(total, currency, i18n.language)}</span>
											</div>
											<div>
												{parts.map(
													(p, index) =>
														p.value > 0n && (
															<p key={p.key}>
																<i
																	className={`assets-dot assets-dot-${index}`}
																/>
																<span>
																	{t(p.key)}
																	<strong>
																		{money(p.value, currency, i18n.language)}
																	</strong>
																</span>
																<small>
																	{total > 0n
																		? Number((p.value * 10000n) / total) / 100
																		: 0}
																	%
																</small>
															</p>
														),
												)}
											</div>
										</div>
									);
								})
							) : (
								<p className="subtitle">{t("assetsNoExpenses")}</p>
							)}
						</section>
					</div>
					<section className="card assets-renewals">
						<h2>
							{t("assetsRenewals")} <small>{t("assetsUpcoming")}</small>
						</h2>
						{expenses.upcomingRows.length ? (
							<div className="assets-table-scroll">
								<table>
									<thead>
										<tr>
											<th>{t("name")}</th>
											<th>{t("category")}</th>
											<th>{t("dueDate")}</th>
											<th>{t("assetsEstimate")}</th>
											<th>{t("actions")}</th>
										</tr>
									</thead>
									<tbody>
										{expenses.upcomingRows.map((row) => (
											<tr key={row.id}>
												<td>{row.name}</td>
												<td>
													{t(
														row.kind === "domain"
															? "workspaceDomains"
															: "subscription",
													)}
												</td>
												<td>{date(row.dueDate, i18n.language)}</td>
												<td className="assets-money">
													{row.amount === null
														? t("workspaceAmountMissing")
														: money(row.amount, row.currency, i18n.language)}
												</td>
												<td>
													<Button asChild size="small">
														<Link
															to="/assets/$kind/$id"
															params={{
																kind:
																	row.kind === "domain"
																		? "project"
																		: "subscription",
																id: row.assetId,
															}}
															hash={
																row.domainId
																	? `project-domain-${row.domainId}`
																	: undefined
															}
															onClick={() => remember(row.assetId)}
														>
															{t("view")}
														</Link>
													</Button>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						) : (
							<p className="subtitle">{t("assetsNoRenewals")}</p>
						)}
					</section>
				</>
			) : (
				<>
					<section className="assets-catalog">
						<div className="assets-toolbar">
							<label className="asset-account-search">
								<Search size={18} />
								<Input
									type="search"
									aria-label={t(
										section === "online"
											? "assetsSearchOnline"
											: "assetsSearchPhysical",
									)}
									placeholder={t(
										section === "online"
											? "assetsSearchOnline"
											: "assetsSearchPhysical",
									)}
									value={query}
									onChange={(event) => {
										setQuery(event.target.value);
										sessionStorage.setItem(
											`keepany-assets-query-${section}`,
											event.target.value,
										);
									}}
								/>
							</label>
							<Select
								aria-label={t("filterTag")}
								value={tag}
								onValueChange={setTag}
							>
								<SelectOption value="">{t("allTags")}</SelectOption>
								{tags.map((value) => (
									<SelectOption key={value} value={value}>
										{value}
									</SelectOption>
								))}
							</Select>
							{section === "physical" && (
								<>
									<Select
										aria-label={t("itemLifecycleStatus")}
										value={status}
										onValueChange={setStatus}
									>
										<SelectOption value="">{t("assetsAllStatus")}</SelectOption>
										{[
											"inUse",
											"loaned",
											"idle",
											"repairing",
											"resold",
											"retired",
											"unrecorded",
										].map((value) => (
											<SelectOption key={value} value={value}>
												{t(
													value === "loaned"
														? "loaned"
														: value === "unrecorded"
															? "itemStatusUnrecorded"
															: `itemStatus_${value}`,
												)}
											</SelectOption>
										))}
									</Select>
									<Select
										aria-label={t("location")}
										value={location}
										onValueChange={setLocation}
									>
										<SelectOption value="">
											{t("assetsAllLocations")}
										</SelectOption>
										{locations.map((value) => (
											<SelectOption key={value} value={value}>
												{value}
											</SelectOption>
										))}
									</Select>
								</>
							)}
							<AssetViewToggle value={assetView} onChange={setAssetView} />
						</div>
						{section === "online" && groupKind && (
							<>
								<Button
									size="small"
									aria-expanded={manage}
									onClick={() => setManage((value) => !value)}
								>
									{t("assetsMoreFilters")}
								</Button>
								{manage && (
									<CategoryStrip
										kind={groupKind}
										chosen={subCategory}
										choose={(value) => setSubCategory(value)}
										showCounts
									/>
								)}
							</>
						)}
						{visible.length + visibleDomains.length ? (
							<div
								className={`asset-list-content workspace-asset-grid assets-catalog-grid${assetView === "list" ? " asset-dense-list" : ""}`}
							>
								{visible.map((asset) =>
									asset.kind === "project" ? (
										<ProjectCard
											key={asset.id}
											asset={asset}
											search={query}
											summary={summary.summaries.get(asset.id)}
											onOpen={() => remember(asset.id)}
										/>
									) : asset.kind === "item" ? (
										<Link
											className="card assets-item-card"
											key={asset.id}
											to="/assets/$kind/$id"
											params={{ kind: asset.kind, id: asset.id }}
											onClick={() => remember(asset.id)}
										>
											<div className="assets-item-image">
												{asset.itemMedia.coverId ? (
													<AssetThumbnail asset={asset} />
												) : (
													<Package size={34} />
												)}
											</div>
											<div>
												<span className="chip">
													{niceCategory(asset.category, t) || t("other")}
												</span>
												<strong>{asset.name}</strong>
												<b>
													{t("itemPurchasePrice")}:{" "}
													{asset.itemPurchasePriceKnown
														? money(asset.amount, asset.currency, i18n.language)
														: t("workspaceAmountMissing")}
												</b>
												<span className="chip">
													{t(
														asset.status === "loaned"
															? "loaned"
															: asset.itemLifecycleStatus
																? `itemStatus_${asset.itemLifecycleStatus}`
																: "itemStatusUnrecorded",
													)}
												</span>
												{asset.purchaseDate && (
													<small>
														{t("workspacePurchaseDateLabel", {
															date: date(asset.purchaseDate, i18n.language),
														})}
													</small>
												)}
												{asset.location && (
													<small>
														{t("location")}: {asset.location}
													</small>
												)}
												{asset.status === "loaned" && (
													<small>
														{t("borrower")}: {asset.borrower}
														{asset.itemExpectedReturnDate
															? ` · ${date(asset.itemExpectedReturnDate, i18n.language)}`
															: ""}
													</small>
												)}
												{asset.warrantyDate && (
													<small>
														{t("warrantyDate")}:{" "}
														{date(asset.warrantyDate, i18n.language)}
													</small>
												)}
											</div>
										</Link>
									) : (
										<LibraryCard
											key={asset.id}
											asset={asset}
											search={query}
											summary={summary.summaries.get(asset.id)}
											onOpen={() => remember(asset.id)}
										/>
									),
								)}
								{visibleDomains.map(({ project, domain, remainingDays }) => (
									<Link
										className="card workspace-domain-card"
										key={`${project.id}:${domain.id}`}
										to="/assets/$kind/$id"
										params={{ kind: "project", id: project.id }}
										hash={`project-domain-${domain.id}`}
										onClick={() => remember(project.id)}
									>
										<div className="workspace-domain-heading">
											<Globe />
											<strong>{domain.name}</strong>
										</div>
										<span className="chip">{t("workspaceDomains")}</span>
										<small>{domain.registrar || project.name}</small>
										<strong>
											{domain.annualAmount === null
												? t("workspaceAmountMissing")
												: `${money(domain.annualAmount, domain.currency, i18n.language)} / ${t("year")}`}
										</strong>
										<RemainingDays days={remainingDays} />
										<small>{date(domain.expiryDate, i18n.language)}</small>
										<small>
											{t("financeRelatedAsset")}: {project.name}
										</small>
									</Link>
								))}
							</div>
						) : query ||
							search ||
							tag ||
							status ||
							location ||
							subCategory ||
							category !== "all" ? (
							<div className="empty">
								<strong>{t("noMatches")}</strong>
							</div>
						) : (
							<Empty />
						)}
						<p className="subtitle">
							{t("assetsCount", {
								count: visible.length + visibleDomains.length,
							})}
						</p>
					</section>
					{section === "physical" && (
						<section className="card assets-maintenance">
							<div className="card-header">
								<h2>
									<Wrench size={18} /> {t("assetsMaintenance")}
								</h2>
								<Button asChild size="small">
									<Link to="/tasks">{t("assetsViewAll")}</Link>
								</Button>
							</div>
							{maintenance.length ? (
								maintenance.slice(0, 6).map((task) => (
									<Link key={task.id} to="/tasks" hash={`task-${task.id}`}>
										{task.name} · {date(task.dueDate, i18n.language)}
									</Link>
								))
							) : (
								<p className="subtitle">{t("assetsNoMaintenance")}</p>
							)}
						</section>
					)}
				</>
			)}
			{createOpen && (
				<Dialog
					title={t("workspaceAddAsset")}
					onClose={() => setCreateOpen(false)}
				>
					<form className="workspace-create-form" onSubmit={create}>
						<label className="field" htmlFor="workspace-create-kind">
							{t("workspaceAssetType")}
							<Select
								id="workspace-create-kind"
								value={createKind}
								onValueChange={(value) =>
									setCreateKind(value as typeof createKind)
								}
							>
								{(section === "physical"
									? (["item"] as const)
									: ([
											"subscription",
											"project",
											"domain",
											...(section === "overview" ? (["item"] as const) : []),
										] as const)
								).map((kind) => (
									<SelectOption key={kind} value={kind}>
										{t(kind === "domain" ? "workspaceDomains" : kind)}
									</SelectOption>
								))}
							</Select>
						</label>
						{createKind === "domain" &&
							(projects.length ? (
								<label className="field" htmlFor="workspace-domain-project">
									{t("workspaceChooseProject")}
									<Select
										id="workspace-domain-project"
										value={projectId}
										onValueChange={setProjectId}
									>
										{projects.map((project) => (
											<SelectOption key={project.id} value={project.id}>
												{project.name}
											</SelectOption>
										))}
									</Select>
								</label>
							) : (
								<p>{t("workspaceNoProjectForDomain")}</p>
							))}
						<div className="actions">
							{createKind === "domain" && !projects.length ? (
								<Button
									variant="primary"
									type="button"
									onClick={() => {
										setCreateOpen(false);
										setEditor("project");
									}}
								>
									{t("project")}
								</Button>
							) : (
								<Button variant="primary" type="submit">
									{t(
										createKind === "domain"
											? "workspaceManageDomain"
											: "workspaceContinue",
									)}
								</Button>
							)}
							<Button type="button" onClick={() => setCreateOpen(false)}>
								{t("cancel")}
							</Button>
						</div>
					</form>
				</Dialog>
			)}
			{editor && (
				<Suspense fallback={<p role="status">{t("loading")}</p>}>
					<AssetEditor
						kind={editor}
						categories={data.categories}
						onClose={() => setEditor(null)}
					/>
				</Suspense>
			)}
		</main>
	);
}
