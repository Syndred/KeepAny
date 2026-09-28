import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { localRepository } from "../../../packages/local-db/src";
import type { SelfHostSyncClient, SyncReport } from "../../../packages/sync-client/src";
import { BindingPanel } from "./components/BindingPanel";
import { Button } from "./components/ui/button";
import { seed } from "./data";
import { PageTitle, useAppContext } from "./view-shared";
export function SettingsPage() {
	const { data, notify } = useAppContext();
	const { t, i18n } = useTranslation();
	const [persistent, setPersistent] = useState<boolean | null>(null);
	const [requested, setRequested] = useState(false);
	const [seeding, setSeeding] = useState(false);
	const [endpoint, setEndpoint] = useState(() => localStorage.getItem("keepany-selfhost-endpoint") ?? "");
	const [workspaceId, setWorkspaceId] = useState(() => localStorage.getItem("keepany-selfhost-workspace") ?? "");
	const [token, setToken] = useState("");
	const [workspaceKey, setWorkspaceKey] = useState("");
	const [showKey, setShowKey] = useState(false);
	const [confirmCreate, setConfirmCreate] = useState(false);
	const [needsKeySave, setNeedsKeySave] = useState(false);
	const [syncReport, setSyncReport] = useState<SyncReport | null>(null);
	const [syncBusy, setSyncBusy] = useState(false);
	const clientRef = useRef<SelfHostSyncClient | null>(null);
	const clientGeneration = useRef(-1);
	const configGeneration = useRef(0);
	const activeOperation = useRef<number | null>(null);
	const nextOperation = useRef(0);
	const mounted = useRef(true);
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
	const editConfig = (write: () => void) => {
		if (activeOperation.current !== null) return;
		invalidateConfig();
		write();
	};
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
		const { SelfHostSyncClient, decodeWorkspaceKey } = await import("../../../packages/sync-client/src");
		const repository = await localRepository();
		if (!isActive(operation)) return null;
		const client = new SelfHostSyncClient(repository, {
			endpoint, token, workspaceId, key: decodeWorkspaceKey(workspaceKey),
		});
		if (!isActive(operation)) return null;
		clientRef.current = client;
		clientGeneration.current = operation.generation;
		return client;
	};
	const rememberLocation = (client: SelfHostSyncClient) => {
		localStorage.setItem("keepany-selfhost-endpoint", client.endpoint);
		localStorage.setItem("keepany-selfhost-workspace", client.workspaceId);
	};
	const createWorkspace = async () => {
		const operation = beginOperation();
		if (!operation) return;
		setConfirmCreate(false);
		try {
			const { newWorkspaceKey, createSelfHostedWorkspace } = await import("../../../packages/sync-client/src");
			if (!isActive(operation)) return;
			const binding = await (await localRepository()).getDatasetBinding();
			if (!isActive(operation)) return;
			if (binding) throw Error("sync-dataset-bound");
			const key = await newWorkspaceKey();
			if (!isActive(operation)) return;
			const id = await createSelfHostedWorkspace(endpoint, token);
			if (!isActive(operation)) return;
			invalidateConfig();
			setWorkspaceId(id);
			setWorkspaceKey(key);
			setNeedsKeySave(true);
		} catch (error) { if (isActive(operation)) setSyncReport(failure(error, "sync-create-failed")); }
		finally { finishOperation(operation); }
	};
	const syncNow = async () => {
		const operation = beginOperation();
		if (!operation) return;
		try {
			const client = await connect(operation);
			if (!client || !isActive(operation)) return;
			const report = await client.run(value => { if (isActive(operation)) setSyncReport(value); });
			if (isActive(operation)) {
				if (report.status !== "failed") rememberLocation(client);
				setSyncReport(report);
			}
		} catch (error) {
			if (isActive(operation)) setSyncReport(failure(error, "sync-configuration"));
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
			if (isActive(operation)) setSyncReport(report);
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
					<h2>{t("language")}</h2>
					<select
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
			<BindingPanel />
			<section className="card padded sync-panel">
				<h2>{t("selfHostSync")}</h2>
				<p>{t("selfHostSyncHint")}</p>
				<div className="form-grid">
					<label className="field"><span>{t("syncServerUrl")}</span><input value={endpoint} disabled={syncBusy} onChange={event => editConfig(() => setEndpoint(event.target.value))} placeholder="https://sync.example.com" autoComplete="url" /></label>
					<label className="field"><span>{t("syncAccessToken")}</span><input type="password" value={token} disabled={syncBusy} onChange={event => editConfig(() => setToken(event.target.value))} autoComplete="off" /></label>
					<label className="field"><span>{t("syncWorkspace")}</span><input value={workspaceId} disabled={syncBusy} onChange={event => editConfig(() => setWorkspaceId(event.target.value))} autoComplete="off" /></label>
					<label className="field"><span>{t("syncWorkspaceKey")}</span><input type={showKey ? "text" : "password"} value={workspaceKey} disabled={syncBusy} onChange={event => editConfig(() => setWorkspaceKey(event.target.value))} autoComplete="off" /><small>{t("syncKeyHint")}</small></label>
				</div>
				<div className="actions">
					<Button disabled={syncBusy || !endpoint || !token} onClick={() => {
						if (workspaceId || workspaceKey) setConfirmCreate(true);
						else void createWorkspace();
					}}>{t("syncCreateWorkspace")}</Button>
					<Button disabled={!workspaceKey} onClick={() => setShowKey(value => !value)}>{t(showKey ? "syncHideKey" : "syncShowKey")}</Button>
					<Button disabled={!workspaceKey} onClick={async () => {
						try { await navigator.clipboard.writeText(workspaceKey); notify(t("syncKeyCopied")); }
						catch { notify(t("syncCopyFailed")); }
					}}>{t("syncCopyKey")}</Button>
					<Button disabled={syncBusy || !endpoint || !token || !workspaceId || !workspaceKey} onClick={() => void checkLocal()}>{t("syncCheckLocal")}</Button>
					<Button disabled={syncBusy || needsKeySave || !endpoint || !token || !workspaceId || !workspaceKey} onClick={() => void syncNow()}>{t("syncNow")}</Button>
				</div>
				{confirmCreate && <fieldset className="sync-confirm" disabled={syncBusy}><legend>{t("syncCreateWorkspace")}</legend>
					<p>{t("syncCreateConfirm")}</p>
					<div className="actions"><Button onClick={() => setConfirmCreate(false)}>{t("cancel")}</Button><Button onClick={() => void createWorkspace()}>{t("syncCreateWorkspace")}</Button></div>
				</fieldset>}
				{needsKeySave && <label className="sync-key-check"><input type="checkbox" checked={!needsKeySave} onChange={event => setNeedsKeySave(!event.target.checked)} />{t("syncKeySavedConfirm")}</label>}
				<div className="notice" role="status">{t(`syncState_${syncBusy ? "syncing" : syncReport?.status ?? "local"}`)}</div>
				{syncReport?.status === "failed" && <p role="alert">{t(syncReport.error === "sync-attachments-unsupported" ? "syncFilesUnsupported" : syncReport.error === "sync-auth" ? "syncAuthFailed" : syncReport.error === "sync-key-mismatch" ? "syncKeyMismatch" : syncReport.error === "sync-dataset-bound" || syncReport.error === "sync-dataset-ambiguous" ? "syncDatasetBound" : syncReport.error === "sync-account-mismatch" ? "syncAccountMismatch" : "syncFailedHint")}</p>}
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
						<Button disabled={syncBusy} onClick={() => void chooseConflict("local")}>{t("syncKeepLocal")}</Button>
						<Button disabled={syncBusy} onClick={() => void chooseConflict("remote")}>{t("syncKeepRemote")}</Button>
					</div>
				</div>}
			</section>
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
