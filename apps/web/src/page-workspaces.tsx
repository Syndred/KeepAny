import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Globe, LockKeyhole, Plus, Search } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { AssetKind } from "../../../packages/domain/src";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { Select, SelectOption } from "./components/ui/select";
import { MoneyTotal, RemainingDays } from "./components/AssetMetrics";
import { usePasswordVault } from "./components/PasswordVaultProvider";
import { AssetKindList, LibraryCard, ProjectCard, type AccountListFilters } from "./page-asset-list";
import { FinancePage } from "./page-finance";
import { matchesAssetSearch } from "./asset-search";
import { partitionAccountPasswords } from "./workspace-summary";
import { useWorkspaceSummary } from "./use-workspace-summary";
import { date, Empty, liveAssets, money, PageTitle, useAppContext } from "./view-shared";
import "./workspaces.css";
import { readWorkspaceReturn, workspaceReturnKey } from "./workspace-return";

const AssetEditor = lazy(() => import("./workflows").then((module) => ({ default: module.AssetEditor })));
type AssetView = "all" | "project" | "item" | "subscription" | "domains" | "ledger";

function AssetTabs({ view }: { view: AssetView }) {
	const { t } = useTranslation();
	return <nav className="workspace-navigation" aria-label={t("assetsWorkspace")}>
		<Link to="/assets" aria-current={view === "all" ? "page" : undefined}>{t("all")}</Link>
		{(["project", "item", "domains", "subscription"] as const).map((kind) => <Link key={kind} to="/assets/$kind" params={{ kind }} aria-current={view === kind ? "page" : undefined}>{t(kind === "domains" ? "workspaceDomains" : kind)}</Link>)}
		<Link to="/finance" aria-current={view === "ledger" ? "page" : undefined}>{t("workspaceLedger")}</Link>
	</nav>;
}

function AccountTabs({ passwords, references }: { passwords: boolean; references: boolean }) {
	const { t } = useTranslation();
	return <nav className="workspace-navigation" aria-label={t("accountsWorkspace")}>
		<Link to="/accounts" aria-current={!passwords ? "page" : undefined}>{t("workspaceAllAccounts")}</Link>
		<Link to="/assets/$kind" params={{ kind: "vault" }} aria-current={passwords && !references ? "page" : undefined}>{t("workspacePasswords")}</Link>
		<Link to="/assets/$kind" params={{ kind: "vault" }} hash="vault-references" aria-current={references ? "page" : undefined}>{t("workspacePasswordReferences")}</Link>
	</nav>;
}

