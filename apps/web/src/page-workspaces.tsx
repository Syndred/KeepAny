import { Input } from "./components/ui/input";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
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
import { SubscriptionRatesDialog } from "./components/SubscriptionRatesDialog";
import { AssetKindList, LibraryCard, type AccountListFilters } from "./page-asset-list";
import { AssetMasonry } from './components/AssetMasonry';
import { addWalletSamples, walletSamplesId } from './wallet-cards';
import { matchesAssetSearch } from "./asset-search";
import { SAMPLE_LIBRARY_ID, sampleLibraryAssetIds } from "./sample-library";
import { partitionAccountPasswords } from "./workspace-summary";
import { useWorkspaceSummary } from "./use-workspace-summary";
import { Empty, liveAssets, PageTitle, useAppContext } from "./view-shared";
import "./workspaces.css";
import { catalogAssets, catalogScope, isManagedAsset, type CatalogScope, type CatalogSort } from "./catalog-view";
import { readWorkspaceReturn, workspaceReturnKey } from "./workspace-return";
import { localRepository } from "../../../packages/local-db/src";
import type { AccountTemplate } from "./account-entry-save";
import { CompactAccountCard } from "./components/CompactAccountCard";

const AssetEditor = lazy(() => import("./workflow-asset-editor").then((module) => ({ default: module.AssetEditor })));
type AssetView = "all" | "project" | "item" | "subscription" | "domains" | "wallet";

function AssetTabs({ view, categories, categoryId, onManage }: { view: AssetView; categories: Category[]; categoryId?: string; onManage: (creating: boolean) => void }) {
	const { t } = useTranslation();
	return <nav className="workspace-navigation" aria-label={t("assetsWorkspace")}>
		<Link to="/assets" activeOptions={{ exact: true }} aria-current={view === "all" ? "page" : undefined}>{t("all")}</Link>
		{(["item", "subscription"] as const).map((kind) => <Link key={kind} to="/assets/$kind" params={{ kind }} activeOptions={{ exact: true }} aria-current={view === kind ? "page" : undefined}>{t(kind)}</Link>)}
		<Link to="/cards" activeOptions={{ exact: true }} aria-current={view === "wallet" ? "page" : undefined}>{t("wallet")}</Link>
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
	const [editAccount, setEditAccount] = useState<{ asset?: Asset; entryId?: string; triggerId?: string; template?: AccountTemplate; initialName?: string } | null>(null);
    const [deleteAccount, setDeleteAccount] = useState<{ asset: Asset; vaultRevision: string } | null>(null);
    const [deleteBusy, setDeleteBusy] = useState(false), [deleteError, setDeleteError] = useState("");
    const navigate = useNavigate();
    const creationConsumed = useRef(false);
    useEffect(() => { if (hash === "vault-trash") void navigate({ to: "/trash", hash: "", replace: true }); }, [hash, navigate]);
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
		<h1 className="sr-only">{t("accountsWorkspace")}</h1>
		<Suspense fallback={<p role="status">{t("loading")}</p>}>
			<PasswordVaultPanel accountToolbar assets={data.assets} sampleAccounts={sampleAccounts} accountCount={data.assets.filter(asset => asset.kind === "account" && !asset.deleted).length + grouped.unlinked.length} notify={notify}
				headerFeedback={<div className="compact-account-feedback-slot" ref={registerFeedbackTarget} />}
				headerAction={({ busy, clearMessage }) => <Button variant="primary" title={t("workspaceAddAccount")} disabled={busy || data.pendingCategoryEdits.some((pending) => pending.kind === "account")} onClick={() => { clearMessage(); setEditAccount({}); }}><Plus size={17} />{t("add")}</Button>}
				renderAccounts={(tools, toolbarActions) => <AssetKindList kind="account" embedded hideTitle toolbarActions={toolbarActions} privateSearch={snapshot.status === "unlocked"}
                    accountExtras={virtualAccounts} filterAccountId={filterAccountId}
                    beforeList={filterAccountId ? <div className="password-vault-filter"><span>{data.assets.find(asset => asset.id === filterAccountId)?.name}</span><Button onClick={() => void navigate({ to: "/accounts", hash: "", replace: true })}>{t("pwVaultClearAssetFilter")}</Button></div> : null}
					accountSearchExtras={searchExtras} onAccountFiltersChange={setFilters}
					renderAccountCard={(asset, context) => <CompactAccountCard asset={asset} entries={virtualEntries.has(asset.id) ? [virtualEntries.get(asset.id)!] : grouped.linked.get(asset.id) ?? []} virtual={virtualEntries.has(asset.id)} onCreate={(template, triggerId) => setEditAccount({ template, triggerId })} onEdit={(asset, entryId, triggerId) => setEditAccount({ asset: virtualEntries.has(asset.id) ? undefined : asset, entryId, triggerId })} onDeleteAccount={asset => { const current = session?.getSnapshot(); if (current?.status !== "unlocked" || !current.revision || current.entries.some(entry => entry.linkedAssetIds.includes(asset.id))) return; setDeleteError(""); setDeleteAccount({ asset, vaultRevision: current.revision }); }} {...context} connectionCount={virtualEntries.has(asset.id) ? virtualEntries.get(asset.id)!.linkedAssetIds.filter(id => data.assets.some(asset => asset.id === id && !asset.deleted)).length : context.connectionCount} tools={tools} focusEntryId={hash.startsWith("password-") ? hash.slice(9) : undefined} />} />}
			/>
		</Suspense>
		{snapshot.status === "unlocked" && editAccount && <Suspense fallback={<p role="status">{t("loading")}</p>}><AccountEntryDialog {...editAccount} returnFocusTo={() => editAccount.triggerId ? document.getElementById(editAccount.triggerId) : document.querySelector<HTMLElement>(".account-toolbar-actions button")} onClose={() => setEditAccount(null)} /></Suspense>}
        {snapshot.status === "unlocked" && deleteAccount && <Dialog title={t("pwVaultDeleteEntry")} onClose={() => { if (!deleteBusy) setDeleteAccount(null); }} closeDisabled={deleteBusy}><p>{deleteAccount.asset.name}</p>{deleteError && <p role="alert" className="field-error">{deleteError}</p>}<div className="actions"><Button disabled={deleteBusy} onClick={() => setDeleteAccount(null)}>{t("cancel")}</Button><Button variant="danger" disabled={deleteBusy} onClick={() => void removeOrdinaryAccount()}>{t("pwVaultDeleteEntry")}</Button></div></Dialog>}
	</main>;
}

