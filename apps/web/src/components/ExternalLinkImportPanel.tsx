import { useMemo, useRef, useState } from "react";
import { FileDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
	checkTargetImageCount,
	externalLinkSubmissionForAsset,
	externalLinkSubmissionId,
	listExternalLinkExportProfiles,
	parseExternalLinkExport,
	previewExternalLinkExport,
} from "../../../../packages/connectors/src/externallink";
import { saveBatch } from "../../../../packages/local-db/src";
import { useAppContext } from "../view-shared";
import { Button } from "./ui/button";

type ExportData = ReturnType<typeof parseExternalLinkExport>;
type Preview = ReturnType<typeof previewExternalLinkExport>;

export function ExternalLinkImportPanel() {
	const { t } = useTranslation();
	const { data } = useAppContext();
	const projects = data.assets.filter(
		(asset) => asset.kind === "project" && !asset.deleted,
	);
	const [source, setSource] = useState<ExportData | null>(null);
	const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([]);
	const [assetId, setAssetId] = useState("");
	const [profileId, setProfileId] = useState("");
	const [preview, setPreview] = useState<Preview | null>(null);
	const [selected, setSelected] = useState<string[]>([]);
	const [minScreenshots, setMinScreenshots] = useState("0");
	const [maxScreenshots, setMaxScreenshots] = useState("4");
	const [requireLogo, setRequireLogo] = useState(false);
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const fileGeneration = useRef(0);
	const importing = useRef(false);
	const imageCheck = useMemo(() => {
		if (!preview) return null;
		try {
			return checkTargetImageCount(preview.profile, {
				minScreenshots: Number(minScreenshots),
				maxScreenshots: Number(maxScreenshots),
				requireLogo,
			});
		} catch {
			return null;
		}
	}, [preview, minScreenshots, maxScreenshots, requireLogo]);

	async function loadFile(file: File | undefined) {
		const generation = ++fileGeneration.current;
		setSource(null);
		setProfiles([]);
		setProfileId("");
		setPreview(null);
		setSelected([]);
		setMessage("");
		if (!file) return;
		try {
			if (file.size > 20 * 1024 * 1024) throw Error("externallink-export-size");
			const input: unknown = JSON.parse(await file.text());
			const parsed = parseExternalLinkExport(input);
			const available = listExternalLinkExportProfiles(parsed);
			if (!available.length) throw Error("externallink-profile");
			if (generation !== fileGeneration.current) return;
			setSource(parsed);
			setProfiles(available);
		} catch {
			if (generation === fileGeneration.current)
				setMessage(t("extInvalidExport"));
		}
	}

	function inspect() {
		if (
			!source ||
			!assetId ||
			!profileId ||
			!projects.some((asset) => asset.id === assetId)
		)
			return;
		setSelected([]);
		setMessage("");
		try {
			setPreview(previewExternalLinkExport(source, profileId, assetId));
		} catch {
			setPreview(null);
			setMessage(t("extInvalidLedger"));
		}
	}

	async function importSelected() {
		if (
			!preview ||
			!assetId ||
			importing.current ||
			!projects.some((asset) => asset.id === assetId)
		)
			return;
		const rows = preview.rows.filter(
			(row) => row.importable && selected.includes(row.preview.ledgerKey),
		);
		if (!rows.length) return;
		importing.current = true;
		setBusy(true);
		setMessage("");
		try {
			const importedAt = new Date().toISOString();
			await saveBatch(
				rows.map((row) => ({
					type: "submission" as const,
					value: externalLinkSubmissionForAsset(row, importedAt),
				})),
			);
			setSelected([]);
			setMessage(t("extImported", { count: rows.length }));
		} catch {
			setMessage(t("error"));
		} finally {
			importing.current = false;
			setBusy(false);
		}
	}

	function issueLabel(issue: string) {
		if (issue === "missing-receipt-evidence") return t("extMissingReceipt");
		if (issue === "missing-submitted-at" || issue === "invalid-submitted-at")
			return t("extMissingDate");
		if (issue === "publication-needs-verification")
			return t("extPublicationUnverified");
		return t("extIncompleteRecord");
	}

	return (
		<section className="card padded external-import-panel">
			<div className="card-header">
				<h2>
					<FileDown size={20} />
					{t("extImportTitle")}
				</h2>
			</div>
			<p>{t("extImportHint")}</p>
			<div className="form-grid">
				<div className="field">
					<label htmlFor="ext-project">{t("extChooseProject")}</label>
					<select
						id="ext-project"
						value={assetId}
						disabled={busy}
						onChange={(e) => {
							setAssetId(e.target.value);
							setPreview(null);
							setSelected([]);
							setMessage("");
						}}
					>
						<option value="">{t("select")}</option>
						{projects.map((asset) => (
							<option key={asset.id} value={asset.id}>
								{asset.name}
							</option>
						))}
					</select>
				</div>
				<div className="field">
					<label htmlFor="ext-file">{t("extExportFile")}</label>
					<input
						id="ext-file"
						type="file"
						accept=".json,application/json"
						disabled={busy}
						onChange={(e) => void loadFile(e.target.files?.[0])}
					/>
				</div>
				<div className="field">
					<label htmlFor="ext-profile">{t("extChooseProfile")}</label>
					<select
						id="ext-profile"
						value={profileId}
						disabled={busy || !source}
						onChange={(e) => {
							setProfileId(e.target.value);
							setPreview(null);
							setSelected([]);
							setMessage("");
						}}
					>
						<option value="">{t("select")}</option>
						{profiles.map((profile) => (
							<option key={profile.id} value={profile.id}>
								{profile.name} · {profile.id}
							</option>
						))}
					</select>
				</div>
			</div>
			<div className="actions">
				<Button
					onClick={inspect}
					disabled={busy || !source || !assetId || !profileId}
				>
					{t("preview")}
				</Button>
			</div>
			{preview && (
				<div className="external-import-preview">
					<h3>
						{t("extProfilePreview")}: {preview.profile.name} ·{" "}
						{preview.profile.profileId}
					</h3>
					<p>{preview.profile.website || "—"}</p>
					{preview.profile.title && <p>{preview.profile.title}</p>}
					{preview.profile.shortDescription && (
						<p>{preview.profile.shortDescription}</p>
					)}
					<p>
						{t("extImageCounts", {
							logo: preview.profile.imageCounts.logo,
							featured: preview.profile.imageCounts.featured,
							screenshots: preview.profile.imageCounts.screenshots,
						})}
					</p>
					<div className="form-grid external-image-rules">
						<div className="field">
							<label htmlFor="ext-min-images">{t("extMinScreenshots")}</label>
							<input
								id="ext-min-images"
								type="number"
								min="0"
								max="20"
								value={minScreenshots}
								onChange={(e) => setMinScreenshots(e.target.value)}
							/>
						</div>
						<div className="field">
							<label htmlFor="ext-max-images">{t("extMaxScreenshots")}</label>
							<input
								id="ext-max-images"
								type="number"
								min="0"
								max="20"
								value={maxScreenshots}
								onChange={(e) => setMaxScreenshots(e.target.value)}
							/>
						</div>
						<label className="field external-checkbox">
							<input
								type="checkbox"
								checked={requireLogo}
								onChange={(e) => setRequireLogo(e.target.checked)}
							/>
							{t("extRequireLogo")}
						</label>
					</div>
					{imageCheck ? (
						<p>
							{t("extImageCheck", {
								missing: imageCheck.missingScreenshots,
								extra: imageCheck.extraScreenshots,
								logo: imageCheck.missingLogo ? t("extMissing") : t("extReady"),
							})}
						</p>
					) : (
						<p role="alert">{t("extImageRuleInvalid")}</p>
					)}
					{!!preview.profile.unresolvedImageFields.length && (
						<p>
							{t("extUnresolvedImages", {
								count: preview.profile.unresolvedImageFields.length,
							})}
						</p>
					)}
					<p>{t("extMediaReferenceHint")}</p>
				<h3>{t("extLedgerPreview")}</h3>
				<p>{t("extSnapshotHint")}</p>
					{preview.rows.length ? (
						preview.rows.map((row) => {
							const existing = data.submissions.some(
								(submission) =>
									!submission.deleted &&
									submission.id ===
										externalLinkSubmissionId(assetId, row.preview.ledgerKey),
							);
							const evidence =
								row.preview.status === "rejected"
									? row.preview.failureReason
									: row.preview.indexEvidenceUrl ||
										row.preview.publicUrl ||
										row.preview.evidenceUrl ||
										row.preview.evidence;
							return (
								<label
									key={row.preview.ledgerKey}
									className="list-row external-import-row"
								>
									<input
										type="checkbox"
										disabled={busy || !row.importable}
										checked={selected.includes(row.preview.ledgerKey)}
										onChange={(e) =>
											setSelected((current) =>
												e.target.checked
													? [...current, row.preview.ledgerKey]
													: current.filter(
															(key) => key !== row.preview.ledgerKey,
														),
											)
										}
									/>
									<span className="external-import-record">
										<strong>{row.preview.destinationKey}</strong>
										<small>
											{row.preview.profileId} ·{" "}
											{row.preview.submittedAt
												? row.preview.submittedAt.slice(0, 10)
												: t("extMissingDate")}
										</small>
								{row.importable && <small>{evidence}</small>}
										{row.preview.issues.map((issue) => (
											<small key={issue} className="field-error">
												{issueLabel(issue)}
											</small>
										))}
										{existing && <small>{t("extExisting")}</small>}
									</span>
							<span className={`chip ${row.importable ? "" : "muted"}`}>{t(row.preview.status)}</span>
								</label>
							);
						})
					) : (
						<p>{t("extNoRecords")}</p>
					)}
					<div className="actions">
						<Button
							variant="primary"
							onClick={() => void importSelected()}
							disabled={busy || !selected.length}
						>
							{t("extImportSelected", { count: selected.length })}
						</Button>
					</div>
				</div>
			)}
			{message && (
				<p className="notice" role="status">
					{message}
				</p>
			)}
		</section>
	);
}
