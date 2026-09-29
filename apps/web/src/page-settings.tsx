import { Link } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { bridgeBindingKeys, createBindingBridgeFetch } from "../../../packages/binding/src/bridge";
import { BindingTransport } from "../../../packages/binding/src/remote";
import { defaultBindingRepository, type StoredBinding } from "../../../packages/binding/src/store";
import { localRepository, type DatasetBinding } from "../../../packages/local-db/src";
import type { SelfHostSyncClient, SyncReport } from "../../../packages/sync-client/src";
import { BindingPanel } from "./components/BindingPanel";
import { ArchiveMigrationPanel } from "./components/ArchiveMigrationPanel";
import { WorkspaceKeyPanel } from "./components/WorkspaceKeyPanel";
import { McpPanel } from "./components/McpPanel";
import { Button } from "./components/ui/button";
import { seed } from "./data";
import { PageTitle, useAppContext } from "./view-shared";
const SelfHostSessionPanel = lazy(() => import("./components/SelfHostSessionPanel").then(module => ({ default: module.SelfHostSessionPanel })));
type AccessMode = "token" | "session" | "official";
const officialWorkspaceKey = (accountId: string) => `keepany-official-workspace:${accountId}`;
const officialOrigin = import.meta.env.VITE_KEEPANY_OFFICIAL_SYNC_ORIGIN;
const bindingIssuer = import.meta.env.VITE_KEEPANY_BINDING_ISSUER;
const bindingBridgeOrigin = import.meta.env.VITE_KEEPANY_BINDING_BRIDGE_ORIGIN;

