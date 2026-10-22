import { Link } from "@tanstack/react-router";
import { Check, Network, Search, WandSparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { generateAiText } from "../../../../packages/ai/src";
import type {
	Asset,
	EntityType,
	Relation,
} from "../../../../packages/domain/src";
import { localRepository } from "../../../../packages/local-db/src";
import { acquireAiConnection, useAiConnection } from "../ai-settings-store";
import { parseAiJson } from "../ai-workflow-model";
import {
	accountLinkSystem,
	aiAccountLinkInput,
	buildAccountLinkRows,
	buildAccountLinkSavePlan,
	dedupeSuggestions,
	readAiAccountLinks,
	sharedIdentifierSuggestions,
	type AccountLinkRow,
	type AccountLinkSuggestion,
} from "../vault-account-links";
import { builtins, niceCategory, useAppContext } from "../view-shared";
import { usePasswordVault } from "./PasswordVaultProvider";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Select, SelectOption } from "./ui/select";
import { TextLink } from "./ui/text-link";

export function VaultAccountLinksDialog({
	onClose,
	onSaved,
}: {
	onClose: () => void;
	onSaved: () => void;
}) {
	const { t } = useTranslation();
	const { data } = useAppContext();
	const { session, snapshot } = usePasswordVault();
	const { connection } = useAiConnection();
	const base = useRef(snapshot.contentRevision);
	const [rows, setRows] = useState<AccountLinkRow[]>([]);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<string[]>([]);
	const [suggestions, setSuggestions] = useState<AccountLinkSuggestion[]>([]);
	const [chosen, setChosen] = useState<number[]>([]);
	const [sourceAssets, setSourceAssets] = useState<Asset[]>([]);
	const [sourceRelations, setSourceRelations] = useState<Relation[]>([]);
	const [replaceCount, setReplaceCount] = useState(0);
	const [blockedEntries, setBlockedEntries] = useState<string[]>([]);
	const [busy, setBusy] = useState(false),
		[loading, setLoading] = useState(true),
		[message, setMessage] = useState("");
	const running = useRef(false),
		active = useRef(true),
		abort = useRef<AbortController | null>(null);
	const stale = snapshot.contentRevision !== base.current;
	useEffect(() => {
		active.current = true;
		const load = async () => {
			if (!session) return;
			const repository = await localRepository();
			if (!active.current) return;
			const assets = await repository.list<Asset>("asset", true);
			const relations = await repository.list<Relation>("relation", true);
			if (!active.current || session.getSnapshot().status !== "unlocked")
				return;
			const entries = session
				.getSnapshot()
				.entries.filter(
					(entry) =>
						entry.username.trim() && !session.readEntry(entry.id).aiKeyBinding,
				);
			const notes = new Map(
				entries.map((entry) => [entry.id, session.readEntry(entry.id).notes]),
			);
			let result: AccountLinkRow[];
			const blocked: string[] = [];
			try {
				result = await buildAccountLinkRows(entries, assets, notes, relations);
			} catch {
				const eligible = [];
				for (const entry of entries) {
					try {
						await buildAccountLinkRows([entry], assets, notes, relations);
						eligible.push(entry);
					} catch {
						blocked.push(entry.title);
					}
				}
				result = await buildAccountLinkRows(eligible, assets, notes, relations);
			}
			if (active.current) {
				setRows(result);
				setBlockedEntries(blocked);
				setSourceAssets(assets);
				setSourceRelations(relations);
			}
		};
		void load()
			.catch(() => {
				if (active.current) setMessage(t("pwConnectLoadError"));
			})
			.finally(() => {
				if (active.current) setLoading(false);
			});
		return () => {
			active.current = false;
			abort.current?.abort();
		};
	}, [session, t]);
	const selectedRows = rows.filter((row) => selected.includes(row.entryId));
	const label = (
		kind: AccountLinkSuggestion["kind"],
		identifierKind?: "email" | "phone",
	) => t(`pwConnectKind_${identifierKind ?? kind}`);
	const categoryOptions = [
		...new Set([
			...builtins.account,
			...data.categories
				.filter((category) => category.kind === "account" && !category.deleted)
				.map((category) => category.name),
			...rows.map((row) => row.account.category).filter(Boolean),
		]),
	];
	const accountNames = new Map(
		rows
			.flatMap((row) => [
				row.account,
				...row.identityAccounts.map((identity) => identity.account),
			])
			.map((account) => [account.id, account.name]),
	);
	useEffect(() => {
		let current = true;
		void buildAccountLinkSavePlan(
			rows.filter((row) => selected.includes(row.entryId)),
			suggestions.filter((_, index) => chosen.includes(index)),
			sourceAssets,
			sourceRelations,
			(kind, identity) => t(`pwConnectKind_${identity ?? kind}`),
		)
			.then((plan) => {
				if (current) setReplaceCount(plan.replacedRelations.length);
			})
			.catch(() => {
				if (current) setReplaceCount(0);
			});
		return () => {
			current = false;
		};
	}, [rows, selected, suggestions, chosen, sourceAssets, sourceRelations, t]);
	function select(ids: string[]) {
		setSelected(ids);
		setSuggestions([]);
		setChosen([]);
		setMessage("");
	}
	function proposeLocal() {
		const result = sharedIdentifierSuggestions(selectedRows);
		setSuggestions(result);
		setChosen(result.map((_, i) => i));
		setMessage("");
	}
	async function proposeAi() {
		if (running.current || !connection || !selectedRows.length || stale) return;
		running.current = true;
		setBusy(true);
		setMessage("");
		const controller = new AbortController();
		abort.current = controller;
		let lease: ReturnType<typeof acquireAiConnection> | undefined;
		try {
			const prompt = aiAccountLinkInput(selectedRows);
			lease = acquireAiConnection(controller.signal);
			const response = await generateAiText(lease.connection, {
				system: accountLinkSystem,
				prompt,
				json: true,
				maxOutputTokens: 5000,
				signal: lease.signal,
			});
			if (
				!active.current ||
				!lease.isCurrent() ||
				session?.getSnapshot().contentRevision !== base.current
			)
				return;
			const result = dedupeSuggestions([
				...sharedIdentifierSuggestions(selectedRows),
				...readAiAccountLinks(parseAiJson(response.text), selectedRows),
			]);
			setSuggestions(result);
			setChosen(result.flatMap((r, i) => (r.kind === "identifier" ? [i] : [])));
			setMessage("");
		} catch {
			if (active.current && !controller.signal.aborted)
				setMessage(t("pwConnectAiError"));
		} finally {
			lease?.release();
			running.current = false;
			if (active.current) setBusy(false);
		}
	}
	async function save() {
		if (
			running.current ||
			!session ||
			!selectedRows.length ||
			stale ||
			!base.current
		)
			return;
		running.current = true;
		setBusy(true);
		setMessage("");
		let savedAccounts = false;
		try {
			const repository = await localRepository();
			const current = await repository.list<Asset>("asset", true);
			const existingRelations = await repository.list<Relation>(
				"relation",
				true,
			);
			if (
				!active.current ||
				session.getSnapshot().status !== "unlocked" ||
				session.getSnapshot().contentRevision !== base.current
			)
				throw Error("stale");
			const plan = await buildAccountLinkSavePlan(
				selectedRows,
				suggestions.filter((_, i) => chosen.includes(i)),
				current,
				existingRelations,
				label,
			);
			const items: { type: EntityType; value: unknown }[] = [
				...plan.newAssets.map((value) => ({ type: "asset" as const, value })),
				...plan.newRelations.map((value) => ({
					type: "relation" as const,
					value,
				})),
			];
			if (items.length > 1000) throw Error("account-link-batch-limit");
			if (
				!active.current ||
				session.getSnapshot().contentRevision !== base.current
			)
				throw Error("stale");
			for (const update of plan.accountUpdates) {
				await repository.saveAssetIfCurrent(update.expected, update.next);
				savedAccounts = true;
			}
			if (items.length) {
				await repository.saveBatchIfAssetsCurrent(items, plan.expectedAssets);
				savedAccounts = true;
			}
			for (const update of plan.replacedRelations)
				await repository.saveRelationIfCurrent(update.expected, update.next);
			savedAccounts = true;
			await session.linkAccounts(
				selectedRows.map((row) => ({
					entryId: row.entryId,
					accountId: row.account.id,
				})),
				base.current,
			);
			if (active.current) {
				onSaved();
				onClose();
			}
		} catch (error) {
			if (active.current)
				setMessage(
					t(
						error instanceof Error &&
							error.message === "account-link-batch-limit"
							? "pwConnectBatchLimit"
							: error instanceof Error &&
									error.message === "account-link-identity-in-use"
								? "pwConnectIdentityInUse"
								: savedAccounts
									? "pwConnectPartial"
									: "pwConnectSaveError",
					),
				);
		} finally {
			running.current = false;
			if (active.current) setBusy(false);
		}
	}
	const visibleRows = rows.filter((row) =>
		[row.account.name, ...row.loginIdentifiers, row.account.url]
			.join(" ")
			.toLocaleLowerCase()
			.includes(query.trim().toLocaleLowerCase()),
	);
	return (
		<Dialog
			title={t("pwConnectTitle")}
			className="vault-connect-dialog"
			focusTitleOnOpen
			closeDisabled={busy}
			onClose={() => {
				if (!running.current) onClose();
			}}
			headerActions={
				<div className="vault-connect-toolbar">
					<Button
						size="small"
						disabled={busy || stale || rows.length > 200}
						onClick={() =>
							select(
								selected.length === rows.length
									? []
									: rows.map((row) => row.entryId),
							)
						}
					>
						{t(
							selected.length === rows.length && rows.length
								? "pwConnectClear"
								: "pwConnectSelectAll",
						)}
					</Button>
					<span className="vault-connect-count">
						{t("pwConnectSelected", { count: selected.length })}
					</span>
					<label className="vault-connect-search">
						<Search size={18} />
						<input
							type="search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							aria-label={t("pwConnectSearch")}
							placeholder={t("pwConnectSearch")}
						/>
					</label>
				</div>
			}
		>
			<div className="vault-connect-content">
				{blockedEntries.length > 0 && (
					<p className="notice" role="alert">
						{t("pwConnectBlocked", {
							count: blockedEntries.length,
							names: blockedEntries.join("、"),
						})}
					</p>
				)}
				{stale && (
					<p className="notice" role="alert">
						{t("pwConnectStale")}
					</p>
				)}
				{message && (
					<p className="notice" role="status">
						{message}
					</p>
				)}
				{loading ? (
					<p>{t("loading")}</p>
				) : (
					<>
						<div className="vault-connect-workspace">
							<section className="vault-connect-account-pane">
								<h3>{t("pwConnectAccountsHeading")}</h3>
								{!rows.length && <p>{t("pwConnectEmpty")}</p>}
								{rows.length > 0 && !visibleRows.length && (
									<p>{t("pwConnectNoResults")}</p>
								)}
								<div className="vault-connect-accounts">
									{visibleRows.map((row) => (
										<section
											className="vault-connect-account"
											key={row.entryId}
										>
											<label className="vault-connect-choice">
												<input
													type="checkbox"
													checked={selected.includes(row.entryId)}
													disabled={
														busy ||
														stale ||
														(!selected.includes(row.entryId) &&
															selected.length >= 200)
													}
													onChange={(event) =>
														select(
															event.target.checked
																? [...selected, row.entryId]
																: selected.filter((id) => id !== row.entryId),
														)
													}
												/>
												<strong>{row.account.name}</strong>
												<span className="vault-connect-primary">
													{row.loginIdentifiers[0]}
												</span>
												<small>
													{t(
														row.isNew
															? "pwConnectNew"
															: row.originalAccount &&
																	["name", "username", "url"].some(
																		(key) =>
																			row.account[
																				key as "name" | "username" | "url"
																			] !==
																			row.originalAccount?.[
																				key as "name" | "username" | "url"
																			],
																	)
																? "pwConnectUpdate"
																: "pwConnectExisting",
													)}
												</small>
											</label>
											<div className="vault-connect-details">
												<div className="vault-connect-identifiers">
													{row.loginIdentifiers.slice(1).map((value) => (
														<p key={value}>{value}</p>
													))}
												</div>
												{row.account.url && <p>{row.account.url}</p>}
												{selected.includes(row.entryId) && (
													<>
														<label
															className="field vault-connect-category"
															htmlFor={`vault-connect-category-${row.entryId}`}
														>
															<span>{t("category")}</span>
															<Select
																id={`vault-connect-category-${row.entryId}`}
																value={row.account.category || "other"}
																disabled={busy || stale}
																aria-label={`${t("category")} ${row.account.name}`}
																onValueChange={(category) => {
																	setRows((current) =>
																		current.map((item) =>
																			item.account.id === row.account.id
																				? {
																						...item,
																						account: {
																							...item.account,
																							category,
																						},
																					}
																				: item,
																		),
																	);
																	setSuggestions([]);
																	setChosen([]);
																}}
															>
																{categoryOptions.map((category) => (
																	<SelectOption key={category} value={category}>
																		{niceCategory(category, t)}
																	</SelectOption>
																))}
															</Select>
														</label>
														{row.originalAccount &&
															["name", "username", "url"].some(
																(key) =>
																	row.account[
																		key as "name" | "username" | "url"
																	] !==
																	row.originalAccount?.[
																		key as "name" | "username" | "url"
																	],
															) && (
																<small>
																	{t("pwConnectOriginal", {
																		name: row.originalAccount.name,
																		username: row.originalAccount.username,
																	})}
																</small>
															)}
														<label className="field">
															<span className="sr-only">
																{t("pwConnectHint")}
															</span>
															<textarea
																rows={1}
																maxLength={500}
																value={row.hint}
																disabled={busy}
																placeholder={t("pwConnectHintExample")}
																onChange={(event) => {
																	setRows(
																		rows.map((r) =>
																			r.entryId === row.entryId
																				? { ...r, hint: event.target.value }
																				: r,
																		),
																	);
																	setSuggestions([]);
																	setChosen([]);
																}}
															/>
														</label>
														{row.hint.length > 500 && (
															<p role="alert">{t("pwConnectNotesLong")}</p>
														)}
													</>
												)}
											</div>
										</section>
									))}
								</div>
							</section>
							<section className="vault-connect-review-pane">
								<h3 aria-live="polite">
									{t("pwConnectReview")}{" "}
									{suggestions.length > 0 && (
										<span className="vault-connect-count">
											{suggestions.length}
										</span>
									)}
								</h3>
								<div className="vault-connect-suggestions">
									{!suggestions.length && (
										<p className="vault-connect-empty">
											{t("pwConnectNoSuggestions")}
										</p>
									)}
									{suggestions.map((relation, index) => (
										<label
											className="vault-connect-suggestion"
											key={`${relation.from}:${relation.to}:${relation.kind}`}
										>
											<input
												type="checkbox"
												disabled={busy || stale}
												checked={chosen.includes(index)}
												onChange={(e) =>
													setChosen(
														e.target.checked
															? [...chosen, index]
															: chosen.filter((i) => i !== index),
													)
												}
											/>
											<span>
												<strong>
													{accountNames.get(relation.from)} →{" "}
													{accountNames.get(relation.to)}
												</strong>
												<span>
													{label(relation.kind, relation.identifierKind)}
												</span>
												{relation.evidence && (
													<small>{relation.evidence}</small>
												)}
											</span>
										</label>
									))}
								</div>
								{suggestions.length > 0 && (
									<p className="vault-connect-empty">
										{t("pwConnectIdentityHint")}
									</p>
								)}
							</section>
						</div>
						<footer className="vault-connect-footer">
							{replaceCount > 0 && (
								<p className="vault-connect-replacement" role="status">
									{t("pwConnectReplace", { count: replaceCount })}
								</p>
							)}
							<div className="vault-connect-meta">
								{connection ? (
									<span className="vault-connect-destination">
										{connection.model} · {connection.baseURL}
									</span>
								) : (
									<TextLink asChild><Link to="/settings">{t("pwConnectConfigure")}</Link></TextLink>
								)}
								<span>{t("pwConnectAiScope")}</span>
							</div>
							<div className="vault-connect-footer-actions">
								<div className="vault-connect-analysis-actions">
									<Button
										disabled={busy || stale || !selected.length}
										onClick={proposeLocal}
									>
										<Network size={16} />
										{t("pwConnectLocal")}
									</Button>
									<Button
										disabled={
											busy ||
											stale ||
											!connection ||
											!selected.length ||
											selectedRows.some((row) => row.hint.length > 500)
										}
										onClick={() => void proposeAi()}
									>
										<WandSparkles size={16} />
										{t("pwConnectAi")}
									</Button>
								</div>
								<span className="vault-connect-save-count">
									{t("pwConnectSaveHint", {
										accounts: new Set(selectedRows.map((row) => row.account.id))
											.size,
										relations: chosen.length,
									})}
								</span>
								<Button
									variant="primary"
									disabled={busy || stale || !selected.length}
									onClick={() => void save()}
								>
									<Check size={16} />
									{t(busy ? "pwConnectWorking" : "pwConnectSave")}
								</Button>
							</div>
						</footer>
					</>
				)}
			</div>
		</Dialog>
	);
}
