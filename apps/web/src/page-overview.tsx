import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, CalendarDays, Layers2, LockKeyhole, Repeat2, ScanEye } from "lucide-react";
import { date, useAppContext } from "./view-shared";
import { usePasswordVault } from "./components/PasswordVaultProvider";
import { RemainingDays } from "./components/AssetMetrics";
import { SampleLibraryButton } from "./components/SampleLibraryButton";
import { Dialog } from "./components/ui/dialog";
import { Button } from "./components/ui/button";
import { buildOverviewAttention, overviewGraphData, type OverviewAttention } from "./overview-model";
import { useLocalDay } from "./use-local-day";
import "./overview-restoration.css";

const Graph = lazy(() => import("./account-family-graph-view").then(module => ({ default: module.AssetRelationGraph })));

export function Overview() {
 const { data } = useAppContext();
 const { t, i18n } = useTranslation();
 const { snapshot, ensureReady } = usePasswordVault();
 const navigate = useNavigate(), today = useLocalDay();
 const [list, setList] = useState<"upcoming" | "overdue" | null>(null);
 const [edgeId, setEdgeId] = useState<string | null>(null);
 const [vaultError, setVaultError] = useState(false);
 useEffect(() => { void ensureReady().catch(() => setVaultError(true)); }, [ensureReady]);
 const unlocked = snapshot.status === "unlocked";
 const graph = useMemo(() => overviewGraphData(data.assets, data.relations, unlocked ? snapshot.entries : []), [data.assets, data.relations, unlocked, snapshot.entries]);
 const attention = useMemo(() => buildOverviewAttention(data.assets, data.tasks, today), [data.assets, data.tasks, today]);
 const byId = new Map(graph.assets.map(asset => [asset.id, asset]));
 const staleRelations = data.relations.filter(relation => {
  if (relation.deleted || !byId.has(relation.from) || !byId.has(relation.to) || relation.from === relation.to) return false;
  if (byId.get(relation.from)?.kind !== "account" && byId.get(relation.to)?.kind !== "account") return false;
  const checked = relation.verifiedAt ? Date.parse(relation.verifiedAt) : NaN;
  return !Number.isFinite(checked) || checked < new Date(`${today}T00:00:00`).getTime() - 90 * 86400000;
 });
 const first = staleRelations[0];
 const account = first && [first.from, first.to].map(id => byId.get(id)).find(asset => asset?.kind === "account");
 const counts = { account: 0, item: 0, subscription: 0, project: 0 };
 for (const asset of graph.assets) if (asset.kind !== "vault") counts[asset.kind]++;
 const visit = (asset: (typeof graph.assets)[number]) => {
  if (asset.id.startsWith("login-") && !data.assets.some(row => row.id === asset.id)) void navigate({ to: "/accounts", hash: `login-detail-${asset.id.slice(6)}` });
  else void navigate({ to: "/assets/$kind/$id", params: { kind: asset.kind, id: asset.id } });
 };
 function row(item: OverviewAttention) {
  const content = <><span className="overview-action-icon"><Repeat2 size={16}/></span><span className="overview-action-copy"><strong>{item.name}</strong><small>{date(item.dueDate, i18n.language)} · {t(({ task: "tasks", renewal: "overviewRenewal", warranty: "overviewWarranty", date: "dueDate" })[item.type])}</small></span><strong className="overview-action-date"><RemainingDays days={item.days}/></strong></>;
  return item.asset ? <Link className="overview-action-row" key={item.id} to="/assets/$kind/$id" params={{ kind: item.asset.kind, id: item.asset.id }}>{content}</Link> : <Link className="overview-action-row" key={item.id} to="/tasks" hash={`task-${item.taskId}`}>{content}</Link>;
 }
 return <main className="page overview-page">
  <div className="overview-stats">
   <div className="card overview-stat"><span>{t("overviewAllRecorded")}<Layers2 size={16}/></span><strong>{graph.assets.length}</strong><small>{t("overviewKindCounts", counts)}</small></div>
   <div className="card overview-stat"><span>{t("overviewNextThirty")}<CalendarDays size={16}/></span><strong>{attention.upcoming.filter(item => item.days <= 30).length}</strong><small>{t("overviewOverdueCount", { count: attention.overdue.length })}</small></div>
   <div className="card overview-stat"><span>{t("overviewRelationsReview")}<ScanEye size={16}/></span><strong>{staleRelations.length}</strong><small>{t("overviewRelationsHint")}</small></div>
  </div>
  <section className="overview-panel overview-graph-panel">
   <div className="overview-panel-head"><div><h1>{t("overviewAllRelations")}</h1><p>{t("overviewGraphCounts", { records: graph.assets.length, connections: graph.relations.length })}</p></div><div className="overview-graph-account"><small>{t(vaultError ? "error" : unlocked ? "overviewVaultUnlocked" : "overviewVaultLocked")}</small><Link to="/accounts">{t("overviewAllAccounts", { count: counts.account })} <ArrowRight size={15}/></Link></div></div>
   {graph.assets.length ? <Suspense fallback={<p className="overview-quiet" role="status">{t("loading")}</p>}><Graph key={unlocked ? "unlocked" : "locked"} scope="all" assets={graph.assets} relations={graph.relations.map(relation => relation.label ? relation : { ...relation, label: t("relations") })} matches={new Set()} selectedEdgeId={edgeId} onSelectEdge={setEdgeId} onVisit={visit}/></Suspense> : <div className="overview-graph-empty"><p>{t("catalogEmptyRecords")}</p><div className="actions"><Link className="button" to="/assets" hash="new">{t("add")} {t("catalogRecords")}</Link>{!data.loading && data.assets.length === 0 && <SampleLibraryButton label={t("overviewTrySample")}/>}</div></div>}
  </section>
  <div className="overview-panels">
   <section className="overview-panel"><div className="overview-panel-head"><h2>{t("overviewCountdown")}</h2><Button variant="ghost" size="small" onClick={() => setList("upcoming")}>{t("viewAll")} <ArrowRight size={15}/></Button></div>
    {attention.upcoming.length ? attention.upcoming.slice(0, 3).map(row) : <div className="overview-quiet">{t("overviewNoActions")}</div>}
    <div className="overview-countdown-footer"><button type="button" onClick={() => setList("overdue")}>{t("overviewOverdueCount", { count: attention.overdue.length })} <ArrowRight size={14}/></button><Link to="/tasks">{t("viewTasks")} <ArrowRight size={14}/></Link></div>
   </section>
   <section className="overview-panel"><div className="overview-panel-head"><h2>{t("overviewAccountReminders")}</h2><Link to="/accounts">{t("overviewAllConnections")} <ArrowRight size={15}/></Link></div>
    {account ? <div className="overview-risk"><div><h3>{account.name}</h3><p>{t("overviewOldRelation", { count: staleRelations.filter(relation => relation.from === account.id || relation.to === account.id).length })}</p><small>{t("overviewBeforeChanges")}</small></div><Button size="small" onClick={() => visit(account)}><ArrowRight size={16}/>{t("viewConnections")}</Button></div> : <div className="overview-quiet">{t("overviewNoRelationReminders")}</div>}
   </section>
  </div>
  <footer className="overview-footer"><span><LockKeyhole size={13}/>{t("overviewLocalStorage")}</span><Link to="/backup">{t("backupAndRestore")}</Link></footer>
  {list && <Dialog title={t(list === "overdue" ? "overdue" : "overviewCountdown")} className="overview-countdown-dialog" onClose={() => setList(null)}><div className="overview-countdown-list">{attention[list].length ? attention[list].map(row) : <p className="overview-quiet">{t("overviewNoActions")}</p>}</div><div className="actions"><Button onClick={() => setList(null)}>{t("close")}</Button><Link className="button" to="/tasks">{t("viewTasks")}</Link></div></Dialog>}
 </main>;
}
