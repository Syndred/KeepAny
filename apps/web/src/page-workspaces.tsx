import { Input } from "./components/ui/input";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Globe, Plus, Search } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { newAsset, type Asset, type AssetKind } from "../../../packages/domain/src";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { Select, SelectOption } from "./components/ui/select";
import { MoneyTotal, RemainingDays } from "./components/AssetMetrics";
import { usePasswordVault } from "./components/PasswordVaultProvider";
import { AssetViewToggle, useAssetView } from "./components/AssetViewToggle";
import { AssetKindList, LibraryCard, ProjectCard, type AccountListFilters } from "./page-asset-list";
import { FinancePage } from "./page-finance";
import { matchesAssetSearch } from "./asset-search";
import { SAMPLE_LIBRARY_ID, sampleLibraryAssetIds } from "./sample-library";
import { partitionAccountPasswords } from "./workspace-summary";
import { useWorkspaceSummary } from "./use-workspace-summary";
import { date, Empty, liveAssets, money, PageTitle, useAppContext } from "./view-shared";
import "./workspaces.css";
import { CatalogDomainCard } from "./components/CatalogDomainCard";
import { catalogAssets, catalogScope, sortCatalogRows, isManagedAsset, type CatalogScope, type CatalogSort } from "./catalog-view";
import { readWorkspaceReturn, workspaceReturnKey } from "./workspace-return";
import { localRepository } from "../../../packages/local-db/src";
import { CompactAccountCard } from "./components/CompactAccountCard";

const AssetEditor = lazy(() => import("./workflow-asset-editor").then((module) => ({ default: module.AssetEditor })));
type AssetView = "all" | "project" | "item" | "subscription" | "domains" | "ledger";

function AssetTabs({ view }: { view: AssetView }) {
	const { t } = useTranslation();
	return <nav className="workspace-navigation" aria-label={t("assetsWorkspace")}>
		<Link to="/assets" activeOptions={{ exact: true }} aria-current={view === "all" ? "page" : undefined}>{t("all")}</Link>
		{(["project", "item", "domains", "subscription"] as const).map((kind) => <Link key={kind} to="/assets/$kind" params={{ kind }} activeOptions={{ exact: true }} aria-current={view === kind ? "page" : undefined}>{t(kind === "domains" ? "workspaceDomains" : kind)}</Link>)}
		<Link to="/finance" activeOptions={{ exact: true }} aria-current={view === "ledger" ? "page" : undefined}>{t("workspaceLedger")}</Link>
	</nav>;
}

const PasswordVaultPanel = lazy(() => import("./components/PasswordVaultPanel").then((module) => ({ default: module.PasswordVaultPanel })));
const AccountEntryDialog = lazy(() => import("./components/AccountEntryDialog").then((module) => ({ default: module.AccountEntryDialog })));
const PrivateAccountDetail = lazy(() => import("./components/PrivateAccountDetail").then(module => ({ default: module.PrivateAccountDetail })));

