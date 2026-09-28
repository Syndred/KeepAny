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
	useEffect(() => {
		void navigator.storage?.persisted?.().then(setPersistent);
	}, []);
	const connect = async () => {
		const { SelfHostSyncClient, decodeWorkspaceKey } = await import("../../../packages/sync-client/src");
		const client = new SelfHostSyncClient(await localRepository(), {
			endpoint, token, workspaceId, key: decodeWorkspaceKey(workspaceKey),
		});
		clientRef.current = client;
		localStorage.setItem("keepany-selfhost-endpoint", client.endpoint);
		localStorage.setItem("keepany-selfhost-workspace", client.workspaceId);
		return client;
	};
	const createWorkspace = async () => {
		setConfirmCreate(false);
		setSyncBusy(true);
		try {
			const { newWorkspaceKey, createSelfHostedWorkspace } = await import("../../../packages/sync-client/src");
			const key = await newWorkspaceKey();
			const id = await createSelfHostedWorkspace(endpoint, token);
			setWorkspaceId(id);
			setWorkspaceKey(key);
			setNeedsKeySave(true);
			setSyncReport(null);
		} catch { setSyncReport({ status: "failed", pending: 0, cursor: 0, conflict: null, error: "sync-create-failed" }); }
		finally { setSyncBusy(false); }
	};
	const syncNow = async () => {
		setSyncBusy(true);
		try {
			const client = await connect();
			setSyncReport(await client.run(setSyncReport));
		} catch {
			setSyncReport({ status: "failed", pending: 0, cursor: 0, conflict: null, error: "sync-configuration" });
		} finally { setSyncBusy(false); }
	};
	const chooseConflict = async (choice: "local" | "remote") => {
		setSyncBusy(true);
		try {
			const client = clientRef.current ?? await connect();
			setSyncReport(await client.resolve(choice));
			setSyncReport(await client.run(setSyncReport));
		} catch {
			setSyncReport(await clientRef.current?.report("conflict") ?? { status: "failed", pending: 0, cursor: 0, conflict: null, error: "sync-resolution" });
		} finally { setSyncBusy(false); }
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
					<label className="field"><span>{t("syncServerUrl")}</span><input value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder="https://sync.example.com" autoComplete="url" /></label>
					<label className="field"><span>{t("syncAccessToken")}</span><input type="password" value={token} onChange={event => setToken(event.target.value)} autoComplete="off" /></label>
					<label className="field"><span>{t("syncWorkspace")}</span><input value={workspaceId} onChange={event => setWorkspaceId(event.target.value)} autoComplete="off" /></label>
					<label className="field"><span>{t("syncWorkspaceKey")}</span><input type={showKey ? "text" : "password"} value={workspaceKey} onChange={event => setWorkspaceKey(event.target.value)} autoComplete="off" /><small>{t("syncKeyHint")}</small></label>
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
					<Button disabled={syncBusy || !endpoint || !token || !workspaceId || !workspaceKey} onClick={async () => {
						try { setSyncReport(await (await connect()).report()); }
						catch { setSyncReport({ status: "failed", pending: 0, cursor: 0, conflict: null, error: "sync-configuration" }); }
					}}>{t("syncCheckLocal")}</Button>
					<Button disabled={syncBusy || needsKeySave || !endpoint || !token || !workspaceId || !workspaceKey} onClick={() => void syncNow()}>{t("syncNow")}</Button>
				</div>
				{confirmCreate && <fieldset className="sync-confirm"><legend>{t("syncCreateWorkspace")}</legend>
					<p>{t("syncCreateConfirm")}</p>
					<div className="actions"><Button onClick={() => setConfirmCreate(false)}>{t("cancel")}</Button><Button onClick={() => void createWorkspace()}>{t("syncCreateWorkspace")}</Button></div>
				</fieldset>}
				{needsKeySave && <label className="sync-key-check"><input type="checkbox" checked={!needsKeySave} onChange={event => setNeedsKeySave(!event.target.checked)} />{t("syncKeySavedConfirm")}</label>}
				<div className="notice" role="status">{t(`syncState_${syncBusy ? "syncing" : syncReport?.status ?? "local"}`)}</div>
				{syncReport?.status === "failed" && <p role="alert">{t(syncReport.error === "sync-attachments-unsupported" ? "syncFilesUnsupported" : syncReport.error === "sync-auth" ? "syncAuthFailed" : syncReport.error === "sync-key-mismatch" ? "syncKeyMismatch" : "syncFailedHint")}</p>}
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
