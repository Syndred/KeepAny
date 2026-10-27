import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	type ReadField,
	readableFields,
	type WriteField,
	writableFields,
} from "../../../../packages/mcp/src/fields";
import { type McpRequest, useMcpRuntime } from "../mcp-runtime";
import { useAppContext } from "../view-shared";
import { Button } from "./ui/button";
import { Select, SelectOption } from "./ui/select";
import { ExportFileLink } from "./ExportFileLink";
import { hasFileDeliveryHandler, type FileDeliveryMessage } from "../file-delivery";
import { McpRevokeButton } from './McpRevokeButton';
import type { MobileMcpPairingFile } from '../../../../packages/mcp/src/mobile-pairing';

const durations = [
	{ value: 5 * 60_000, key: "mcpDuration5m" },
	{ value: 10 * 60_000, key: "mcpDuration10m" },
	{ value: 15 * 60_000, key: "mcpDuration15m" },
] as const;
const same = (left: readonly string[], right: readonly string[]) =>
	left.length === right.length &&
	left.every((item, index) => item === right[index]);
const privateAddress = (address: string) => {
	if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(address)) return false;
	const [a, b, c, d] = address.split('.').map(Number);
	return [a, b, c, d].every(part => part <= 255) && (address === '127.0.0.1' || a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168);
};

