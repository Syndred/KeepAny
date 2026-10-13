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
		"填写服务商或自部署模型的 API 地址。兼容服务支持本机 HTTP 或远端 HTTPS，无需在 StackPerch 下载模型。",
		"Enter your provider's or self-hosted model's API URL. Compatible services support local HTTP or remote HTTPS. StackPerch does not download models.",
	],
	aiSettingsModel: ["模型名称或接入点 ID", "Model name or endpoint ID"],
	aiSettingsModelHint: [
		"可填写服务商支持的模型名称；豆包也可填写方舟接入点 ID。",
		"Enter a model supported by your provider; Doubao also accepts an Ark endpoint ID.",
	],
	aiSettingsKeySource: ["API Key 的使用方式", "API key source"],
	aiSettingsKeySession: ["仅本次使用", "Use for this session only"],
	aiSettingsKeyVault: ["加密保存，长期使用", "Save encrypted for future use"],
	aiSettingsKeyNone: ["服务无需密钥", "Service without a key"],
	aiSettingsApiKey: ["API Key", "API key"],
	aiSettingsApiKeyPlaceholder: ["输入密钥", "Enter your API key"],
	aiSettingsKeepSessionKey: [
		"当前会话已有密钥；留空可继续使用",
		"A session key is active; leave blank to keep using it",
	],
	aiSettingsKeepVaultKey: [
		"留空继续使用所选条目中的密钥",
		"Leave blank to keep the key in the selected entry",
	],
	aiSettingsSessionHint: [
		"服务和模型会保存在本机；密钥仅在当前页面会话使用，刷新或关闭后需重新输入。",
		"Provider and model settings are saved on this device. The key stays in this page session and must be entered again after refreshing or closing it.",
	],
	aiSettingsVaultHint: [
		"API Key 加密保存在本机密码库，刷新或重新打开后仍保留。密码库锁定时暂停使用，解锁后可继续。",
		"Your API key is encrypted in the password vault on this device and survives refreshes and reopening. It cannot be used while the vault is locked; unlock it to continue.",
	],
	aiSettingsVaultNewKeyHint: [
		"输入密钥后保存配置，将在密码库中新建 API Key 条目；也可选择已有条目。",
		"Enter a key and save the configuration to create an API key entry in your vault, or select an existing entry.",
	],
	aiSettingsVaultReplacementHint: [
		"留空复用所选密钥；输入新值会更新此条目的密码，并保留其他内容和历史。",
		"Leave blank to reuse the selected key. A new value updates this entry's password while keeping its other fields and history.",
	],
	aiSettingsAutoActivate: [
		"解锁密码库后自动启用此密钥",
		"Activate this key automatically after unlocking the vault",
	],
	aiSettingsAutoActivateHint: [
		"下次打开或刷新后，只需解锁密码库，无需重新输入 API Key。",
		"After reopening or refreshing, unlock the vault to use the key without re-entering it.",
	],
	aiSettingsManualActivateHint: [
		"下次打开或刷新后，解锁密码库并点击“启用已选密钥”，无需重新输入 API Key。",
		"After reopening or refreshing, unlock the vault and click Activate selected key; you do not need to re-enter the key.",
	],
	aiSettingsVaultEntry: ["密钥保存位置", "Key storage entry"],
	aiSettingsChooseVaultEntry: [
		"新建 API Key 条目",
		"Create a new API key entry",
	],
	aiSettingsMissingVaultEntry: [
		"原条目已不可用，请重新选择",
		"The previous entry is unavailable; choose another",
	],
	aiSettingsOpenVault: ["打开密码库", "Open password vault"],
	aiSettingsUnlockVault: ["解锁密码库", "Unlock password vault"],
	aiSettingsVaultEmpty: [
		"还没有密码库。先创建或导入密码库，即可加密保存 API Key。",
		"Create or import a password vault before saving your API key encrypted.",
	],
	aiSettingsCreateVault: [
		"创建或导入密码库",
		"Create or import a password vault",
	],
	aiSettingsVaultReady: [
		"密码库已解锁，可以加密保存新密钥或使用已有条目。",
		"The vault is unlocked. Save a new key encrypted or use an existing entry.",
	],
	aiSettingsActivateVaultKey: ["启用已选密钥", "Activate selected key"],
	aiSettingsVaultActivated: [
		"所选密钥已在当前会话启用。",
		"The selected key is active in this session.",
	],
	aiSettingsReady: ["模型配置已启用", "Model configuration is active"],
	aiSettingsNeedsKey: [
		"模型已配置，请启用或输入 API Key",
		"Model configured; activate or enter an API key",
	],
	aiSettingsVaultNeedsUnlock: [
		"模型已配置，请解锁密码库读取已保存的密钥",
		"Model configured; unlock the vault to use the saved key",
	],
	aiSettingsVaultNeedsActivation: [
		"密钥已保存，请点击“启用已选密钥”",
		"The key is saved; click Activate selected key",
	],
	aiSettingsNotConfigured: ["尚未配置模型", "No model configured"],
	aiSettingsSave: ["保存配置", "Save configuration"],
	aiSettingsSaving: ["正在保存…", "Saving…"],
	aiSettingsSaved: ["模型配置已保存。", "Model configuration saved."],
	aiSettingsSessionSaved: [
		"模型配置已保存。API Key 仅本次使用，刷新或关闭页面后需重新输入。",
		"Model configuration saved. The API key lasts for this session only and must be entered again after refreshing or closing the page.",
	],
	aiSettingsVaultSaved: [
		"API Key 已加密保存在密码库，模型配置已保存。",
		"The API key is encrypted in your password vault and the model configuration is saved.",
	],
	aiSettingsVaultSavedNotActivated: [
		"API Key 已加密保存，但密码库或模型配置已变化，尚未启用。请解锁并选择已保存的条目后重试。",
		"The API key is encrypted in your vault, but the vault or model settings changed before activation. Unlock the vault and select the saved entry to retry.",
	],
	aiSettingsVaultConfigSaveFailed: [
		"API Key 已加密保存，模型配置未保存。已保留所选条目，可再次保存配置，无需重新输入密钥。",
		"The API key was saved encrypted, but the model configuration was not saved. The entry remains selected; save the configuration again without re-entering the key.",
	],
	aiSettingsVaultSaveFailed: [
		"保存未完成，请解锁并核对密码库条目后重试；已填写的内容仍保留。",
		"Saving did not complete. Unlock the vault and check its entries before retrying; your input has been kept.",
	],
	aiSettingsVaultBindingRequired: [
		"所选条目尚未允许为此模型自动启用。请解锁密码库并保存配置，或关闭自动启用。",
		"The selected entry is not yet authorized for automatic activation with this model. Unlock the vault and save the configuration, or turn off automatic activation.",
	],
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
