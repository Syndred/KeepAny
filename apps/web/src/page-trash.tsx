import "./trash.css";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import {
	previewTrashPurge,
	purgeTrash,
	type TrashPurgePlan,
	type TrashTarget,
	restoreEntity,
} from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { Empty, PageTitle, date, useAppContext } from "./view-shared";
export function TrashPage() {
	const { data, notify } = useAppContext();
	const { t, i18n } = useTranslation();
	const assets = data.assets.filter((a) => a.deleted && !a.purged);
	const relations = data.relations.filter(
		(relation) => relation.deleted && !relation.purged,
	);
	const [restoring, setRestoring] = useState("");
	const [errors, setErrors] = useState<Record<string, string>>({});
	const inFlight = useRef(false);
	const [purgePlan, setPurgePlan] = useState<{
		plan: TrashPurgePlan;
		name?: string;
	} | null>(null);
	const [purging, setPurging] = useState(false);
	const [preparing, setPreparing] = useState(false);
	const [purgeError, setPurgeError] = useState("");
	const purgeOpener = useRef<HTMLElement | null>(null);
	const disabled = !!restoring || purging || preparing;
	async function preparePurge(targets: TrashTarget[], name?: string) {
		if (inFlight.current) return;
		inFlight.current = true;
		purgeOpener.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		setPreparing(true);
		setPurgeError("");
		try {
			setPurgePlan({ plan: await previewTrashPurge(targets), name });
		} catch {
			setPurgeError(t("trashChanged"));
		} finally {
			inFlight.current = false;
			setPreparing(false);
		}
	}
	async function confirmPurge() {
		if (!purgePlan || inFlight.current) return;
		inFlight.current = true;
		setPurging(true);
		setPurgeError("");
		try {
			await purgeTrash(purgePlan.plan);
			setPurgePlan(null);
			notify(t("trashDeleted"));
		} catch (error) {
			setPurgeError(
				t(
					error instanceof Error && error.message === "trash-stale"
						? "trashChanged"
						: "trashDeleteFailed",
				),
			);
		} finally {
			inFlight.current = false;
			setPurging(false);
		}
	}
	async function restore(type: "asset" | "relation", id: string) {
		if (inFlight.current) return;
		inFlight.current = true;
		setRestoring(id);
		setErrors((current) => ({ ...current, [id]: "" }));
		try {
			await restoreEntity(type, id);
			notify(t("saved"));
		} catch (error) {
			const relation =
				type === "relation"
					? data.relations.find((item) => item.id === id)
					: null;
			const missingEndpoint =
				relation &&
				[relation.from, relation.to].some(
					(endpoint) => !data.assets.some((asset) => asset.id === endpoint),
				);
			setErrors((current) => ({
				...current,
				[id]:
					error instanceof Error && error.message === "relation-endpoint"
						? t(
								missingEndpoint
									? "relationEndpointMissing"
									: "relationRestoreBlocked",
							)
						: t("error"),
			}));
		} finally {
			inFlight.current = false;
			setRestoring("");
		}
	}
	return (
		<main className="page trash-page" tabIndex={-1}>
			<PageTitle
				title={t("trash")}
				action={
					assets.length + relations.length > 0 && (
						<Button
							variant="danger"
							disabled={disabled}
							onClick={() =>
								void preparePurge([
									...assets.map((asset) => ({
										type: "asset" as const,
										id: asset.id,
									})),
									...relations.map((relation) => ({
										type: "relation" as const,
										id: relation.id,
									})),
								])
							}
						>
							{t("emptyTrash")}
						</Button>
					)
				}
			/>
			{purgeError && !purgePlan && (
				<p className="field-error" role="alert">
					{purgeError}
				</p>
			)}
			{purgePlan && (
				<Dialog
					className="trash-confirm-dialog"
					title={t(purgePlan.name ? "deletePermanently" : "emptyTrash")}
					closeDisabled={purging}
					returnFocusTo={() =>
						purgeOpener.current?.isConnected
							? purgeOpener.current
							: document.querySelector<HTMLElement>(
									".trash-page .page-header button, .trash-page",
								)
					}
					onClose={() => {
						if (!inFlight.current) {
							setPurgePlan(null);
							setPurgeError("");
						}
					}}
				>
					{purgePlan.name ? (
						<p>
							<strong>{purgePlan.name}</strong>
						</p>
					) : (
						<p>
							{t("emptyTrashConfirm", { count: purgePlan.plan.targets.length })}
						</p>
					)}
					<p>{t("trashPermanentWarning")}</p>
					{!purgePlan.plan.targets.some((target) => target.type === "asset") &&
						purgePlan.plan.rows.length > purgePlan.plan.targets.length && (
							<p>{t("trashRelationPurgeHint")}</p>
						)}
					{purgePlan.plan.targets.some((target) => target.type === "asset") && (
						<p>{t("trashAssetPurgeHint")}</p>
					)}
					{purgeError && (
						<p className="field-error" role="alert">
							{purgeError}
						</p>
					)}
					<div className="actions">
						<Button
							disabled={purging}
							onClick={() => {
								setPurgePlan(null);
								setPurgeError("");
							}}
						>
							{t("cancel")}
						</Button>
						<Button
							variant="danger"
							disabled={purging}
							onClick={() => void confirmPurge()}
						>
							{t(
								purging
									? "loading"
									: purgePlan.name
										? "deletePermanently"
										: "emptyTrash",
							)}
						</Button>
					</div>
				</Dialog>
			)}
			{assets.length > 0 && (
				<section className="card">
					<h2>{t("deletedAssets")}</h2>
					<div className="list">
						{assets.map((a) => (
							<div
								className="list-row trash-row"
								key={a.id}
								data-asset-id={a.id}
							>
								<Trash2 size={18} />
								<div>
									<strong>{a.name}</strong>
									<small>{t(a.kind)}</small>
								</div>
								<div className="actions trash-row-actions">
									{" "}
									<Button
										size="small"
										disabled={disabled}
										onClick={() => void restore("asset", a.id)}
									>
										{t("restore")}
									</Button>
									<Button
										size="small"
										variant="danger"
										disabled={disabled}
										onClick={() =>
											void preparePurge([{ type: "asset", id: a.id }], a.name)
										}
									>
										{t("deletePermanently")}
									</Button>
								</div>
								{errors[a.id] && (
									<small className="field-error" role="alert">
										{errors[a.id]}
									</small>
								)}
							</div>
						))}
					</div>
				</section>
			)}
			{relations.length > 0 && (
				<section className="card">
					<h2>{t("deletedRelations")}</h2>
					<div className="list relation-list">
						{relations.map((relation) => {
							const from = data.assets.find(
								(asset) => asset.id === relation.from,
							);
							const to = data.assets.find((asset) => asset.id === relation.to);
							return (
								<div
									className="list-row relation-row trash-row"
									key={relation.id}
									data-relation-id={relation.id}
								>
									<Trash2 size={18} />
									<div className="relation-info">
										<strong>
											{from?.name ?? "—"} → {to?.name ?? "—"}
										</strong>
										<small>{relation.label}</small>
										{(relation.source || relation.verifiedAt) && (
											<small>
												{relation.source &&
													`${t("relationSource")}: ${relation.source}`}
												{relation.source && relation.verifiedAt && " · "}
												{relation.verifiedAt &&
													`${t("verifiedAt")}: ${date(relation.verifiedAt, i18n.language)}`}
											</small>
										)}
										{errors[relation.id] && (
											<small className="field-error" role="alert">
												{errors[relation.id]}
											</small>
										)}
									</div>
									<div className="actions trash-row-actions">
										{" "}
										<Button
											size="small"
											disabled={disabled}
											onClick={() => void restore("relation", relation.id)}
										>
											{t("restore")}
										</Button>
										<Button
											size="small"
											variant="danger"
											disabled={disabled}
											onClick={() =>
												void preparePurge(
													[{ type: "relation", id: relation.id }],
													`${from?.name ?? "—"} → ${to?.name ?? "—"}`,
												)
											}
										>
											{t("deletePermanently")}
										</Button>
									</div>
								</div>
							);
						})}
					</div>
				</section>
			)}
			{assets.length === 0 && relations.length === 0 && (
				<section className="card">
					<Empty hint={false} />
				</section>
			)}
		</main>
	);
}
