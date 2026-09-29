import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
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
const devicesSchema = z.object({ devices: z.array(z.object({
	bindingId: z.uuid(),
	status: z.enum(["active", "inactive", "device_limit", "credential_expired", "revoked", "unavailable"]),
	stateObservedAt: z.iso.datetime(),
})).max(64) });
type BoundDevice = z.infer<typeof devicesSchema>["devices"][number];

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
	const [devices, setDevices] = useState<BoundDevice[] | null>(null);
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
				setDevices(null);
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
					setDevices(null);
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
	function refreshDevices() {
		void run(async () => {
			setDevices(null);
			if (!officialConfigured || !binding?.allowedScopes.includes("sync:write")) throw Error("binding-access-scope");
			const { createBoundSyncAccess } = await import("../../../../packages/binding/src/bound-sync");
			const access = await createBoundSyncAccess({ repository, ...client(), resourceOrigin: officialOrigin });
			if (access.bindingId !== binding.bindingId) throw Error("binding-not-active");
			const url = `${officialOrigin}/sync/devices`;
			const response = await fetch(url, { headers: await access.headers("GET", url), cache: "no-store" });
			await access.assertCurrent();
			if (!response.ok) throw Error("binding-device-list");
			const result = devicesSchema.parse(await response.json());
			await access.assertCurrent();
			setDevices(result.devices);
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
						{officialConfigured && binding.allowedScopes.includes("sync:write") && (
							<Button disabled={busy} onClick={refreshDevices}>{t("bindingDevicesRefresh")}</Button>
						)}
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
									setDevices(null);
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
					{officialConfigured && binding.allowedScopes.includes("sync:write") && (
						<div className="binding-devices">
							<p>{t("bindingDevicesHint")}</p>
							{devices && (devices.length ? <ul>{devices.map(device => <li key={device.bindingId}>
								<code>{device.bindingId}</code> · {t(device.bindingId === binding.bindingId ? "bindingThisDevice" : "bindingOtherDevice")} · {t(`bindingState_${device.status}`)}
							</li>)}</ul> : <p>{t("bindingDevicesEmpty")}</p>)}
						</div>
					)}
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
										setDevices(null);
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
									setDevices(null);
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
