/** Chinese and English copy for AI configuration; merged into i18next by the shell. */
export const aiCopy: Record<string, [string, string]> = {
	aiSettingsTitle: ["连接 AI 模型", "Connect an AI model"],
	aiSettingsHint: [
		"选择自己的模型，用于整理导入、查找资料和安排提醒。每次处理前都可以核对将发送的资料。",
		"Choose your own model to organize imports, find records and plan reminders. Review what will be sent before each request.",
	],
	aiSettingsProvider: ["模型服务", "Provider"],
	aiProviderOpenai: ["OpenAI", "OpenAI"],
	aiProviderAnthropic: ["Anthropic Claude", "Anthropic Claude"],
	aiProviderGoogle: ["Google Gemini", "Google Gemini"],
	aiProviderDeepseek: ["DeepSeek", "DeepSeek"],
	aiProviderQwen: ["通义千问", "Qwen"],
	aiProviderDoubao: ["豆包 · 火山方舟", "Doubao · Volcengine Ark"],
	aiProviderMoonshot: ["Kimi · 月之暗面", "Kimi · Moonshot"],
	aiProviderMinimax: ["MiniMax", "MiniMax"],
	aiProviderOpenrouter: ["OpenRouter", "OpenRouter"],
	aiProviderOllama: ["Ollama 本机模型", "Ollama local model"],
	aiProviderCompatible: [
		"其他 OpenAI 兼容服务",
		"Other OpenAI-compatible service",
	],
	aiSettingsBaseUrl: ["API 地址", "API base URL"],
	aiSettingsBaseUrlHint: [
		"填写服务商的 API 基础地址，或完整接口地址。",
		"Enter the provider's API base URL or full endpoint URL.",
	],
	aiSettingsModel: ["模型名称或接入点 ID", "Model name or endpoint ID"],
	aiSettingsModelHint: [
		"可填写服务商支持的模型名称；豆包也可填写方舟接入点 ID。",
		"Enter a model supported by your provider; Doubao also accepts an Ark endpoint ID.",
	],
	aiSettingsKeySource: ["API Key 的使用方式", "API key source"],
	aiSettingsKeySession: ["仅当前页面会话", "Current page session only"],
	aiSettingsKeyVault: ["使用密码库中的条目", "Use a password vault entry"],
	aiSettingsKeyNone: ["本机服务无需密钥", "Local service without a key"],
	aiSettingsApiKey: ["API Key", "API key"],
	aiSettingsApiKeyPlaceholder: ["输入密钥", "Enter your API key"],
	aiSettingsKeepSessionKey: [
		"当前会话已有密钥；留空可继续使用",
		"A session key is active; leave blank to keep using it",
	],
	aiSettingsSessionHint: [
		"服务和模型会保存在本机；密钥仅在当前页面会话使用，刷新或关闭后需重新输入。",
		"Provider and model settings are saved on this device. The key stays in this page session and must be entered again after refreshing or closing it.",
	],
	aiSettingsVaultHint: [
		"先在密码库建立 API Key 条目，并把密钥放在“密码”字段。此处只保存你选中条目的引用；密码库锁定后需重新解锁并启用密钥。",
		"Create an API key entry in your password vault and put the key in its Password field. Only a reference to your selected entry is saved here. Unlock the vault and activate the key again after it locks.",
	],
	aiSettingsVaultEntry: ["密码库条目", "Vault entry"],
	aiSettingsChooseVaultEntry: [
		"选择一个 API Key 条目",
		"Choose an API key entry",
	],
	aiSettingsMissingVaultEntry: [
		"原条目已不可用，请重新选择",
		"The previous entry is unavailable; choose another",
	],
	aiSettingsOpenVault: ["打开密码库", "Open password vault"],
	aiSettingsUnlockVault: ["解锁密码库", "Unlock password vault"],
	aiSettingsVaultEmpty: [
		"还没有密码库。请先到密码库页面建立或导入，再回来选择密钥条目。",
		"No password vault is set up. Create or import one on the Password vault page, then return to choose a key entry.",
	],
	aiSettingsVaultReady: [
		"密码库已解锁，选择条目后保存配置即可使用。",
		"The vault is unlocked. Choose an entry and save the configuration to use it.",
	],
	aiSettingsActivateVaultKey: ["启用已选密钥", "Activate selected key"],
	aiSettingsVaultActivated: [
		"所选密钥已在当前会话启用。",
		"The selected key is active in this session.",
	],
	aiSettingsReady: ["模型配置已就绪", "Model connection is ready"],
	aiSettingsNeedsKey: [
		"模型已配置，请启用或输入 API Key",
		"Model configured; activate or enter an API key",
	],
	aiSettingsNotConfigured: ["尚未配置模型", "No model configured"],
	aiSettingsSave: ["保存配置", "Save configuration"],
	aiSettingsSaved: ["模型配置已保存。", "Model configuration saved."],
	aiSettingsClear: ["移除模型配置", "Remove model configuration"],
	aiSettingsCleared: [
		"模型配置和本次会话密钥已移除，密码库条目仍保留。",
		"Model settings and the session key were removed. The vault entry is kept.",
	],
	aiSettingsTest: ["测试连接", "Test connection"],
	aiSettingsTestHint: [
		"连接测试只发送一句测试文字，可能产生少量模型费用。",
		"The connection test sends one short test message and may incur a small model charge.",
	],
	aiSettingsTesting: ["正在测试…", "Testing…"],
	aiSettingsTestPassed: [
		"连接成功 · 模型 {{model}}",
		"Connected · model {{model}}",
	],
	aiSettingsTestUsage: [
		"输入 {{input}} · 输出 {{output}} tokens",
		"Input {{input}} · output {{output}} tokens",
	],
	aiSettingsUsageUnknown: ["未返回", "Not reported"],
	aiSettingsTestFailed: [
		"连接未成功。请检查地址、模型和密钥，并确认服务商允许浏览器访问。",
		"Connection failed. Check the URL, model and key, and confirm that your provider allows browser requests.",
	],
	aiSettingsInvalid: [
		"配置不完整或无效，请核对后再试。",
		"The configuration is incomplete or invalid. Review it and try again.",
	],
	aiSettingsInvalidUrl: [
		"请输入 HTTPS 地址，或 localhost / 127.0.0.1 的 HTTP 地址；地址中不要包含密钥。",
		"Enter an HTTPS URL, or an HTTP URL on localhost / 127.0.0.1. Do not put a key in the URL.",
	],
	aiSettingsModelRequired: [
		"请填写模型名称或接入点 ID。",
		"Enter a model name or endpoint ID.",
	],
	aiSettingsKeyRequired: [
		"请填写 API Key，或选择包含密钥的密码库条目。",
		"Enter an API key, or choose a vault entry containing one.",
	],
	aiSettingsVaultEntryRequired: [
		"请选择一个可用的密码库条目。",
		"Choose an available vault entry.",
	],
	aiSettingsVaultLocked: [
		"密码库已锁定，请解锁后再启用密钥。",
		"The password vault is locked. Unlock it before activating the key.",
	],
	aiSettingsVaultReadFailed: [
		"无法读取所选条目，请重新选择。",
		"The selected entry could not be read. Choose it again.",
	],
	aiSettingsStorageFailed: [
		"本机配置未保存，请检查浏览器存储是否可用。",
		"The configuration was not saved. Check that browser storage is available.",
	],
	aiSettingsConnectionRequired: [
		"请先在设置中配置并启用 AI 模型。",
		"Configure and activate an AI model in Settings first.",
	],
	aiSettingsVaultUnlockFailed: [
		"密码库未解锁，请核对主密码后再试。",
		"The vault could not be unlocked. Check the master password and try again.",
	],
};

export default aiCopy;
