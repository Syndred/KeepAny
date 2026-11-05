import { newAsset, type Asset, type Relation, type Task } from "../../../packages/domain/src";
import type { VaultEntrySummary } from "../../../packages/password-vault/src";
import { zonedParts } from "../../../packages/domain/src/task-reminder";
import { daysBetween } from "./workspace-summary";

export type OverviewAttention = {
 id: string; name: string; dueDate: string; days: number;
 type: "task" | "renewal" | "warranty" | "date"; asset?: Asset; taskId?: string;
};

/** A read-only projection of current occurrences, independent of notification delivery receipts. */
export function buildOverviewAttention(assets: readonly Asset[], tasks: readonly Task[], today: string, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
 const byId = new Map(assets.filter(a => !a.deleted && !a.purged && a.kind !== "vault").map(a => [a.id, a]));
 const rows = new Map<string, OverviewAttention>();
 const add = (row: Omit<OverviewAttention, "days">) => {
  const days = daysBetween(today, row.dueDate);
  if (days !== null) rows.set(row.id, { ...row, days });
 };
 for (const asset of byId.values()) {
  if (asset.status === "archived" || asset.status === "cancelled" || asset.status === "paused") continue;
  if (asset.kind === "subscription") add({ id: `renew-${asset.id}`, name: asset.name, dueDate: asset.dueDate, type: "renewal", asset });
  else if (asset.kind === "item") add({ id: `warranty-${asset.id}`, name: asset.name, dueDate: asset.warrantyDate, type: "warranty", asset });
  else if (asset.kind !== "account") add({ id: `date-${asset.id}`, name: asset.name, dueDate: asset.dueDate, type: "date", asset });
 }
 for (const task of tasks) {
  if (task.deleted || task.purged || task.done || task.maintenancePlan && !task.maintenancePlan.active) continue;
  const owner = byId.get(task.assetId);
  if (task.assetId && (!owner || owner.kind === "subscription" && owner.status !== "active")) continue;
  // Date-only occurrences stay unchanged. Timed reminders count calendar days in the
  // viewer's zone; their stored dueDate belongs to the reminder's own zone.
  let dueDate = task.dueDate;
  if (task.reminder) {
   try {
    dueDate = zonedParts(task.reminder.at, timeZone).date;
   } catch { continue; }
  }
  add({ id: `task-${task.id}`, taskId: task.id, name: task.name, dueDate, type: "task" });
 }
 const sorted = [...rows.values()].sort((a, b) => a.days - b.days || a.id.localeCompare(b.id));
 return { upcoming: sorted.filter(row => row.days >= 0), overdue: sorted.filter(row => row.days < 0) };
}

/** Call with summaries only while unlocked. Never read credentials or persist virtual nodes/edges. */
export function overviewGraphData(assets: readonly Asset[], relations: readonly Relation[], unlockedEntries: readonly VaultEntrySummary[]) {
 const live = [...new Map(assets.filter(a => !a.deleted && !a.purged && a.kind !== "vault").map(a => [a.id, a])).values()];
 const ids = new Set(live.map(a => a.id));
 const edges = relations.filter(r => !r.deleted && r.from !== r.to && ids.has(r.from) && ids.has(r.to));
 const accountIds = new Set(live.filter(asset => asset.kind === "account").map(asset => asset.id));
 for (const entry of unlockedEntries) {
  const targets = [...new Set(entry.linkedAssetIds)].filter(id => ids.has(id));
  // A single public account already represents its login. Mixed or shared links need
  // their real encrypted login node; collapsing them would fabricate account-to-item edges.
  if (targets.length === 1 && accountIds.has(targets[0])) continue;
  const id = `login-${entry.id}`;
  live.push({ ...newAsset("account"), id, name: entry.title, updatedAt: entry.modifiedAt });
  for (const target of targets) edges.push({
   id: `overview-encrypted-${entry.id}-${target}`, from: id, to: target, label: "", createdAt: entry.modifiedAt, verifiedAt: "", deleted: false,
  });
 }
 return { assets: live, relations: edges };
}
