import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	bridgeBindingKeys,
	createBindingBridgeFetch,
} from "../../../../packages/binding/src/bridge";
import {
	BindingTransport,
	pollAndConsumeBinding,
	readBindingState,
	startBindingChallenge,
} from "../../../../packages/binding/src/remote";
import type { BindingScope } from "../../../../packages/binding/src/ticket";
import {
	defaultBindingRepository,
	type PendingBinding,
	type StoredBinding,
} from "../../../../packages/binding/src/store";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

const issuer = import.meta.env.VITE_KEEPANY_BINDING_ISSUER;
const bridgeOrigin = import.meta.env.VITE_KEEPANY_BINDING_BRIDGE_ORIGIN;
const officialOrigin = import.meta.env.VITE_KEEPANY_OFFICIAL_SYNC_ORIGIN;
const configured =
	typeof issuer === "string" && typeof bridgeOrigin === "string";

function client() {
	if (!configured) throw Error("binding-unconfigured");
	return {
		transport: new BindingTransport(
			issuer,
			createBindingBridgeFetch(issuer, bridgeOrigin),
		),
		keys: bridgeBindingKeys(issuer, bridgeOrigin),
	};
}

export function BindingPanel({
	onBindingChange,
}: {
	onBindingChange?: (binding: StoredBinding | undefined) => void;
}) {
	const { t } = useTranslation();
	const officialConfigured =
		typeof officialOrigin === "string" &&
		officialOrigin === window.location.origin;
	const [binding, setBinding] = useState<StoredBinding>();
	const [pending, setPending] = useState<PendingBinding>();
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	const [forgetOpen, setForgetOpen] = useState(false);
	const [message, setMessage] = useState<{ key: string; count?: number }>();
	useEffect(() => {
		if (!configured) return;
		let mounted = true;
		const repository = defaultBindingRepository();
		void Promise.all([
			repository.activeBinding(),
			repository.pendingChallenge(),
		])
			.then(([active, challenge]) => {
				if (!mounted) return;
				setBinding(active);
				onBindingChange?.(active);
				setPending(challenge);
			})
			.catch(() => {
				if (mounted) setMessage({ key: "bindingLocalError" });
			});
		return () => {
			mounted = false;
		};
	}, [onBindingChange]);
	if (!configured) return null;
	const repository = defaultBindingRepository();
	async function run(action: () => Promise<void>) {
		if (busyRef.current) return;
		busyRef.current = true;
		setBusy(true);
		setMessage(undefined);
		try {
			await action();
		} catch {
			// Another tab may have removed the binding during an in-flight check.
			// Reconcile the visible state with the local repository before retry UI.
			if (binding) {
				try {
					const latest = await repository.activeBinding();
					setBinding(latest);
					onBindingChange?.(latest);
					if (latest?.bindingId !== binding.bindingId) {
						setForgetOpen(false);
						setMessage({ key: "bindingForgotten" });
						return;
					}
				} catch {
					setMessage({ key: "bindingLocalError" });
					return;
				}
			}
			setMessage({ key: "bindingFailed" });
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	}
	function begin(scopes: BindingScope[]) {
		void run(async () => {
			const result = await startBindingChallenge({
				repository,
				transport: client().transport,
				instanceName: t("bindingDeviceName"),
				scopes,
			});
			setPending(await repository.pendingChallenge());
			setMessage({ key: "bindingWait", count: result.interval });
		});
	}
	return (
		<section className="card padded binding-panel">
			<h2>{t("bindingTitle")}</h2>
			<p>{t("bindingHint")}</p>
			{binding ? (
				<>
					<p>{t("bindingConnected")}</p>
					{officialConfigured && (
						<p>
							{t(
								binding.allowedScopes.includes("sync:write")
									? "bindingWriteEnabled"
									: "bindingReadOnly",
							)}
						</p>
					)}
					<div className="actions">
						<Button
							disabled={busy}
							onClick={() =>
								void run(async () => {
									const state = await readBindingState({
										repository,
										transport: client().transport,
									});
									const latest = await repository.activeBinding();
									setBinding(latest);
									onBindingChange?.(latest);
									setMessage({
										key:
											state.state === "revoked" ||
											latest?.bindingId === binding.bindingId
												? `bindingState_${state.state}`
												: "bindingForgotten",
									});
								})
							}
						>
							{t("bindingCheck")}
						</Button>
						<Button
							disabled={busy}
							onClick={() => {
								setMessage(undefined);
								setForgetOpen(true);
							}}
						>
							{t("bindingForget")}
						</Button>
					</div>
				</>
			) : pending && Date.parse(pending.expiresAt) > Date.now() ? (
				<>
					<p>{t("bindingCode")}</p>
					<code className="binding-code">{pending.userCode}</code>
					<p>{t("bindingApprove")}</p>
					{pending.requestedScopes.includes("sync:write") && (
						<p>{t("bindingWriteRequest")}</p>
					)}
					<div className="actions">
						<a
							className="button"
							href={pending.verificationUri}
							target="_blank"
							rel="noopener noreferrer"
						>
							{t("bindingOpenApproval")}
						</a>
						<Button
							disabled={busy}
							onClick={() =>
								void run(async () => {
									const result = await pollAndConsumeBinding({
										repository,
										...client(),
									});
									if (
										result.status === "created" ||
										result.status === "already-bound"
									) {
										setBinding(result.binding);
										onBindingChange?.(result.binding);
										setPending(undefined);
										setMessage(undefined);
									} else if (
										result.status === "wait" ||
										result.status === "slow_down"
									) {
										setMessage({
											key: "bindingWait",
											count: result.retryAfterSeconds,
										});
									} else {
										setPending(undefined);
										setMessage({ key: `bindingPoll_${result.status}` });
									}
								})
							}
						>
							{t("bindingCheck")}
						</Button>
					</div>
				</>
			) : (
				<div className="actions">
					<Button disabled={busy} onClick={() => begin(["sync:read"])}>
						{t("bindingStart")}
					</Button>
					{officialConfigured && (
						<Button
							disabled={busy}
							onClick={() => begin(["sync:read", "sync:write"])}
						>
							{t("bindingStartOfficial")}
						</Button>
					)}
				</div>
			)}
			{message && (!forgetOpen || !binding) && (
				<p role="status">{t(message.key, { count: message.count })}</p>
			)}
			{forgetOpen && binding && (
				<Dialog
					title={t("bindingForget")}
					onClose={() => {
						if (!busyRef.current) setForgetOpen(false);
					}}
				>
					<p>{t("bindingForgetConfirm")}</p>
					{message && (
						<p role="alert">{t(message.key, { count: message.count })}</p>
					)}
					<div className="actions">
						<Button disabled={busy} onClick={() => setForgetOpen(false)}>
							{t("cancel")}
						</Button>
						<Button
							variant="danger"
							disabled={busy}
							onClick={() =>
								void run(async () => {
									await repository.revokeLocal(binding.bindingId);
									setForgetOpen(false);
									setBinding(undefined);
									onBindingChange?.(undefined);
									setMessage({ key: "bindingForgotten" });
								})
							}
						>
							{t("bindingForget")}
						</Button>
					</div>
				</Dialog>
			)}
		</section>
	);
}