export function McpPanel() {
	const { t } = useTranslation();
	const { data } = useAppContext();
	const runtime = useMcpRuntime();
	const { localConnectionAvailable, status, scope, prepared, error, prepare, invalidatePrepared, importPairing, native } = runtime;
	const assets = data.assets.filter((asset) => !asset.deleted);
	const [assetIds, setAssetIds] = useState<string[]>([]);
	const [readFields, setReadFields] = useState<ReadField[]>(["name"]);
	const [writeFields, setWriteFields] = useState<WriteField[]>([]);
	const [ttlMs, setTtlMs] = useState<number>(durations[2].value);
	const [busy, setBusy] = useState(false);
	const [address, setAddress] = useState('');
	const [expiredFile, setExpiredFile] = useState<MobileMcpPairingFile | null>(null);
	const operation = useRef(false);
	const [localError, setLocalError] = useState<string | null>(null);
	const [deliveryMessage, setDeliveryMessage] = useState<FileDeliveryMessage | null>(null);
	const [download, setDownload] = useState<{
		request: McpRequest | MobileMcpPairingFile;
		url: string;
	} | null>(null);
	const nativeMode = Boolean(native);
	const exportSource = native ? native.preparedFile : prepared;
	const currentExport = useRef(exportSource);
	currentExport.current = exportSource;

	useEffect(() => {
		setDeliveryMessage(null);
		if (!exportSource) {
			setDownload(null);
			return;
		}
		const url = URL.createObjectURL(
			new Blob([nativeMode ? JSON.stringify(exportSource) : JSON.stringify(exportSource, null, 2)], {
				type: "application/json",
			}),
		);
		setDownload({ request: exportSource, url });
		return () => {
			URL.revokeObjectURL(url);
		};
	}, [exportSource, nativeMode]);
	useEffect(() => {
		if (!native?.preparedFile) return;
		const file = native.preparedFile;
		const timer = setTimeout(() => setExpiredFile(file), Math.max(0, file.expiresAt - Date.now()));
		return () => clearTimeout(timer);
	}, [native?.preparedFile]);

	const availableIds = new Set(assets.map((asset) => asset.id));
	const selectedIds = assetIds.filter((id) => availableIds.has(id));
	const stopUnconfirmed = Boolean(native && (localError === 'mcpNativeStopUnconfirmed' || error === 'mcpNativeStopUnconfirmed'));
	const nativeLocked = Boolean(native && ['preparing', 'activating', 'waiting', 'authorized'].includes(native.phase)) || stopUnconfirmed;
	const controlsDisabled = !localConnectionAvailable || busy || status === "pairing" || nativeLocked;
	const canPrepare = localConnectionAvailable && selectedIds.length > 0 && readFields.length > 0 && (!native || privateAddress(address.trim()));
	const requestCurrent = Boolean(
		prepared &&
			prepared.ttlMs === ttlMs &&
			same(prepared.assetIds, selectedIds) &&
			same(prepared.readFields, readFields) &&
			same(prepared.writeFields, writeFields),
	);
	const nativeFile = native?.preparedFile;
	const nativeCurrent = Boolean(nativeFile && nativeFile !== expiredFile && nativeFile.expiresAt > Date.now() &&
		nativeFile.scope.ttlMs === ttlMs && same(nativeFile.scope.assetIds, selectedIds) &&
		same(nativeFile.scope.readFields, readFields) && same(nativeFile.scope.writeFields, writeFields) &&
		new URL(nativeFile.endpoint).hostname === address.trim());
	const nativeExportAvailable = Boolean(native?.phase === 'prepared' && !busy && nativeCurrent && !stopUnconfirmed && download?.request === nativeFile);
	const connected = scope !== null;
	const invalidateSelection = () => { currentExport.current = null; setDeliveryMessage(null); invalidatePrepared(); };
	const stopNative = async () => {
		if (operation.current) return;
		operation.current = true; setBusy(true); setLocalError(null);
		try { await runtime.revoke(); setDeliveryMessage(null); }
		catch { setLocalError('mcpNativeStopUnconfirmed'); }
		finally { operation.current = false; setBusy(false); }
	};
	const toggleAsset = (id: string, checked: boolean) => {
		invalidateSelection();
		setAssetIds((current) =>
			checked ? [...current, id] : current.filter((item) => item !== id),
		);
		setLocalError(null);
	};
	const toggleRead = (field: ReadField, checked: boolean) => {
		invalidateSelection();
		setReadFields((current) =>
			checked ? [...current, field] : current.filter((item) => item !== field),
		);
		if (!checked) {
			setWriteFields((current) => current.filter((item) => item !== field));
		}
		setLocalError(null);
	};
	const toggleWrite = (field: WriteField, checked: boolean) => {
		invalidateSelection();
		setWriteFields((current) =>
			checked ? [...current, field] : current.filter((item) => item !== field),
		);
		setLocalError(null);
	};

	return (
		<section className="card padded mcp-panel">
			<h2 id="mcp-panel-title" tabIndex={-1}>{t("mcpTitle")}</h2>
			<p>{t(native ? "mcpNativeHint" : localConnectionAvailable ? "mcpHint" : "mcpNativeUnavailable")}</p>
			{native && <><p>{t('mcpNativeForegroundHint')}</p><p>{t('mcpNativeFileSensitiveHint')}</p></>}
			{connected ? (
				<div className="mcp-active">
					<p role="status">
						{t(native ? "mcpNativeGranted" : status === "connected" ? "mcpConnected" : "mcpConnectionFailed")}
					</p>
					<dl>
						<dt>{t("mcpAssets")}</dt>
						<dd>
							{scope.assetIds
								.map(
									(id) =>
										assets.find((asset) => asset.id === id)?.name ??
										t("mcpAssetUnavailable"),
								)
								.join(", ")}
						</dd>
						<dt>{t("mcpReadFields")}</dt>
						<dd>
							{scope.readFields
								.map((field) => t(`mcpField_${field}`))
								.join(", ")}
						</dd>
						<dt>{t("mcpWriteFields")}</dt>
						<dd>
							{scope.writeFields.length
								? scope.writeFields
										.map((field) => t(`mcpField_${field}`))
										.join(", ")
								: t("mcpNoWrite")}
						</dd>
					</dl>
					<McpRevokeButton disabled={busy} />
				</div>
			) : (
				<>
					<fieldset
						className="mcp-options"
						disabled={controlsDisabled}
					>
						<legend>{t("mcpAssets")}</legend>
						{assets.length ? (
							<div className="mcp-options-list mcp-asset-list">
								{assets.map((asset) => (
									<label className="mcp-check" key={asset.id}>
										<input
											type="checkbox"
											checked={selectedIds.includes(asset.id)}
											onChange={(event) =>
												toggleAsset(asset.id, event.target.checked)
											}
										/>
										<span>{asset.name}</span>
									</label>
								))}
							</div>
						) : (
							<p>{t("mcpNoAssets")}</p>
						)}
						<small>{t("mcpAssetHint")}</small>
					</fieldset>
					<fieldset
						className="mcp-options"
						disabled={controlsDisabled}
					>
						<legend>{t("mcpReadFields")}</legend>
						<div className="mcp-options-list mcp-field-list">
							{readableFields.map((field) => (
								<label className="mcp-check" key={field}>
									<input
										type="checkbox"
										checked={readFields.includes(field)}
										onChange={(event) =>
											toggleRead(field, event.target.checked)
										}
									/>
									<span>{t(`mcpField_${field}`)}</span>
								</label>
							))}
						</div>
					</fieldset>
					<fieldset
						className="mcp-options"
						disabled={controlsDisabled}
					>
						<legend>{t("mcpWriteFields")}</legend>
						<div className="mcp-options-list mcp-field-list">
							{writableFields.map((field) => (
								<label className="mcp-check" key={field}>
									<input
										type="checkbox"
										checked={writeFields.includes(field)}
										disabled={!readFields.includes(field)}
										onChange={(event) =>
											toggleWrite(field, event.target.checked)
										}
									/>
									<span>{t(`mcpField_${field}`)}</span>
								</label>
							))}
						</div>
						<small>{t("mcpWriteHint")}</small>
					</fieldset>
					<label htmlFor="mcp-duration" className="field mcp-duration">
						<span>{t("mcpDuration")}</span>
						<Select id="mcp-duration"
							value={String(ttlMs)}
							disabled={controlsDisabled}
							onValueChange={(selectValue) => {
								invalidateSelection();
								setTtlMs(Number(selectValue));
							}}
						>
							{durations.map(({ value, key }) => (
								<SelectOption value={String(value)} key={value}>
									{t(key)}
								</SelectOption>
							))}
						</Select>
					</label>
					{native && <label className="field" htmlFor="mcp-native-address">
						<span>{t('mcpNativeAddress')}</span>
						<input id="mcp-native-address" type="text" inputMode="decimal" autoComplete="off" spellCheck={false}
							value={address} disabled={controlsDisabled} aria-describedby="mcp-native-address-hint"
							onChange={event => { invalidateSelection(); setAddress(event.target.value); setLocalError(null); }} />
						<small id="mcp-native-address-hint">{t('mcpNativeAddressHint')}</small>
					</label>}
					<div className="actions">
						<Button
							variant="primary"
							disabled={!canPrepare || controlsDisabled}
							onClick={() => {
								if (!canPrepare || operation.current) return;
								setLocalError(null);
								if (native) {
									operation.current = true; setBusy(true);
									void native.prepare(address.trim(), { assetIds: selectedIds, readFields, writeFields, ttlMs: ttlMs as 300000 | 600000 | 900000 })
										.catch(cause => setLocalError(cause instanceof Error && cause.message === 'mcpNativeStopUnconfirmed' ? 'mcpNativeStopUnconfirmed' : 'mcpNativePrepareFailed'))
										.finally(() => { operation.current = false; setBusy(false); });
									return;
								}
								try {
									prepare({
										assetIds: selectedIds,
										readFields,
										writeFields,
										ttlMs,
									});
								} catch (cause) {
									setLocalError(cause instanceof Error && cause.message === "mcpNativeUnavailable" ? "mcpNativeUnavailable" : "mcpSelectionInvalid");
								}
							}}
						>
							{t(native ? "mcpNativePrepare" : "mcpCreateRequest")}
						</Button>
						{!native && localConnectionAvailable && requestCurrent && download?.request === prepared && (
							<ExportFileLink
								className="button"
								href={download.url}
								download="keepany-mcp-request.json"
								onDeliveryMessage={setDeliveryMessage}
							>
								{t("mcpDownloadRequest")}
							</ExportFileLink>
						)}
						{nativeExportAvailable && download && <ExportFileLink className="button" href={download.url} download="keepany-mcp-mobile-pairing.json"
							onClick={event => { if (!nativeFile || nativeFile.expiresAt <= Date.now()) event.preventDefault(); }}
							onDeliveryMessage={message => {
								if (currentExport.current !== nativeFile) return;
								setDeliveryMessage(message); native?.reportDelivery(message);
							}}>{t('mcpDownloadRequest')}</ExportFileLink>}
						{native?.phase === 'prepared' && <Button variant="primary" disabled={busy || stopUnconfirmed || !nativeCurrent || !native.delivered}
							onClick={() => {
								if (operation.current || !nativeCurrent || !native.delivered || !nativeFile || nativeFile.expiresAt <= Date.now()) return;
								operation.current = true; setBusy(true); setLocalError(null);
								void native.activate().catch(() => setLocalError('mcpNativeActivationFailed'))
									.finally(() => { operation.current = false; setBusy(false); });
							}}>{t('mcpNativeActivate')}</Button>}
						{native && native.phase !== 'idle' && <Button variant="danger" disabled={busy} onClick={() => void stopNative()}>{t('mcpNativeStop')}</Button>}
					</div>
					{!native && prepared && (
						<p role="status">
							{t(requestCurrent ? deliveryMessage ?? (hasFileDeliveryHandler() ? "exportRequestReady" : "mcpRequestReady") : "mcpSelectionChanged")}
						</p>
					)}
					{native && <>
						{native.phase === 'prepared' && <p role="status">{t(nativeCurrent ? deliveryMessage === 'exportFileSaved' ? 'mcpNativeFileSaved' : deliveryMessage ?? 'mcpNativeTicketReady' : 'mcpNativePairExpired')}</p>}
						{(native.phase === 'preparing' || native.phase === 'activating') && <p role="status">{t('mcpNativePreparing')}</p>}
						{native.phase === 'waiting' && <p role="status">{t('mcpNativeWaiting')}</p>}
					</>}
					{!native && <label className="field mcp-import">
						<span>{t("mcpImportPairing")}</span>
						<input
							type="file"
							accept=".json,application/json"
							disabled={!localConnectionAvailable || !requestCurrent || busy || status === "pairing"}
							onChange={(event) => {
								const file = event.target.files?.[0];
								event.target.value = "";
								if (!file) return;
								setBusy(true);
								setLocalError(null);
								void importPairing(file)
									.catch(() => undefined)
									.finally(() => setBusy(false));
							}}
						/>
						{localConnectionAvailable && <small>{t("mcpPairingHint")}</small>}
					</label>}
				</>
			)}
			{!native && status === "pairing" && <p role="status">{t("mcpPairing")}</p>}
			{(localError || error) && (
				<p role="alert" className="mcp-error">
					{t(localError || error || "mcpStatusError")}
				</p>
			)}
		</section>
	);
}
