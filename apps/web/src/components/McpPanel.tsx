import { useEffect, useState } from "react";
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

const durations = [
	{ value: 5 * 60_000, key: "mcpDuration5m" },
	{ value: 10 * 60_000, key: "mcpDuration10m" },
	{ value: 15 * 60_000, key: "mcpDuration15m" },
] as const;
const same = (left: readonly string[], right: readonly string[]) =>
	left.length === right.length &&
	left.every((item, index) => item === right[index]);

export function McpPanel() {
	const { t } = useTranslation();
	const { data } = useAppContext();
	const { status, scope, prepared, error, prepare, invalidatePrepared, importPairing, revoke } =
		useMcpRuntime();
	const assets = data.assets.filter((asset) => !asset.deleted);
	const [assetIds, setAssetIds] = useState<string[]>([]);
	const [readFields, setReadFields] = useState<ReadField[]>(["name"]);
	const [writeFields, setWriteFields] = useState<WriteField[]>([]);
	const [ttlMs, setTtlMs] = useState<number>(durations[2].value);
	const [busy, setBusy] = useState(false);
	const [localError, setLocalError] = useState<string | null>(null);
	const [download, setDownload] = useState<{
		request: McpRequest;
		url: string;
	} | null>(null);

	useEffect(() => {
		if (!prepared) {
			setDownload(null);
			return;
		}
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(prepared, null, 2)], {
				type: "application/json",
			}),
		);
		setDownload({ request: prepared, url });
		return () => {
			URL.revokeObjectURL(url);
		};
	}, [prepared]);

	const availableIds = new Set(assets.map((asset) => asset.id));
	const selectedIds = assetIds.filter((id) => availableIds.has(id));
	const canPrepare = selectedIds.length > 0 && readFields.length > 0;
	const requestCurrent = Boolean(
		prepared &&
			prepared.ttlMs === ttlMs &&
			same(prepared.assetIds, selectedIds) &&
			same(prepared.readFields, readFields) &&
			same(prepared.writeFields, writeFields),
	);
	const connected = scope !== null;
	const toggleAsset = (id: string, checked: boolean) => {
		invalidatePrepared();
		setAssetIds((current) =>
			checked ? [...current, id] : current.filter((item) => item !== id),
		);
		setLocalError(null);
	};
	const toggleRead = (field: ReadField, checked: boolean) => {
		invalidatePrepared();
		setReadFields((current) =>
			checked ? [...current, field] : current.filter((item) => item !== field),
		);
		if (!checked) {
			setWriteFields((current) => current.filter((item) => item !== field));
		}
		setLocalError(null);
	};
	const toggleWrite = (field: WriteField, checked: boolean) => {
		invalidatePrepared();
		setWriteFields((current) =>
			checked ? [...current, field] : current.filter((item) => item !== field),
		);
		setLocalError(null);
	};

	return (
		<section className="card padded mcp-panel">
			<h2 id="mcp-panel-title" tabIndex={-1}>{t("mcpTitle")}</h2>
			<p>{t("mcpHint")}</p>
			{connected ? (
				<div className="mcp-active">
					<p role="status">
						{t(status === "connected" ? "mcpConnected" : "mcpConnectionFailed")}
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
					<Button
						disabled={busy}
						variant="danger"
						onClick={() => {
							setBusy(true);
							setLocalError(null);
							void revoke()
								.catch(() => setLocalError("mcpRevokeUnconfirmed"))
								.finally(() => setBusy(false));
						}}
					>
						{t("mcpRevoke")}
					</Button>
				</div>
			) : (
				<>
					<fieldset
						className="mcp-options"
						disabled={busy || status === "pairing"}
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
						disabled={busy || status === "pairing"}
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
						disabled={busy || status === "pairing"}
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
							disabled={busy || status === "pairing"}
							onValueChange={(selectValue) => {
								invalidatePrepared();
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
					<div className="actions">
						<Button
							variant="primary"
							disabled={!canPrepare || busy || status === "pairing"}
							onClick={() => {
								if (!canPrepare) return;
								setLocalError(null);
								try {
									prepare({
										assetIds: selectedIds,
										readFields,
										writeFields,
										ttlMs,
									});
								} catch {
									setLocalError("mcpSelectionInvalid");
								}
							}}
						>
							{t("mcpCreateRequest")}
						</Button>
						{requestCurrent && download?.request === prepared && (
							<a
								className="button"
								href={download.url}
								download="stackperch-mcp-request.json"
							>
								{t("mcpDownloadRequest")}
							</a>
						)}
					</div>
					{prepared && (
						<p role="status">
							{t(requestCurrent ? "mcpRequestReady" : "mcpSelectionChanged")}
						</p>
					)}
					<label className="field mcp-import">
						<span>{t("mcpImportPairing")}</span>
						<input
							type="file"
							accept=".json,application/json"
							disabled={!requestCurrent || busy || status === "pairing"}
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
						<small>{t("mcpPairingHint")}</small>
					</label>
				</>
			)}
			{status === "pairing" && <p role="status">{t("mcpPairing")}</p>}
			{(localError || error) && (
				<p role="alert" className="mcp-error">
					{t(localError || error || "mcpStatusError")}
				</p>
			)}
		</section>
	);
}