export function AccountsWorkspace() {
	const { data, search, notify, registerFeedbackTarget, pendingAccountName, setPendingAccountName } = useAppContext();
	const { t } = useTranslation();
	const { snapshot, session } = usePasswordVault();
	const hash = useRouterState({ select: (state) => state.location.hash });
	const [editAccount, setEditAccount] = useState<{ asset?: Asset; entryId?: string; triggerId?: string; newLogin?: boolean; initialName?: string } | null>(null);
    const [deleteAccount, setDeleteAccount] = useState<{ asset: Asset; vaultRevision: string } | null>(null);
    const [deleteBusy, setDeleteBusy] = useState(false), [deleteError, setDeleteError] = useState("");
    const navigate = useNavigate();
    const creationConsumed = useRef(false);
    useEffect(() => { if (hash !== "new-account") { creationConsumed.current = false; return; } if (snapshot.status === "unlocked" && !creationConsumed.current) { creationConsumed.current = true; setEditAccount({ initialName: pendingAccountName ?? "" }); setPendingAccountName?.(""); void navigate({ to: "/accounts", hash: "", replace: true }); } }, [hash, snapshot.status, navigate, pendingAccountName, setPendingAccountName]);
    useEffect(() => { if (snapshot.status !== "unlocked") { setEditAccount(null); setDeleteAccount(null); setDeleteError(""); } }, [snapshot.status]);
	const [filters, setFilters] = useState<AccountListFilters>(() => ({ search: sessionStorage.getItem("keepany-account-list-search") ?? "", category: "", tag: "" }));
	const sampleIds = sampleLibraryAssetIds(data.preferences.find((preference) => preference.id === SAMPLE_LIBRARY_ID)?.value);
	const sampleAccounts = data.assets.filter((asset) => !asset.deleted && asset.kind === "account" && sampleIds.includes(asset.id));
	const grouped = useMemo(() => partitionAccountPasswords(snapshot.status === "unlocked" ? snapshot.entries : [], data.assets), [snapshot.status, snapshot.entries, data.assets]);
    const searchExtras = useMemo(() => new Map([
        ...[...grouped.linked].map(([id, entries]) => [id, entries.flatMap(entry => [entry.title, entry.username, ...(entry.usernameAliases ?? []), entry.url]).join(" ").toLocaleLowerCase()] as const),
        ...grouped.unlinked.map(entry => [`login-${entry.id}`, [entry.title, entry.username, ...(entry.usernameAliases ?? []), entry.url].join(" ").toLocaleLowerCase()] as const),
    ]), [grouped.linked, grouped.unlinked]);
    const virtualAccounts = useMemo(() => grouped.unlinked.map(entry => ({ ...newAsset("account"), id: `login-${entry.id}`, name: entry.title, category: "other", username: entry.username, url: entry.url, updatedAt: entry.modifiedAt })), [grouped.unlinked]);
    const virtualEntries = new Map(grouped.unlinked.map(entry => [`login-${entry.id}`, entry]));
    const filterAccountId = hash.startsWith("asset-") ? hash.slice(6) : undefined;
    const privateDetail = hash.startsWith("login-detail-") && snapshot.status === "unlocked" ? snapshot.entries.find(entry => entry.id === hash.slice(13)) : undefined;
    async function removeOrdinaryAccount() {
        if (!deleteAccount || deleteBusy) return;
        setDeleteBusy(true); setDeleteError("");
        try {
            const current = session?.getSnapshot();
            if (current?.status !== "unlocked" || current.revision !== deleteAccount.vaultRevision || current.entries.some(entry => entry.linkedAssetIds.includes(deleteAccount.asset.id))) throw Error("asset-stale");
            const repo = await localRepository();
            await repo.trashEmptyAccountIfCurrent(deleteAccount.asset, deleteAccount.vaultRevision); setDeleteAccount(null); notify(t("pwVaultSaved"));
        } catch (error) { setDeleteError(t(error instanceof Error && ["asset-stale", "vault-stale"].includes(error.message) ? "assetStale" : "error")); } finally { setDeleteBusy(false); }
    }
    if (privateDetail) return <Suspense fallback={<p role="status">{t("loading")}</p>}><PrivateAccountDetail key={privateDetail.id} entry={privateDetail} /></Suspense>;
	return <main className="page unified-accounts-page">
		<Suspense fallback={<p role="status">{t("loading")}</p>}>
			<PasswordVaultPanel assets={data.assets} sampleAccounts={sampleAccounts} accountCount={data.assets.filter(asset => asset.kind === "account" && !asset.deleted).length + grouped.unlinked.length} notify={notify}
				headerFeedback={<div className="compact-account-feedback-slot" ref={registerFeedbackTarget} />}
				headerAction={({ busy, clearMessage }) => <Button variant="primary" title={t("workspaceAddAccount")} disabled={busy || data.pendingCategoryEdits.some((pending) => pending.kind === "account")} onClick={() => { clearMessage(); setEditAccount({}); }}><Plus size={17} />{t("add")}</Button>}
				renderAccounts={(tools) => <AssetKindList kind="account" embedded hideTitle privateSearch={snapshot.status === "unlocked"}
                    accountExtras={virtualAccounts} filterAccountId={filterAccountId}
                    beforeList={filterAccountId ? <div className="password-vault-filter"><span>{data.assets.find(asset => asset.id === filterAccountId)?.name}</span><Button onClick={() => void navigate({ to: "/accounts", hash: "", replace: true })}>{t("pwVaultClearAssetFilter")}</Button></div> : null}
					accountSearchExtras={searchExtras} onAccountFiltersChange={setFilters}
					renderAccountCard={(asset, context) => <CompactAccountCard asset={asset} entries={virtualEntries.has(asset.id) ? [virtualEntries.get(asset.id)!] : grouped.linked.get(asset.id) ?? []} virtual={virtualEntries.has(asset.id)} onEdit={(asset, entryId, triggerId, newLogin) => setEditAccount({ asset: virtualEntries.has(asset.id) ? undefined : asset, entryId, triggerId, newLogin })} onDeleteAccount={asset => { const current = session?.getSnapshot(); if (current?.status !== "unlocked" || !current.revision || current.entries.some(entry => entry.linkedAssetIds.includes(asset.id))) return; setDeleteError(""); setDeleteAccount({ asset, vaultRevision: current.revision }); }} {...context} connectionCount={virtualEntries.has(asset.id) ? virtualEntries.get(asset.id)!.linkedAssetIds.filter(id => data.assets.some(asset => asset.id === id && !asset.deleted)).length : context.connectionCount} tools={tools} focusEntryId={hash.startsWith("password-") ? hash.slice(9) : undefined} />} />}
			/>
		</Suspense>
		{snapshot.status === "unlocked" && editAccount && <Suspense fallback={<p role="status">{t("loading")}</p>}><AccountEntryDialog {...editAccount} returnFocusTo={() => editAccount.triggerId ? document.getElementById(editAccount.triggerId) : document.querySelector<HTMLElement>(".password-vault-header button")} onClose={() => setEditAccount(null)} /></Suspense>}
        {snapshot.status === "unlocked" && deleteAccount && <Dialog title={t("pwVaultDeleteEntry")} onClose={() => { if (!deleteBusy) setDeleteAccount(null); }} closeDisabled={deleteBusy}><p>{deleteAccount.asset.name}</p>{deleteError && <p role="alert" className="field-error">{deleteError}</p>}<div className="actions"><Button disabled={deleteBusy} onClick={() => setDeleteAccount(null)}>{t("cancel")}</Button><Button variant="danger" disabled={deleteBusy} onClick={() => void removeOrdinaryAccount()}>{t("pwVaultDeleteEntry")}</Button></div></Dialog>}
	</main>;
}

