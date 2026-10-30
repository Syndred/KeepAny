import { Input } from "./components/ui/input";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { newAsset, type Asset, type AssetKind, type Category } from "../../../packages/domain/src";
import { CatalogRecordEditor } from './catalog-record-editor';
import { CatalogRecordCard } from './page-catalog-record';
import { CatalogCategoryManager, useCatalogCategories } from './catalog-categories';
import { catalogCategories, catalogCategoryLabel, catalogRecords } from './catalog-records';
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { Select, SelectOption } from "./components/ui/select";
import { MoneyTotal } from "./components/AssetMetrics";
import { usePasswordVault } from "./components/PasswordVaultProvider";
import { AssetViewToggle, useAssetView } from "./components/AssetViewToggle";
import { AssetKindList, LibraryCard, type AccountListFilters } from "./page-asset-list";
import { FinancePage } from "./page-finance";
import { matchesAssetSearch } from "./asset-search";
import { SAMPLE_LIBRARY_ID, sampleLibraryAssetIds } from "./sample-library";
import { partitionAccountPasswords } from "./workspace-summary";
import { useWorkspaceSummary } from "./use-workspace-summary";
import { Empty, liveAssets, PageTitle, useAppContext } from "./view-shared";
import "./workspaces.css";
import { catalogAssets, catalogScope, isManagedAsset, type CatalogScope, type CatalogSort } from "./catalog-view";
import { readWorkspaceReturn, workspaceReturnKey } from "./workspace-return";
import { localRepository } from "../../../packages/local-db/src";
import { CompactAccountCard } from "./components/CompactAccountCard";

const AssetEditor = lazy(() => import("./workflow-asset-editor").then((module) => ({ default: module.AssetEditor })));
type AssetView = "all" | "project" | "item" | "subscription" | "domains" | "ledger";

