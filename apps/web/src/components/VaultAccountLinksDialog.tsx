import { Link } from "@tanstack/react-router";
import { Network, WandSparkles } from "lucide-react";
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
	accountLinkRelations,
	accountLinkSystem,
	aiAccountLinkInput,
	buildAccountLinkRows,
	dedupeSuggestions,
	readAiAccountLinks,
	sharedIdentifierSuggestions,
	type AccountLinkRow,
	type AccountLinkSuggestion,
} from "../vault-account-links";
import { usePasswordVault } from "./PasswordVaultProvider";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

export function VaultAccountLinksDialog({
	onClose,
	onSaved,
}: {
	onClose: () => void;
	onSaved: () => void;
}) {
	const { t } = useTranslation();
	const { session, snapshot } = usePasswordVault();
	const { connection } = useAiConnection();
	const base = useRef(snapshot.contentRevision);
	const [rows, setRows] = useState<AccountLinkRow[]>([]);
	const [selected, setSelected] = useState<string[]>([]);
	const [suggestions, setSuggestions] = useState<AccountLinkSuggestion[]>([]);
	const [chosen, setChosen] = useState<number[]>([]);
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
			const result = await buildAccountLinkRows(entries, assets, notes);
			if (active.current) setRows(result);
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
	const label = (kind: AccountLinkSuggestion["kind"]) =>
		t(`pwConnectKind_${kind}`);
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
		setMessage(t("pwConnectFound", { count: result.length }));
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
			setMessage(t("pwConnectFound", { count: result.length }));
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
			const expected: Asset[] = [],
				items: { type: EntityType; value: unknown }[] = [];
			const seen = new Set<string>();
			for (const row of selectedRows) {
				if (seen.has(row.account.id)) continue;
				seen.add(row.account.id);
				const found = current.find((a) => a.id === row.account.id);
				if (found) {
					if (
						found.deleted ||
						found.kind !== "account" ||
						found.name !== row.account.name ||
						found.username !== row.account.username ||
						found.url !== row.account.url
					)
						throw Error("stale");
					expected.push(found);
				} else {
					if (!row.isNew) throw Error("stale");
					items.push({ type: "asset", value: row.account });
				}
			}
			const relations = await accountLinkRelations(
				suggestions.filter((_, i) => chosen.includes(i)),
				existingRelations,
				label,
			);
			items.push(
				...relations.map((value) => ({ type: "relation" as const, value })),
			);
			if (
				!active.current ||
				session.getSnapshot().contentRevision !== base.current
			)
				throw Error("stale");
			if (items.length)
				await repository.saveBatchIfAssetsCurrent(items, expected);
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
		} catch {
			if (active.current)
				setMessage(
					t(savedAccounts ? "pwConnectPartial" : "pwConnectSaveError"),
				);
		} finally {
			running.current = false;
			if (active.current) setBusy(false);
		}
	}
	return (
		<Dialog
			title={t("pwConnectTitle")}
			className="vault-connect-dialog"
			closeDisabled={busy}
			onClose={() => {
				if (!running.current) onClose();
			}}
		>
			<div className="vault-connect-content">
				<p>{t("pwConnectIntro")}</p>
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
						<div className="actions">
							<Button
								size="small"
								disabled={busy || stale || rows.length > 200}
								onClick={() => select(rows.map((r) => r.entryId))}
							>
								{t("pwConnectSelectAll")}
							</Button>
							<Button
								size="small"
								variant="ghost"
								disabled={busy}
								onClick={() => select([])}
							>
								{t("pwConnectClear")}
							</Button>
							<span>{t("pwConnectSelected", { count: selected.length })}</span>
						</div>
						{!rows.length && <p>{t("pwConnectEmpty")}</p>}
						<div className="vault-connect-accounts">
							{rows.map((row) => (
								<section className="vault-connect-account" key={row.entryId}>
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
										<small>
											{t(row.isNew ? "pwConnectNew" : "pwConnectExisting")}
										</small>
									</label>
									<div className="vault-connect-identifiers">
										{row.loginIdentifiers.map((value) => (
											<p key={value}>{value}</p>
										))}
									</div>
									{row.account.url && <p>{row.account.url}</p>}
									{selected.includes(row.entryId) && (
										<>
											<label className="field">
												<span>{t("pwConnectHint")}</span>
												<textarea
													rows={2}
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
								</section>
							))}
						</div>
						<div className="actions">
							<Button
								disabled={busy || stale || !selected.length}
								onClick={proposeLocal}
							>
								<Network size={16} />
								{t("pwConnectLocal")}
							</Button>
						</div>
						<section className="vault-connect-ai">
							<h3>{t("pwConnectAiTitle")}</h3>
							<p>{t("pwConnectAiScope")}</p>
							{connection ? (
								<p className="vault-connect-destination">
									{connection.model} · {connection.baseURL}
								</p>
							) : (
								<Link to="/settings">{t("pwConnectConfigure")}</Link>
							)}
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
						</section>
						{suggestions.length > 0 && (
							<section className="vault-connect-suggestions">
								<h3>{t("pwConnectReview")}</h3>
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
												{
													rows.find((r) => r.account.id === relation.from)
														?.account.name
												}{" "}
												→{" "}
												{
													rows.find((r) => r.account.id === relation.to)
														?.account.name
												}
											</strong>
											<span>{label(relation.kind)}</span>
											{relation.evidence && <small>{relation.evidence}</small>}
										</span>
									</label>
								))}
							</section>
						)}
						<p>
							{t("pwConnectSaveHint", {
								accounts: new Set(selectedRows.map((row) => row.account.id))
									.size,
								relations: chosen.length,
							})}
						</p>
						<div className="actions">
							<Button
								disabled={busy || stale || !selected.length}
								onClick={() => void save()}
							>
								{t(busy ? "pwConnectWorking" : "pwConnectSave")}
							</Button>
						</div>
					</>
				)}
			</div>
		</Dialog>
	);
}
