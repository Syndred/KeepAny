export const mobileServicesCopy: Record<string, [string, string]> = {
	collectionDeletedTitle: ["已删除的集合", "Deleted collections"],
	collectionDeletedHint: ["恢复集合会保留原成员；成员资料不会因删除集合而删除。", "Restore a collection with its original members. Deleting a collection keeps its member records."],
	collectionRestoreDuplicate: ["已有同名集合。请先重命名当前集合，再恢复。", "A collection with this name already exists. Rename it before restoring this one."],
	intakeModeText: ["文字", "Text"],
	intakeTextSource: ["原始文字", "Original text"],
	intakeTextHint: ["每个非空行作为一项名称。选择资料类型，预览后逐项核对；不会自动填写金额或日期。", "Each non-empty line becomes one record name. Choose a type and review each candidate. Amounts and dates stay blank."],
	intakeTextLimit: ["最多 200 项、20,000 字，每项名称最多 160 字。请缩短后重试。", "Use up to 200 records and 20,000 characters, with up to 160 characters per name. Shorten the text and retry."],
	intakeTextOriginal: ["查看原始文字", "View original text"],
	intakeTextBatch: ["文字收录", "Text capture"],
	intakeTextSecrets: ["这段文字包含登录秘密，请使用独立的密码导入入口。", "This text includes login secrets. Use the separate password import instead."],
};
