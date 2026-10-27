export interface FileDeliveryRequest {
	name: string;
	mimeType: string;
	bytes: Uint8Array;
}

// Opening a system share sheet does not prove that another app saved the file.
export interface FileDeliveryResult { status: "opened" | "cancelled" }
export type FileDeliveryHandler = (request: FileDeliveryRequest) => Promise<FileDeliveryResult>;
export type FileDeliveryMessage = "exportFileOpening" | "exportFileOpened" | "exportFileCancelled" | "exportFileFailed";

let handler: FileDeliveryHandler | undefined;

/** Registered by the native entry before mounting the shared React application. */
export function registerFileDeliveryHandler(next: FileDeliveryHandler): () => void {
	handler = next;
	return () => { if (handler === next) handler = undefined; };
}

export function hasFileDeliveryHandler(): boolean { return handler !== undefined; }

export async function deliverExportFile(request: FileDeliveryRequest): Promise<FileDeliveryResult> {
	const current = handler;
	if (!current) throw Error("file-delivery-unavailable");
	return current(request);
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
