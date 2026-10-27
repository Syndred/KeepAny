import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "./components/ui/button";
import { useMcpRuntime } from "./mcp-runtime";
import { liveAssets, PageTitle, useAppContext } from "./view-shared";
import "./page-assistant-access.css";
import { McpRevokeButton } from './components/McpRevokeButton';

export function AssistantAccessPage() {
	const { data } = useAppContext();
	const { t, i18n } = useTranslation();
	const runtime = useMcpRuntime();
	const connected = runtime.status === "connected" && runtime.scope !== null &&
		(runtime.expiresAt ?? 0) > Date.now();
	const assetsById = new Map(liveAssets(data).map((asset) => [asset.id, asset]));
	const dateTime = (time: number) => new Intl.DateTimeFormat(i18n.language, {
		dateStyle: "medium", timeStyle: "short",
	}).format(time);
	return <main className="page assistant-access-page">
		<PageTitle eyebrow={t("assistantAccessEyebrow")} title={t("assistantAccessTitle")}
			subtitle={t("assistantAccessSubtitle")} />
		<div className="assistant-access-banner" role="note">{t(runtime.localConnectionAvailable ? "assistantAccessBanner" : "mcpNativeUnavailable")}</div>
		<div className="assistant-access-grid">
			<section className="card padded assistant-access-connections">
				<div className="assistant-access-section-head"><h2>{t("assistantAccessConnections")}</h2>{runtime.localConnectionAvailable && <p>{t("assistantAccessConnectionHint")}</p>}</div>
				{connected && runtime.scope ? <div className="assistant-access-connection">
					<div className="assistant-access-connection-head"><div><strong>{t("assistantAccessLocalConnection")}</strong>
						{runtime.expiresAt && <small>{t("assistantAccessExpires", { time: dateTime(runtime.expiresAt) })}</small>}</div>
						<McpRevokeButton /></div>
					<div className="assistant-access-scope"><strong>{t("assistantAccessSelectedRecords")}</strong>
						<div className="assistant-access-chips">{runtime.scope.assetIds.map((id) => <span className="chip" key={id}>{assetsById.get(id)?.name ?? t("mcpAssetUnavailable")}</span>)}</div></div>
					<div className="assistant-access-scope"><strong>{t("mcpReadFields")}</strong>
						<div className="assistant-access-chips">{runtime.scope.readFields.map((field) => <span className="chip" key={field}>{t(`mcpField_${field}`)}</span>)}</div></div>
					<div className="assistant-access-scope"><strong>{t("mcpWriteFields")}</strong>
						<p>{runtime.scope.writeFields.length ? runtime.scope.writeFields.map((field) => t(`mcpField_${field}`)).join(" · ") : t("mcpNoWrite")}</p></div>
				</div> : <div className="assistant-access-empty"><strong>{t("assistantAccessNoConnection")}</strong><p>{t(runtime.localConnectionAvailable ? "assistantAccessNoConnectionHint" : "mcpNativeLocalDataHint")}</p></div>}
				{runtime.error && <p role="alert">{t(runtime.error)}</p>}
				<div className="actions"><Button asChild><Link to="/settings" hash="assistant">{t("assistantAccessConfigure")}</Link></Button>
					<Button onClick={() => window.dispatchEvent(new Event("keepany-open-ai-dialog"))}>{t("settingsAskAssistant")}</Button></div>
			</section>
			<div className="assistant-access-side">
				<section className="card padded assistant-access-history"><h2>{t("assistantAccessRecent")}</h2>
					{!connected && (runtime.audit.length > 0 || runtime.revokedAt !== null) && <p>{t('mcpAuditRetainedHint')}</p>}
					{runtime.audit.length > 0 || runtime.revokedAt !== null ? <ol>{runtime.revokedAt !== null && <li data-mcp-revoked-receipt><strong>{t('assistantAccessAction_revoke')}</strong><small>{dateTime(runtime.revokedAt)} · {t('mcpRevokeDeviceReceipt')}</small></li>}{runtime.audit.map((entry) => <li key={entry.id}>
						<strong>{t(`assistantAccessAction_${entry.action}`)}</strong>
						<small>{dateTime(entry.at)} · {t(`assistantAccessOutcome_${entry.outcome}`)}{entry.assetId ? ` · ${assetsById.get(entry.assetId)?.name ?? t("mcpAssetUnavailable")}` : ""}</small>
					</li>)}</ol> : <p>{t(!runtime.localConnectionAvailable ? "mcpNativeNoActivity" : connected ? "assistantAccessNoRecent" : "assistantAccessRecentRequiresConnection")}</p>}
				</section>
				<section className="card assistant-access-allowed"><h2>{t("assistantAccessAllowed")}</h2>
					{connected ? <ul><li>{t("assistantAccessSearchSelected")}</li><li>{t("assistantAccessReadSelected")}</li>
						{runtime.scope?.writeFields.length ? <li>{t("assistantAccessWriteApproval")}</li> : null}</ul>
						: <p>{t(runtime.localConnectionAvailable ? "assistantAccessAllowedEmpty" : "mcpNativeNoAccess")}</p>}
				</section>
			</div>
		</div>
	</main>;
}
