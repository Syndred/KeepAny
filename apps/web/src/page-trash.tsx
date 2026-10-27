import "./trash.css";
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { effectiveFinanceEntry, financeActions, historyReferenceIds, type Task, type History } from '../../../packages/domain/src';
import {
	previewTrashPurge,
	purgeTrash,
	type TrashPurgePlan,
	type TrashTarget,
	restoreEntity,
	AccountRestoreConflict,
	restoreTaskIfCurrent,
	restoreFinanceEntryIfCurrent,
} from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { TextLink } from "./components/ui/text-link";
import { Empty, PageTitle, date, money, useAppContext } from "./view-shared";
import { Select, SelectOption } from './components/ui/select';
import { emptyTrashFilters, matchesTrashFilters, readTrashFilters, trashFilterStorageKey, trashFilterTypes, type TrashFilters, type TrashFilterType } from './trash-filter-state';
export function TrashPage() {
	const { data, notify } = useAppContext();
	const { t, i18n } = useTranslation();
	const [filters, setFilters] = useState<TrashFilters>(() => { try { return readTrashFilters(sessionStorage.getItem(trashFilterStorageKey)); } catch { return { ...emptyTrashFilters }; } });
	useEffect(() => { try { sessionStorage.setItem(trashFilterStorageKey, JSON.stringify(filters)); } catch { /* Optional UI preferences never block recovery. */ } }, [filters]);
	const allAssets = data.assets.filter((a) => a.deleted && !a.purged);
	const allRelations = data.relations.filter(
		(relation) => relation.deleted && !relation.purged,
	);
	const allTasks = data.tasks.filter(task => task.deleted && !task.purged && !task.impactSnapshot && !task.projectWorkflow && !task.maintenancePlan);
	const allBills = data.history.filter(entry => !entry.purged && !entry.financeCorrection?.purged &&
		(financeActions.includes(entry.action as typeof financeActions[number]) && entry.deleted || entry.action === 'renew' && !entry.deleted && entry.financeCorrection?.hidden));
	const assetName = (id: string) => data.assets.find(asset => asset.id === id)?.name ?? '';
	const assets = allAssets.filter(asset => matchesTrashFilters(filters, asset.kind, [asset.name, t(asset.kind)]));
	const relations = allRelations.filter(relation => matchesTrashFilters(filters, 'relation', [assetName(relation.from), assetName(relation.to), relation.label, relation.source ?? '', date(relation.verifiedAt, i18n.language)]));
	const tasks = allTasks.filter(task => matchesTrashFilters(filters, 'task', [task.name, assetName(task.assetId), date(task.dueDate, i18n.language)]));
	const bills = allBills.filter(original => { const entry = effectiveFinanceEntry(original); return matchesTrashFilters(filters, 'history', [entry.title || assetName(entry.assetId), date(entry.eventDate || entry.billDate || entry.createdAt.slice(0, 10), i18n.language), entry.amount !== undefined && entry.currency ? money(entry.amount, entry.currency, i18n.language) : '']); });
	const filtered = filters.type !== 'all' || !!filters.query.trim();
	const [restoring, setRestoring] = useState("");
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [existingAccounts, setExistingAccounts] = useState<
		Record<string, string>
	>({});
	const inFlight = useRef(false);
	const [purgePlan, setPurgePlan] = useState<{
		plan: TrashPurgePlan;
		name?: string;
		filtered?: boolean;
	} | null>(null);
	const [purging, setPurging] = useState(false);
	const [preparing, setPreparing] = useState(false);
	const [purgeError, setPurgeError] = useState("");
	const purgeOpener = useRef<HTMLElement | null>(null);
	const disabled = !!restoring || purging || preparing;
	async function preparePurge(targets: TrashTarget[], name?: string, filtered = false) {
		if (inFlight.current) return;
		inFlight.current = true;
		purgeOpener.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		setPreparing(true);
		setPurgeError("");
		try {
			setPurgePlan({ plan: await previewTrashPurge(targets), name, filtered });
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
	async function restore(type: "asset" | "relation" | "task" | "history", id: string, expected?: Task | History) {
		if (inFlight.current) return;
		const errorKey = type === 'task' || type === 'history' ? `${type}:${id}` : id;
		inFlight.current = true;
		setRestoring(id);
		setErrors((current) => ({ ...current, [errorKey]: "" }));
		setExistingAccounts((current) => ({ ...current, [id]: "" }));
		try {
			if (type === 'task') await restoreTaskIfCurrent(expected as Task);
			else if (type === 'history') await restoreFinanceEntryIfCurrent(expected as History);
			else await restoreEntity(type, id);
			notify(t("saved"));
		} catch (error) {
			if (type === 'task' || type === 'history') {
				const code = error instanceof Error ? error.message : '';
				setErrors(current => ({ ...current, [errorKey]: t(code === 'task-duplicate' ? 'trashTaskDuplicate' : code === 'task-target-changed' ? 'trashTaskTargetUnavailable' : code === 'task-stale' ? 'workflowTaskStale' : code === 'history-stale' ? 'trashBillStale' : code === 'finance-target-changed' ? 'trashBillTargetUnavailable' : 'error') }));
				return;
			}
			if (error instanceof AccountRestoreConflict) {
				setErrors((current) => ({ ...current, [id]: t("trashAccountExists") }));
				setExistingAccounts((current) => ({
					...current,
					[id]: error.existingId,
				}));
				return;
			}
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
					assets.length + relations.length + tasks.length + bills.length > 0 && (
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
									...tasks.map(task => ({ type: 'task' as const, id: task.id })),
									...bills.map(entry => ({ type: 'history' as const, id: entry.id })),
								], undefined, filtered)
							}
						>
							{t(filtered ? 'trashDeleteFiltered' : "emptyTrash")}
						</Button>
					)
				}
			/>
			<section className="card padded"><div className="form-grid">
				<label className="field" htmlFor="trash-filter-query">{t('trashFilterQuery')}<input id="trash-filter-query" type="search" maxLength={2000} value={filters.query} onChange={event => setFilters(current => ({ ...current, query: event.target.value }))} /></label>
				<label className="field" htmlFor="trash-filter-type">{t('trashFilterType')}<Select id="trash-filter-type" value={filters.type} onValueChange={type => setFilters(current => ({ ...current, type: type as TrashFilterType }))}>{trashFilterTypes.map(type => <SelectOption key={type} value={type}>{t(type === 'relation' ? 'deletedRelations' : type === 'task' ? 'deletedTasks' : type === 'history' ? 'deletedBills' : type === 'vault' ? 'trashReferenceType' : type)}</SelectOption>)}</Select></label>
			</div><div className="actions"><Button disabled={!filtered} onClick={() => setFilters({ ...emptyTrashFilters })}>{t('trashClearFilters')}</Button></div></section>
			{purgeError && !purgePlan && (
				<p className="field-error" role="alert">
					{purgeError}
				</p>
			)}
			{purgePlan && (
				<Dialog
					className="trash-confirm-dialog"
					title={t(purgePlan.name ? "deletePermanently" : purgePlan.filtered ? 'trashDeleteFiltered' : "emptyTrash")}
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
							{t(purgePlan.filtered ? 'trashDeleteFilteredConfirm' : "emptyTrashConfirm", { count: purgePlan.plan.targets.length })}
						</p>
					)}
					<p>{t("trashPermanentWarning")}</p>
					{purgePlan.plan.targets.some(target => target.type === 'history' && purgePlan.plan.rows.some(row => {
						if (row.id !== `history:${target.id}`) return false;
						const history = JSON.parse(row.payload) as History;
						return history.action === 'renew' && !history.deleted && history.financeCorrection?.hidden && !historyReferenceIds(history).some(id => purgePlan.plan.targets.some(other => other.type === 'asset' && other.id === id));
					})) && <p>{t('trashRenewalProjectionPurge')}</p>}
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
										: purgePlan.filtered ? 'trashDeleteFiltered' : "emptyTrash",
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
									<div className="trash-restore-error" role="alert">
										<small className="field-error">{errors[a.id]}</small>
										{existingAccounts[a.id] && (
											<TextLink asChild>
												<Link
													to="/assets/$kind/$id"
													params={{
														kind: "account",
														id: existingAccounts[a.id],
													}}
												>
													{t("trashViewAccount")}
												</Link>
											</TextLink>
										)}
									</div>
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
			{tasks.length > 0 && <section className="card"><h2>{t('deletedTasks')}</h2><div className="list">{tasks.map(task => <div className="list-row trash-row" key={task.id} data-task-id={task.id}>
				<Trash2 size={18} /><div><strong>{task.name}</strong><small>{date(task.dueDate, i18n.language)}{task.assetId ? ` · ${data.assets.find(asset => asset.id === task.assetId)?.name ?? t('taskRelatedMissing')}` : ''}</small>{task.completionHistory.length > 0 && <small>{t('trashTaskHistoryCount', { count: task.completionHistory.length })}</small>}</div>
				<div className="actions trash-row-actions"><Button size="small" disabled={disabled} onClick={() => void restore('task', task.id, task)}>{t('restore')}</Button><Button size="small" variant="danger" disabled={disabled} onClick={() => void preparePurge([{ type: 'task', id: task.id }], task.name)}>{t('deletePermanently')}</Button></div>
				{errors[`task:${task.id}`] && <p className="field-error" role="alert">{errors[`task:${task.id}`]}</p>}
			</div>)}</div></section>}
			{bills.length > 0 && <section className="card"><h2>{t('deletedBills')}</h2><div className="list">{bills.map(original => {
				const entry = effectiveFinanceEntry(original);
				const name = entry.title || data.assets.find(asset => asset.id === original.assetId)?.name || t('financeRecentRecords');
				return <div className="list-row trash-row" key={original.id} data-history-id={original.id}><Trash2 size={18} /><div><strong>{name}</strong><small>{date(entry.eventDate || entry.billDate || entry.createdAt.slice(0, 10), i18n.language)}{entry.amount !== undefined && entry.currency ? ` · ${money(entry.amount, entry.currency, i18n.language)}` : ''}</small>{original.action === 'renew' && <small>{t('trashRenewalProjectionHint')}</small>}</div>
					<div className="actions trash-row-actions"><Button size="small" disabled={disabled} onClick={() => void restore('history', original.id, original)}>{t('restore')}</Button><Button size="small" variant="danger" disabled={disabled} onClick={() => void preparePurge([{ type: 'history', id: original.id }], name)}>{t('deletePermanently')}</Button></div>
					{errors[`history:${original.id}`] && <p className="field-error" role="alert">{errors[`history:${original.id}`]}</p>}
				</div>;
			})}</div></section>}
			{assets.length === 0 && relations.length === 0 && tasks.length === 0 && bills.length === 0 && (
				<section className="card">
					{filtered && allAssets.length + allRelations.length + allTasks.length + allBills.length > 0 ? <p>{t('trashNoMatches')}</p> : <Empty hint={false} />}
				</section>
			)}
		</main>
	);
}
