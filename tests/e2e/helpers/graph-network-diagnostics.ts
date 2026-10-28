import { appendFileSync } from "node:fs";
import type { Page, TestInfo } from "@playwright/test";

export async function observeGraphNetwork(
	page: Page,
	info: TestInfo,
	onStaticFailure?: (failure: Record<string, unknown>) => void,
) {
	if (process.env.KEEPANY_GRAPH_NETWORK_DIAGNOSTICS !== "1")
		return async () => {};
	const origin = new URL(String(info.project.use.baseURL)).origin;
	const path = info.outputPath("account-graph-network.jsonl");
	const requests = new Map<string, string>();
	const requestContexts = new Map<
		string,
		{
			loaderId: string;
			frameId: string | null;
			documentUrl: string | null;
			type: string | null;
		}
	>();
	const observations: Promise<unknown>[] = [];
	const session = await page.context().newCDPSession(page);
	const browserSession = await page.context().browser()?.newBrowserCDPSession();
	const workerSessions = new Map<string, string>();
	const workerAttachments: Promise<unknown>[] = [];
	const workerTargets = new Map<string, string>();
	const workerAttachStarted = new Set<string>();
	let observedFailure = false;
	let stopping = false;
	let workerCommandId = 0;
	let closed = false;
	let stopPromise: Promise<void> | undefined;
	let currentMainLoaderId: string | undefined;
	const withinDeadline = <T>(task: Promise<T>, phase: string): Promise<T> => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(() => {
				const error = new Error(`Diagnostic deadline: ${phase}`);
				error.name = "DiagnosticTimeout";
				reject(error);
			}, 3000);
		});
		return Promise.race([task, timeout]).finally(() => {
			if (timer) clearTimeout(timer);
		});
	};
	const cleanUrl = (value: string) => {
		try {
			const url = new URL(value);
			return url.origin === origin ? `${url.origin}${url.pathname}` : null;
		} catch {
			return null;
		}
	};
	const record = (stage: string, details: Record<string, unknown>) => {
		if (closed) return;
		appendFileSync(
			path,
			JSON.stringify({
				stage,
				recordedAt: new Date().toISOString(),
				nodeMonotonicMs: performance.now(),
				collectorStopping: stopping,
				...details,
			}) + String.fromCharCode(10),
		);
	};
	const scrubWorkerText = (value: string) =>
		value
			.slice(0, 4000)
			.replace(
				/https?:\/\/[^\s)\]"'<>]+/g,
				(url) => cleanUrl(url) ?? "[external-url]",
			);
	const attachWorkerAfterFailure = (targetId: string, url: string) => {
		if (
			!browserSession ||
			!observedFailure ||
			stopping ||
			closed ||
			workerAttachStarted.has(targetId)
		)
			return;
		workerAttachStarted.add(targetId);
		record("service-worker-attach-after-failure", { targetId, url });
		workerAttachments.push(
			withinDeadline(
				browserSession
					.send("Target.attachToTarget", {
						targetId,
						flatten: false,
					})
					.then(async ({ sessionId }) => {
						if (stopping || closed) {
							await browserSession.send("Target.detachFromTarget", {
								sessionId,
							});
							return;
						}
						workerSessions.set(sessionId, url);
						await browserSession.send("Target.sendMessageToTarget", {
							sessionId,
							message: JSON.stringify({
								id: ++workerCommandId,
								method: "Runtime.enable",
							}),
						});
					})
					.catch((error) =>
						record("worker-observation-unavailable", {
							name: error instanceof Error ? error.name : "unknown",
						}),
					),
				"worker-attach",
			).catch((error) =>
				record("worker-observation-unavailable", {
					name: error instanceof Error ? error.name : "unknown",
				}),
			),
		);
	};
	if (browserSession) {
		const observeWorker = (targetInfo: {
			type: string;
			url: string;
			targetId: string;
		}) => {
			const url = cleanUrl(targetInfo.url);
			if (targetInfo.type !== "service_worker" || !url) return;
			workerTargets.set(targetInfo.targetId, url);
			record("service-worker-target", { targetId: targetInfo.targetId, url });
			attachWorkerAfterFailure(targetInfo.targetId, url);
		};
		browserSession.on("Target.targetCreated", ({ targetInfo }) =>
			observeWorker(targetInfo),
		);
		browserSession.on("Target.targetInfoChanged", ({ targetInfo }) =>
			observeWorker(targetInfo),
		);
		browserSession.on("Target.targetDestroyed", ({ targetId }) => {
			const url = workerTargets.get(targetId);
			if (url) record("service-worker-target-destroyed", { targetId, url });
			workerTargets.delete(targetId);
		});
		browserSession.on("Target.receivedMessageFromTarget", (event) => {
			const url = workerSessions.get(event.sessionId);
			if (!url) return;
			let message: {
				id?: number;
				result?: unknown;
				method?: string;
				error?: { code?: number; message?: string };
				params?: {
					exceptionDetails?: {
						exception?: { description?: string };
						text?: string;
					};
					type?: string;
					args?: { value?: unknown; description?: string }[];
				};
			};
			try {
				message = JSON.parse(event.message);
			} catch {
				return;
			}
			if (message.error) {
				record("service-worker-protocol-error", {
					url,
					code: message.error.code,
					text: scrubWorkerText(message.error.message ?? ""),
				});
			} else if (typeof message.id === "number" && "result" in message) {
				record("service-worker-runtime-enabled", {
					url,
					commandId: message.id,
				});
			}
			if (message.method === "Runtime.exceptionThrown") {
				const detail = message.params?.exceptionDetails;
				record("service-worker-exception", {
					url,
					text: scrubWorkerText(
						String(detail?.exception?.description ?? detail?.text ?? ""),
					),
				});
			} else if (message.method === "Runtime.consoleAPICalled") {
				record("service-worker-console", {
					url,
					type: message.params?.type,
					text: scrubWorkerText(
						(message.params?.args ?? [])
							.map((arg: { value?: unknown; description?: string }) =>
								String(arg.value ?? arg.description ?? ""),
							)
							.join(" "),
					),
				});
			}
		});
		await browserSession.send("Target.setDiscoverTargets", { discover: true });
	}
	type Stack = {
		callFrames: {
			functionName: string;
			url: string;
			lineNumber: number;
			columnNumber: number;
		}[];
		parent?: Stack;
		parentId?: { id: string; debuggerId?: string };
	};
	const cleanStack = (stack: Stack | undefined, depth = 0): unknown =>
		stack && {
			frameCount: stack.callFrames.length,
			framesTruncated: stack.callFrames.length > 12,
			parentTruncated: depth >= 2 && !!stack.parent,
			parentId: stack.parentId,
			callFrames: stack.callFrames.slice(0, 12).map((frame) => ({
				functionName: frame.functionName,
				url: cleanUrl(frame.url),
				lineNumber: frame.lineNumber,
				columnNumber: frame.columnNumber,
			})),
			parent: depth < 2 ? cleanStack(stack.parent, depth + 1) : undefined,
		};
	// Only after a real failure: observe public static-resource timing and cache
	// digests. This does not retry requests, mutate caches, or inspect user data.
	const snapshotFailure = (url: string) => {
		if (stopping || closed) return;
		const urls = [...new Set([url, ...requests.values()])]
			.filter((value) =>
				/\/(?:PasswordVaultPanel-[^/]+|papaparse[^/]*|file-picker-[^/]+|ai-settings-store-[^/]+)\.js$/.test(
					value,
				),
			)
			.slice(0, 6);
		observations.push(
			withinDeadline(
				page.evaluate(async (targets) => {
					const resourceTiming = performance
						.getEntriesByType("resource")
						.filter((entry) => targets.includes(entry.name))
						.map((entry) => entry.toJSON());
					const inspect = async () => {
						const rows = [];
						for (const target of targets) {
							const response = await caches.match(target);
							if (!response) continue;
							const bytes = await response.arrayBuffer();
							const digest = await crypto.subtle.digest("SHA-256", bytes);
							rows.push({
								url: target,
								status: response.status,
								mime: response.headers.get("content-type"),
								bytes: bytes.byteLength,
								sha256: [...new Uint8Array(digest)]
									.map((value) => value.toString(16).padStart(2, "0"))
									.join(""),
							});
						}
						return { timedOut: false, rows };
					};
					const cache = await Promise.race([
						inspect(),
						new Promise((resolve) =>
							setTimeout(() => resolve({ timedOut: true }), 2000),
						),
					]);
					return {
						href: location.origin + location.pathname,
						resourceTiming,
						cache,
					};
				}, urls),
				"public-cache",
			)
				.then((result) =>
					record("failure-public-cache-observation", {
						failedUrl: url,
						...result,
					}),
				)
				.catch((error) =>
					record("failure-observation-unavailable", {
						name: error instanceof Error ? error.name : "unknown",
					}),
				),
		);
	};
	session.on("Network.requestWillBeSent", (event) => {
		const url = cleanUrl(event.request.url);
		if (
			!url ||
			(event.type !== "Document" &&
				(!new URL(url).pathname.startsWith("/assets/") ||
					!/\.(js|css)$/.test(url)))
		)
			return;
		requests.set(event.requestId, url);
		requestContexts.set(event.requestId, {
			loaderId: event.loaderId,
			frameId: event.frameId ?? null,
			documentUrl: cleanUrl(event.documentURL),
			type: event.type ?? null,
		});
		record("request", {
			requestId: event.requestId,
			url,
			loaderId: event.loaderId,
			frameId: event.frameId,
			documentUrl: cleanUrl(event.documentURL),
			type: event.type,
			initiatorType: event.initiator.type,
			initiatorUrl: event.initiator.url
				? cleanUrl(event.initiator.url)
				: undefined,
			initiatorStack: cleanStack(event.initiator.stack),
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
		requestContexts.delete(event.requestId);
	});
	session.on("Network.loadingFailed", (event) => {
		const url = requests.get(event.requestId);
		if (!url) return;
		const details = {
			requestId: event.requestId,
			url,
			requestContext: requestContexts.get(event.requestId),
			currentMainLoaderId,
			cdpTimestampSeconds: event.timestamp,
			errorText: event.errorText.startsWith("net::")
				? event.errorText
				: "browser-request-failure",
			canceled: event.canceled,
			blockedReason: event.blockedReason,
			corsErrorStatus: event.corsErrorStatus,
		};
		record("failed", details);
		console.log("[account-graph-network-failure]", JSON.stringify(details));
		if (/\.(js|css)$/.test(url)) onStaticFailure?.(details);
		observedFailure = true;
		for (const [targetId, workerUrl] of workerTargets)
			attachWorkerAfterFailure(targetId, workerUrl);
		if (/\.(js|css)$/.test(url)) snapshotFailure(url);
		requests.delete(event.requestId);
		requestContexts.delete(event.requestId);
	});
	session.on("Page.navigatedWithinDocument", (event) => {
		const url = cleanUrl(event.url);
		if (url)
			record("same-document-navigation", {
				frameId: event.frameId,
				url,
				navigationType: event.navigationType,
			});
	});
	session.on("Page.frameNavigated", ({ frame }) => {
		if (frame.parentId) return;
		currentMainLoaderId = frame.loaderId;
		const url = cleanUrl(frame.url);
		if (url)
			record("frame-navigated", {
				frameId: frame.id,
				loaderId: frame.loaderId,
				url,
			});
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
		schema: "keepany.graph-network.v2",
		origin,
		scope:
			"Before failure: passive navigation/request/target discovery only. SW Runtime attachment and public static-resource timing/cache digests start only after first observed failure. No interception, retry, headers, user data, cache or SW policy changes.",
	});
	return () => {
		if (stopPromise) return stopPromise;
		stopping = true;
		record("collector-stop-start", {});
		stopPromise = (async () => {
			await Promise.allSettled(observations);
			await Promise.allSettled(workerAttachments);
			if (browserSession) {
				await Promise.allSettled(
					[...workerSessions.keys()].map((sessionId) =>
						withinDeadline(
							browserSession.send("Target.detachFromTarget", { sessionId }),
							"worker-detach",
						),
					),
				);
			}
			const cleanup = await Promise.allSettled([
				withinDeadline(session.detach(), "page-detach"),
				...(browserSession
					? [withinDeadline(browserSession.detach(), "browser-detach")]
					: []),
			]);
			record("collector-stop", {
				pendingObservedRequestCount: requests.size,
				cleanupUnavailable: cleanup.filter(
					(result) => result.status === "rejected",
				).length,
			});
			closed = true;
		})();
		return stopPromise;
	};
}
