const copy: Record<string, [string, string]> = {
	exportFileReady: ["加密文件已生成。请选择保存或分享，并在所选位置确认文件。", "Encrypted file ready. Choose Save or share, then check the file at your chosen destination."],
	exportFileOpen: ["保存或分享文件", "Save or share file"],
	exportFileOpening: ["正在准备系统保存或分享界面…", "Preparing the system save or share sheet…"],
	exportFileOpened: ["已打开系统保存或分享界面。请在所选位置确认文件；返回应用不代表文件已保存。", "The system save or share sheet was opened. Check the file at your chosen destination; returning to the app does not confirm it was saved."],
	exportFileSaved: ["文件已保存，并已读回核对。请妥善保管文件和密码。", "The file was saved and read back for verification. Keep the file and its password safe."],
	exportFileCancelled: ["已取消保存或分享，生成的文件仍可重试。", "Save or share cancelled. You can try again with the generated file."],
	exportFileFailed: ["无法打开文件保存或分享，请重试。", "Could not prepare the file for saving or sharing. Try again."],
	desktopExportReady: ["加密文件已生成。请选择保存位置。", "Encrypted file ready. Choose where to save it."],
	desktopExportOpening: ["正在打开系统保存对话框…", "Opening the system save dialog…"],
	desktopExportCancelled: ["已取消保存，可以重新选择位置。", "Save cancelled. You can choose a location again."],
	desktopExportFailed: ["无法保存文件。请重试或选择其他位置。", "Could not save the file. Try again or choose another location."],
};

export const fileDeliveryCopy = copy;
