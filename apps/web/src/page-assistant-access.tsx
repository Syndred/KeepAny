import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./components/ui/button";
import { useMcpRuntime } from "./mcp-runtime";
import { liveAssets, PageTitle, useAppContext } from "./view-shared";
import "./page-assistant-access.css";

export function AssistantAccessPage() {
	const { data } = useAppContext();
	const { t, i18n } = useTranslation();
	const runtime = useMcpRuntime();
	const [busy, setBusy] = useState(false);
	const connected = runtime.status === "connected" && runtime.scope !== null &&
		(runtime.expiresAt ?? 0) > Date.now();
	const assetsById = new Map(liveAssets(data).map((asset) => [asset.id, asset]));
	const dateTime = (time: number) => new Intl.DateTimeFormat(i18n.language, {
		dateStyle: "medium", timeStyle: "short",
	}).format(time);
	const revoke = async () => {
		if (busy) return;
		setBusy(true);
		try { await runtime.revoke(); }
		catch { /* The runtime displays the verified revocation error. */ }
		finally { setBusy(false); }
	};
	return <main className="page assistant-access-page">
		<PageTitle eyebrow={t("assistantAccessEyebrow")} title={t("assistantAccessTitle")}
			subtitle={t("assistantAccessSubtitle")} />
		<div className="assistant-access-banner" role="note">{t("assistantAccessBanner")}</div>
		<div className="assistant-access-grid">
			<section className="card padded assistant-access-connections">
				<div className="assistant-access-section-head"><h2>{t("assistantAccessConnections")}</h2><p>{t("assistantAccessConnectionHint")}</p></div>
				{connected && runtime.scope ? <div className="assistant-access-connection">
					<div className="assistant-access-connection-head"><div><strong>{t("assistantAccessLocalConnection")}</strong>
						<small>{t("assistantAccessExpires", { time: dateTime(runtime.expiresAt!) })}</small></div>
						<Button disabled={busy} onClick={() => void revoke()}>{t("mcpRevoke")}</Button></div>
					<div className="assistant-access-scope"><strong>{t("assistantAccessSelectedRecords")}</strong>
						<div className="assistant-access-chips">{runtime.scope.assetIds.map((id) => <span className="chip" key={id}>{assetsById.get(id)?.name ?? t("mcpAssetUnavailable")}</span>)}</div></div>
					<div className="assistant-access-scope"><strong>{t("mcpReadFields")}</strong>
						<div className="assistant-access-chips">{runtime.scope.readFields.map((field) => <span className="chip" key={field}>{t(`mcpField_${field}`)}</span>)}</div></div>
					<div className="assistant-access-scope"><strong>{t("mcpWriteFields")}</strong>
						<p>{runtime.scope.writeFields.length ? runtime.scope.writeFields.map((field) => t(`mcpField_${field}`)).join(" · ") : t("mcpNoWrite")}</p></div>
				</div> : <div className="assistant-access-empty"><strong>{t("assistantAccessNoConnection")}</strong><p>{t("assistantAccessNoConnectionHint")}</p></div>}
				{runtime.error && <p role="alert">{t(runtime.error)}</p>}
				<div className="actions"><Button asChild><Link to="/settings" hash="assistant">{t("assistantAccessConfigure")}</Link></Button>
					<Button onClick={() => window.dispatchEvent(new Event("keepany-open-ai-dialog"))}>{t("settingsAskAssistant")}</Button></div>
			</section>
			<div className="assistant-access-side">
				<section className="card padded assistant-access-history"><h2>{t("assistantAccessRecent")}</h2>
					{connected && runtime.audit.length ? <ol>{runtime.audit.map((entry) => <li key={entry.id}>
						<strong>{t(`assistantAccessAction_${entry.action}`)}</strong>
						<small>{dateTime(entry.at)} · {t(`assistantAccessOutcome_${entry.outcome}`)}{entry.assetId ? ` · ${assetsById.get(entry.assetId)?.name ?? t("mcpAssetUnavailable")}` : ""}</small>
					</li>)}</ol> : <p>{t(connected ? "assistantAccessNoRecent" : "assistantAccessRecentRequiresConnection")}</p>}
				</section>
				<section className="card assistant-access-allowed"><h2>{t("assistantAccessAllowed")}</h2>
					{connected ? <ul><li>{t("assistantAccessSearchSelected")}</li><li>{t("assistantAccessReadSelected")}</li>
						{runtime.scope?.writeFields.length ? <li>{t("assistantAccessWriteApproval")}</li> : null}</ul>
						: <p>{t("assistantAccessAllowedEmpty")}</p>}
				</section>
			</div>
		</div>
	</main>;
}
