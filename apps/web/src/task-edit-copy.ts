export const taskEditCopy: Record<string, [string, string]> = {
	editTask: ["编辑待办", "Edit task"],
	taskDateRange: ["日期范围", "Date range"],
	taskDateFrom: ["开始日期", "Start date"],
	taskDateTo: ["结束日期", "End date"],
	taskDateRangeInvalid: ["结束日期不能早于开始日期。", "The end date must be on or after the start date."],
	taskClearDates: ["清除日期", "Clear dates"],
	backlinkDelete: ["删除外链记录", "Delete link record"],
	backlinkDeleteAction: ["删除", "Delete"],
	backlinkDeleteConfirm: ["删除“{{name}}”的外链记录？", "Delete the link record for “{{name}}”?"],
	intakeUrlMetadataFallback: ["未能读取网页内容。已按网址生成预览，可重试读取或手动补全后确认。", "The page could not be read. A URL preview is ready; retry or fill in its details before confirming."],
};