function AssetTabs({ view, categories, categoryId, onManage }: { view: AssetView; categories: Category[]; categoryId?: string; onManage: (creating: boolean) => void }) {
	const { t } = useTranslation();
	return <nav className="workspace-navigation" aria-label={t("assetsWorkspace")}>
		<Link to="/assets" activeOptions={{ exact: true }} aria-current={view === "all" ? "page" : undefined}>{t("all")}</Link>
		{(["item", "subscription"] as const).map((kind) => <Link key={kind} to="/assets/$kind" params={{ kind }} activeOptions={{ exact: true }} aria-current={view === kind ? "page" : undefined}>{t(kind)}</Link>)}
		<Link to="/finance" activeOptions={{ exact: true }} aria-current={view === "ledger" ? "page" : undefined}>{t("workspaceLedger")}</Link>
		{categories.filter(category => !category.hidden).map(category => <Link key={category.id} to="/assets/category/$categoryId" params={{ categoryId: category.id }} aria-current={categoryId === category.id ? 'page' : undefined}>{catalogCategoryLabel(category,t)}</Link>)}
		<Button size="small" onClick={() => onManage(true)}><Plus size={15}/>{t('catalogNew')}</Button><Button variant="ghost" size="small" onClick={() => onManage(false)}>{t('catalogManage')}</Button>
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

function AssetCatalog({ categoryId }: { categoryId?: string }) {
	const { data, search } = useAppContext();
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const summary = useWorkspaceSummary();
 const [assetView, setAssetView] = useAssetView();
	const queryKey = `keepany-catalog-query-${categoryId ?? 'all'}`;
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
		if (!saved || saved.view !== 'all') return;
		const frame = requestAnimationFrame(() => { window.scrollTo(0, saved.scrollY); restoredScroll.current = true; });
		return () => cancelAnimationFrame(frame);
	}, [data.loading, categoryId]);
	function rememberCatalog(assetId: string) {
		sessionStorage.setItem(workspaceReturnKey, JSON.stringify({ view: 'all', assetId, query, scrollY: window.scrollY }));
	}
	const [createOpen, setCreateOpen] = useState(false);
	const [createKind, setCreateKind] = useState<'record' | 'item' | 'subscription'>('record');
	const [recordEdit,setRecordEdit] = useState(false);
	const [newCategory,setNewCategory] = useState(categoryId ?? '');
	const [editor, setEditor] = useState<AssetKind | null>(null);
	const categories = catalogCategories(data.categories);
	const category = categories.find(value => value.id === categoryId);
	const assets = liveAssets(data).filter((asset) => ["item", "subscription"].includes(asset.kind));
	const visible = catalogAssets(assets, ["managed", "all", "archived"].includes(scope) ? scope : "managed", sort).filter((asset) => [search, query].every((value) => matchesAssetSearch(asset, value)));
	const records = catalogRecords(data.assets,data.categories).filter(record => (categoryId === undefined || record.categoryId === categoryId) && (scope === 'all' || isManagedAsset(record.asset) === (scope === 'managed')) && [search,query].every(value=>matchesAssetSearch(record.asset,value)));
	const rows = [...records.map(record=>({record,asset:record.asset})),...(categoryId===undefined?visible.map(asset=>({record:undefined,asset})):[])].sort((a,b) => (sort === 'due' ? (a.asset.dueDate || a.asset.warrantyDate || '9999').localeCompare(b.asset.dueDate || b.asset.warrantyDate || '9999') : b.asset.updatedAt.localeCompare(a.asset.updatedAt)) || a.asset.name.localeCompare(b.asset.name));
	const hash = useRouterState({select:state=>state.location.hash});
	useEffect(()=>{if(hash === 'new' && !data.loading){setNewCategory(categoryId ?? '');setRecordEdit(true);void navigate({hash:'',replace:true});}},[hash,data.loading,categoryId,navigate]);

	function create(event: FormEvent) {
		event.preventDefault();
		setCreateOpen(false); if (createKind === 'record') setRecordEdit(true); else setEditor(createKind);
	}
	const hasResults = (categoryId === undefined && visible.length > 0) || records.length > 0;
	if(data.loading)return <main className="page"><p role="status">{t('loading')}</p></main>;
	return <main className="page workspace-catalog">
		<PageTitle title={categoryId === undefined ? t('assetsWorkspace') : category ? catalogCategoryLabel(category,t) : t('catalogUnclassified')} subtitle={t('catalogSubtitle')}
			action={<Button variant="primary" onClick={() => { setCreateKind('record');setNewCategory(category?.id ?? ''); if(categoryId !== undefined)setRecordEdit(true);else setCreateOpen(true); }}><Plus size={17} />{t("workspaceAddAsset")}</Button>} />
		{categoryId === undefined && <div className="workspace-summary-grid">
			<section className="card"><span>{t("workspacePurchaseTotal")}</span><strong><MoneyTotal totals={summary.purchases} empty={t("workspaceAmountMissing")} /></strong></section>
			<section className="card"><span>{t("workspaceRecordedSpending")}</span><strong><MoneyTotal totals={summary.spending} empty={t("financeNoRecords")} /></strong></section>
			<section className="card"><span>{t("workspaceMonthlyPlan")}</span><strong><MoneyTotal totals={summary.monthly} empty={t("financeNoPlan")} /></strong></section>
			<section className="card"><span>{t("workspaceUpcoming")}</span><strong>{summary.upcoming}</strong></section>
		</div>}
		<div className="workspace-catalog-controls"><label className="field">{t("assetStatusView")}<Select value={scope} onValueChange={value => { setScope(value as CatalogScope); sessionStorage.setItem("keepany-catalog-scope", value); }}>{(["managed", "all", "archived"] as const).map(value => <SelectOption key={value} value={value}>{t(value === "managed" ? "managedAssets" : value === "all" ? "all" : "archivedAssets")}</SelectOption>)}</Select></label><label className="field">{t("assetSort")}<Select value={sort} onValueChange={value => { setSort(value as CatalogSort); sessionStorage.setItem("keepany-catalog-sort", value); }}><SelectOption value="updated">{t("recentlyUpdated")}</SelectOption><SelectOption value="due">{t("nearestDue")}</SelectOption></Select></label></div>
		<div className="workspace-search"><label className="asset-account-search"><Search size={18} /><Input type="search" value={query} aria-label={t("workspaceSearch")} placeholder={t("workspaceSearch")} onChange={(event) => { setQuery(event.target.value); sessionStorage.setItem(queryKey, event.target.value); }} /></label><AssetViewToggle value={assetView} onChange={setAssetView} /><span>{t("workspaceAssetCount", { count: (categoryId === undefined ? visible.length : 0) + records.length })}</span></div>
		{hasResults ? <section className={`asset-list-content workspace-asset-grid${assetView === "list" ? " asset-dense-list" : ""}`} aria-label={t('catalogRecords')}>
      {rows.map(({record,asset})=>record?<CatalogRecordCard key={record.id} record={record} onOpen={()=>sessionStorage.setItem('keepany-catalog-record-return',JSON.stringify({recordId:record.id,categoryId:categoryId??null}))} categoryName={catalogCategoryLabel(categories.find(category=>category.id===record.categoryId) ?? {id:'',kind:'project',name:t('catalogUnclassified'),order:0,deleted:false},t)}/>:<LibraryCard key={asset.id} asset={asset} search={search} summary={summary.summaries.get(asset.id)} onOpen={()=>rememberCatalog(asset.id)}/>)}
		</section> : query || search ? <div className="empty"><strong>{t("noMatches")}</strong></div> : <Empty />}
		{createOpen && <Dialog title={t("workspaceAddAsset")} onClose={() => setCreateOpen(false)}><form className="workspace-create-form" onSubmit={create}>
			<label className="field" htmlFor="workspace-create-kind">{t("workspaceAssetType")}<Select id="workspace-create-kind" value={createKind} onValueChange={(value) => setCreateKind(value as typeof createKind)}>{(['record','item','subscription'] as const).map(kind=><SelectOption key={kind} value={kind}>{t(kind==='record'?'catalogRecords':kind)}</SelectOption>)}</Select></label>
			{createKind==='record'&&<label className="field" htmlFor="workspace-create-category">{t('category')}<Select id="workspace-create-category" value={newCategory} onValueChange={setNewCategory}><SelectOption value="">{t('catalogUnclassified')}</SelectOption>{categories.map(category=><SelectOption key={category.id} value={category.id}>{catalogCategoryLabel(category,t)}</SelectOption>)}</Select></label>}
			<div className="actions"><Button variant="primary" type="submit">{t('workspaceContinue')}</Button><Button type="button" onClick={() => setCreateOpen(false)}>{t("cancel")}</Button></div>
		</form></Dialog>}
		{editor && <Suspense fallback={<div className="toast" role="status">{t("loading")}</div>}><AssetEditor kind={editor} categories={data.categories} onClose={() => setEditor(null)} /></Suspense>}
		{recordEdit && <CatalogRecordEditor categoryId={newCategory} onClose={()=>setRecordEdit(false)}/>}
	</main>;
}

