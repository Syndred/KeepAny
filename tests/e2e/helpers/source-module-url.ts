import { resolve } from "node:path";

/** Vite's filesystem URL requires a separator before a Windows drive letter. */
export function sourceModuleUrl(path: string) {
	const absolute = resolve(path).replaceAll("\\", "/");
	return `/@fs${absolute.startsWith("/") ? "" : "/"}${absolute}`;
}
