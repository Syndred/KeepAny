import type { Asset, Task } from "../../../packages/domain/src";
import { buildOverviewAttention } from "./overview-model";
import { REMINDER_SETTINGS_ID, readReminderSettings, readSubscriptionReminder, type ReminderPreference } from "./reminders";

export const REMINDER_READ_PREFIX = "reminder-read:";
const SIGNATURE_VERSION = "reminder-center.v1";

export type ReminderCenterItem = {
	id: string;
	signature: string;
	name: string;
	dueDate: string;
	days: number | null;
	type: "task" | "renewal" | "warranty" | "date";
	task?: Task;
	asset?: Asset;
	read: boolean;
	group: "overdue" | "today" | "week" | "later" | "undated";
};

/** Read receipts contain only occurrence identity. They never contain names, notes or credentials. */
export async function reminderReadPreference(signature: string): Promise<{ id: string; value: { signature: string } }> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signature));
	const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
	return { id: `${REMINDER_READ_PREFIX}${hash}`, value: { signature } };
}

function readSignatures(preferences: readonly ReminderPreference[]): Set<string> {
	const signatures = new Set<string>();
	for (const preference of preferences) {
		if (!/^reminder-read:[a-f0-9]{64}$/.test(preference.id)) continue;
		const value = preference.value;
		if (!value || typeof value !== "object" || Array.isArray(value)) continue;
		const signature = (value as { signature?: unknown }).signature;
		if (typeof signature !== "string" || signature.length > 4096) continue;
		try {
			const parsed: unknown = JSON.parse(signature);
			if (Array.isArray(parsed) && parsed[0] === SIGNATURE_VERSION) signatures.add(signature);
		} catch { /* Malformed legacy preferences cannot mark a reminder read. */ }
	}
	return signatures;
}

function occurrenceSignature(id: string, type: ReminderCenterItem["type"], dueDate: string, task?: Task): string {
	// Use the stored instant/date rather than the viewing-zone projection. A time-zone
	// change or a midnight refresh must not turn the same occurrence unread again.
	const occurrence = task ? [
		task.dueDate,
		task.reminder ? [task.reminder.at, task.reminder.anchorAt, task.reminder.occurrence] : null,
		task.maintenancePlan ? [task.maintenancePlan.schedule.anchorDate, task.maintenancePlan.schedule.occurrence,
			task.maintenancePlan.schedule.dueDate, task.maintenancePlan.deferredUntil] : null,
	] : dueDate;
	return JSON.stringify([SIGNATURE_VERSION, type, id, occurrence]);
}

function groupFor(days: number | null): ReminderCenterItem["group"] {
	return days === null ? "undated" : days < 0 ? "overdue" : days === 0 ? "today" : days <= 7 ? "week" : "later";
}

/** A projection of ordinary RxDB records, never a second asset/task state source. */
export function buildReminderCenterItems(
	assets: readonly Asset[],
	tasks: readonly Task[],
	preferences: readonly ReminderPreference[],
	today: string,
	timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): ReminderCenterItem[] {
	const settings = readReminderSettings(preferences.find(preference => preference.id === REMINDER_SETTINGS_ID)?.value);
	if (!settings.enabled) return [];
	const live = new Map(assets.filter(asset => !asset.deleted && !asset.purged && asset.kind !== "vault" &&
		asset.status !== "archived" && asset.status !== "paused" && asset.status !== "cancelled" &&
		(asset.kind !== "subscription" || asset.status === "active")).map(asset => [asset.id, asset]));
	const eligible = new Map(tasks.filter(task => !task.deleted && !task.purged && !task.done &&
		(!task.maintenancePlan || task.maintenancePlan.active) && (!task.assetId || live.has(task.assetId))).map(task => [task.id, task]));
	const read = readSignatures(preferences);
	const attention = buildOverviewAttention([...live.values()], [...eligible.values()], today, timeZone);
	const result: ReminderCenterItem[] = [];
	for (const row of [...attention.overdue, ...attention.upcoming]) {
		if (row.type === "renewal" && row.asset && !readSubscriptionReminder(row.asset.id, settings).enabled) continue;
		const task = row.taskId ? eligible.get(row.taskId) : undefined;
		const asset = row.asset ?? (task?.assetId ? live.get(task.assetId) : undefined);
		const signature = occurrenceSignature(row.id, row.type, row.dueDate, task);
		result.push({ id: row.id, name: row.name, dueDate: row.dueDate, days: row.days, type: row.type,
			...(task ? { task } : {}), ...(asset ? { asset } : {}), signature, read: read.has(signature), group: groupFor(row.days) });
	}
	// Keep undated standalone legacy work reachable without restoring its old page.
	// Invalid dates and reminders are deliberately not reclassified as undated.
	for (const task of eligible.values()) {
		if (task.assetId || task.dueDate || task.reminder) continue;
		const id = `task-${task.id}`, signature = occurrenceSignature(id, "task", "", task);
		result.push({ id, signature, name: task.name, dueDate: "", days: null, type: "task", task,
			read: read.has(signature), group: "undated" });
	}
	return result.sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity) || a.id.localeCompare(b.id));
}

export type ReminderTarget =
	| { to: "/records/$id"; params: { id: string }; hash?: string }
	| { to: "/assets/$kind/$id"; params: { kind: Asset["kind"]; id: string }; hash?: string };

/** Source task context is requested on demand, rather than restoring permanent task banners. */
export function resolveReminderTarget(item: Pick<ReminderCenterItem, "asset" | "task">): ReminderTarget | null {
	const asset = item.asset;
	if (!asset || asset.deleted || asset.purged || asset.kind === "vault") return null;
	const hash = item.task ? `reminder-task-${encodeURIComponent(item.task.id)}` : undefined;
	return asset.walletCard
		? { to: "/records/$id", params: { id: `asset:${asset.id}` }, ...(hash ? { hash } : {}) }
		: { to: "/assets/$kind/$id", params: { kind: asset.kind, id: asset.id }, ...(hash ? { hash } : {}) };
}