export function AssetsWorkspace({ view = "all", categoryId }: { view?: AssetView; categoryId?: string }) {
	const {t}=useTranslation();const navigate=useNavigate();const registry=useCatalogCategories();const [manager,setManager]=useState<boolean|null>(null);
	const selected=categoryId !== undefined ? (registry.categories.some(category=>category.id===categoryId)?categoryId:'') : (view==='project'||view==='domains'?registry.categories.find(category=>category.source===view)?.id ?? '':undefined);
	return <div className="workspace-page"><AssetTabs view={selected!==undefined?'project':view} categories={registry.categories} categoryId={selected} onManage={setManager}/>{registry.error&&<div role="alert" className="notice">{t('error')}<Button onClick={registry.retry}>{t('retry')}</Button></div>}{view === "ledger" ? <FinancePage /> : view === 'item' || view==='subscription' ? <AssetKindList key={view} kind={view}/> : <AssetCatalog key={selected ?? 'all'} categoryId={selected}/>}{manager!==null&&<CatalogCategoryManager creating={manager} onClose={()=>setManager(null)} onCreated={id=>void navigate({to:'/assets/category/$categoryId',params:{categoryId:id}})}/>}</div>;
}

export function CategoryWorkspaceRoute(){const categoryId=useRouterState({select:state=>(state.matches.at(-1)?.params as {categoryId:string}).categoryId});return <AssetsWorkspace categoryId={categoryId}/>;}

export function FinanceWorkspaceRoute() { return <AssetsWorkspace view="ledger" />; }

export function WorkspaceLegacyRoute() {
	const params = useRouterState({ select: (state) => state.matches.at(-1)?.params }) as { kind?: string } | undefined;
	const kind = params?.kind;
	if (kind === "account" || kind === "vault") return <AccountsWorkspace />;
	return <AssetsWorkspace view={kind === "item" || kind === "subscription" || kind === "domains" ? kind : "project"} />;
}