async function officialAccess() {
	if (officialOrigin !== window.location.origin || typeof bindingIssuer !== "string" || typeof bindingBridgeOrigin !== "string") throw Error("sync-auth");
	const { createBoundSyncAccess } = await import("../../../packages/binding/src/bound-sync");
	return createBoundSyncAccess({
		repository: defaultBindingRepository(),
		transport: new BindingTransport(bindingIssuer, createBindingBridgeFetch(bindingIssuer, bindingBridgeOrigin)),
		keys: bridgeBindingKeys(bindingIssuer, bindingBridgeOrigin),
		resourceOrigin: officialOrigin,
	});
}
function syncFailureKey(error: string | undefined, mode: AccessMode): string {
	if (error?.startsWith("sync-attachment-") || error?.startsWith("attachment-"))
		return mode === "official" ? "syncOfficialFilesFailed" : "syncFilesUnsupported";
	if (error === "sync-auth" || (mode === "official" && error?.startsWith("binding-")))
		return mode === "official" ? "syncOfficialAuthFailed" : mode === "session" ? "syncSessionAuthFailed" : "syncAuthFailed";
	if (error === "sync-key-mismatch") return "syncKeyMismatch";
	if (error === "sync-dataset-bound" || error === "sync-dataset-ambiguous") return "syncDatasetBound";
	if (error === "sync-account-mismatch") return mode === "official" ? "syncOfficialAccountMismatch" : "syncAccountMismatch";
	if (error?.startsWith("archive-merge-")) return "migrationSyncGate";
	return "syncFailedHint";
}
export function SettingsPage() {
	const { data, notify } = useAppContext();
	const { t, i18n } = useTranslation();
	const officialAvailable = typeof officialOrigin === "string" && officialOrigin === window.location.origin &&
		typeof bindingIssuer === "string" && typeof bindingBridgeOrigin === "string";
	const [persistent, setPersistent] = useState<boolean | null>(null);
	const [requested, setRequested] = useState(false);
	const [seeding, setSeeding] = useState(false);
	const [accessMode, setAccessMode] = useState<AccessMode>(() => {
		const saved = localStorage.getItem("keepany-sync-access-mode") ?? localStorage.getItem("keepany-selfhost-access-mode");
		return saved === "official" && officialAvailable ? "official" : saved === "session" ? "session" : "token";
	});
	const [endpoint, setEndpoint] = useState(() => localStorage.getItem("keepany-selfhost-endpoint") ?? "");
	const [workspaceId, setWorkspaceId] = useState(() => accessMode === "official" ? "" : localStorage.getItem("keepany-selfhost-workspace") ?? "");
	const [token, setToken] = useState("");
	const [sessionAccountId, setSessionAccountId] = useState<string | null>(null);
	const [officialBinding, setOfficialBinding] = useState<StoredBinding>();
	const [availableWorkspaces, setAvailableWorkspaces] = useState<string[]>([]);
	const [workspaceKey, setWorkspaceKey] = useState("");
	const [showKey, setShowKey] = useState(false);
	const [confirmCreate, setConfirmCreate] = useState(false);
	const [needsKeySave, setNeedsKeySave] = useState(false);
	const [syncReport, setSyncReport] = useState<SyncReport | null>(null);
	const [syncBusy, setSyncBusy] = useState(false);
	const [migrationBusy, setMigrationBusy] = useState(false);
	const [keyAccessBusy, setKeyAccessBusy] = useState(false);
	const clientRef = useRef<SelfHostSyncClient | null>(null);
	const clientGeneration = useRef(-1);
	const configGeneration = useRef(0);
	const activeOperation = useRef<number | null>(null);
	const nextOperation = useRef(0);
	const mounted = useRef(true);
	const sessionAccountRef = useRef<string | null>(null);
	const bindingIdentity = useRef<string | null | undefined>(undefined);
	const accessModeRef = useRef(accessMode);
	accessModeRef.current = accessMode;
	const syncEndpoint = accessMode === "official" ? officialOrigin ?? "" : accessMode === "session" ? window.location.origin : endpoint;
	const officialAccountId = officialBinding?.allowedScopes.includes("sync:write") ? officialBinding.subject : null;
	const hasAccess = accessMode === "official" ? Boolean(officialAccountId) : accessMode === "session" ? Boolean(sessionAccountId) : Boolean(token);
	const uiBusy = syncBusy || migrationBusy || keyAccessBusy;
	useEffect(() => {
		mounted.current = true;
		void navigator.storage?.persisted?.().then(value => { if (mounted.current) setPersistent(value); });
		return () => {
			mounted.current = false;
			configGeneration.current++;
			activeOperation.current = null;
			clientGeneration.current = -1;
			clientRef.current = null;
		};
	}, []);
	const invalidateConfig = () => {
		configGeneration.current++;
		clientGeneration.current = -1;
		clientRef.current = null;
		setSyncReport(null);
		setConfirmCreate(false);
	};
	const changeBinding = useCallback((binding: StoredBinding | undefined) => {
		const next = binding ? `${binding.bindingId}:${binding.subject}:${[...binding.allowedScopes].sort().join(" ")}` : null;
		const previous = bindingIdentity.current;
		bindingIdentity.current = next;
		setOfficialBinding(binding);
		if (previous === undefined) {
			if (accessModeRef.current === "official" && binding?.allowedScopes.includes("sync:write"))
				setWorkspaceId(localStorage.getItem(officialWorkspaceKey(binding.subject)) ?? "");
			return;
		}
		if (previous === next) return;
		configGeneration.current++;
		clientGeneration.current = -1;
		clientRef.current = null;
		setSyncReport(null);
		setConfirmCreate(false);
		if (accessModeRef.current === "official") {
			setAvailableWorkspaces([]);
			setWorkspaceId(binding?.allowedScopes.includes("sync:write") ? localStorage.getItem(officialWorkspaceKey(binding.subject)) ?? "" : "");
			setWorkspaceKey("");
			setNeedsKeySave(false);
		}
	}, []);
	const editConfig = (write: () => void) => {
		if (activeOperation.current !== null || migrationBusy || keyAccessBusy) return;
		invalidateConfig();
		write();
	};
	const changeSession = (accountId: string | null) => {
		if (sessionAccountRef.current === accountId) return;
		sessionAccountRef.current = accountId;
		invalidateConfig();
		setSessionAccountId(accountId);
		setAvailableWorkspaces([]);
		setWorkspaceId("");
		setWorkspaceKey("");
		setShowKey(false);
		setNeedsKeySave(false);
	};
	const loadWorkspaces = useCallback(async (mode: "session" | "official", accountId: string): Promise<string[]> => {
		if (mode === "official") {
			const bound = await officialAccess();
			if (bound.accountId !== accountId) throw Error("sync-account-mismatch");
			const { getBoundIdentity, listBoundWorkspaces } = await import("../../../packages/sync-client/src");
			if (await getBoundIdentity(window.location.origin, bound) !== accountId) throw Error("sync-account-mismatch");
			return listBoundWorkspaces(window.location.origin, bound);
		}
		const { getSessionIdentity } = await import("../../../packages/sync-client/src");
		if (await getSessionIdentity(window.location.origin) !== accountId) throw Error("sync-account-mismatch");
		const response = await fetch(`${window.location.origin}/workspaces`, { credentials: "include", cache: "no-store",
			headers: { "X-KeepAny-Account-Id": accountId } });
		if (!response.ok) throw Error("sync-auth");
		const body = await response.json() as { workspaces?: { workspaceId: string }[] };
		return (body.workspaces ?? []).map(item => item.workspaceId);
	}, []);
	useEffect(() => {
		const accountId = accessMode === "session" ? sessionAccountId : accessMode === "official" ? officialAccountId : null;
		if (!accountId || (accessMode !== "session" && accessMode !== "official")) return;
		let current = true;
		void (async () => {
			try {
				const ids = await loadWorkspaces(accessMode, accountId);
				if (current) setAvailableWorkspaces(ids);
			} catch { /* A later sign-in or explicit refresh can retry. */ }
		})();
		return () => { current = false; };
	}, [accessMode, sessionAccountId, officialAccountId, loadWorkspaces]);
	const beginOperation = () => {
		if (activeOperation.current !== null) return null;
		const id = ++nextOperation.current;
		activeOperation.current = id;
		setSyncBusy(true);
		return { id, generation: configGeneration.current };
	};
	const isActive = (operation: { id: number; generation: number }) =>
		mounted.current && activeOperation.current === operation.id && configGeneration.current === operation.generation;
	const finishOperation = (operation: { id: number }) => {
		if (activeOperation.current !== operation.id) return;
		activeOperation.current = null;
		if (mounted.current) setSyncBusy(false);
	};
	const failure = (error: unknown, fallback: string): SyncReport => ({
		status: "failed", pending: 0, cursor: 0, conflict: null,
		error: error instanceof Error ? error.message : fallback,
	});
	const connect = async (operation: { id: number; generation: number }) => {
		const { SelfHostSyncClient, decodeWorkspaceKey, getSessionIdentity, getBoundIdentity } = await import("../../../packages/sync-client/src");
		const repository = await localRepository();
		if (!isActive(operation)) return null;
		const key = decodeWorkspaceKey(workspaceKey);
		let client: SelfHostSyncClient;
		if (accessMode === "official") {
			const bound = await officialAccess();
			if (!isActive(operation)) return null;
			if (bound.accountId !== officialBinding?.subject || await getBoundIdentity(syncEndpoint, bound) !== bound.accountId) throw Error("sync-account-mismatch");
			await bound.assertCurrent();
			if (!isActive(operation)) return null;
			client = new SelfHostSyncClient(repository, { endpoint: syncEndpoint, bound, workspaceId, key });
		} else if (accessMode === "session") {
			const accountId = await getSessionIdentity(syncEndpoint);
			if (accountId !== sessionAccountId) throw Error("sync-account-mismatch");
			client = new SelfHostSyncClient(repository, { endpoint: syncEndpoint, sessionAccountId: accountId, workspaceId, key });
		} else {
			client = new SelfHostSyncClient(repository, { endpoint: syncEndpoint, token, workspaceId, key });
		}
		if (!isActive(operation)) return null;
		clientRef.current = client;
		clientGeneration.current = operation.generation;
		return client;
	};
	const rememberLocation = (client: SelfHostSyncClient) => {
		if (accessMode === "official" && officialAccountId) localStorage.setItem(officialWorkspaceKey(officialAccountId), client.workspaceId);
		else {
			localStorage.setItem("keepany-selfhost-endpoint", client.endpoint);
			localStorage.setItem("keepany-selfhost-workspace", client.workspaceId);
		}
	};
	const createWorkspace = async () => {
		const operation = beginOperation();
		if (!operation) return;
		setConfirmCreate(false);
		try {
			const { newWorkspaceKey, createSelfHostedWorkspace, createSessionWorkspace, createBoundWorkspace, getSessionIdentity, getBoundIdentity } = await import("../../../packages/sync-client/src");
			if (!isActive(operation)) return;
			const binding = await (await localRepository()).getDatasetBinding();
			if (!isActive(operation)) return;
			if (binding) throw Error("sync-dataset-bound");
			const key = await newWorkspaceKey();
			if (!isActive(operation)) return;
			let id: string;
			if (accessMode === "official") {
				const bound = await officialAccess();
				if (bound.accountId !== officialBinding?.subject || await getBoundIdentity(syncEndpoint, bound) !== bound.accountId) throw Error("sync-account-mismatch");
				if (!isActive(operation)) return;
				id = await createBoundWorkspace(syncEndpoint, bound);
				await bound.assertCurrent();
			} else if (accessMode === "session") {
				if (await getSessionIdentity(syncEndpoint) !== sessionAccountId) throw Error("sync-account-mismatch");
				id = await createSessionWorkspace(syncEndpoint);
				if (await getSessionIdentity(syncEndpoint) !== sessionAccountId) throw Error("sync-account-mismatch");
			} else id = await createSelfHostedWorkspace(syncEndpoint, token);
			if (!isActive(operation)) return;
			invalidateConfig();
			setWorkspaceId(id);
			setWorkspaceKey(key);
			setNeedsKeySave(true);
			if (accessMode !== "token") setAvailableWorkspaces(current => [...new Set([...current, id])]);
		} catch (error) { if (isActive(operation)) setSyncReport(failure(error, "sync-create-failed")); }
		finally { finishOperation(operation); }
	};
	const prepareMigrationTarget = async (): Promise<DatasetBinding> => {
		const operation = beginOperation();
		if (!operation) throw Error("migrationTargetFailed");
		try {
			const repository = await localRepository();
			if (await repository.pendingArchiveMerge()) throw Error("archive-merge-pending");
			const client = await connect(operation);
			if (!client || !isActive(operation)) throw Error("migrationTargetChanged");
			const local = await client.report();
			if (local.pending > 0 || local.conflict) throw Error("migrationTargetNotClean");
			const report = await client.run(value => { if (isActive(operation)) setSyncReport(value); });
			if (!isActive(operation)) throw Error("migrationTargetChanged");
			setSyncReport(report);
			if (report.status !== "synced" || report.pending > 0) throw Error("migrationTargetFailed");
			const binding = await repository.getDatasetBinding();
			if (!binding || binding.endpoint !== client.endpoint || binding.workspaceId !== client.workspaceId)
				throw Error("migrationTargetChanged");
			rememberLocation(client);
			return binding;
		} finally { finishOperation(operation); }
	};
	const syncNow = async (): Promise<SyncReport | null> => {
		const operation = beginOperation();
		if (!operation) return null;
		try {
			const client = await connect(operation);
			if (!client || !isActive(operation)) return null;
			const report = await client.run(value => { if (isActive(operation)) setSyncReport(value); });
			if (isActive(operation)) {
				if (report.status !== "failed") rememberLocation(client);
				if (report.status === "synced" && report.pending === 0) {
					const repository = await localRepository();
					if ((await repository.pendingArchiveMerge())?.phase === "syncing") await repository.completeArchiveMerge();
				}
				setSyncReport(report);
			}
			return report;
		} catch (error) {
			if (isActive(operation)) setSyncReport(failure(error, "sync-configuration"));
			return failure(error, "sync-configuration");
		} finally { finishOperation(operation); }
	};
	const syncArchiveMigration = async (): Promise<SyncReport | null> => {
		const operation = beginOperation();
		if (!operation) return null;
		try {
			const client = await connect(operation);
			if (!client || !isActive(operation)) return null;
			const repository = await localRepository();
			const pending = await repository.pendingArchiveMerge();
			if (!pending || pending.phase === "applying") throw Error("archive-merge-not-applied");
			if (pending.phase === "applied") {
				await client.verifyTarget();
				if (!isActive(operation)) return null;
				await repository.finalizeArchiveMerge();
			}
			const report = await client.run(value => { if (isActive(operation)) setSyncReport(value); });
			if (isActive(operation)) {
				if (report.status === "synced" && report.pending === 0) await repository.completeArchiveMerge();
				setSyncReport(report);
			}
			return report;
		} catch (error) {
			const report = failure(error, "sync-configuration");
			if (isActive(operation)) setSyncReport(report);
			return report;
		} finally { finishOperation(operation); }
	};
	const chooseConflict = async (choice: "local" | "remote") => {
		const client = clientRef.current;
		if (!syncReport?.conflict || !client || clientGeneration.current !== configGeneration.current) return;
		const operation = beginOperation();
		if (!operation) return;
		try {
			const resolved = await client.resolve(choice);
			if (!isActive(operation)) return;
			setSyncReport(resolved);
			const report = await client.run(value => { if (isActive(operation)) setSyncReport(value); });
			if (isActive(operation)) {
				if (report.status === "synced" && report.pending === 0) {
					const repository = await localRepository();
					if ((await repository.pendingArchiveMerge())?.phase === "syncing") await repository.completeArchiveMerge();
				}
				setSyncReport(report);
			}
		} catch (error) {
			if (isActive(operation)) setSyncReport(failure(error, "sync-resolution"));
		} finally { finishOperation(operation); }
	};
	const checkLocal = async () => {
		const operation = beginOperation();
		if (!operation) return;
		try {
			const client = await connect(operation);
			if (!client || !isActive(operation)) return;
			const report = await client.report();
			if (isActive(operation)) setSyncReport(report);
		} catch (error) {
			if (isActive(operation)) setSyncReport(failure(error, "sync-configuration"));
		} finally { finishOperation(operation); }
	};
	const openKeyEnvelopeClient = async () => {
		const { KeyEnvelopeClient } = await import("../../../packages/sync-client/src");
		if (accessMode === "official") {
			const bound = await officialAccess();
			if (bound.accountId !== officialAccountId) throw Error("sync-account-mismatch");
			return new KeyEnvelopeClient({ endpoint: syncEndpoint, workspaceId, bound });
		}
		if (accessMode === "session") {
			if (!sessionAccountId) throw Error("sync-auth");
			return new KeyEnvelopeClient({ endpoint: syncEndpoint, workspaceId, sessionAccountId });
		}
		return new KeyEnvelopeClient({ endpoint: syncEndpoint, workspaceId, token });
	};
	const acceptRecoveredKey = async (key: string, recoveredAccountId: string) => {
		const repository = await localRepository();
		const binding = await repository.getDatasetBinding();
		const accountId = accessMode === "session" ? sessionAccountId : accessMode === "official" ? officialAccountId : null;
		if (accountId && recoveredAccountId !== accountId) throw Error("sync-account-mismatch");
		if (binding && (binding.endpoint !== syncEndpoint || binding.workspaceId !== workspaceId ||
			binding.accountId !== recoveredAccountId)) throw Error("sync-dataset-bound");
		if (!binding && (await repository.allRecords()).length > 0) throw Error("sync-dataset-ambiguous");
		invalidateConfig();
		setWorkspaceKey(key);
		setNeedsKeySave(false);
	};
	const differences = (() => {
		const conflict = syncReport?.conflict;
		if (!conflict) return [];
		const local = conflict.localPayload ? JSON.parse(conflict.localPayload) as Record<string, unknown> : {};
		const remote = JSON.parse(conflict.remotePayload) as Record<string, unknown>;
		return Object.keys({ ...local, ...remote }).filter(key => JSON.stringify(local[key]) !== JSON.stringify(remote[key])).slice(0, 20)
			.map((key, index) => ({ key, label: key === "deleted" ? t("syncDeleted") : ["name", "notes", "description", "status", "dueDate", "url", "username", "amount"].includes(key) ? t(key) : t("syncOtherField", { count: index + 1 }),
				local: local[key], remote: remote[key] }));
	})();
	const showConflictValue = (value: unknown) => typeof value === "boolean" ? t(value ? "syncYes" : "syncNo") :
		Array.isArray(value) ? value.join(", ") : value && typeof value === "object" ? t("syncMultipleValues") : String(value ?? "—");
	return (
		<main className="page">
			<PageTitle title={t("settings")} />
			<div className="card-grid">
				<section className="card padded">
					<h2 id="settings-language-label">{t("language")}</h2>
					<select
						aria-labelledby="settings-language-label"
						value={i18n.language}
						onChange={(e) => {
							const value = e.target.value;
							localStorage.setItem("keepany-language", value);
							void i18n.changeLanguage(value);
						}}
					>
						<option value="zh-CN">简体中文</option>
						<option value="en">English</option>
					</select>
				</section>
				<section className="card padded">
					<h2>{t("storage")}</h2>
					<p>{t("storageHint")}</p>
					<div className="actions">
						<Button
							onClick={async () => {
								const value = await navigator.storage?.persist?.();
								setRequested(true);
								setPersistent(Boolean(value));
								notify(t(value ? "persistent" : "persistDenied"));
							}}
						>
							{t("persist")}
						</Button>
						<Link className="button" to="/intake">
							{t("backup")}
						</Link>
					</div>
					{(persistent === true || requested) && (
						<small>{t(persistent ? "persistent" : "persistDenied")}</small>
					)}
				</section>
			</div>
			<BindingPanel onBindingChange={changeBinding} />
			<McpPanel />
			<section className="card padded sync-panel">
				<h2>{t(accessMode === "official" ? "officialSync" : "selfHostSync")}</h2>
				<p>{t(accessMode === "official" ? "officialSyncHint" : "selfHostSyncHint")}</p>
				<label className="field"><span>{t("syncAccessMode")}</span><select value={accessMode} disabled={uiBusy} onChange={event => editConfig(() => {
					const mode: AccessMode = event.target.value === "official" && officialAvailable ? "official" : event.target.value === "session" ? "session" : "token";
					localStorage.setItem("keepany-sync-access-mode", mode);
					if (mode !== "official") localStorage.setItem("keepany-selfhost-access-mode", mode);
					setAccessMode(mode);
					setWorkspaceId(mode === "official" ? officialAccountId ? localStorage.getItem(officialWorkspaceKey(officialAccountId)) ?? "" : "" : localStorage.getItem("keepany-selfhost-workspace") ?? "");
					setWorkspaceKey("");
					setNeedsKeySave(false);
					setToken("");
				})}><option value="token">{t("syncTokenMode")}</option><option value="session">{t("syncSessionMode")}</option>{officialAvailable && <option value="official">{t("syncOfficialMode")}</option>}</select></label>
				{accessMode === "session" && <><p>{t("syncSessionOriginHint")}</p><Suspense fallback={<p>{t("syncSessionChecking")}</p>}><SelfHostSessionPanel disabled={uiBusy} onSessionChange={changeSession} /></Suspense></>}
				{accessMode === "official" && <p role="status">{t(hasAccess ? "syncOfficialReady" : "syncOfficialAuthorize")}</p>}
				<div className="form-grid">
					<label className="field"><span>{t("syncServerUrl")}</span><input value={syncEndpoint} disabled={uiBusy} readOnly={accessMode !== "token"} onChange={event => editConfig(() => setEndpoint(event.target.value))} placeholder="https://sync.example.com" autoComplete="url" /></label>
					{accessMode === "token" && <label className="field"><span>{t("syncAccessToken")}</span><input type="password" value={token} disabled={uiBusy} onChange={event => editConfig(() => setToken(event.target.value))} autoComplete="off" /></label>}
					<label className="field"><span>{t("syncWorkspace")}</span><input value={workspaceId} disabled={uiBusy || !hasAccess} onChange={event => editConfig(() => setWorkspaceId(event.target.value))} autoComplete="off" /></label>
					<label className="field"><span>{t("syncWorkspaceKey")}</span><input type={showKey ? "text" : "password"} value={workspaceKey} disabled={uiBusy || !hasAccess} onChange={event => editConfig(() => setWorkspaceKey(event.target.value))} autoComplete="off" /><small>{t(accessMode === "token" ? "syncKeyHint" : "syncSessionKeyHint")}</small></label>
				</div>
				{accessMode !== "token" && hasAccess && <div className="actions">
					<label className="field"><span>{t("syncSelectWorkspace")}</span><select value={availableWorkspaces.includes(workspaceId) ? workspaceId : ""} disabled={uiBusy || availableWorkspaces.length === 0} onChange={event => editConfig(() => {
						setWorkspaceId(event.target.value); setWorkspaceKey(""); setNeedsKeySave(false);
					})}><option value="">{t(availableWorkspaces.length ? "syncSelectWorkspace" : "syncNoWorkspaces")}</option>
						{availableWorkspaces.map(id => <option key={id} value={id}>{id}</option>)}</select></label>
					<Button disabled={uiBusy} onClick={() => {
						const mode = accessMode;
						const accountId = mode === "session" ? sessionAccountId : officialBinding?.subject;
						const generation = configGeneration.current;
						if (!accountId || (mode !== "session" && mode !== "official")) return;
						void loadWorkspaces(mode, accountId).then(ids => {
							if (mounted.current && configGeneration.current === generation && accessModeRef.current === mode) setAvailableWorkspaces(ids);
						}).catch(() => {
							if (mounted.current && configGeneration.current === generation) setSyncReport(failure(Error("sync-auth"), "sync-auth"));
						});
					}}>{t("syncRefreshWorkspaces")}</Button>
				</div>}
				<div className="actions">
					<Button disabled={uiBusy || !syncEndpoint || !hasAccess} onClick={() => {
						if (workspaceId || workspaceKey) setConfirmCreate(true);
						else void createWorkspace();
					}}>{t("syncCreateWorkspace")}</Button>
					<Button disabled={!workspaceKey} onClick={() => setShowKey(value => !value)}>{t(showKey ? "syncHideKey" : "syncShowKey")}</Button>
					<Button disabled={!workspaceKey} onClick={async () => {
						try { await navigator.clipboard.writeText(workspaceKey); notify(t("syncKeyCopied")); }
						catch { notify(t("syncCopyFailed")); }
					}}>{t("syncCopyKey")}</Button>
					<Button disabled={uiBusy || !syncEndpoint || !hasAccess || !workspaceId || !workspaceKey} onClick={() => void checkLocal()}>{t("syncCheckLocal")}</Button>
					<Button disabled={uiBusy || needsKeySave || !syncEndpoint || !hasAccess || !workspaceId || !workspaceKey} onClick={() => void syncNow()}>{t("syncNow")}</Button>
				</div>
				{confirmCreate && <fieldset className="sync-confirm" disabled={uiBusy}><legend>{t("syncCreateWorkspace")}</legend>
					<p>{t("syncCreateConfirm")}</p>
					<div className="actions"><Button onClick={() => setConfirmCreate(false)}>{t("cancel")}</Button><Button onClick={() => void createWorkspace()}>{t("syncCreateWorkspace")}</Button></div>
				</fieldset>}
				{needsKeySave && <label className="sync-key-check"><input type="checkbox" checked={!needsKeySave} onChange={event => setNeedsKeySave(!event.target.checked)} />{t("syncKeySavedConfirm")}</label>}
				<div className="notice" role="status">{t(`syncState_${syncBusy ? "syncing" : syncReport?.status ?? "local"}`)}</div>
				{syncReport?.status === "failed" && <p role="alert">{t(syncFailureKey(syncReport.error, accessMode))}</p>}
				{syncReport && syncReport.pending > 0 && <small>{t("syncPendingCount", { count: syncReport.pending })}</small>}
				{syncReport?.conflict && <div className="sync-conflict" role="alert">
					<h3>{t("syncConflictTitle")}</h3>
					<p>{t("syncConflictHint")}</p>
					<div className="sync-differences">
						{differences.map(field => <div className="sync-difference" key={field.key}>
							<strong>{field.label}</strong><span>{t("syncLocalValue")}: {showConflictValue(field.local)}</span><span>{t("syncRemoteValue")}: {showConflictValue(field.remote)}</span>
						</div>)}
					</div>
					<div className="actions">
						<Button disabled={uiBusy} onClick={() => void chooseConflict("local")}>{t("syncKeepLocal")}</Button>
						<Button disabled={uiBusy} onClick={() => void chooseConflict("remote")}>{t("syncKeepRemote")}</Button>
					</div>
				</div>}
			</section>
			<WorkspaceKeyPanel
				endpoint={syncEndpoint}
				accountId={accessMode === "session" ? sessionAccountId : accessMode === "official" ? officialAccountId : null}
				accessMode={accessMode}
				accessToken={token}
				hasAccess={hasAccess}
				workspaceId={workspaceId}
				workspaceKey={workspaceKey}
				canIssue={syncReport?.status === "synced" && !needsKeySave}
				otherBusy={syncBusy || migrationBusy}
				onBusyChange={setKeyAccessBusy}
				openClient={openKeyEnvelopeClient}
				onRecovered={acceptRecoveredKey}
			/>
			<ArchiveMigrationPanel
				configurationKey={JSON.stringify([accessMode, syncEndpoint, workspaceId, workspaceKey, token, sessionAccountId, officialAccountId])}
				syncBusy={syncBusy || keyAccessBusy}
				onBusyChange={setMigrationBusy}
				prepareTarget={prepareMigrationTarget}
				syncTarget={syncArchiveMigration}
			/>
			<section className="card padded">
				<h2>{t("trial")}</h2>
				<p>{t("emptyHint")}</p>
				<Button
					disabled={data.assets.length > 0 || seeding}
					onClick={async () => {
						setSeeding(true);
						try {
							await seed();
							notify(t("saved"));
						} catch {
							notify(t("error"));
						} finally {
							setSeeding(false);
						}
					}}
				>
					{t("loadSample")}
				</Button>
			</section>
		</main>
	);
}
