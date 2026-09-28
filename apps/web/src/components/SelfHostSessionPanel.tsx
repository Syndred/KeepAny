import { createAuthClient } from "better-auth/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";

type Props = {
	disabled: boolean;
	onSessionChange: (accountId: string | null) => void;
};

/** The session service is available only at the Web app's own origin. */
export function SelfHostSessionPanel({ disabled, onSessionChange }: Props) {
	const { t } = useTranslation();
	const client = useMemo(() => createAuthClient({
		baseURL: window.location.origin,
		fetchOptions: { credentials: "include" },
	}), []);
	const callback = useRef(onSessionChange);
	callback.current = onSessionChange;
	const mounted = useRef(true);
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [name, setName] = useState("");
	const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [checking, setChecking] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const load = async () => {
		const result = await client.getSession();
		if (!mounted.current) return;
		if (result.error) throw Error("sync-session-unavailable");
		if (!result.data?.user) {
			setSignedInEmail(null);
			callback.current(null);
			return;
		}
		const { getSessionIdentity } = await import("../../../../packages/sync-client/src");
		const accountId = await getSessionIdentity(window.location.origin);
		if (!mounted.current) return;
		setSignedInEmail(result.data.user.email);
		callback.current(accountId);
	};

	useEffect(() => {
		mounted.current = true;
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
				const accountId = await getSessionIdentity(window.location.origin);
				if (!current) return;
				setSignedInEmail(result.data.user.email);
				callback.current(accountId);
			} catch {
				if (current) { setError("syncSessionUnavailable"); callback.current(null); }
			} finally {
				if (current) setChecking(false);
			}
		})();
		return () => { current = false; mounted.current = false; };
	}, [client]);

	const submit = async (kind: "in" | "up") => {
		if (disabled || busy) return;
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
		if (disabled || busy) return;
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
		<p>{checking ? t("syncSessionChecking") : signedInEmail ? t("syncSignedInAs", { email: signedInEmail }) : t("syncSessionSignedOut")}</p>
		{!checking && !signedInEmail && <>
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