export function AccountsWorkspace({ passwords = false }: { passwords?: boolean }) {
	const { data, search } = useAppContext();
	const { t } = useTranslation();
	const { snapshot, ensureReady, lock } = usePasswordVault();
	const hash = useRouterState({ select: (state) => state.location.hash });
	const [filters, setFilters] = useState<AccountListFilters>(() => ({ search: sessionStorage.getItem("keepany-account-list-search") ?? "", category: "", tag: "" }));
	useEffect(() => { void ensureReady().catch(() => {}); }, [ensureReady]);
	useEffect(() => {
		if (data.loading || !passwords || hash !== "vault-references") return;
		const frame = requestAnimationFrame(() => document.getElementById("vault-references")?.scrollIntoView({ block: "start" }));
		return () => cancelAnimationFrame(frame);
	}, [passwords, hash, data.loading]);
	const grouped = useMemo(() => partitionAccountPasswords(snapshot.status === "unlocked" ? snapshot.entries : [], data.assets), [snapshot.status, snapshot.entries, data.assets]);
	const passwordCounts = useMemo(() => snapshot.status === "unlocked"
		? new Map(data.assets.filter((asset) => !asset.deleted && asset.kind === "account").map((asset) => [asset.id, grouped.linked.get(asset.id)?.length ?? 0]))
		: undefined, [snapshot.status, data.assets, grouped.linked]);
	const unlinked = grouped.unlinked.filter((entry) => [search, filters.search].every((query) => !query.trim() ||
		[entry.title, entry.username, ...(entry.usernameAliases ?? []), entry.url].join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
	return <div className="workspace-page">
		<AccountTabs passwords={passwords} references={passwords && hash === "vault-references"} />
		{passwords ? <AssetKindList kind="vault" /> : <AssetKindList kind="account" passwordCounts={passwordCounts} onAccountFiltersChange={setFilters} privateSearch={snapshot.status === "unlocked"}
			beforeList={<div className="notice workspace-password-status"><span><LockKeyhole size={17} />{snapshot.status === "unlocked" ? t("pwVaultStatusUnlocked") : snapshot.status === "loading" ? t("pwVaultLoading") : snapshot.status === "empty" ? t("pwVaultStatusEmpty") : t("workspacePasswordsLocked")}</span><div className="actions">{snapshot.status === "unlocked" && <Button size="small" onClick={lock}>{t("pwVaultLock")}</Button>}<Button asChild size="small"><Link to="/assets/$kind" params={{ kind: "vault" }}>{t("workspaceOpenPasswords")}</Link></Button></div></div>}
			afterList={snapshot.status === "unlocked" && !filters.category && !filters.tag && unlinked.length > 0 ? <section className="workspace-password-only" aria-labelledby="workspace-unlinked-passwords"><h2 id="workspace-unlinked-passwords">{t("workspacePasswordOnly")}</h2><div className="asset-account-grid">{unlinked.map((entry) => <Link key={entry.id} className="asset-account-card workspace-password-card" to="/assets/$kind" params={{ kind: "vault" }} hash={`password-${entry.id}`}><span className="asset-account-avatar"><LockKeyhole size={20} /></span><span className="asset-account-summary"><strong>{entry.title}</strong>{entry.username && <small>{entry.username}</small>}<span className="chip">{t("workspacePasswords")}</span></span></Link>)}</div></section> : null} />}
	</div>;
}

function AssetCatalog({ domainsOnly }: { domainsOnly: boolean }) {
	const { data, search } = useAppContext();
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const summary = useWorkspaceSummary();
	const queryKey = `keepany-catalog-query-${domainsOnly ? "domains" : "all"}`;
	const [query, setQuery] = useState(() => sessionStorage.getItem(queryKey) ?? "");
	const restoredScroll = useRef(false);
	useEffect(() => {
		setQuery(sessionStorage.getItem(queryKey) ?? "");
		restoredScroll.current = false;
	}, [queryKey]);
	useEffect(() => {
		if (data.loading || restoredScroll.current) return;
		const saved = readWorkspaceReturn();
		if (!saved || saved.view !== (domainsOnly ? "domains" : "all")) return;
		const frame = requestAnimationFrame(() => { window.scrollTo(0, saved.scrollY); restoredScroll.current = true; });
		return () => cancelAnimationFrame(frame);
	}, [data.loading, domainsOnly]);
	function rememberCatalog(assetId: string) {
		sessionStorage.setItem(workspaceReturnKey, JSON.stringify({ view: domainsOnly ? "domains" : "all", assetId, query, scrollY: window.scrollY }));
	}
	const [createOpen, setCreateOpen] = useState(false);
	const [createKind, setCreateKind] = useState<"project" | "item" | "subscription" | "domain">(domainsOnly ? "domain" : "project");
	const [projectId, setProjectId] = useState("");
	const [editor, setEditor] = useState<AssetKind | null>(null);
	const assets = liveAssets(data).filter((asset) => ["project", "item", "subscription"].includes(asset.kind));
	const projects = assets.filter((asset) => asset.kind === "project");
	const visible = assets.filter((asset) => [search, query].every((value) => matchesAssetSearch(asset, value)));
	const visibleDomains = summary.domains.filter(({ domain, project }) => [search, query].every((value) => !value.trim() ||
		[domain.name, domain.registrar, project.name].join(" ").toLocaleLowerCase().includes(value.trim().toLocaleLowerCase())));
	const backlinks = useMemo(() => {
		const counts = new Map<string, { total: number; pending: number }>();
		for (const row of data.submissions) {
			if (row.deleted) continue;
			const count = counts.get(row.assetId) ?? { total: 0, pending: 0 };
			count.total += 1; if (row.status === "verify") count.pending += 1;
			counts.set(row.assetId, count);
		}
		return counts;
	}, [data.submissions]);
	function create(event: FormEvent) {
		event.preventDefault();
		if (createKind === "domain") {
			if (!projects.some((project) => project.id === projectId)) return;
			setCreateOpen(false);
			void navigate({ to: "/assets/$kind/$id", params: { kind: "project", id: projectId }, hash: "project-domains" });
		} else { setCreateOpen(false); setEditor(createKind); }
	}
	const hasResults = (!domainsOnly && visible.length > 0) || visibleDomains.length > 0;
	return <main className="page workspace-catalog">
		<PageTitle title={t(domainsOnly ? "workspaceDomains" : "assetsWorkspace")} subtitle={t("workspaceAssetSubtitle")}
			action={<Button variant="primary" onClick={() => { setCreateKind(domainsOnly ? "domain" : "project"); setProjectId(projects[0]?.id ?? ""); setCreateOpen(true); }}><Plus size={17} />{t("workspaceAddAsset")}</Button>} />
		{!domainsOnly && <div className="workspace-summary-grid">
			<section className="card"><span>{t("workspacePurchaseTotal")}</span><strong><MoneyTotal totals={summary.purchases} empty={t("workspaceAmountMissing")} /></strong></section>
			<section className="card"><span>{t("workspaceRecordedSpending")}</span><strong><MoneyTotal totals={summary.spending} empty={t("financeNoRecords")} /></strong></section>
			<section className="card"><span>{t("workspaceMonthlyPlan")}</span><strong><MoneyTotal totals={summary.monthly} empty={t("financeNoPlan")} /></strong></section>
			<section className="card"><span>{t("workspaceUpcoming")}</span><strong>{summary.upcoming}</strong></section>
		</div>}
		<div className="workspace-search"><label className="asset-account-search"><Search size={18} /><input type="search" value={query} aria-label={t("workspaceSearch")} placeholder={t("workspaceSearch")} onChange={(event) => { setQuery(event.target.value); sessionStorage.setItem(queryKey, event.target.value); }} /></label><span>{t("workspaceAssetCount", { count: (domainsOnly ? 0 : visible.length) + visibleDomains.length })}</span></div>
		{hasResults ? <section className="asset-list-content workspace-asset-grid" aria-label={t(domainsOnly ? "workspaceDomains" : "assetsWorkspace")}>
			{!domainsOnly && visible.map((asset) => asset.kind === "project" ? <ProjectCard key={asset.id} asset={asset} search={search} summary={summary.summaries.get(asset.id)} backlinks={backlinks.get(asset.id) ?? { total: 0, pending: 0 }} onOpen={() => rememberCatalog(asset.id)} /> : <LibraryCard key={asset.id} asset={asset} search={search} summary={summary.summaries.get(asset.id)} onOpen={() => rememberCatalog(asset.id)} />)}
			{visibleDomains.map(({ project, domain, remainingDays }) => <Link className="card workspace-domain-card" key={`${project.id}:${domain.id}`} to="/assets/$kind/$id" params={{ kind: "project", id: project.id }} hash={`project-domain-${domain.id}`} onClick={() => rememberCatalog(project.id)}>
				<div className="workspace-domain-heading"><Globe size={22} /><strong>{domain.name}</strong></div><span className="subtitle">{t("workspaceDomains")} · {project.name}</span>
				<strong><RemainingDays days={remainingDays} /></strong><span>{t("projectExpiry")}: {date(domain.expiryDate, i18n.language)}</span>
				<div className="workspace-cost-line"><span>{t("projectAnnualFee")}</span><strong>{domain.annualAmount === null ? t("workspaceAmountMissing") : money(domain.annualAmount, domain.currency, i18n.language)}</strong></div>
				{domain.registrar && <span className="subtitle">{domain.registrar}</span>}<span className="workspace-domain-action">{t("workspaceManageDomain")} ↗</span>
			</Link>)}
		</section> : query || search ? <div className="empty"><strong>{t("noMatches")}</strong></div> : <Empty />}
		{createOpen && <Dialog title={t("workspaceAddAsset")} onClose={() => setCreateOpen(false)}><form className="workspace-create-form" onSubmit={create}>
			<label className="field" htmlFor="workspace-create-kind">{t("workspaceAssetType")}<Select id="workspace-create-kind" value={createKind} onValueChange={(value) => setCreateKind(value as typeof createKind)}>{(["project", "item", "subscription", "domain"] as const).map((kind) => <SelectOption key={kind} value={kind}>{t(kind === "domain" ? "workspaceDomains" : kind)}</SelectOption>)}</Select></label>
			{createKind === "domain" && (projects.length ? <label className="field" htmlFor="workspace-domain-project">{t("workspaceChooseProject")}<Select id="workspace-domain-project" value={projectId} onValueChange={setProjectId}>{projects.map((project) => <SelectOption key={project.id} value={project.id}>{project.name}</SelectOption>)}</Select></label> : <p>{t("workspaceNoProjectForDomain")}</p>)}
			<div className="actions">{createKind === "domain" && !projects.length ? <Button variant="primary" type="button" onClick={() => { setCreateOpen(false); setEditor("project"); }}>{t("project")}</Button> : <Button variant="primary" type="submit" disabled={createKind === "domain" && !projects.some((project) => project.id === projectId)}>{createKind === "domain" ? t("workspaceManageDomain") : t("workspaceContinue")}</Button>}<Button type="button" onClick={() => setCreateOpen(false)}>{t("cancel")}</Button></div>
		</form></Dialog>}
		{editor && <Suspense fallback={<div className="toast" role="status">{t("loading")}</div>}><AssetEditor kind={editor} categories={data.categories} onClose={() => setEditor(null)} /></Suspense>}
	</main>;
}

export function AssetsWorkspace({ view = "all" }: { view?: AssetView }) {
	return <div className="workspace-page"><AssetTabs view={view} />{view === "ledger" ? <FinancePage /> : view === "all" || view === "domains" ? <AssetCatalog domainsOnly={view === "domains"} /> : <AssetKindList kind={view} />}</div>;
}

export function FinanceWorkspaceRoute() { return <AssetsWorkspace view="ledger" />; }

export function WorkspaceLegacyRoute() {
	const params = useRouterState({ select: (state) => state.matches.at(-1)?.params }) as { kind?: string } | undefined;
	const kind = params?.kind;
	if (kind === "account" || kind === "vault") return <AccountsWorkspace passwords={kind === "vault"} />;
	return <AssetsWorkspace view={kind === "item" || kind === "subscription" || kind === "domains" ? kind : "project"} />;
}
