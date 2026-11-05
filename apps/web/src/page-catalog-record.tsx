import { ReminderTaskContext } from "./ReminderTaskContext";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ExternalLink, MoreHorizontal, Plus, X } from "lucide-react";
import {
	cleanupUnreferencedFile,
	putFile,
	saveAssetIfCurrent,
} from "../../../packages/local-db/src";
import { AssetCardContent } from "./components/AssetSummaryCard";
import { WalletCardFace } from "./components/WalletCardFace";
import {
	UnifiedDetailColumns,
	UnifiedDetailDescription,
	UnifiedDetailHeader,
	UnifiedDetailHistory,
	UnifiedDetailImage,
	UnifiedDetailTasks,
} from "./components/UnifiedAssetDetail";
import { CatalogRecordEditor } from "./catalog-record-editor";
import {
	applyCatalogEdit,
	catalogCategories,
	catalogCategoryLabel,
	catalogRecords,
	type CatalogRecord,
} from "./catalog-records";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { money, date, useAppContext } from "./view-shared";
import "./workspaces.css";
import { withDetailImages } from "./unified-detail-data";

const ProjectDetailExtras = lazy(() => import("./page-asset-detail").then(module => ({ default: module.ProjectDetailExtras })));

export function CatalogRecordCard({
	record,
	categoryName,
	onOpen,
}: {
	record: CatalogRecord;
	categoryName: string;
	onOpen?: () => void;
}) {
	return (
		<Link
			className="asset-summary-card catalog-record-card"
			to="/records/$id"
			params={{ id: record.id }}
			onClick={onOpen}
		>
			<AssetCardContent asset={record.asset} categoryName={categoryName} />
		</Link>
	);
}
export function CatalogRecordPage({ recordId }: { recordId?: string } = {}) {
	const id = useRouterState({
		select: (state) => (state.matches.at(-1)?.params as { id?: string })?.id,
	});
	return <CatalogDetail key={recordId ?? id} recordId={recordId ?? id ?? ""} />;
}
function CatalogDetail({ recordId }: { recordId: string }) {
	const { data, notify } = useAppContext(),
		{ t, i18n } = useTranslation(),
		navigate = useNavigate();
	const current = catalogRecords(data.assets, data.categories).find(
		(record) => record.id === recordId,
	);
	const [extrasOpen, setExtrasOpen] = useState(false);
	const extrasToggle = useRef<HTMLButtonElement>(null);
	const extrasRegion = useRef<HTMLElement>(null);
	useEffect(() => {
		if (!extrasOpen) return;
		const frame = requestAnimationFrame(() => {
			extrasRegion.current?.focus({ preventScroll: true });
			extrasRegion.current?.scrollIntoView({ block: "start" });
		});
		return () => cancelAnimationFrame(frame);
	}, [extrasOpen]);
	function closeExtras() {
		setExtrasOpen(false);
		extrasToggle.current?.focus();
	}
	const [edit, setEdit] = useState(false),
		[remove, setRemove] = useState<CatalogRecord | null>(null);
	const [busy, setBusy] = useState(false),
		[error, setError] = useState("");
	const [pending, setPending] = useState<{
			file: File;
			replace: string;
			expected: CatalogRecord;
		} | null>(null),
		[preview, setPreview] = useState(""),
		[ready, setReady] = useState(false);
	const upload = useRef<HTMLInputElement>(null),
		replaceId = useRef(""),
		inFlight = useRef(false);
	useEffect(() => {
		if (!pending) {
			setPreview("");
			return;
		}
		const url = URL.createObjectURL(pending.file);
		setPreview(url);
		setReady(false);
		return () => URL.revokeObjectURL(url);
	}, [pending]);
	if (data.loading) return <p role="status">{t("loading")}</p>;
	if (!current)
		return (
			<main className="page">
				<h1>{t("noMatches")}</h1>
				<Button asChild>
					<Link to="/assets">{t("back")}</Link>
				</Button>
			</main>
		);
	const category = catalogCategories(data.categories).find(
		(row) => row.id === current.categoryId,
	);
	const categoryName = current.asset.walletCard
		? t(`walletType_${current.asset.walletCard.type}`)
		: category
			? catalogCategoryLabel(category, t)
			: t("catalogUnclassified");
	async function run(action: () => Promise<void>) {
		if (inFlight.current) return;
		inFlight.current = true;
		setBusy(true);
		setError("");
		try {
			await action();
			notify(t("saved"));
		} catch (reason) {
			setError(
				t(
					reason instanceof Error && reason.message === "asset-stale"
						? "assetStale"
						: "error",
				),
			);
		} finally {
			inFlight.current = false;
			setBusy(false);
		}
	}
	async function storeImages(
		ids: string[],
		replace = "",
		replacement = "",
		expected = current,
	) {
		if (!expected) return;
		const draft = expected.domain
			? { ...expected.asset, attachments: ids }
			: withDetailImages(expected.asset, ids, replace, replacement);
		await saveAssetIfCurrent(
			expected.owner,
			applyCatalogEdit(
				expected,
				{ ...draft, updatedAt: new Date().toISOString() },
				expected.categoryId,
			),
		);
	}
	function chooseImage(id = "") {
		replaceId.current = id;
		setError("");
		upload.current?.click();
	}
	const hasLegacy =
		current.domain ||
		current.owner.catalogCategoryId === undefined ||
		current.owner.projectDomains.length > 0 ||
		[
			current.owner.contact,
			current.owner.projectLaunchMonth,
			current.owner.projectInspectionDate,
			current.owner.projectTitle,
			current.owner.projectPromoUrl,
			current.owner.projectMediumDescription,
			current.owner.projectFeatures,
			current.owner.projectPricing,
			current.owner.projectPricingType,
			current.owner.projectEmail,
		].some(Boolean);
	const info = (
		<section className="unified-detail-info" aria-label={t("detailBasicInfo")}>
			<dl>
				{current.asset.walletCard && (
					<>
						<div>
							<dt>{t("walletIssuer")}</dt>
							<dd>{current.asset.walletCard.issuer || t("none")}</dd>
						</div>
						{current.asset.walletCard.lastFour && (
							<div>
								<dt>{t("walletLastFour")}</dt>
								<dd>{current.asset.walletCard.lastFour}</dd>
							</div>
						)}
						{current.asset.walletCard.balanceMinor !== null && (
							<div>
								<dt>{t("walletBalance")}</dt>
								<dd>
									{money(
										current.asset.walletCard.balanceMinor,
										"CNY",
										i18n.language,
									)}
								</dd>
							</div>
						)}
						{current.asset.walletCard.remainingUses !== null && (
							<div>
								<dt>{t("walletRemaining")}</dt>
								<dd>{current.asset.walletCard.remainingUses}</dd>
							</div>
						)}
					</>
				)}
				{current.domain && (
					<div>
						<dt>{t("project")}</dt>
						<dd>{current.owner.name}</dd>
					</div>
				)}
			</dl>
			{hasLegacy && (
                <Button ref={extrasToggle} size="small" variant="ghost" aria-expanded={extrasOpen} aria-controls="project-detail-extras" onClick={() => setExtrasOpen(value => !value)}>{t("detailMoreInfo")}</Button>
			)}
		</section>
	);
	const description = (
		<UnifiedDetailDescription
			asset={current.asset}
			accountId={current.domain?.accountId}
			readOnly={!!current.domain}
			actions={
				<Button
					size="small"
					variant="ghost"
					disabled={busy || current.asset.attachments.length >= 20}
					onClick={() => chooseImage()}
				>
					<Plus size={16} />
					{t("addPhoto")}
				</Button>
			}
		>
			<input
				ref={upload}
				type="file"
				accept="image/png,image/jpeg,image/webp,image/gif"
				hidden
				tabIndex={-1}
				aria-label={t("addPhoto")}
				disabled={busy}
				onChange={(event) => {
					const file = event.target.files?.[0];
					event.target.value = "";
					if (!file) return;
					if (
						!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
							file.type,
						) ||
						!file.size ||
						file.size > 20 * 1024 * 1024 ||
						file.name.length > 255
					) {
						setError(t("uploadError"));
						return;
					}
					setPending({
						file,
						replace: replaceId.current,
						expected: structuredClone(current),
					});
				}}
			/>
			{current.asset.attachments.length ? (
				<div className="unified-detail-gallery">
					{current.asset.attachments.map((image, index) => (
						<UnifiedDetailImage
							key={image}
							id={image}
							label={t("detailPhotoNumber", { number: index + 1 })}
							actions={
								<>
									<DropdownMenuItem
										disabled={busy}
										onClick={() => chooseImage(image)}
									>
										{t("replaceImage")}
									</DropdownMenuItem>
									<DropdownMenuItem
										disabled={busy}
										onClick={() =>
											void run(async () => {
												await storeImages(
													current.asset.attachments.filter(
														(id) => id !== image,
													),
												);
												await cleanupUnreferencedFile(image).catch(() => false);
											})
										}
									>
										{t("removeImage")}
									</DropdownMenuItem>
								</>
							}
						/>
					))}
				</div>
			) : (
				<p className="unified-detail-empty">{t("detailNoImages")}</p>
			)}
		</UnifiedDetailDescription>
	);
	return (
		<main className="page unified-asset-detail catalog-record-detail">
			{error && !pending && !remove ? (
				<p className="field-error" role="alert">
					{error}
				</p>
			) : null}
			<UnifiedDetailColumns
				asset={current.asset}
				header={
					<UnifiedDetailHeader
						asset={current.asset}
						category={categoryName}
						state={t(current.asset.status)}
						actions={
							<>
								<Button variant="primary" onClick={() => setEdit(true)}>
									{t("edit")}
								</Button>
								<DropdownMenu>
									<DropdownMenuTrigger
										render={<Button aria-label={t("moreActions")} />}
									>
										<MoreHorizontal size={18} />
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
                                        {!current.domain && !current.asset.walletCard && <>
                                            <DropdownMenuItem render={<Link to="/assets/project/$id/workflow/$flow" params={{ id: current.owner.id, flow: "brand" }} />}>{t("workflowBrandEntry")}</DropdownMenuItem>
                                            <DropdownMenuItem render={<Link to="/assets/project/$id/workflow/$flow" params={{ id: current.owner.id, flow: "close" }} />}>{t("workflowCloseEntry")}</DropdownMenuItem>
                                        </>}
										<DropdownMenuItem
											disabled={!!current.domain || busy}
											onClick={() => {
												setError("");
												setRemove(structuredClone(current));
											}}
										>
											{t("delete")}
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</>
						}
					/>
				}
				info={info}
				description={description}
				history={<UnifiedDetailHistory asset={current.asset} />}
				tasks={<UnifiedDetailTasks assetId={current.owner.id} />}
			/>
            {hasLegacy && extrasOpen && <section ref={extrasRegion} tabIndex={-1} id="project-detail-extras" className="unified-detail-extras-region" aria-label={t("detailMoreInfo")}><div className="unified-detail-extras-actions"><h2>{current.domain ? `${t("project")}: ${current.owner.name}` : t("detailMoreInfo")}</h2><Button size="small" aria-label={t("close")} onClick={closeExtras}><X size={18}/></Button></div><Suspense fallback={<p role="status">{t("loading")}</p>}><ProjectDetailExtras projectId={current.owner.id} /></Suspense></section>}

			{edit ? (
				<CatalogRecordEditor record={current} onClose={() => setEdit(false)} />
			) : null}
			{pending ? (
				<Dialog
					title={t("preview")}
					closeDisabled={busy}
					onClose={() => {
						if (!inFlight.current) setPending(null);
					}}
				>
					{preview ? (
						<img
							className="image-preview"
							src={preview}
							alt={pending.file.name}
							onLoad={() => setReady(true)}
							onError={() => {
								setReady(false);
								setError(t("uploadError"));
							}}
						/>
					) : null}
					{error ? <p role="alert">{error}</p> : null}
					<div className="actions">
						<Button disabled={busy} onClick={() => setPending(null)}>
							{t("cancel")}
						</Button>
						<Button
							variant="primary"
							disabled={busy || !ready}
							onClick={() =>
								void run(async () => {
									let id = "";
									try {
										id = await putFile(pending.file);
										const ids = pending.replace
											? pending.expected.asset.attachments.map((value) =>
													value === pending.replace ? id : value,
												)
											: [...pending.expected.asset.attachments, id];
										await storeImages(
											ids,
											pending.replace,
											id,
											pending.expected,
										);
										if (pending.replace)
											await cleanupUnreferencedFile(pending.replace).catch(
												() => false,
											);
										setPending(null);
									} catch (reason) {
										if (id)
											await cleanupUnreferencedFile(id).catch(() => false);
										throw reason;
									}
								})
							}
						>
							{t("confirm")}
						</Button>
					</div>
				</Dialog>
			) : null}
			{remove ? (
				<Dialog
					title={t("delete")}
					closeDisabled={busy}
					onClose={() => {
						if (!inFlight.current) setRemove(null);
					}}
				>
					<p>{t("deleteConfirm")}</p>
					<p>{remove.asset.name}</p>
					{error ? <p role="alert">{error}</p> : null}
					<div className="actions">
						<Button disabled={busy} onClick={() => setRemove(null)}>
							{t("cancel")}
						</Button>
						<Button
							variant="danger"
							disabled={busy}
							onClick={() =>
								void run(async () => {
									await saveAssetIfCurrent(remove.owner, {
										...remove.owner,
										deleted: true,
										updatedAt: new Date().toISOString(),
									});
									setRemove(null);
									void navigate({ to: "/assets" });
								})
							}
						>
							{t("delete")}
						</Button>
					</div>
				</Dialog>
			) : null}
		</main>
	);
}
