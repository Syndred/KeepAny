export const nativeDatasetsCopy: Record<string, [string, string]> = {
  localDatasets: ['本机资料', 'Local datasets'],
  localDatasetRestoreHint: ['恢复将建立一份新的本机资料。当前资料会保留，可以在这里切换；密码库仍需原主密码解锁。', 'Restoring creates a new local dataset. Your current records are retained and you can switch here; the vault still needs its original master password.'],
  localDatasetInitial: ['初始资料', 'Initial dataset'],
  localDatasetRestored: ['恢复于 {{date}}', 'Restored {{date}}'],
  localDatasetActive: ['当前使用', 'In use'],
  localDatasetPending: ['恢复尚未完成', 'Restore incomplete'],
  localDatasetSwitch: ['切换到这份资料', 'Switch to this dataset'],
  localDatasetSwitchConfirm: ['切换前请保存正在编辑的内容。当前资料会保留，切换后重新打开应用页面。', 'Save any unfinished edits before switching. Your current dataset is retained and the app will reopen with the selected dataset.'],
  localDatasetResume: ['继续核对与恢复', 'Continue verification and restore'],
  localDatasetAbandon: ['保留当前，放弃此恢复', 'Keep current data and discard this restore'],
  localDatasetAbandonConfirm: ['只移除这次尚未完成的恢复资料，当前使用的资料和原备份文件会保留。', 'Remove only this incomplete restore. Your active dataset and the original backup file are retained.'],
  localDatasetFailure: ['操作未完成，当前资料仍保留。若恢复缺少内容，请重新选择原备份文件后重试。', 'The operation did not complete. Your current dataset is retained. If restore content is missing, select the original backup again and retry.'],
};
