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
import {
	defaultBindingRepository,
	type PendingBinding,
	type StoredBinding,
} from "../../../../packages/binding/src/store";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

const issuer = import.meta.env.VITE_KEEPANY_BINDING_ISSUER;
const bridgeOrigin = import.meta.env.VITE_KEEPANY_BINDING_BRIDGE_ORIGIN;
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

export function BindingPanel() {
	const { t } = useTranslation();
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
				setPending(challenge);
			})
			.catch(() => {
				if (mounted) setMessage({ key: "bindingLocalError" });
			});
		return () => {
			mounted = false;
		};
	}, []);
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
					if (latest?.bindingId !== binding.bindingId) {
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
	return (
		<section className="card padded binding-panel">
			<h2>{t("bindingTitle")}</h2>
			<p>{t("bindingHint")}</p>
			{binding ? (
				<>
					<p>{t("bindingConnected")}</p>
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
						<Button disabled={busy} onClick={() => setForgetOpen(true)}>
							{t("bindingForget")}
						</Button>
					</div>
				</>
			) : pending && Date.parse(pending.expiresAt) > Date.now() ? (
				<>
					<p>{t("bindingCode")}</p>
					<code className="binding-code">{pending.userCode}</code>
					<p>{t("bindingApprove")}</p>
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
				<Button
					disabled={busy}
					onClick={() =>
						void run(async () => {
							const result = await startBindingChallenge({
								repository,
								transport: client().transport,
								instanceName: t("bindingDeviceName"),
								scopes: ["sync:read"],
							});
							setPending(await repository.pendingChallenge());
							setMessage({ key: "bindingWait", count: result.interval });
						})
					}
				>
					{t("bindingStart")}
				</Button>
			)}
			{message && (
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
