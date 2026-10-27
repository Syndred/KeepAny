export const financeCopy: Record<string, [string, string]> = {
	financeRelatedAsset: ["关联资产", "Related asset"],
	financeNoTarget: ["请先创建资产再记账。", "Add an asset before recording a transaction."],
	financeEditRecord: ["编辑账单", "Edit transaction"],
	financeDeleteRecord: ["删除账单", "Delete transaction"],
	financeDeleteAction: ["删除", "Delete"],
	financeDeletePrompt: ["删除这张账单？", "Delete this transaction?"],
	financeRecordDeleted: ["账单已删除。", "Transaction deleted."],
	financeAdditionalAssets: ["其他关联资产", "Other related assets"],
	financeRecordChanged: ["账单已在其他页面更改。请关闭后重新打开，核对最新内容。", "This transaction changed in another tab. Close and reopen it to review the latest contents."],
	financeRenewalCorrectionHint: ["账单调整不会改变订阅账期。删除账单不会撤销续费记录。", "Bill changes leave the subscription schedule unchanged. Deleting the bill keeps the renewal record."],
};
