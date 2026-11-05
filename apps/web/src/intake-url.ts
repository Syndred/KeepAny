export interface UrlMetadata { url: string; title: string; description: string }
export interface UrlMetadataHtml { url: string; html: string }
export type NativeMetadataHandler = (url: string, options: { signal?: AbortSignal }) => Promise<UrlMetadataHtml>;
let nativeHandler: NativeMetadataHandler | undefined;
export function registerNativeMetadataHandler(handler: NativeMetadataHandler): () => void {
	nativeHandler = handler;
	return () => { if (nativeHandler === handler) nativeHandler = undefined; };
}

/** Parse in an inert template: no script execution, image loads or page render. */
export function parseUrlMetadataHtml(url: string, html: string): UrlMetadata {
	const template = document.createElement("template");
	template.innerHTML = html;
	const meta = (names: string[]) => {
		for (const name of names) {
			const element = [...template.content.querySelectorAll("meta")].find(node =>
				(node.getAttribute("property") || node.getAttribute("name") || "").toLowerCase() === name);
			const value = element?.getAttribute("content")?.trim();
			if (value) return value;
		}
		return "";
	};
	const title = meta(["og:title", "twitter:title"]) || template.content.querySelector("title")?.textContent || "";
	return { url, title: title.replace(/\s+/g, " ").trim().slice(0, 160),
		description: meta(["description", "og:description", "twitter:description"]).slice(0, 2000) };
}

export async function readUrlMetadata(url: string, options: { signal?: AbortSignal } = {}): Promise<UrlMetadata> {
	const target = new URL(url);
	if (!["http:", "https:"].includes(target.protocol) || target.username || target.password || url.length > 2048) throw Error("metadata-url");
	target.hash = "";
	if (nativeHandler) {
		const value = await nativeHandler(target.href, options);
		if (typeof value.url !== "string" || typeof value.html !== "string" || value.html.length > 1024 * 1024) throw Error("metadata-invalid");
		const resolved = new URL(value.url);
		if (!["http:", "https:"].includes(resolved.protocol) || resolved.username || resolved.password || value.url.length > 2048) throw Error("metadata-invalid");
		resolved.hash = "";
		return parseUrlMetadataHtml(resolved.href, value.html);
	}
	const response = await fetch("/__keepany_intake__/url-metadata", {
		method: "POST", credentials: "omit", signal: options.signal,
		headers: { "content-type": "application/json", "x-keepany-intake": "metadata" },
		body: JSON.stringify({ url: target.href }),
	});
	if (!response.headers.get("content-type")?.startsWith("application/json")) throw Error("metadata-unavailable");
	const value = await response.json() as { error?: string; url?: unknown; html?: unknown };
	if (!response.ok) throw Error(typeof value.error === "string" ? value.error : "metadata-network");
	if (typeof value.url !== "string" || typeof value.html !== "string" || value.html.length > 1024 * 1024) throw Error("metadata-invalid");
	const resolved = new URL(value.url);
	if (!["http:", "https:"].includes(resolved.protocol) || resolved.username || resolved.password) throw Error("metadata-invalid");
	return parseUrlMetadataHtml(resolved.href, value.html);
}
