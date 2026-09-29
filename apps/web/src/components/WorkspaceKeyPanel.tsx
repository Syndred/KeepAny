import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { KeyEnvelope, KeyEnvelopeClient, KeyEnvelopeMetadata } from "../../../../packages/sync-client/src";
import { Button } from "./ui/button";

interface Props {
	endpoint: string;
	accountId: string | null;
	accessMode: string;
	accessToken: string;
	hasAccess: boolean;
	workspaceId: string;
	workspaceKey: string;
	canIssue: boolean;
	otherBusy: boolean;
	onBusyChange: (busy: boolean) => void;
	openClient: () => Promise<KeyEnvelopeClient>;
	onRecovered: (key: string, accountId: string, isCurrent: () => boolean) => Promise<void>;
}

async function fingerprint(key: Uint8Array): Promise<string> {
	return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", key as BufferSource)),
		value => value.toString(16).padStart(2, "0")).join("");
}

export function WorkspaceKeyPanel({ endpoint, accountId, accessMode, accessToken, hasAccess, workspaceId, workspaceKey, canIssue, otherBusy,
	onBusyChange, openClient, onRecovered }: Props) {
	const { t } = useTranslation();
	const [envelopes, setEnvelopes] = useState<KeyEnvelopeMetadata[]>([]);
	const [issued, setIssued] = useState<{ kind: "recovery" | "join"; credential: string; envelope: KeyEnvelopeMetadata } | null>(null);
	const [kind, setKind] = useState<"recovery" | "join">("recovery");
	const [joinId, setJoinId] = useState("");
	const [credential, setCredential] = useState("");
	const [candidate, setCandidate] = useState<{ key: string; envelope: KeyEnvelope; accountId: string } | null>(null);
	const [verifiedAccountId, setVerifiedAccountId] = useState<string | null>(null);
	const [confirmed, setConfirmed] = useState(false);
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const running = useRef(false);
	const generation = useRef(0);
	const configuration = [endpoint, accountId, accessMode, accessToken, hasAccess, workspaceId, workspaceKey] as const;
	const latestConfiguration = useRef(configuration);
	latestConfiguration.current = configuration;
	useEffect(() => {
		void [endpoint, accountId, accessMode, accessToken, workspaceId];
		generation.current++;
		setEnvelopes([]); setIssued(null); setCandidate(null); setCredential(""); setJoinId(""); setConfirmed(false); setMessage(""); setVerifiedAccountId(null);
		return () => { generation.current++; };
	}, [endpoint, accountId, accessMode, accessToken, workspaceId]);
	useEffect(() => {
		void workspaceKey;
		generation.current++;
		setIssued(null); setCandidate(null); setConfirmed(false);
	}, [workspaceKey]);

	const work = async (action: (client: KeyEnvelopeClient, isCurrent: () => boolean) => Promise<void>) => {
		if (running.current || otherBusy || !hasAccess || !workspaceId) return;
		const current = generation.current;
		const isCurrent = () => generation.current === current &&
			configuration.every((value, index) => value === latestConfiguration.current[index]);
		running.current = true; setBusy(true); onBusyChange(true); setMessage("");
		try {
			const client = await openClient();
			if (!isCurrent()) return;
			const identity = await client.verifyTarget();
			if (accountId && identity.accountId !== accountId) throw Error("sync-account-mismatch");
			if (!isCurrent()) return;
			setVerifiedAccountId(identity.accountId);
			await action(client, isCurrent);
		} catch (error) {
			if (!isCurrent()) return;
			const reason = error instanceof Error ? error.message : "";
			setMessage(reason === "sync-auth" || reason === "sync-account-mismatch" ? "keyAccessIdentityFailed" :
				reason === "sync-http-409" ? "keyAccessExists" :
				reason === "sync-dataset-bound" || reason === "sync-dataset-ambiguous" ? "keyAccessLocalDataset" : "keyAccessFailed");
		} finally {
			running.current = false; setBusy(false); onBusyChange(false);
		}
	};
	const refresh = () => void work(async (client, isCurrent) => {
		const list = await client.list();
		if (!isCurrent()) return;
		setEnvelopes(list);
		setMessage("keyAccessRefreshed");
	});
	const issue = (issuedKind: "recovery" | "join") => void work(async (client, isCurrent) => {
		if (!canIssue || !workspaceKey) throw Error("key-access-no-trusted-key");
		const [{ decodeWorkspaceKey }, { createRecoveryCredential, wrapForRecovery }] = await Promise.all([
			import("../../../../packages/sync-client/src"), import("../../../../packages/crypto/src"),
		]);
		if (!isCurrent()) return;
		const key = decodeWorkspaceKey(workspaceKey);
		const credential = await createRecoveryCredential();
		if (!isCurrent()) return;
		const wrap = await wrapForRecovery(key, credential, workspaceId, 1);
		if (!isCurrent()) return;
		const keyFingerprint = await fingerprint(key);
		if (!isCurrent()) return;
		const envelope = await client.create({ kind: issuedKind, wrap, keyFingerprint,
			...(issuedKind === "join" ? { expiresInSeconds: 600 } : {}) });
		if (!isCurrent()) return;
		setIssued({ kind: issuedKind, credential, envelope });
		const list = await client.list();
		if (!isCurrent()) return;
		setEnvelopes(list);
		setMessage("keyAccessIssued");
	});
	const unlock = () => void work(async (client, isCurrent) => {
		setCandidate(null); setConfirmed(false);
		const [{ encodeWorkspaceKey }, { unwrapRecovery }] = await Promise.all([
			import("../../../../packages/sync-client/src"), import("../../../../packages/crypto/src"),
		]);
		if (!isCurrent()) return;
		const selected = kind === "join" ? envelopes.find(item => item.envelopeId === joinId.trim()) :
			(await client.list()).find(item => item.kind === "recovery");
		if (!isCurrent()) return;
		const envelopeId = kind === "join" ? joinId.trim() : selected?.envelopeId;
		if (!envelopeId) throw Error("key-access-no-envelope");
		const envelope = await client.get(envelopeId);
		if (!isCurrent()) return;
		if (envelope.kind !== kind || envelope.keyEpoch !== 1 || envelope.wrap.workspaceId !== workspaceId) throw Error("key-access-context");
		const key = await unwrapRecovery(envelope.wrap, credential.trim(), workspaceId, 1);
		if (!isCurrent()) return;
		if (await fingerprint(key) !== envelope.keyFingerprint) throw Error("key-access-fingerprint");
		if (!isCurrent()) return;
		const identity = await client.verifyTarget();
		if (!isCurrent()) return;
		setCandidate({ key: encodeWorkspaceKey(key), envelope, accountId: identity.accountId });
		setMessage("keyAccessUnlocked");
	});
	const useKey = () => void work(async (client, isCurrent) => {
		if (!candidate || !confirmed) throw Error("key-access-confirm");
		const current = await client.get(candidate.envelope.envelopeId);
		if (!isCurrent()) return;
		if (current.keyFingerprint !== candidate.envelope.keyFingerprint || current.kind !== candidate.envelope.kind ||
			current.wrap.nonce !== candidate.envelope.wrap.nonce ||
			current.wrap.ciphertext !== candidate.envelope.wrap.ciphertext) throw Error("key-access-changed");
		await onRecovered(candidate.key, candidate.accountId, isCurrent);
		setCredential(""); setCandidate(null); setConfirmed(false);
		if (isCurrent()) setMessage("keyAccessReady");
	});
	const revoke = (envelopeId: string) => void work(async (client, isCurrent) => {
		await client.revoke(envelopeId);
		if (!isCurrent()) return;
		const list = await client.list();
		if (!isCurrent()) return;
		setEnvelopes(list);
		if (issued?.envelope.envelopeId === envelopeId) setIssued(null);
		if (candidate?.envelope.envelopeId === envelopeId) setCandidate(null);
		setMessage("keyAccessRevoked");
	});
	return <section className="card padded key-access-panel">
		<h2>{t("keyAccessTitle")}</h2>
		<p>{t("keyAccessHint")}</p>
		<p className="notice">{t("keyAccessTarget", { accountId: verifiedAccountId || accountId || "—", workspaceId: workspaceId || "—" })}</p>
		<p>{t("keyAccessBoundary")}</p>
		<div className="actions">
			<Button disabled={busy || otherBusy || !hasAccess || !workspaceId} onClick={refresh}>{t("keyAccessRefresh")}</Button>
			<Button disabled={busy || otherBusy || !canIssue || !workspaceKey || !hasAccess || !workspaceId || envelopes.some(item => item.kind === "recovery")} onClick={() => issue("recovery")}>{t("keyAccessCreateRecovery")}</Button>
			<Button disabled={busy || otherBusy || !canIssue || !workspaceKey || !hasAccess || !workspaceId} onClick={() => issue("join")}>{t("keyAccessCreateJoin")}</Button>
		</div>
		{!canIssue && workspaceKey && <p>{t("keyAccessSyncFirst")}</p>}
		{issued && <div className="notice" role="status">
			<strong>{t(issued.kind === "recovery" ? "keyAccessRecoverySave" : "keyAccessJoinShare")}</strong>
			<p>{t("keyAccessEnvelopeId")}: <code>{issued.envelope.envelopeId}</code></p>
			<p>{t("keyAccessCredential")}: <code>{issued.credential}</code></p>
			<p>{t("keyAccessFingerprint")}: <code>{issued.envelope.keyFingerprint}</code></p>
			{issued.envelope.expiresAt && <p>{t("keyAccessExpires")}: {new Date(issued.envelope.expiresAt).toLocaleString()}</p>}
		</div>}
		{envelopes.length > 0 && <div className="key-access-list">
			<h3>{t("keyAccessActive")}</h3>
			{envelopes.map(item => <div className="notice" key={item.envelopeId}>
				<p>{t(item.kind === "recovery" ? "keyAccessRecovery" : "keyAccessJoin")}: <code>{item.envelopeId}</code></p>
				<p>{t("keyAccessFingerprint")}: <code>{item.keyFingerprint}</code></p>
				{item.expiresAt && <p>{t("keyAccessExpires")}: {new Date(item.expiresAt).toLocaleString()}</p>}
				<Button disabled={busy || otherBusy} onClick={() => revoke(item.envelopeId)}>{t("keyAccessRevoke")}</Button>
			</div>)}
		</div>}
		<h3>{t("keyAccessUnlockTitle")}</h3>
		<div className="form-grid">
			<label className="field"><span>{t("keyAccessMethod")}</span><select value={kind} disabled={busy || otherBusy} onChange={event => { setKind(event.target.value as "recovery" | "join"); setCandidate(null); setConfirmed(false); }}>
				<option value="recovery">{t("keyAccessRecovery")}</option><option value="join">{t("keyAccessJoin")}</option>
			</select></label>
			{kind === "join" && <label className="field"><span>{t("keyAccessEnvelopeId")}</span><input value={joinId} disabled={busy || otherBusy} onChange={event => { setJoinId(event.target.value); setCandidate(null); }} autoComplete="off" /></label>}
			<label className="field"><span>{t("keyAccessCredential")}</span><input type="password" value={credential} disabled={busy || otherBusy} onChange={event => { setCredential(event.target.value); setCandidate(null); }} autoComplete="off" /></label>
		</div>
		<div className="actions"><Button disabled={busy || otherBusy || !hasAccess || !workspaceId || !credential || (kind === "join" && !joinId)} onClick={unlock}>{t("keyAccessCheck")}</Button></div>
		{candidate && <div className="notice" role="status">
			<p>{t("keyAccessVerified", { accountId: candidate.accountId, workspaceId })}</p>
			<p>{t("keyAccessFingerprint")}: <code>{candidate.envelope.keyFingerprint}</code></p>
			<label className="sync-key-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{t("keyAccessConfirm")}</label>
			<Button disabled={busy || otherBusy || !confirmed} onClick={useKey}>{t("keyAccessUseKey")}</Button>
		</div>}
		{message && <p role={message === "keyAccessFailed" || message === "keyAccessIdentityFailed" || message === "keyAccessExists" || message === "keyAccessLocalDataset" ? "alert" : "status"}>{t(message)}</p>}
	</section>;
}
