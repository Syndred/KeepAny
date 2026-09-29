import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { Asset } from "../../../packages/domain/src";
import type { BrowserAuditEntry, BrowserMcpBridgeClient } from "../../../packages/mcp/src/browser-bridge";
import type { BridgeScope } from "../../../packages/mcp/src/bridge";
import {
	readableFields,
	writableFields,
	type ReadField,
	type WriteField,
} from "../../../packages/mcp/src/fields";
import type { RxdbMcpAssetStore } from "../../../packages/mcp/src/rxdb-store";
import type { PreviewResult } from "../../../packages/mcp/src/service";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";

export type McpRequest = {
	kind: "keepany-mcp-local-request-v1";
	appOrigin: string;
	assetIds: string[];
	readFields: ReadField[];
	writeFields: WriteField[];
	ttlMs: number;
	createdAt: number;
	requestNonce: string;
};
type McpStatus = "idle" | "pairing" | "connected" | "error";
type RequestInput = Pick<McpRequest, "assetIds" | "readFields" | "writeFields" | "ttlMs">;
type Runtime = {
	status: McpStatus;
	scope: BridgeScope | null;
	expiresAt: number | null;
	audit: BrowserAuditEntry[];
	prepared: McpRequest | null;
	error: string | null;
	prepare(input: RequestInput): void;
	invalidatePrepared(): void;
	importPairing(file: File): Promise<void>;
	revoke(): Promise<void>;
};
const context = createContext<Runtime | null>(null);

export function useMcpRuntime(): Runtime {
	const value = useContext(context);
	if (!value) throw Error("missing-mcp-runtime");
	return value;
}

const same = (left: readonly string[], right: readonly string[]) =>
	left.length === right.length && left.every((item, index) => item === right[index]);

const selectedScope = (scope: BridgeScope, request: McpRequest) =>
	same(scope.assetIds, request.assetIds) &&
	same(scope.readFields, request.readFields) &&
	same(scope.writeFields, request.writeFields);

function pairingFile(raw: unknown, request: McpRequest): { url: string; pairingSecret: string } {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error("mcpPairingInvalid");
	const value = raw as Record<string, unknown>;
	if (
		value.kind !== "keepany-mcp-pairing-v1" ||
		value.requestNonce !== request.requestNonce ||
		value.appOrigin !== window.location.origin ||
		typeof value.url !== "string" ||
		typeof value.pairingSecret !== "string" ||
		!/^[A-Za-z0-9_-]{43}$/.test(value.pairingSecret) ||
		typeof value.expiresAt !== "number" ||
		!Number.isSafeInteger(value.expiresAt) ||
		value.expiresAt <= Date.now() ||
		value.expiresAt > Date.now() + 120_000
	) throw Error("mcpPairingInvalid");
	const url = new URL(value.url);
	if (
		url.origin !== value.url ||
		url.protocol !== "http:" ||
		url.hostname !== "127.0.0.1" ||
		!url.port ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	) throw Error("mcpPairingInvalid");
	return { url: value.url, pairingSecret: value.pairingSecret };
}

function valueText(value: unknown): string {
	if (value === undefined || value === null || value === "") return "—";
	if (typeof value === "string") return value;
	return JSON.stringify(value);
}