function AssetCatalog({ domainsOnly }: { domainsOnly: boolean }) {
	const { data, search } = useAppContext();
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const summary = useWorkspaceSummary();
 const [assetView, setAssetView] = useAssetView();
	const queryKey = `keepany-catalog-query-${domainsOnly ? "domains" : "all"}`;
	const [scope, setScope] = useState<CatalogScope>(() => { try { return catalogScope(sessionStorage.getItem("keepany-catalog-scope")); } catch { return "managed"; } });
 const [sort, setSort] = useState<CatalogSort>(() => sessionStorage.getItem("keepany-catalog-sort") === "due" ? "due" : "updated");
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
	const visible = catalogAssets(assets, ["managed", "all", "archived"].includes(scope) ? scope : "managed", sort).filter((asset) => [search, query].every((value) => matchesAssetSearch(asset, value)));
	const visibleDomains = summary.domains.filter(({ domain, project }) => (scope === "all" || isManagedAsset(project) === (scope === "managed")) && [search, query].every((value) => !value.trim() ||
		[domain.name, domain.registrar, project.name].join(" ").toLocaleLowerCase().includes(value.trim().toLocaleLowerCase())));

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
		<div className="workspace-catalog-controls"><label className="field">{t("assetStatusView")}<Select value={scope} onValueChange={value => { setScope(value as CatalogScope); sessionStorage.setItem("keepany-catalog-scope", value); }}>{(["managed", "all", "archived"] as const).map(value => <SelectOption key={value} value={value}>{t(value === "managed" ? "managedAssets" : value === "all" ? "all" : "archivedAssets")}</SelectOption>)}</Select></label><label className="field">{t("assetSort")}<Select value={sort} onValueChange={value => { setSort(value as CatalogSort); sessionStorage.setItem("keepany-catalog-sort", value); }}><SelectOption value="updated">{t("recentlyUpdated")}</SelectOption><SelectOption value="due">{t("nearestDue")}</SelectOption></Select></label></div>
		<div className="workspace-search"><label className="asset-account-search"><Search size={18} /><Input type="search" value={query} aria-label={t("workspaceSearch")} placeholder={t("workspaceSearch")} onChange={(event) => { setQuery(event.target.value); sessionStorage.setItem(queryKey, event.target.value); }} /></label><AssetViewToggle value={assetView} onChange={setAssetView} /><span>{t("workspaceAssetCount", { count: (domainsOnly ? 0 : visible.length) + visibleDomains.length })}</span></div>
		{hasResults ? <section className={`asset-list-content workspace-asset-grid${assetView === "list" ? " asset-dense-list" : ""}`} aria-label={t(domainsOnly ? "workspaceDomains" : "assetsWorkspace")}>
      {sortCatalogRows([...(domainsOnly ? [] : visible.map(asset => ({ type: "asset" as const, asset }))), ...visibleDomains.map(row => ({ type: "domain" as const, ...row }))], sort).map(row => row.type === "asset" ? row.asset.kind === "project" ? <ProjectCard key={row.asset.id} asset={row.asset} search={search} summary={summary.summaries.get(row.asset.id)} onOpen={() => rememberCatalog(row.asset.id)} /> : <LibraryCard key={row.asset.id} asset={row.asset} search={search} summary={summary.summaries.get(row.asset.id)} onOpen={() => rememberCatalog(row.asset.id)} /> : <CatalogDomainCard key={`${row.project.id}:${row.domain.id}`} {...row} onOpen={() => rememberCatalog(row.project.id)} />)}
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
	if (kind === "account" || kind === "vault") return <AccountsWorkspace />;
	return <AssetsWorkspace view={kind === "item" || kind === "subscription" || kind === "domains" ? kind : "project"} />;
}
