import { useEffect, useRef, useState } from "react";
import { CloudUpload, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
	createS3PresignedTransport,
	createWebDavTransport,
	downloadVerifiedArchive,
	parseRemoteBackupReceipt,
	type RemoteBackupReceipt,
	uploadEncryptedArchive,
} from "../../../../packages/connectors/src/remote-backup";
import {
	exportArchive,
	inspectArchive,
} from "../../../../packages/local-db/src";
import { Button } from "./ui/button";
import { Select, SelectOption } from "./ui/select";

type RemoteKind = "s3" | "webdav";

function basicAuthorization(username: string, password: string): string {
	if (
		username.includes(":") ||
		/[\r\n]/.test(username + password) ||
		username.length + password.length > 1024
	)
		throw Error("backup-authorization");
	const encoded = new TextEncoder().encode(`${username}:${password}`);
	return `Basic ${btoa(Array.from(encoded, (byte) => String.fromCharCode(byte)).join(""))}`;
}

export function RemoteBackupPanel({
	password,
	busy,
	setBusy,
	invalidatePreview,
	acceptPreview,
	canConfirm,
	restoreCount,
	restoreReviewCount,
	restoreHasVault,
	confirmRestore,
}: {
	password: string;
	busy: boolean;
	setBusy: (value: boolean) => void;
	invalidatePreview: () => number;
	acceptPreview: (
		archive: Uint8Array,
		count: number,
		generation: number,
		reviewCount?: number,
		hasVault?: boolean,
	) => boolean;
	canConfirm: boolean;
	restoreCount: number;
	restoreReviewCount: number;
	restoreHasVault?: boolean;
	confirmRestore: () => void;
}) {
	const { t } = useTranslation();
	const [kind, setKind] = useState<RemoteKind>("s3");
	const [putUrl, setPutUrl] = useState("");
	const [getUrl, setGetUrl] = useState("");
	const [davUrl, setDavUrl] = useState("");
	const [davUser, setDavUser] = useState("");
	const [davPassword, setDavPassword] = useState("");
	const [receiptText, setReceiptText] = useState("");
	const [receiptDownload, setReceiptDownload] = useState<string | null>(null);
	const [status, setStatus] = useState("");
	const operation = useRef(false);
	const receiptGeneration = useRef(0);
	const receiptFileInput = useRef<HTMLInputElement>(null);
	const previousCanConfirm = useRef(canConfirm);

	useEffect(
		() => () => {
			if (receiptDownload) URL.revokeObjectURL(receiptDownload);
		},
		[receiptDownload],
	);
	useEffect(() => {
		if (previousCanConfirm.current && !canConfirm) setStatus("");
		previousCanConfirm.current = canConfirm;
	}, [canConfirm]);

	function changed() {
		invalidatePreview();
		setStatus("");
	}

	function transport(readOnly = false) {
		if (kind === "s3")
			return createS3PresignedTransport({
				putUrl: readOnly ? getUrl.trim() : putUrl.trim(),
				getUrl: getUrl.trim(),
			});
		return createWebDavTransport({
			objectUrl: davUrl.trim(),
			authorization:
				davUser || davPassword
					? async () => basicAuthorization(davUser, davPassword)
					: undefined,
		});
	}

	function failure(error: unknown, phase: "upload" | "preview") {
		const reason = error instanceof Error ? error.message : "";
		if (
			reason === "backup-endpoint" ||
			reason === "backup-object-mismatch" ||
			reason === "backup-authorization"
		)
			return t("remoteConfigError");
		if (reason === "backup-readback-mismatch") return t("remoteReadbackError");
		if (reason === "backup-size") return t("remoteSizeError");
		if (phase === "preview" && reason.startsWith("backup-"))
			return t("remoteRequestError");
		return t(phase === "preview" ? "remotePreviewError" : "remoteRequestError");
	}

	async function upload() {
		if (operation.current || busy || password.length < 12) return;
		operation.current = true;
		setBusy(true);
		changed();
		receiptGeneration.current++;
		setReceiptText("");
		setReceiptDownload(null);
		if (receiptFileInput.current) receiptFileInput.current.value = "";
		try {
			const destination = transport();
			const receipt = await uploadEncryptedArchive(
				await exportArchive(),
				password,
				destination,
			);
			const json = JSON.stringify(receipt, null, 2);
			setReceiptText(json);
			setReceiptDownload(
				URL.createObjectURL(new Blob([json], { type: "application/json" })),
			);
			setStatus(t("remoteStored"));
		} catch (error) {
			setStatus(failure(error, "upload"));
		} finally {
			operation.current = false;
			setBusy(false);
		}
	}

	async function preview() {
		if (operation.current || busy || password.length < 12) return;
		const generation = invalidatePreview();
		let receipt: RemoteBackupReceipt;
		try {
			if (receiptText.length > 4096) throw Error("receipt-size");
			receipt = parseRemoteBackupReceipt(JSON.parse(receiptText));
		} catch {
			setStatus(t("remoteReceiptError"));
			return;
		}
		operation.current = true;
		setBusy(true);
		setStatus("");
		try {
			const archive = await downloadVerifiedArchive(
				receipt,
				password,
				transport(true),
			);
			const inspected = await inspectArchive(archive);
			if (acceptPreview(archive, inspected.rows.length, generation, inspected.intakeReview.length, !!inspected.passwordVault))
				setStatus(t("remotePreviewReady"));
		} catch (error) {
			setStatus(failure(error, "preview"));
		} finally {
			operation.current = false;
			setBusy(false);
		}
	}

	return (
		<section className="card padded remote-backup-panel">
			<div className="card-header">
				<h2>
					<CloudUpload size={20} />
					{t("remoteBackupTitle")}
				</h2>
			</div>
			<p>{t("remoteBackupHint")}</p>
			<div className="field">
				<label htmlFor="remote-kind">{t("remoteBackupKind")}</label>
				<Select
					id="remote-kind"
					value={kind}
					disabled={busy}
					onValueChange={(selectValue) => {
						changed();
						setDavPassword("");
						setKind(selectValue as RemoteKind);
					}}
				>
					<SelectOption value="s3">{t("remoteS3")}</SelectOption>
					<SelectOption value="webdav">WebDAV</SelectOption>
				</Select>
			</div>
			{kind === "s3" ? (
				<div className="form-grid remote-backup-fields">
					<div className="field">
						<label htmlFor="remote-put-url">{t("remotePutUrl")}</label>
						<input
							id="remote-put-url"
							type="url"
							autoComplete="off"
							spellCheck={false}
							disabled={busy}
							value={putUrl}
							onChange={(e) => {
								changed();
								setPutUrl(e.target.value);
							}}
						/>
					</div>
					<div className="field">
						<label htmlFor="remote-get-url">{t("remoteGetUrl")}</label>
						<input
							id="remote-get-url"
							type="url"
							autoComplete="off"
							spellCheck={false}
							disabled={busy}
							value={getUrl}
							onChange={(e) => {
								changed();
								setGetUrl(e.target.value);
							}}
						/>
					</div>
				</div>
			) : (
				<div className="form-grid remote-backup-fields">
					<div className="field wide">
						<label htmlFor="remote-dav-url">{t("remoteDavUrl")}</label>
						<input
							id="remote-dav-url"
							type="url"
							autoComplete="off"
							spellCheck={false}
							disabled={busy}
							value={davUrl}
							onChange={(e) => {
								changed();
								setDavUrl(e.target.value);
							}}
						/>
					</div>
					<div className="field">
						<label htmlFor="remote-dav-user">{t("remoteDavUser")}</label>
						<input
							id="remote-dav-user"
							autoComplete="off"
							disabled={busy}
							value={davUser}
							onChange={(e) => {
								changed();
								setDavUser(e.target.value);
							}}
						/>
					</div>
					<div className="field">
						<label htmlFor="remote-dav-password">
							{t("remoteDavPassword")}
						</label>
						<input
							id="remote-dav-password"
							type="password"
							autoComplete="new-password"
							disabled={busy}
							value={davPassword}
							onChange={(e) => {
								changed();
								setDavPassword(e.target.value);
							}}
						/>
					</div>
				</div>
			)}
			<small className="remote-backup-hint">{t("remotePrivateHint")}</small>
			<div className="actions">
				<Button
					onClick={() => void upload()}
					disabled={busy || password.length < 12}
				>
					{t("remoteUpload")}
				</Button>
				{receiptDownload && (
					<Button asChild variant="primary">
						<a href={receiptDownload} download="stackperch-remote-receipt.json">
							<Download size={16} />
							{t("remoteSaveReceipt")}
						</a>
					</Button>
				)}
			</div>
			<div className="field">
				<label htmlFor="remote-receipt">{t("remoteReceipt")}</label>
				<textarea
					id="remote-receipt"
					spellCheck={false}
					disabled={busy}
					value={receiptText}
					onChange={(e) => {
						receiptGeneration.current++;
						changed();
						setReceiptText(e.target.value);
						setReceiptDownload(null);
					}}
				/>
				<small>{t("remoteReceiptHint")}</small>
			</div>
			<div className="field">
				<label htmlFor="remote-receipt-file">{t("remoteReceiptFile")}</label>
				<input
					ref={receiptFileInput}
					id="remote-receipt-file"
					type="file"
					accept=".json,application/json"
					disabled={busy}
					onChange={async (e) => {
						const file = e.target.files?.[0];
						const generation = ++receiptGeneration.current;
						changed();
						setReceiptText("");
						setReceiptDownload(null);
						if (!file) return;
						try {
							if (file.size > 4096) throw Error("receipt-size");
							const parsed = parseRemoteBackupReceipt(
								JSON.parse(await file.text()),
							);
							if (generation === receiptGeneration.current)
								setReceiptText(JSON.stringify(parsed, null, 2));
						} catch {
							if (generation === receiptGeneration.current)
								setStatus(t("remoteReceiptError"));
						}
					}}
				/>
			</div>
			<div className="actions">
				<Button
					onClick={() => void preview()}
					disabled={busy || password.length < 12 || !receiptText.trim()}
				>
					{t("remotePreview")}
				</Button>
				{canConfirm && <p role="status">{t("restorePreviewSummary", { count: restoreCount, reviewCount: restoreReviewCount })}</p>}
				{canConfirm && restoreHasVault && <p>{t("restoreContainsVault")}</p>}
				{canConfirm && (
					<Button variant="primary" onClick={confirmRestore} disabled={busy}>
						{t("confirm")} · {restoreCount}
					</Button>
				)}
			</div>
			{status && (
				<p className="notice" role="status">
					{status}
				</p>
			)}
		</section>
	);
}