export function McpRuntimeProvider({
	assets,
	children,
}: {
	assets: Asset[];
	children: ReactNode;
}) {
	const { t } = useTranslation();
	const [status, setStatus] = useState<McpStatus>("idle");
	const [scope, setScope] = useState<BridgeScope | null>(null);
	const [expiresAt, setExpiresAt] = useState<number | null>(null);
	const [audit, setAudit] = useState<BrowserAuditEntry[]>([]);
	const [prepared, setPrepared] = useState<McpRequest | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [pendingScope, setPendingScope] = useState<BridgeScope | null>(null);
	const [previews, setPreviews] = useState<PreviewResult[]>([]);
	const [previewCurrent, setPreviewCurrent] = useState(false);
	const [previewChecking, setPreviewChecking] = useState(false);
	const [busy, setBusy] = useState(false);
	const clientRef = useRef<BrowserMcpBridgeClient | null>(null);
	const storeRef = useRef<RxdbMcpAssetStore | null>(null);
	const controllerRef = useRef<AbortController | null>(null);
	const approvalRef = useRef<((approved: boolean) => void) | null>(null);
	const scopeDecisionInFlightRef = useRef(false);
	const timerRef = useRef<number | null>(null);
	const generationRef = useRef(0);
	const decisionInFlightRef = useRef(false);
	const preview = previews[0];

	const stopLocal = useCallback(() => {
		generationRef.current++;
		if (timerRef.current !== null) window.clearInterval(timerRef.current);
		timerRef.current = null;
		controllerRef.current?.abort();
		controllerRef.current = null;
		void clientRef.current?.close();
		clientRef.current = null;
		storeRef.current = null;
		approvalRef.current?.(false);
		approvalRef.current = null;
		setPendingScope(null);
		setPreviews([]);
		setScope(null);
		setExpiresAt(null);
		setAudit([]);
	}, []);

	useEffect(() => {
		const leave = () => {
			stopLocal();
		};
		window.addEventListener("pagehide", leave);
		return () => {
			window.removeEventListener("pagehide", leave);
			leave();
		};
	}, [stopLocal]);

	const prepare = useCallback((input: RequestInput) => {
		if (clientRef.current || approvalRef.current || status === "pairing") throw Error("mcpSelectionInvalid");
		const assetSet = new Set(assets.filter(asset => !asset.deleted).map(asset => asset.id));
		const ids = [...new Set(input.assetIds)];
		const reads = [...new Set(input.readFields)];
		const writes = [...new Set(input.writeFields)];
		if (
			!ids.length ||
			ids.length > 500 ||
			ids.some(id => !assetSet.has(id) || id.length > 96) ||
			!reads.length ||
			reads.some(field => !readableFields.includes(field)) ||
			writes.some(field => !writableFields.includes(field) || !reads.includes(field)) ||
			![5 * 60_000, 10 * 60_000, 15 * 60_000].includes(input.ttlMs)
		) {
			setError("mcpSelectionInvalid");
			throw Error("mcpSelectionInvalid");
		}
		const request: McpRequest = {
			kind: "keepany-mcp-local-request-v1",
			appOrigin: window.location.origin,
			assetIds: ids,
			readFields: reads,
			writeFields: writes,
			ttlMs: input.ttlMs,
			createdAt: Date.now(),
			requestNonce: crypto.randomUUID(),
		};
		setPrepared(request);
		setError(null);
		const url = URL.createObjectURL(new Blob([JSON.stringify(request)], { type: "application/json" }));
		const link = document.createElement("a");
		link.href = url;
		link.download = `keepany-mcp-request-${request.requestNonce}.json`;
		document.body.append(link);
		link.click();
		link.remove();
		window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
	}, [assets, status]);
	const invalidatePrepared = useCallback(() => {
		setPrepared(null);
		setError(current =>
			prepared || current === "mcpSelectionChanged" ? "mcpSelectionChanged" : null,
		);
	}, [prepared]);

	const answerScope = (approved: boolean) => {
		const resolve = approvalRef.current;
		if (!resolve || scopeDecisionInFlightRef.current) return;
		if (!approved) {
			approvalRef.current = null;
			setPendingScope(null);
			resolve(false);
			return;
		}
		const requested = prepared;
		const selected = pendingScope;
		const store = storeRef.current;
		scopeDecisionInFlightRef.current = true;
		setBusy(true);
		void (async () => {
			const liveIds = new Set(assets.filter(asset => !asset.deleted).map(asset => asset.id));
			const valid = Boolean(requested && selected && store &&
				Date.now() - requested.createdAt <= 5 * 60_000 &&
				selectedScope(selected, requested) &&
				selected.assetIds.every(id => liveIds.has(id)) &&
				(await Promise.all(selected.assetIds.map(id => store.get(id))))
					.every(row => row && !row.asset.deleted));
			if (approvalRef.current === resolve) {
				approvalRef.current = null;
				setPendingScope(null);
				resolve(valid);
			}
		})().catch(() => {
			if (approvalRef.current === resolve) {
				approvalRef.current = null;
				setPendingScope(null);
				resolve(false);
			}
		}).finally(() => {
			scopeDecisionInFlightRef.current = false;
			setBusy(false);
		});
	};

	const importPairing = useCallback(async (file: File) => {
		if (!prepared || clientRef.current || status === "pairing" || file.size > 20_000) {
			setError("mcpPairingInvalid");
			throw Error("mcpPairingInvalid");
		}
		let client: BrowserMcpBridgeClient | null = null;
		setStatus("pairing");
		setError(null);
		try {
			if (Date.now() - prepared.createdAt > 5 * 60_000) throw Error("mcpPairingInvalid");
			let contents: unknown;
			try { contents = JSON.parse(await file.text()); }
			catch { throw Error("mcpPairingInvalid"); }
			const pairing = pairingFile(contents, prepared);
			const [{ BrowserMcpBridgeClient }, { RxdbMcpAssetStore }, { localRepository }] = await Promise.all([
				import("../../../packages/mcp/src/browser-bridge"),
				import("../../../packages/mcp/src/rxdb-store"),
				import("../../../packages/local-db/src"),
			]);
			const store = new RxdbMcpAssetStore(await localRepository());
			storeRef.current = store;
			client = new BrowserMcpBridgeClient({
				...pairing,
				store,
				approve: selected => {
					if (!selectedScope(selected, prepared)) return Promise.resolve(false);
					return new Promise<boolean>(resolve => {
						approvalRef.current = resolve;
						setPendingScope(selected);
					});
				},
			});
			const selected = await client.pair();
			if (!selectedScope(selected, prepared)) throw Error("mcpPairingInvalid");
			clientRef.current = client;
			storeRef.current = store;
			const controller = new AbortController();
			controllerRef.current = controller;
			const generation = ++generationRef.current;
			setScope(selected);
			setExpiresAt(client.sessionExpiresAt);
			setStatus("connected");
			setPrepared(null);
			let lastAuditFetch = 0;
			const refresh = async () => {
				try {
					const now = Date.now();
					const checkAudit = now - lastAuditFetch >= 5_000;
					if (checkAudit) lastAuditFetch = now;
					const [list, entries] = await Promise.all([client?.pendingPreviews(), checkAudit ? client?.auditEntries().catch(() => []) : undefined]);
					if (generation === generationRef.current && list) setPreviews(current =>
						JSON.stringify(current) === JSON.stringify(list) ? current : list);
					if (generation === generationRef.current && entries) setAudit(current =>
						JSON.stringify(current) === JSON.stringify(entries) ? current : entries);
				} catch {
					if (generation === generationRef.current) {
						setError("mcpConnectionFailed");
						setStatus("error");
					}
				}
			};
			timerRef.current = window.setInterval(() => { void refresh(); }, 800);
			void refresh();
			void client.run(controller.signal).catch(() => {
				if (generation === generationRef.current) {
					setError("mcpConnectionFailed");
					setStatus("error");
				}
			}).finally(() => {
				if (generation === generationRef.current) {
					stopLocal();
					setStatus("idle");
				}
			});
		} catch (cause) {
			void client?.close();
			storeRef.current = null;
			approvalRef.current = null;
			setPendingScope(null);
			setStatus("error");
			setError(cause instanceof Error && cause.message === "mcpPairingInvalid" ? "mcpPairingInvalid" :
				cause instanceof Error && cause.message === "bridge-approval-denied" ? "mcpApprovalDenied" : "mcpConnectionFailed");
			throw cause;
		}
	}, [prepared, status, stopLocal]);

	const revoke = useCallback(async () => {
		const client = clientRef.current;
		if (!client) {
			stopLocal();
			setStatus("idle");
			return;
		}
		setBusy(true);
		try {
			const result = await client.revokeGrant();
			stopLocal();
			setStatus("idle");
			setPrepared(null);
			setError(result.writeMayHaveApplied ? "mcpWriteMayHaveApplied" : null);
		} catch {
			setError("mcpRevokeUnconfirmed");
			setStatus("connected");
			throw Error("mcpRevokeUnconfirmed");
		} finally {
			setBusy(false);
		}
	}, [stopLocal]);

	useEffect(() => {
		if (!preview) {
			setPreviewCurrent(false);
			return;
		}
		let active = true;
		setPreviewChecking(true);
		void storeRef.current?.get(preview.assetId).then(row => {
			if (!active) return;
			setPreviewCurrent(Boolean(row && row.version === preview.expectedVersion &&
				preview.changes.every(change =>
					JSON.stringify(row.asset[change.field]) === JSON.stringify(change.before))));
		}).catch(() => { if (active) setPreviewCurrent(false); }).finally(() => {
			if (active) setPreviewChecking(false);
		});
		return () => { active = false; };
	}, [preview]);

	const decidePreview = async (approved: boolean) => {
		const current = preview;
		const client = clientRef.current;
		const store = storeRef.current;
		if (!current || !client || !store || decisionInFlightRef.current) return;
		decisionInFlightRef.current = true;
		setBusy(true);
		try {
			const row = await store.get(current.assetId);
			const matches = Boolean(row && row.version === current.expectedVersion &&
				current.changes.every(change =>
					JSON.stringify(row.asset[change.field]) === JSON.stringify(change.before)));
			if (approved && !matches) {
				setError("mcpPreviewExpired");
				await client.rejectPreview(current.previewId);
			} else if (approved) {
				await client.approvePreview(current.previewId);
			} else {
				await client.rejectPreview(current.previewId);
			}
			setPreviews(items => items.filter(item => item.previewId !== current.previewId));
		} catch {
			setError("mcpConnectionFailed");
		} finally {
			decisionInFlightRef.current = false;
			setBusy(false);
		}
	};

	return <context.Provider value={{ status, scope, expiresAt, audit, prepared, error, prepare, invalidatePrepared, importPairing, revoke }}>
		{children}
		{pendingScope && <Dialog title={t("mcpScopeApprovalTitle")} onClose={() => answerScope(false)} returnFocusTo={() => document.getElementById("mcp-panel-title")}>
			<p>{t("mcpScopeApprovalHint")}</p>
			<ul className="mcp-scope-list">
				{pendingScope.assetIds.map(id =>
					<li key={id}>{assets.find(asset => asset.id === id)?.name ?? t("mcpAssetUnavailable")}</li>)}
			</ul>
			<p>{t("mcpReadFields")}: {pendingScope.readFields.map(field => t(`mcpField_${field}`)).join(", ")}</p>
			<p>{t("mcpWriteFields")}: {pendingScope.writeFields.length ?
				pendingScope.writeFields.map(field => t(`mcpField_${field}`)).join(", ") : t("mcpNoWrite")}</p>
			{prepared && <p>{t("mcpScopeDuration", { minutes: prepared.ttlMs / 60_000 })}</p>}
			<div className="actions">
				<Button disabled={busy} onClick={() => answerScope(false)}>{t("mcpScopeApprovalDeny")}</Button>
				<Button disabled={busy} onClick={() => answerScope(true)}>{t("mcpScopeApprovalApprove")}</Button>
			</div>
		</Dialog>}
		{preview && <Dialog title={t("mcpWriteApprovalTitle")} onClose={() => void decidePreview(false)}>
			<p>{t("mcpWriteApprovalHint")}</p>
			<p className="mcp-preview-asset">{t("mcpPreviewAsset")}: {assets.find(asset => asset.id === preview.assetId)?.name ?? preview.assetId}</p>
			<div className="mcp-preview-changes">
				{preview.changes.map(change => <div key={change.field} className="mcp-preview-change">
					<strong>{t(`mcpField_${change.field}`)}</strong>
					<div><small>{t("mcpValueBefore")}</small><p>{valueText(change.before)}</p></div>
					<div><small>{t("mcpValueAfter")}</small><p>{valueText(change.after)}</p></div>
				</div>)}
			</div>
			{!previewChecking && !previewCurrent && <p role="alert">{t("mcpPreviewExpired")}</p>}
			<div className="actions">
				<Button disabled={busy} onClick={() => void decidePreview(false)}>{t("mcpWriteApprovalDeny")}</Button>
				<Button disabled={busy || previewChecking || !previewCurrent} onClick={() => void decidePreview(true)}>
					{t("mcpWriteApprovalApprove")}
				</Button>
			</div>
		</Dialog>}
	</context.Provider>;
}
