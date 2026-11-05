export const REMINDER_CENTER_EVENT = "keepany-open-reminder-center";

export type ReminderCenterRequest = {
	taskId?: string;
	assetId?: string;
	filter?: "all" | "unread" | "overdue";
};

/** Opens the existing shell panel without creating a page or altering source data. */
export function openReminderCenter(options: ReminderCenterRequest = {}) {
	window.dispatchEvent(new CustomEvent<ReminderCenterRequest>(REMINDER_CENTER_EVENT, { detail: options }));
}
