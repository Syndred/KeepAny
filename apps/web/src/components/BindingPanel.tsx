import { useEffect, useState } from "react";
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
		setBusy(true);
		setMessage(undefined);
		try {
			await action();
		} catch {
			setMessage({ key: "bindingFailed" });
		} finally {
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
									if (state.state === "revoked") setBinding(undefined);
									setMessage({ key: `bindingState_${state.state}` });
								})
							}
						>
							{t("bindingCheck")}
						</Button>
						<Button
							disabled={busy}
							onClick={() => {
								if (!window.confirm(t("bindingForgetConfirm"))) return;
								void run(async () => {
									await repository.revokeLocal(binding.bindingId);
									setBinding(undefined);
									setMessage({ key: "bindingForgotten" });
								});
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
		</section>
	);
}
