/** Native-only wording; the shared H5 views retain their browser copy. */
export const nativePlatformCopy: Record<string, [string, string]> = {
  nativeReminderRuntimeScope: ["仅在应用打开时显示应用内提醒，关闭应用后不会推送。重新打开时补充最近 7 天的提醒，更早的逾期事项仍可在应用内查看。", "In-app reminders appear while the app is open. Nothing is pushed after it closes. Reopening catches up on the past 7 days; older overdue items remain visible in the app."],
  nativeSettingsAssistantHint: ["设置模型；提问时选择要发送的资料。", "Set up a model and choose the records to send when asking a question."],
  nativeStorageHint: ["资料保存在此设备的应用空间中。请定期导出加密备份。", "Records are stored in this device’s app storage. Export encrypted backups regularly."],
  platformSettingFailed: ["设置未保存，请重试。", "The setting was not saved. Try again."],
  pwVaultImportUnlock: ["密码库已锁定。已选择的文件会保留；请重新解锁后再导入。", "The vault is locked. Your selected file is retained; unlock again before importing."],
  pwVaultOperationLocked: ["操作期间密码库已锁定。请重新解锁并核对结果后再继续。", "The vault locked during this operation. Unlock and check the result before continuing."],
  pwVaultCommitLocked: ["密码库已锁定，本次加密写入已完成。请重新解锁核对保存结果。", "The vault is locked and the encrypted write completed. Unlock again to check the saved result."],
};
