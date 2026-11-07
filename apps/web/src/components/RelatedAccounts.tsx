import { ScrollArea } from "@base-ui/react/scroll-area";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, GripVertical, UserRound } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Asset } from "../../../../packages/domain/src";
import { savePreferenceIfCurrent } from "../../../../packages/local-db/src";
import { ACCOUNT_ORDER_ID, reorderAccountPeers } from "../account-order";
import { otherAccountRows, type RelatedAccount } from "../related-accounts";
import { useAccountCardGroups } from "../use-account-card-groups";
import { useAppContext } from "../view-shared";
import { usePasswordVault, type PasswordVaultEntrySummary } from "./PasswordVaultProvider";
import { Button } from "./ui/button";
import "../account-other-accounts.css";

function OtherAccountLink({ row, draggable = false }: { row: RelatedAccount; draggable?: boolean }) {
 const { t } = useTranslation();
 return <Link className="account-related-link" onFocus={event => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" })} data-related-key={row.key} data-same-platform={row.reasons.includes("platform") || undefined} {...(row.assetId ? { to: "/assets/$kind/$id" as const, params: { kind: "account", id: row.assetId }, hash: row.entryId ? `password-${row.entryId}` : "" } : { to: "/accounts" as const, hash: `login-detail-${row.entryId}` })}><span className="account-related-avatar"><UserRound size={18}/></span><span className="account-related-info"><strong title={row.name}>{row.name}</strong><small title={row.username}>{row.username || t("pwVaultValueEmpty")}</small><span className="account-related-reasons">{row.reasons.map(reason => <span key={reason}>{t(`accountRelated_${reason}`)}</span>)}</span></span>{!draggable && <ChevronRight size={16} aria-hidden="true"/>}</Link>;
}

function SortableOtherAccount({ row, id, enabled, busy }: { row: RelatedAccount; id: string; enabled: boolean; busy: boolean }) {
 const { t } = useTranslation();
 const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: busy || !enabled });
 return <div ref={setNodeRef} className={`account-other-item${enabled ? " has-drag-handle" : ""}${isDragging ? " is-dragging" : ""}`} style={{ transform: CSS.Transform.toString(transform), transition }} data-account-order-id={id}>
  <OtherAccountLink row={row} draggable={enabled}/>
  {enabled && <Button asChild type="button" className="account-order-handle" variant="ghost" size="icon" {...attributes} {...listeners} disabled={busy} aria-label={t("accountOrderHandle", { name: row.name })} title={t("accountOrderHandle", { name: row.name })} onClick={event => event.preventDefault()} onFocus={event => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" })}><button ref={setActivatorNodeRef}><GripVertical size={17}/></button></Button>}
 </div>;
}

export function RelatedAccounts({ asset, entry }: { asset: Asset; entry?: PasswordVaultEntrySummary }) {
 const { data, notify } = useAppContext(), { snapshot, session } = usePasswordVault(), { t } = useTranslation();
 const { cardGroups, order, orderPreference } = useAccountCardGroups();
 const viewport = useRef<HTMLDivElement>(null);
 const [busy, setBusy] = useState(false), [error, setError] = useState("");
 const running = useRef(false);
 const members = cardGroups.groups.get(asset.id) ?? [];
 const rows = useMemo(() => snapshot.status === "unlocked" ? otherAccountRows({ asset, entry, assets: data.assets, entries: snapshot.entries }, cardGroups.groups.get(asset.id) ?? []) : [], [asset, entry, data.assets, snapshot.status, snapshot.entries, cardGroups]);
 const peerIds = members.filter(member => member.asset.id !== asset.id).map(member => member.asset.id);
 const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, scrollBehavior: "auto" }));
 if (snapshot.status !== "unlocked" || !rows.length) return null;
 function move(direction: number) {
  const element = viewport.current;
  if (element) element.scrollBy({ left: direction * Math.max(240, element.clientWidth * .8), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
 }
 async function finishDrag(event: DragEndEvent) {
  if (!event.over || event.active.id === event.over.id || running.current || session?.getSnapshot().status !== "unlocked") return;
  running.current = true; setBusy(true); setError("");
  try {
   const value = reorderAccountPeers(members, order, asset.id, String(event.active.id), String(event.over.id));
   await savePreferenceIfCurrent(orderPreference ?? null, { id: ACCOUNT_ORDER_ID, value });
   if (session?.getSnapshot().status === "unlocked") notify(t("accountOrderSaved"));
  } catch { if (session?.getSnapshot().status === "unlocked") setError(t("accountOrderError")); }
  finally { running.current = false; setBusy(false); }
 }
 const rowName = (id: string | number) => members.find(member => member.asset.id === id)?.asset.name ?? "";
 return <section className="card account-related-card account-other-card" aria-labelledby="account-related-title" aria-busy={busy}><ScrollArea.Root className="account-other-scroll">
  <header className="account-other-header"><h2 id="account-related-title">{t("accountRelatedTitle")}</h2><div className="actions account-other-controls">
   <Button className="account-other-previous" variant="ghost" size="icon" aria-label={t("accountOtherPrevious")} title={t("accountOtherPrevious")} onClick={() => move(-1)}><ChevronLeft size={18}/></Button>
   <Button className="account-other-next" variant="ghost" size="icon" aria-label={t("accountOtherNext")} title={t("accountOtherNext")} onClick={() => move(1)}><ChevronRight size={18}/></Button>
  </div></header>
  {busy && <p className="account-order-feedback" role="status">{t("accountOrderSaving")}</p>}
  {error && <p className="account-order-feedback field-error" role="alert">{error}</p>}
  <ScrollArea.Viewport ref={viewport} className="account-other-viewport" aria-labelledby="account-related-title">
   <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={event => void finishDrag(event)} accessibility={{ screenReaderInstructions: { draggable: t("navDndInstructions") }, announcements: {
    onDragStart: ({ active }) => t("navPickedUp", { name: rowName(active.id) }),
    onDragOver: ({ active, over }) => over ? t("navMoved", { name: rowName(active.id), position: peerIds.indexOf(String(over.id)) + 1 }) : undefined,
    onDragEnd: ({ active, over }) => over ? t("navDropped", { name: rowName(active.id), position: peerIds.indexOf(String(over.id)) + 1 }) : t("navCancelled"),
    onDragCancel: () => t("navCancelled"),
   } }}><SortableContext items={peerIds} strategy={horizontalListSortingStrategy}><ScrollArea.Content className="account-other-track">
    {rows.map(row => row.reasons.includes("platform") ? <SortableOtherAccount key={row.key} row={row} id={row.assetId ?? `login-${row.entryId}`} enabled={peerIds.length > 1} busy={busy}/> : <div className="account-other-item" key={row.key}><OtherAccountLink row={row}/></div>)}
   </ScrollArea.Content></SortableContext></DndContext>
  </ScrollArea.Viewport>
 </ScrollArea.Root></section>;
}
