import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, ArrowUpRight, Bell, CalendarDays, Layers2, Plus, ScanEye, TriangleAlert } from "lucide-react";
import type { Asset } from "../../../packages/domain/src";
import { date, liveAssets, useAppContext } from "./view-shared";
import "./overview-restoration.css";

type Attention = { id: string; name: string; meta: string; dueDate: string; asset?: Asset };
const day = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;

export function Overview() {
  const { data } = useAppContext();
  const { t, i18n } = useTranslation();
  const assets = liveAssets(data);
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const now = new Date();
  const today = day(now);
  const inThirtyDays = day(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30));
  const inSevenDays = day(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
  const attention: Attention[] = [
    ...data.tasks.filter((task) => !task.deleted && !task.done).map((task) => ({
      id: `task-${task.id}`, name: task.name, meta: byId.get(task.assetId)?.name || t("tasks"), dueDate: task.dueDate,
    })),
    ...assets.filter((asset) => asset.kind === "subscription" && asset.status === "active" && asset.dueDate).map((asset) => ({
      id: `renew-${asset.id}`, name: asset.name, meta: t("overviewRenewal"), dueDate: asset.dueDate, asset,
    })),
    ...assets.filter((asset) => asset.kind === "item" && asset.status !== "archived" && asset.warrantyDate).map((asset) => ({
      id: `warranty-${asset.id}`, name: asset.name, meta: t("overviewWarranty"), dueDate: asset.warrantyDate, asset,
    })),
  ].sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
  const upcoming = attention.filter((item) => item.dueDate && item.dueDate >= today && item.dueDate <= inThirtyDays);
  const weekCount = upcoming.filter((item) => item.dueDate <= inSevenDays).length;
  const staleRelations = data.relations.filter((relation) => {
    if (relation.deleted || !byId.has(relation.from) || !byId.has(relation.to)) return false;
    if (byId.get(relation.from)?.kind !== "account" && byId.get(relation.to)?.kind !== "account") return false;
    const checked = relation.verifiedAt ? Date.parse(relation.verifiedAt) : NaN;
    return !Number.isFinite(checked) || checked < now.getTime() - 90 * 86400000;
  });
  const first = staleRelations[0];
  const account = first && [first.from, first.to].map((id) => byId.get(id)).find((asset) => asset?.kind === "account");
  const noVault = assets.filter((asset) => asset.kind === "account" && !data.relations.some((relation) =>
    !relation.deleted && (relation.from === asset.id || relation.to === asset.id) &&
    (byId.get(relation.from)?.kind === "vault" || byId.get(relation.to)?.kind === "vault"),
  ));
  const projects = assets.filter((asset) => asset.kind === "project").slice(0, 2);
  const connected = (project: Asset) => {
    const ids = new Set(data.relations.filter((relation) => !relation.deleted && (relation.from === project.id || relation.to === project.id))
      .map((relation) => relation.from === project.id ? relation.to : relation.from));
    return [...ids].map((id) => byId.get(id)).filter((asset): asset is Asset => !!asset);
  };
  return <main className="page overview-page">
    <section className="overview-hero">
      <div><span className="eyebrow">YOUR WORLD, ALL CONNECTED</span><h1>{t("overviewHero")}</h1><p>{t("overviewHeroHint")}</p></div>
      <Link to="/assets/$kind" params={{ kind: "project" }} className="button overview-hero-action"><ArrowUpRight size={16}/>{t("exploreProjects")}</Link>
    </section>
    <div className="overview-intake-bar"><strong>{t("overviewCollectHint")}</strong><Link className="button" to="/intake"><Plus size={15}/>{t("quickIntake")}</Link><Link className="button" to="/tasks">{t("viewTasks")} <ArrowRight size={15}/></Link></div>
    <div className="overview-stats">
      <div className="card overview-stat"><span>{t("overviewRecorded")}<Layers2 size={16}/></span><strong>{assets.length}</strong><small>{t("overviewRecordedHint")}</small></div>
      <div className="card overview-stat"><span>{t("overviewNextThirty")}<CalendarDays size={16}/></span><strong>{upcoming.length}</strong><small>{t("overviewThisWeek", { count: weekCount })}</small></div>
      <div className="card overview-stat"><span>{t("overviewRelationsReview")}<ScanEye size={16}/></span><strong>{staleRelations.length}</strong><small>{t("overviewRelationsHint")}</small></div>
    </div>
    <div className="overview-panels">
      <section className="overview-panel"><div className="overview-panel-head"><div><h2>{t("overviewNextActions")}</h2><p>{t("overviewDueOrder")}</p></div><Link to="/tasks">{t("viewAll")} <ArrowRight size={15}/></Link></div>
        {attention.length ? attention.slice(0, 3).map((item) => {
          const content = <><span className="overview-action-icon"><Bell size={16}/></span><span className="overview-action-copy"><strong>{item.name}</strong><small>{item.meta}</small></span><span className="overview-action-date"><strong>{date(item.dueDate, i18n.language)}</strong>{item.dueDate && item.dueDate < today ? t("overdue") : ""}</span></>;
          return item.asset ? <Link className="overview-action-row" key={item.id} to="/assets/$kind/$id" params={{ kind: item.asset.kind, id: item.asset.id }}>{content}</Link> :
            <Link className="overview-action-row" key={item.id} to="/tasks">{content}</Link>;
        }) : <div className="overview-quiet">{t("overviewNoActions")}</div>}
      </section>
      <section className="overview-panel"><div className="overview-panel-head"><div><h2>{t("overviewAccountReminders")}</h2><p>{t("overviewBeforeChanges")}</p></div></div>
        {account ? <div className="overview-risk"><h3><TriangleAlert size={16}/>{account.name}</h3><p>{t("overviewOldRelation", { count: staleRelations.filter((relation) => relation.from === account.id || relation.to === account.id).length })}</p><Link className="button" to="/assets/$kind/$id" params={{ kind: "account", id: account.id }}>{t("viewConnections")}</Link></div> :
          <div className="overview-quiet">{t("overviewNoRelationReminders")}</div>}
        {noVault.length > 0 && <Link className="overview-reminder-row" to="/assets/$kind" params={{ kind: "account" }}><span>{t("overviewUnlinkedVault", { count: noVault.length })}</span><span className="chip">{t("planned")}</span></Link>}
      </section>
    </div>
    <div className="overview-project-heading"><h2>{t("myProjects")}</h2><Link to="/assets/$kind" params={{ kind: "project" }}>{t("allProjects")} <ArrowRight size={15}/></Link></div>
    {projects.length ? <div className="overview-project-grid">{projects.map((project) => {
      const linked = connected(project);
      return <Link key={project.id} className="overview-project-card" to="/assets/$kind/$id" params={{ kind: "project", id: project.id }}>
        <div className="overview-project-top"><span className="overview-project-mark">{project.name.trim().charAt(0).toLocaleUpperCase() || "K"}</span><span className="chip">{t(project.status)}</span></div>
        <h3>{project.name}</h3><p>{[project.description, project.url].filter(Boolean).join(" · ") || t("project")}</p>
        <div className="overview-project-counts"><span><strong>{linked.length}</strong> {t("overviewLinkedAssets", { count: linked.length })}</span><span><strong>{linked.filter((asset) => asset.kind === "account").length}</strong> {t("overviewAccountLabel", { count: linked.filter((asset) => asset.kind === "account").length })}</span><span><strong>{linked.filter((asset) => asset.kind === "subscription").length}</strong> {t("overviewSubscriptionLabel", { count: linked.filter((asset) => asset.kind === "subscription").length })}</span></div>
      </Link>;
    })}</div> : <div className="overview-project-empty"><p>{t("overviewNoProjects")}</p><Link className="button" to="/assets/$kind" params={{ kind: "project" }}>{t("add")} {t("project")}</Link></div>}
  </main>;
}