function AssetCatalog({ categoryId, kind, navigation }: { categoryId?: string; kind?: "item" | "subscription" | "wallet"; navigation: ReactNode }) {
	const { data, search, notify } = useAppContext();
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const summary = useWorkspaceSummary();
 const [ratesOpen, setRatesOpen] = useState(false);
	const queryKey = `keepany-catalog-query-${kind ?? categoryId ?? 'all'}`;
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
		if (!saved || saved.view !== (kind ?? 'all')) return;
		const frame = requestAnimationFrame(() => { window.scrollTo(0, saved.scrollY); restoredScroll.current = true; });
		return () => cancelAnimationFrame(frame);
	}, [data.loading, categoryId, kind]);
	function rememberCatalog(assetId: string) {
		sessionStorage.setItem(workspaceReturnKey, JSON.stringify({ view: kind ?? 'all', assetId, query, scrollY: window.scrollY }));
	}
	const [createOpen, setCreateOpen] = useState(false);
	const [createKind, setCreateKind] = useState<'record' | 'item' | 'subscription' | 'wallet'>(kind ?? 'record');
	const [recordEdit,setRecordEdit] = useState(false);
 const [samplesOpen,setSamplesOpen] = useState(false), [samplesBusy,setSamplesBusy] = useState(false), [samplesError,setSamplesError] = useState('');
 const samplesRunning = useRef(false);
 async function installSamples() {
  if(samplesRunning.current)return; samplesRunning.current=true;setSamplesBusy(true);setSamplesError('');
  try {await addWalletSamples(t);setSamplesOpen(false);notify(t('saved'));}catch{setSamplesError(t('error'));}finally{samplesRunning.current=false;setSamplesBusy(false);}
 }
	const [newCategory,setNewCategory] = useState(categoryId ?? '');
	const [editor, setEditor] = useState<AssetKind | null>(null);
	const categories = catalogCategories(data.categories);
	const category = categories.find(value => value.id === categoryId);
	const assets = liveAssets(data).filter((asset) => kind ? asset.kind === kind : ["item", "subscription"].includes(asset.kind));
	const visible = catalogAssets(assets, ["managed", "all", "archived"].includes(scope) ? scope : "managed", sort).filter((asset) => [search, query].every((value) => matchesAssetSearch(asset, value)));
	const records = catalogRecords(data.assets,data.categories).filter(record => (kind === 'wallet' ? !!record.asset.walletCard : !kind) && (categoryId === undefined || record.categoryId === categoryId) && (scope === 'all' || isManagedAsset(record.asset) === (scope === 'managed')) && [search,query].every(value=>matchesAssetSearch(record.asset,value)));
	const rows = [...records.map(record=>({record,asset:record.asset})),...(categoryId===undefined?visible.map(asset=>({record:undefined,asset})):[])].sort((a,b) => (sort === 'due' ? (a.asset.dueDate || a.asset.warrantyDate || '9999').localeCompare(b.asset.dueDate || b.asset.warrantyDate || '9999') : b.asset.updatedAt.localeCompare(a.asset.updatedAt)) || a.asset.name.localeCompare(b.asset.name));
	const hash = useRouterState({select:state=>state.location.hash});
	useEffect(()=>{if(hash === 'new' && !data.loading){setNewCategory(categoryId ?? '');setCreateKind(kind ?? 'record');if(kind && kind !== 'wallet')setEditor(kind);else setRecordEdit(true);void navigate({hash:'',replace:true});}},[hash,data.loading,categoryId,kind,navigate]);

	function create(event: FormEvent) {
		event.preventDefault();
		setCreateOpen(false); if (createKind === 'record' || createKind === 'wallet') setRecordEdit(true); else setEditor(createKind);
	}
	const hasResults = (categoryId === undefined && visible.length > 0) || records.length > 0;
	if(data.loading)return <main className="page"><p role="status">{t('loading')}</p></main>;
	return <main className="page workspace-catalog">
        <h1 className="sr-only">{kind ? t(kind) : categoryId === undefined ? t('assetsWorkspace') : category ? catalogCategoryLabel(category,t) : t('catalogUnclassified')}</h1>
        <div className="catalog-summary-bar">
            <div className="catalog-summary-stat"><span>{t("workspacePurchaseTotal")}</span><strong><MoneyTotal totals={summary.purchases} empty={t("workspaceAmountMissing")} /></strong></div>
            <div className="catalog-summary-stat"><span>{t("workspaceMonthlyPlan")}</span><strong><MoneyTotal totals={summary.monthlyCny} empty={summary.unconvertedSubscriptions ? "—" : t("financeNoPlan")} /></strong>{summary.unconvertedSubscriptions > 0 && <small role="status">{t('subscriptionCnyPartial',{count:summary.unconvertedSubscriptions})}</small>}<button type="button" className="catalog-rate-button" onClick={()=>setRatesOpen(true)}>{t('subscriptionRates')}</button></div>
            <div className="catalog-summary-stat"><span>{t("workspaceUpcoming")}</span><strong>{summary.upcoming}</strong></div>
            <div className="catalog-summary-stat"><span>{t("walletCount")}</span><strong>{data.assets.filter(asset=>!asset.deleted && !!asset.walletCard && isManagedAsset(asset)).length}</strong></div>
            <Button variant="primary" onClick={() => { setCreateKind(kind ?? 'record');setNewCategory(category?.id ?? ''); if(categoryId !== undefined || kind === 'wallet')setRecordEdit(true);else if(kind)setEditor(kind);else setCreateOpen(true); }}><Plus size={17} />{t("workspaceAddAsset")}</Button>
        </div>
        {navigation}
        <div className="workspace-catalog-controls">
            <label className="asset-account-search"><Search size={18} /><Input type="search" value={query} aria-label={t("workspaceSearch")} placeholder={t("workspaceSearch")} onChange={(event) => { setQuery(event.target.value); sessionStorage.setItem(queryKey, event.target.value); }} /></label>
            <label className="field"><span className="sr-only">{t("assetStatusView")}</span><Select aria-label={t('assetStatusView')} value={scope} onValueChange={value => { setScope(value as CatalogScope); sessionStorage.setItem("keepany-catalog-scope", value); }}>{(["managed", "all", "archived"] as const).map(value => <SelectOption key={value} value={value}>{t(value === "managed" ? "managedAssets" : value === "all" ? "all" : "archivedAssets")}</SelectOption>)}</Select></label>
            <label className="field"><span className="sr-only">{t("assetSort")}</span><Select aria-label={t('assetSort')} value={sort} onValueChange={value => { setSort(value as CatalogSort); sessionStorage.setItem("keepany-catalog-sort", value); }}><SelectOption value="updated">{t("recentlyUpdated")}</SelectOption><SelectOption value="due">{t("nearestDue")}</SelectOption></Select></label>
        </div>
        {ratesOpen && <SubscriptionRatesDialog onClose={()=>setRatesOpen(false)}/>}
		{hasResults ? <AssetMasonry label={t(kind === 'wallet' ? 'wallet' : 'catalogRecords')}>
      {rows.map(({record,asset})=>record?<CatalogRecordCard key={record.id} record={record} onOpen={()=>{rememberCatalog(asset.id);sessionStorage.setItem('keepany-catalog-record-return',JSON.stringify({recordId:record.id,categoryId:categoryId??null,wallet:kind==='wallet'}));}} categoryName={catalogCategoryLabel(categories.find(category=>category.id===record.categoryId) ?? {id:'',kind:'project',name:t('catalogUnclassified'),order:0,deleted:false},t)}/>:<LibraryCard key={asset.id} asset={asset} search={search} summary={summary.summaries.get(asset.id)} onOpen={()=>rememberCatalog(asset.id)}/>)}
		</AssetMasonry> : <section className="asset-list-content">{query || search ? <div className="empty"><strong>{t('noMatches')}</strong></div> : <Empty />}</section>}
        {kind === 'wallet' && !data.preferences.some(p=>p.id===walletSamplesId) && <div className="wallet-sample-action"><Button size="small" onClick={()=>{setSamplesError('');setSamplesOpen(true);}}>{t('walletSamples')}</Button></div>}
        {samplesOpen && <Dialog title={t('walletSamplesTitle')} onClose={()=>setSamplesOpen(false)} closeDisabled={samplesBusy}><p>{t('walletSamplesHint')}</p>{samplesError && <p role="alert" className="field-error">{samplesError}</p>}<div className="actions"><Button disabled={samplesBusy} onClick={()=>setSamplesOpen(false)}>{t('cancel')}</Button><Button variant="primary" disabled={samplesBusy} onClick={()=>void installSamples()}>{t(samplesBusy?'loading':'walletSamples')}</Button></div></Dialog>}
		{createOpen && <Dialog title={t("workspaceAddAsset")} onClose={() => setCreateOpen(false)}><form className="workspace-create-form" onSubmit={create}>
			<label className="field" htmlFor="workspace-create-kind">{t("workspaceAssetType")}<Select id="workspace-create-kind" value={createKind} onValueChange={(value) => setCreateKind(value as typeof createKind)}>{(['record','item','subscription','wallet'] as const).map(kind=><SelectOption key={kind} value={kind}>{t(kind==='record'?'catalogRecords':kind)}</SelectOption>)}</Select></label>
			{createKind==='record'&&<label className="field" htmlFor="workspace-create-category">{t('category')}<Select id="workspace-create-category" value={newCategory} onValueChange={setNewCategory}><SelectOption value="">{t('catalogUnclassified')}</SelectOption>{categories.map(category=><SelectOption key={category.id} value={category.id}>{catalogCategoryLabel(category,t)}</SelectOption>)}</Select></label>}
			<div className="actions"><Button variant="primary" type="submit">{t('workspaceContinue')}</Button><Button type="button" onClick={() => setCreateOpen(false)}>{t("cancel")}</Button></div>
		</form></Dialog>}
		{editor && <Suspense fallback={<div className="toast" role="status">{t("loading")}</div>}><AssetEditor kind={editor} categories={data.categories} onClose={() => setEditor(null)} /></Suspense>}
		{recordEdit && <CatalogRecordEditor wallet={createKind === 'wallet'} categoryId={newCategory} onClose={()=>setRecordEdit(false)}/>}
	</main>;
}

