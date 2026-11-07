export interface FileDeliveryRequest {
	name: string;
	mimeType: string;
	bytes: Uint8Array;
}

// Opening a system share sheet does not prove that another app saved the file.
export interface FileDeliveryResult { status: "opened" | "cancelled" | "saved" }
export type FileDeliveryHandler = (request: FileDeliveryRequest) => Promise<FileDeliveryResult>;
export type FileDeliveryMessage = "exportFileOpening" | "exportFileOpened" | "exportFileSaved" | "exportFileCancelled" | "exportFileFailed" | "desktopExportOpening" | "desktopExportCancelled" | "desktopExportFailed";
export function fileDeliveryMessage(result: FileDeliveryResult): FileDeliveryMessage {
  if (result.status === "cancelled") return handler?.mode === "save" ? "desktopExportCancelled" : "exportFileCancelled";
  return result.status === "saved" ? "exportFileSaved" : "exportFileOpened";
}

let handler: { deliver: FileDeliveryHandler; mode: "save" | "share" } | undefined;

/** Registered by the native entry before mounting the shared React application. */
export function registerFileDeliveryHandler(deliver: FileDeliveryHandler, mode: "save" | "share" = "share"): () => void {
	const next = { deliver, mode };
	handler = next;
	return () => { if (handler === next) handler = undefined; };
}

export function hasFileDeliveryHandler(): boolean { return handler !== undefined; }

export function fileDeliveryReadyMessage() {
  if (!handler) return "backupReady";
  return handler.mode === "save" ? "desktopExportReady" : "exportFileReady";
}

export function fileDeliveryOpeningMessage(): FileDeliveryMessage {
  return handler?.mode === "save" ? "desktopExportOpening" : "exportFileOpening";
}

export function fileDeliveryFailedMessage(): FileDeliveryMessage {
  return handler?.mode === "save" ? "desktopExportFailed" : "exportFileFailed";
}

export function fileDeliveryAction() {
  return handler?.mode === "save" ? "saveBackupFile" : "exportFileOpen";
}

export async function deliverExportFile(request: FileDeliveryRequest): Promise<FileDeliveryResult> {
	const current = handler;
	if (!current) throw Error("file-delivery-unavailable");
	return current.deliver(request);
}

/** Only app-generated object URLs are read. Remote URLs never enter this path. */
export async function deliverExportUrl(url: string, name: string): Promise<FileDeliveryResult> {
	const parsed = new URL(url);
	if (parsed.protocol !== "blob:" || parsed.origin !== window.location.origin) throw Error("file-delivery-url");
	const response = await fetch(url);
	if (!response.ok) throw Error("file-delivery-read");
	const blob = await response.blob();
	return deliverExportFile({ name, mimeType: blob.type || "application/octet-stream", bytes: new Uint8Array(await blob.arrayBuffer()) });
}
