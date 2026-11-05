import { useEffect, useRef } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { TaskRow } from "./TaskRow";
import { Button } from "./components/ui/button";
import { useAppContext } from "./view-shared";
import "./reminder-entry.css";

/** Context is revealed only after entering a specific reminder; the asset stays the page. */
export function ReminderTaskContext({ assetId }: { assetId: string }) {
 const { data } = useAppContext();
 const { t } = useTranslation();
 const navigate = useNavigate();
 const hash = useRouterState({ select: state => state.location.hash });
 const region = useRef<HTMLElement>(null);
 let selectedId = "";
 if (hash.startsWith("reminder-task-")) {
  try { selectedId = decodeURIComponent(hash.slice("reminder-task-".length)); } catch { /* malformed historical hash stays unavailable */ }
 }
 useEffect(() => {
  if (!selectedId) return;
  region.current?.scrollIntoView({ block: "start" });
  region.current?.focus({ preventScroll: true });
 }, [selectedId]);
 if (!hash.startsWith("reminder-task-")) return null;
 const task = data.tasks.find(row => row.id === selectedId && row.assetId === assetId && !row.deleted && !row.purged);
 return <section ref={region} tabIndex={-1} className="card reminder-task-context" aria-label={t("reminderEntryDetails")}>
  <header><h2>{t("reminderEntryDetails")}</h2><Button variant="ghost" size="icon" aria-label={t("close")} onClick={() => void navigate({ hash: "", replace: true }).then(() => document.getElementById("reminder-bell")?.focus({ preventScroll: true }))}><X size={18}/></Button></header>
  {task ? <TaskRow key={task.id} task={task} hideRelated compact/> : <p role="status">{t("reminderEntryMissing")}</p>}
 </section>;
}
