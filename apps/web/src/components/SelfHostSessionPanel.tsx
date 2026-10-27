import { createAuthClient } from "better-auth/client";
import { Capacitor } from "@capacitor/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { openPlatformSession, type SessionConnection } from "../platform-connections";
import { getPlatformSetting } from "../platform-settings";

type Props = {
	disabled: boolean;
	onSessionChange: (accountId: string | null) => void;
	onEndpointChange?: (origin: string) => void;
};

export function SelfHostSessionPanel({ disabled, onSessionChange, onEndpointChange }: Props) {
	const { t } = useTranslation();
	const nativeApp = Capacitor.isNativePlatform();
	const [server, setServer] = useState(() => getPlatformSetting("keepany-selfhost-endpoint") ?? "");
	const [connection, setConnection] = useState<SessionConnection | null>(() => nativeApp ? null : { origin: window.location.origin, fetch, close: async () => {} });
	const client = useMemo(() => connection ? createAuthClient({
		baseURL: connection.origin,
		fetchOptions: { credentials: "include", customFetchImpl: connection.fetch, disableDefaultFetchPlugins: nativeApp },
	}) : null, [connection, nativeApp]);
	const callback = useRef(onSessionChange);
	callback.current = onSessionChange;
	const endpointCallback = useRef(onEndpointChange);
	endpointCallback.current = onEndpointChange;
	const mounted = useRef(true);
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [name, setName] = useState("");
	const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [checking, setChecking] = useState(!nativeApp);
	const [error, setError] = useState<string | null>(null);

	const load = async () => {
		if (!client || !connection) return;
		const result = await client.getSession();
		if (!mounted.current) return;
		if (result.error) throw Error("sync-session-unavailable");
		if (!result.data?.user) {
			setSignedInEmail(null);
			callback.current(null);
			return;
		}
		const { getSessionIdentity } = await import("../../../../packages/sync-client/src");
		const accountId = await getSessionIdentity(connection.origin);
		if (!mounted.current) return;
		setSignedInEmail(result.data.user.email);
		callback.current(accountId);
	};

	useEffect(() => {
		mounted.current = true;
		return () => { mounted.current = false; };
	}, []);
	useEffect(() => () => { void connection?.close().catch(() => {}); }, [connection]);
	useEffect(() => {
		if (!client || !connection) { setChecking(false); return; }
		setChecking(true);
		let current = true;
		void (async () => {
			try {
				const result = await client.getSession();
				if (!current) return;
				if (result.error) throw Error("sync-session-unavailable");
				if (!result.data?.user) {
					setSignedInEmail(null);
					callback.current(null);
					return;
				}
				const { getSessionIdentity } = await import("../../../../packages/sync-client/src");
				const accountId = await getSessionIdentity(connection.origin);
				if (!current) return;
				setSignedInEmail(result.data.user.email);
				callback.current(accountId);
			} catch {
				if (current) { setError("syncSessionUnavailable"); callback.current(null); }
			} finally {
				if (current) setChecking(false);
			}
		})();
		return () => { current = false; };
	}, [client, connection]);

	const confirmServer = async () => {
		if (disabled || busy || connection) return;
		setBusy(true); setError(null);
		try {
			const next = await openPlatformSession(server.trim(), true);
			if (!mounted.current) { await next.close(); return; }
			endpointCallback.current?.(next.origin);
			setConnection(next);
		} catch (cause) { if (mounted.current) setError(cause instanceof Error && cause.message === "native-session-origin" ? "syncServerInvalid" : "syncSessionUnavailable"); }
		finally { if (mounted.current) setBusy(false); }
	};

	const submit = async (kind: "in" | "up") => {
		if (disabled || busy || !client) return;
		setBusy(true);
		setError(null);
		try {
			const result = kind === "in"
				? await client.signIn.email({ email: email.trim(), password })
				: await client.signUp.email({ name: name.trim(), email: email.trim(), password });
			if (result.error) throw Error(kind === "up" ? "syncSignupFailed" : "syncSigninFailed");
			if (mounted.current) setPassword("");
			await load();
		} catch (cause) {
			if (mounted.current) setError(cause instanceof Error && cause.message === "syncSignupFailed" ? "syncSignupFailed" : "syncSigninFailed");
		} finally { if (mounted.current) setBusy(false); }
	};

	const signOut = async () => {
		if (disabled || busy || !client) return;
		setBusy(true);
		setError(null);
		try {
			const result = await client.signOut();
			if (result.error) throw Error("syncSignoutFailed");
			if (mounted.current) {
				setSignedInEmail(null);
				setPassword("");
				callback.current(null);
			}
		} catch { if (mounted.current) setError("syncSignoutFailed"); }
		finally { if (mounted.current) setBusy(false); }
	};

	return <div className="sync-session">
		{nativeApp && <>
			<p>{t("syncNativeSessionHint")}</p>
			<label className="field"><span>{t("syncServerUrl")}</span><input value={server} disabled={disabled || busy || Boolean(connection)} onChange={event => { setServer(event.target.value); setError(null); }} placeholder="https://sync.example.com" autoComplete="url" /></label>
			{!connection ? <Button disabled={disabled || busy || !server.trim()} onClick={() => void confirmServer()}>{t("syncConfirmServer")}</Button> : <Button disabled={disabled || busy} onClick={() => { setConnection(null); setSignedInEmail(null); setPassword(""); setError(null); callback.current(null); endpointCallback.current?.(""); }}>{t("syncChangeServer")}</Button>}
		</>}
		{connection && <p>{checking ? t("syncSessionChecking") : signedInEmail ? t("syncSignedInAs", { email: signedInEmail }) : t("syncSessionSignedOut")}</p>}
		{connection && !checking && !signedInEmail && <>
			<div className="form-grid">
				<label className="field"><span>{t("syncAccountName")}</span><input value={name} disabled={disabled || busy} onChange={event => setName(event.target.value)} autoComplete="name" /></label>
				<label className="field"><span>{t("syncAccountEmail")}</span><input type="email" value={email} disabled={disabled || busy} onChange={event => setEmail(event.target.value)} autoComplete="email" /></label>
				<label className="field"><span>{t("syncAccountPassword")}</span><input type="password" value={password} disabled={disabled || busy} onChange={event => setPassword(event.target.value)} autoComplete="current-password" /></label>
			</div>
			<div className="actions">
				<Button disabled={disabled || busy || !email || !password} onClick={() => void submit("in")}>{t("syncSignIn")}</Button>
				<Button disabled={disabled || busy || !name || !email || !password} onClick={() => void submit("up")}>{t("syncSignUp")}</Button>
			</div>
		</>}
		{signedInEmail && <Button disabled={disabled || busy} onClick={() => void signOut()}>{t("syncSignOut")}</Button>}
		{error && <p role="alert">{t(error)}</p>}
	</div>;
}
