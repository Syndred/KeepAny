import { appendFileSync } from "node:fs";
import type { Page, TestInfo } from "@playwright/test";

export async function observeGraphNetwork(page: Page, info: TestInfo) {
	if (process.env.KEEPANY_GRAPH_NETWORK_DIAGNOSTICS !== "1")
		return async () => {};
	const origin = new URL(String(info.project.use.baseURL)).origin;
	const path = info.outputPath("account-graph-network.jsonl");
	const requests = new Map<string, string>();
	const session = await page.context().newCDPSession(page);
	const cleanUrl = (value: string) => {
		try {
			const url = new URL(value);
			return url.origin === origin ? `${url.origin}${url.pathname}` : null;
		} catch {
			return null;
		}
	};
	const record = (stage: string, details: Record<string, unknown>) => {
		appendFileSync(
			path,
			JSON.stringify({
				stage,
				recordedAt: new Date().toISOString(),
				nodeMonotonicMs: performance.now(),
				...details,
			}) + String.fromCharCode(10),
		);
	};
	session.on("Network.requestWillBeSent", (event) => {
		const url = cleanUrl(event.request.url);
		if (!url || !new URL(url).pathname.startsWith("/assets/") || !/\.(js|css)$/.test(url))
			return;
		requests.set(event.requestId, url);
		record("request", {
			requestId: event.requestId,
			url,
			loaderId: event.loaderId,
			frameId: event.frameId,
			documentUrl: cleanUrl(event.documentURL),
			type: event.type,
			initiatorType: event.initiator.type,
			cdpTimestampSeconds: event.timestamp,
		});
	});
	session.on("Network.responseReceived", (event) => {
		const url = requests.get(event.requestId);
		if (!url) return;
		record("response", {
			requestId: event.requestId,
			url,
			loaderId: event.loaderId,
			cdpTimestampSeconds: event.timestamp,
			status: event.response.status,
			mimeType: event.response.mimeType,
			protocol: event.response.protocol,
			fromServiceWorker: event.response.fromServiceWorker,
			fromDiskCache: event.response.fromDiskCache,
			fromPrefetchCache: event.response.fromPrefetchCache,
			serviceWorkerResponseSource: event.response.serviceWorkerResponseSource,
		});
	});
	session.on("Network.requestServedFromCache", (event) => {
		const url = requests.get(event.requestId);
		if (url) record("served-from-cache", { requestId: event.requestId, url });
	});
	session.on("Network.loadingFinished", (event) => {
		const url = requests.get(event.requestId);
		if (!url) return;
		record("finished", {
			requestId: event.requestId,
			url,
			cdpTimestampSeconds: event.timestamp,
			encodedDataLength: event.encodedDataLength,
		});
		requests.delete(event.requestId);
	});
	session.on("Network.loadingFailed", (event) => {
		const url = requests.get(event.requestId);
		if (!url) return;
		const details = {
			requestId: event.requestId,
			url,
			cdpTimestampSeconds: event.timestamp,
			errorText: event.errorText.startsWith("net::") ? event.errorText : "browser-request-failure",
			canceled: event.canceled,
			blockedReason: event.blockedReason,
			corsErrorStatus: event.corsErrorStatus,
		};
		record("failed", details);
		console.log("[account-graph-network-failure]", JSON.stringify(details));
		requests.delete(event.requestId);
	});
	session.on("Page.frameNavigated", ({ frame }) => {
		if (frame.parentId) return;
		const url = cleanUrl(frame.url);
		if (url) record("frame-navigated", { frameId: frame.id, loaderId: frame.loaderId, url });
	});
	session.on("Page.lifecycleEvent", (event) => {
		record("lifecycle", {
			frameId: event.frameId,
			loaderId: event.loaderId,
			name: event.name,
			cdpTimestampSeconds: event.timestamp,
		});
	});
	await session.send("Network.enable");
	await session.send("Page.enable");
	await session.send("Page.setLifecycleEventsEnabled", { enabled: true });
	record("collector-start", {
		schema: "keepany.graph-network.v1",
		origin,
		scope: "Passive CDP metadata only; no interception, headers, bodies, cache or SW changes",
	});
	return async () => {
		record("collector-stop", { pendingStaticRequestCount: requests.size });
		await session.detach();
	};
}
