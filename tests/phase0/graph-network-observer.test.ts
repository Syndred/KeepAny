import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { observeGraphNetwork } from "../e2e/helpers/graph-network-diagnostics";

// Controlled protocol objects verify observer boundaries, not browser behavior.
class Session extends EventEmitter {
	commands: { method: string; params: Record<string, unknown> }[] = [];
	detached = 0;
	attachment?: Promise<{ sessionId: string }>;
	async send(method: string, params: Record<string, unknown> = {}) {
		this.commands.push({ method, params });
		if (method === "Target.attachToTarget")
			return this.attachment ?? { sessionId: "synthetic-session" };
		return {};
	}
	async detach() {
		this.detached++;
	}
}

const cleanups: (() => Promise<void>)[] = [];
const directories: string[] = [];
function fixture(neverEvaluate = false) {
	const directory = mkdtempSync(join(tmpdir(), "keepany-observer-"));
	directories.push(directory);
	const pageSession = new Session();
	const browserSession = new Session();
	const evaluate = vi.fn((_callback: unknown, targets: string[]) =>
		neverEvaluate
			? new Promise<never>(() => {})
			: Promise.resolve({
					href: "http://127.0.0.1:4393/accounts",
					resourceTiming: [],
					cache: { timedOut: false, rows: [] },
					queriedUrls: targets,
				}),
	);
	const page = {
		context: () => ({
			newCDPSession: async () => pageSession,
			browser: () => ({ newBrowserCDPSession: async () => browserSession }),
		}),
		evaluate,
	} as unknown as Page;
	const info = {
		project: { use: { baseURL: "http://127.0.0.1:4393" } },
		outputPath: (name: string) => join(directory, name),
	} as unknown as TestInfo;
	const worker = (targetId = "synthetic-worker") =>
		browserSession.emit("Target.targetCreated", {
			targetInfo: {
				type: "service_worker",
				url: "http://127.0.0.1:4393/sw.js",
				targetId,
			},
		});
	const request = (requestId: string, path: string, type = "Script") =>
		pageSession.emit("Network.requestWillBeSent", {
			requestId,
			request: { url: `http://127.0.0.1:4393${path}` },
			loaderId: "synthetic-loader",
			frameId: "synthetic-frame",
			documentURL: "http://127.0.0.1:4393/accounts",
			type,
			initiator: { type: "script" },
			timestamp: 1,
		});
	const fail = (requestId: string) =>
		pageSession.emit("Network.loadingFailed", {
			requestId,
			timestamp: 2,
			errorText: "net::ERR_ABORTED",
			canceled: true,
		});
	const rows = () =>
		readFileSync(join(directory, "account-graph-network.jsonl"), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
	return {
		page,
		info,
		pageSession,
		browserSession,
		evaluate,
		worker,
		request,
		fail,
		rows,
	};
}

afterEach(async () => {
	for (const stop of cleanups.splice(0)) await stop();
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true });
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

describe("graph network observer boundaries", () => {
	it("does not create protocol sessions when diagnostics are disabled", async () => {
		vi.stubEnv("KEEPANY_GRAPH_NETWORK_DIAGNOSTICS", "0");
		const context = vi.fn();
		const stop = await observeGraphNetwork(
			{ context } as unknown as Page,
			{} as TestInfo,
		);
		await stop();
		expect(context).not.toHaveBeenCalled();
	});

	it("keeps default metadata mode free of forensic activity after cancellations", async () => {
		vi.stubEnv("KEEPANY_GRAPH_NETWORK_DIAGNOSTICS", "1");
		const f = fixture();
		const onFailure = vi.fn();
		const stop = await observeGraphNetwork(f.page, f.info, onFailure);
		cleanups.push(stop);
		f.worker();
		f.request("first", "/assets/workbox-window-synthetic.js?private=discarded");
		f.fail("first");
		f.request("document", "/accounts/synthetic", "Document");
		f.fail("document");
		f.worker("later-worker");
		await stop();
		expect(onFailure).toHaveBeenCalledTimes(1);
		expect(f.rows().filter((row) => row.stage === "failed")).toHaveLength(2);
		expect(f.evaluate).not.toHaveBeenCalled();
		expect(
			f.browserSession.commands.filter(
				(row) => row.method === "Target.attachToTarget",
			),
		).toEqual([]);
		expect(
			f.rows().find((row) => row.stage === "collector-start").observerMode,
		).toBe("metadata");
		expect(
			f.rows().some((row) => row.stage === "failure-public-cache-observation"),
		).toBe(false);
	});

	it("samples the failed public Workbox first and at most five related resources only in forensic mode", async () => {
		vi.stubEnv("KEEPANY_GRAPH_NETWORK_DIAGNOSTICS", "1");
		const f = fixture();
		const stop = await observeGraphNetwork(f.page, f.info, undefined, {
			mode: "forensic",
		});
		cleanups.push(stop);
		f.worker();
		expect(f.evaluate).not.toHaveBeenCalled();
		expect(
			f.browserSession.commands.filter(
				(row) => row.method === "Target.attachToTarget",
			),
		).toEqual([]);
		for (let index = 0; index < 7; index++)
			f.request(
				`related-${index}`,
				`/assets/PasswordVaultPanel-synthetic-${index}.js`,
			);
		f.request("duplicate", "/assets/PasswordVaultPanel-synthetic-0.js");
		f.request("unrelated", "/assets/other-synthetic.js");
		f.request("first", "/assets/workbox-window-synthetic.js?private=discarded");
		f.fail("first");
		await stop();
		const targets = f.evaluate.mock.calls[0][1];
		expect(targets).toEqual([
			"http://127.0.0.1:4393/assets/workbox-window-synthetic.js",
			...Array.from(
				{ length: 5 },
				(_, index) =>
					`http://127.0.0.1:4393/assets/PasswordVaultPanel-synthetic-${index}.js`,
			),
		]);
		const raw = f.rows();
		expect(
			raw.find((row) => row.stage === "failure-public-cache-observation")
				.queriedUrls,
		).toEqual(targets);
		expect(
			raw.find((row) => row.stage === "collector-start").observerMode,
		).toBe("forensic");
		expect(
			raw.filter((row) => row.stage === "service-worker-attach-after-failure"),
		).toHaveLength(1);
	});

	it("does not start forensic activity for a Document cancellation", async () => {
		vi.stubEnv("KEEPANY_GRAPH_NETWORK_DIAGNOSTICS", "1");
		const f = fixture();
		const stop = await observeGraphNetwork(f.page, f.info, undefined, {
			mode: "forensic",
		});
		cleanups.push(stop);
		f.worker();
		f.request("document", "/accounts/synthetic", "Document");
		f.fail("document");
		f.request("document-script-suffix", "/assets/not-a-script.js", "Document");
		f.fail("document-script-suffix");
		f.worker("later-worker");
		await stop();
		expect(f.evaluate).not.toHaveBeenCalled();
		expect(
			f.browserSession.commands.filter(
				(row) => row.method === "Target.attachToTarget",
			),
		).toEqual([]);
		expect(f.rows().filter((row) => row.stage === "failed")).toHaveLength(2);
	});

	it("keeps stop idempotent, bounds a hung evaluation, and detaches a late forensic attachment", async () => {
		vi.stubEnv("KEEPANY_GRAPH_NETWORK_DIAGNOSTICS", "1");
		vi.useFakeTimers();
		const f = fixture(true);
		let resolveAttachment!: (value: { sessionId: string }) => void;
		f.browserSession.attachment = new Promise((resolve) => {
			resolveAttachment = resolve;
		});
		const stop = await observeGraphNetwork(f.page, f.info, undefined, {
			mode: "forensic",
		});
		f.worker();
		f.request("first", "/assets/PasswordVaultPanel-synthetic.js");
		f.fail("first");
		const firstStop = stop();
		expect(stop()).toBe(firstStop);
		f.request("late", "/assets/PasswordVaultPanel-late.js");
		f.fail("late");
		f.worker("late-worker");
		resolveAttachment({ sessionId: "late-session" });
		await vi.advanceTimersByTimeAsync(3001);
		await firstStop;
		expect(stop()).toBe(firstStop);
		expect(f.evaluate).toHaveBeenCalledTimes(1);
		expect(
			f.browserSession.commands.filter(
				(row) => row.method === "Target.attachToTarget",
			),
		).toHaveLength(1);
		expect(
			f.browserSession.commands.filter(
				(row) => row.method === "Target.sendMessageToTarget",
			),
		).toHaveLength(0);
		expect(
			f.browserSession.commands.filter(
				(row) => row.method === "Target.detachFromTarget",
			),
		).toHaveLength(1);
		expect(f.pageSession.detached).toBe(1);
		expect(f.browserSession.detached).toBe(1);
		const raw = f.rows();
		expect(raw.filter((row) => row.stage === "collector-stop")).toHaveLength(1);
		expect(
			raw.some(
				(row) =>
					row.stage === "failure-observation-unavailable" &&
					row.name === "DiagnosticTimeout",
			),
		).toBe(true);
	});
});
