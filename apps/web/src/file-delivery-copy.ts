import i18n from "./i18n";

const copy: Record<string, [string, string]> = {
	exportFileReady: ["加密文件已生成。请选择保存或分享，并在所选位置确认文件。", "Encrypted file ready. Choose Save or share, then check the file at your chosen destination."],
	exportFileOpen: ["保存或分享文件", "Save or share file"],
	exportFileOpening: ["正在准备系统保存或分享界面…", "Preparing the system save or share sheet…"],
	exportFileOpened: ["已打开系统保存或分享界面。请在所选位置确认文件；返回应用不代表文件已保存。", "The system save or share sheet was opened. Check the file at your chosen destination; returning to the app does not confirm it was saved."],
	exportFileCancelled: ["已取消保存或分享，生成的文件仍可重试。", "Save or share cancelled. You can try again with the generated file."],
	exportFileFailed: ["无法打开文件保存或分享，请重试。", "Could not prepare the file for saving or sharing. Try again."],
	exportRequestReady: ["连接请求文件已生成。请选择保存或分享文件。", "The connection request file is ready. Choose Save or share file."],
};

for (const [language, index] of [["zh-CN", 0], ["en", 1]] as const) {
	i18n.addResources(language, "translation", Object.fromEntries(
		Object.entries(copy).map(([key, value]) => [key, value[index]]),
	));
}

export const fileDeliveryCopy = copy;