export function AssetsWorkspace({ view = "all", categoryId }: { view?: AssetView; categoryId?: string }) {
	const {t}=useTranslation();const navigate=useNavigate();const registry=useCatalogCategories();const [manager,setManager]=useState<boolean|null>(null);
	const selected=categoryId !== undefined ? (registry.categories.some(category=>category.id===categoryId)?categoryId:'') : (view==='project'||view==='domains'?registry.categories.find(category=>category.source===view)?.id ?? '':undefined);
    const navigation = <AssetTabs view={selected!==undefined?'project':view} categories={registry.categories} categoryId={selected} onManage={setManager}/>;
    return <div className="workspace-page">{registry.error&&<div role="alert" className="notice">{t('error')}<Button onClick={registry.retry}>{t('retry')}</Button></div>}{<AssetCatalog key={view + (selected ?? 'all')} categoryId={selected} kind={view === 'item' || view === 'subscription' || view === 'wallet' ? view : undefined} navigation={navigation}/>}{manager!==null&&<CatalogCategoryManager creating={manager} onClose={()=>setManager(null)} onCreated={id=>void navigate({to:'/assets/category/$categoryId',params:{categoryId:id}})}/>}</div>;
}

export function CategoryWorkspaceRoute(){const categoryId=useRouterState({select:state=>(state.matches.at(-1)?.params as {categoryId:string}).categoryId});return <AssetsWorkspace categoryId={categoryId}/>;}

export function CardsWorkspaceRoute() { return <AssetsWorkspace view="wallet" />; }

export function WorkspaceLegacyRoute() {
	const params = useRouterState({ select: (state) => state.matches.at(-1)?.params }) as { kind?: string } | undefined;
	const kind = params?.kind;
	if (kind === "account" || kind === "vault") return <AccountsWorkspace />;
	return <AssetsWorkspace view={kind === "item" || kind === "subscription" || kind === "domains" ? kind : "project"} />;
}
