import i18n from "./i18n";

const copy: Record<string, [string, string]> = {
	mobileMore: ["更多", "More"],
	mobileMainNavigation: ["主要导航", "Main navigation"],
	mobileMoreSubtitle: ["整理资料、保护备份和管理连接。", "Organize your records, backups and connections."],
	mobileOrganize: ["整理资料", "Organize"],
	mobileSecurityAndData: ["密码与备份", "Passwords and backups"],
	mobileAssistantAndConnections: ["助手与连接", "Assistant and connections"],
	mobileCategoriesAndTags: ["分类与标签", "Categories and tags"],
	mobileIntakeHint: ["文字、链接、文件与导入审核", "Text, links, files and import review"],
	mobileLedgerHint: ["支出、充值、退款与余额", "Expenses, top-ups, refunds and balances"],
	mobileCollectionsHint: ["集中查看选中的资料", "Keep selected records together"],
	mobileReferences: ["外部密码引用", "External password references"],
	mobileReferencesHint: ["记录外部密码库中的位置", "Find records in an external password manager"],
	mobilePasswordsHint: ["导入导出、历史与密码回收站", "Import, export, history and password trash"],
	mobileBackupHint: ["加密备份、恢复与远端备份", "Encrypted backups, restore and remote backups"],
	mobileTrashHint: ["恢复或彻底删除普通资料与关系", "Restore or permanently remove records and relations"],
	mobileAskAssistant: ["询问 AI 助手", "Ask AI assistant"],
	mobileAskAssistantHint: ["选择本次提供给助手的资料", "Choose the records to share this time"],
	mobileAiSettings: ["模型与助手设置", "Model and assistant settings"],
	mobileAiSettingsHint: ["模型地址、密钥引用与用量说明", "Model address, key references and usage"],
	mobileAccessHint: ["范围、逐次写入批准与审计", "Scopes, write approval and audit"],
	mobileConnectionsHint: ["账号绑定与实验同步选项", "Account binding and experimental sync options"],
	mobileImpactHint: ["换绑前查看影响与人工核对清单", "Review affected records before changing a login"],
	mobileSettingsHint: ["语言、提醒与本机选项", "Language, reminders and local options"],
	mobileProjectCategories: ["项目分类与标签", "Project categories and tags"],
	mobileItemCategories: ["实物分类与标签", "Item categories and tags"],
	mobileSubscriptionCategories: ["订阅分类与标签", "Subscription categories and tags"],
	mobileAccountCategories: ["账号分类与标签", "Account categories and tags"],
	mobileBackToMore: ["返回更多", "Back to More"],
};

for (const [language, index] of [["zh-CN", 0], ["en", 1]] as const) {
	i18n.addResources(language, "translation", Object.fromEntries(
		Object.entries(copy).map(([key, value]) => [key, value[index]]),
	));
}

export const mobileCopy = copy;
