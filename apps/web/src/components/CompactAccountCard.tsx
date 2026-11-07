import { Link } from "@tanstack/react-router";
import { ArrowLeftRight, Check, ChevronRight, Copy, ExternalLink, Eye, EyeOff, LockKeyhole, Mail, Pencil, Plus, RefreshCw, Smartphone, Trash2, UserRound } from "lucide-react";
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { accountNotes } from "../account-entry-edit";
import type { AccountTemplate } from "../account-entry-save";
import type { Asset } from "../../../../packages/domain/src";
import { accountHttpUrl, accountLoginChoices, nextAccountLogin, preferredAccountLogin } from "../account-login-choices";
import { matchesAssetSearch } from "../asset-search";
import { niceCategory } from "../view-shared";
import type { AccountVaultTools } from "./PasswordVaultPanel";
import { usePasswordVault, type PasswordVaultEntrySummary } from "./PasswordVaultProvider";
import { Button } from "./ui/button";
import "../compact-account.css";

type Props = { onNextAccount?: () => void; accountPosition?: number; accountTotal?: number; asset: Asset; entries: PasswordVaultEntrySummary[]; connectionCount: number; queries: string[]; focusEntryId?: string; tools: AccountVaultTools; onOpen: () => void; onCreate: (template: AccountTemplate, triggerId: string) => void; onEdit: (asset: Asset, entryId?: string, triggerId?: string) => void; onDeleteAccount: (asset: Asset) => void; virtual?: boolean };

function CompactIcon({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
	return <Button type="button" variant="ghost" size="icon" className="compact-account-icon" aria-label={label} title={label} {...props}>{children}</Button>;
}

function Frame({ asset, connectionCount, onOpen, onEdit, onCreate, onDelete, url, children, entryId, createId, editId, busy, virtual, onNextAccount, accountPosition = 1, accountTotal = 1 }: Pick<Props, "asset" | "connectionCount" | "onOpen" | "virtual"> & { onEdit: () => void; onCreate: () => void; onDelete: () => void; editId?: string; createId?: string; busy: boolean; onNextAccount?: () => void; accountPosition?: number; accountTotal?: number; url: string; children: ReactNode; entryId?: string }) {
	const { t } = useTranslation();
	const Icon = asset.category === "email" ? Mail : asset.category === "phone" ? Smartphone : UserRound;
	const details = virtual
        ? { to: "/accounts" as const, hash: `login-detail-${entryId}`, onClick: onOpen }
        : { to: "/assets/$kind/$id" as const, params: { kind: asset.kind, id: asset.id }, hash: entryId ? `password-${entryId}` : undefined, onClick: onOpen };
	return <article className={`unified-account asset-account-card compact-account-card asset-account-${asset.category}`} data-account-id={asset.id} data-private-only={virtual ? "true" : undefined} data-entry-id={entryId} aria-label={asset.name} tabIndex={-1}>
		<header className="compact-account-heading"><span className="compact-account-avatar"><Icon size={18} /></span>
			<Link {...details} className="compact-account-title-block" aria-label={asset.name} title={asset.name}><span className="compact-account-title">{asset.name}</span><span className="compact-account-associations" aria-hidden="true">{t("accountConnectionCount", { count: connectionCount })}<ChevronRight size={11} /></span></Link>
			{url && <a className="compact-account-icon compact-account-url" href={url} target="_blank" rel="noreferrer" aria-label={t("compactAccountOpenUrl")} title={`${t("compactAccountOpenUrl")} · ${url}`}><ExternalLink size={16} /></a>}
		</header>
		{children}
        <footer className="compact-account-footer"><span className="compact-account-meta" title={[niceCategory(asset.category || "other", t), ...asset.tags].join(" · ")}>{[niceCategory(asset.category || "other", t), ...asset.tags].join(" · ")}</span><span className="compact-account-actions"><CompactIcon id={createId} label={t("add")} disabled={busy} onClick={onCreate}><Plus size={16} /></CompactIcon><CompactIcon id={editId} label={t("edit")} disabled={busy} onClick={onEdit}><Pencil size={16} /></CompactIcon><CompactIcon label={t("accountDeleteAccountTitle")} disabled={busy} onClick={onDelete}><Trash2 size={16} /></CompactIcon><CompactIcon data-account-switch label={t("compactAccountNextAccount", { index: accountPosition, total: accountTotal })} disabled={busy || accountTotal < 2 || !onNextAccount} onClick={onNextAccount}><RefreshCw size={16} /></CompactIcon></span></footer>
	</article>;
}

function ValueRow({ label, children, actions }: { label: string; children: ReactNode; actions: ReactNode }) {
	return <div className="compact-account-row"><span className="compact-account-label">{label}</span><span className="compact-account-value">{children}</span><span className="compact-account-actions">{actions}</span></div>;
}

function LockedCard({ asset, connectionCount, onOpen, tools, onEdit, onDeleteAccount }: Props) {
	const { t } = useTranslation();
	const { snapshot } = usePasswordVault();
	const loading = snapshot.status === "loading", empty = snapshot.status === "empty", url = accountHttpUrl(asset.url);
	const [copied, setCopied] = useState(false);
	return <Frame asset={asset} connectionCount={connectionCount} onOpen={onOpen} onCreate={tools.requestAccess} onEdit={() => onEdit(asset)} onDelete={() => onDeleteAccount(asset)} busy={tools.busy || loading} url={url}>
		<ValueRow label={t("pwVaultAccountShort")} actions={<CompactIcon label={t("pwVaultCopyUsername")} disabled={!asset.username || tools.busy} onClick={() => void tools.copy("pwVaultUsernameField", asset.username, false).then((success) => setCopied(success))}>{copied ? <Check size={16} /> : <Copy size={16} />}</CompactIcon>}><span title={asset.username}>{asset.username || t("pwVaultValueEmpty")}</span></ValueRow>
		<ValueRow label={t("pwVaultPasswordField")} actions={<Button type="button" className="compact-account-access" size="small" disabled={tools.busy || loading} onClick={tools.requestAccess}>{t(loading ? "loading" : empty ? "compactAccountCreate" : "compactAccountUnlock")}</Button>}><span className="compact-account-muted"><LockKeyhole size={13} />{t(loading ? "loading" : empty ? "pwVaultStatusEmpty" : "pwVaultStatusLocked")}</span></ValueRow>
		<ValueRow label={t("pwVaultNotesField")} actions={<CompactIcon label={t("compactAccountCopyNotes")} disabled><Copy size={16} /></CompactIcon>}><span className="compact-account-muted">{t("pwVaultStatusLocked")}</span></ValueRow>
	</Frame>;
}

function UnlockedCard({ asset, entries, connectionCount, onOpen, tools, queries, focusEntryId, onCreate, onEdit, onDeleteAccount, virtual, onNextAccount, accountPosition, accountTotal }: Props) {
	const { t } = useTranslation();
	const createId = useId(), editId = useId();
	const { session, snapshot } = usePasswordVault();
	const queryKey = JSON.stringify(queries);
	const [selection, setSelection] = useState({ key: "", queryKey });
	const choices = accountLoginChoices(entries);
	const current = preferredAccountLogin(choices, selection.queryKey === queryKey ? selection.key : "", queries, focusEntryId, (query) => matchesAssetSearch(asset, query));
	const [revealedKey, setRevealedKey] = useState("");
	const [copied, setCopied] = useState("");
	const generation = useRef(0);
	useEffect(() => () => { generation.current++; tools.cancelCopy(); }, [tools.cancelCopy]);
	const scope = current ? `${current.key}:${current.entry.modifiedAt}` : "";
	const live = session?.getSnapshot().status === "unlocked";
	const draft = current && live ? session.readEntry(current.entry.id) : null;
	const username = current?.username ?? asset.username;
	const url = accountHttpUrl(current?.entry.url || asset.url);
	const rawNotes = accountNotes(asset, draft?.notes);
	const notes = rawNotes.trim() ? rawNotes : "";
	const hasPassword = Boolean(draft?.password);
	const reveal = Boolean(scope && revealedKey === scope);
	const position = Math.max(0, choices.findIndex((choice) => choice.key === current?.key)) + 1;

	async function copy(label: string, value: string, field: string, privateValue = true) {
		const request = ++generation.current;
		const success = await tools.copy(label, value, privateValue);
		if (request === generation.current && session?.getSnapshot().status === "unlocked") setCopied(success ? `${scope}:${field}` : "");
	}
	function advance() {
		if (!current || choices.length < 2 || tools.busy) return;
		generation.current++;
		tools.cancelCopy();
		setRevealedKey(""); setCopied("");
		setSelection({ key: nextAccountLogin(choices, current.key)?.key ?? "", queryKey });
	}
	const copiedIcon = (field: string) => copied === `${scope}:${field}` ? <Check size={16} /> : <Copy size={16} />;
	return <Frame asset={{ ...asset, name: current?.entry.title ?? asset.name }} connectionCount={connectionCount} onOpen={onOpen} onCreate={() => onCreate({ ...asset, name: current?.entry.title ?? asset.name, url: current?.entry.url || asset.url, sourceEntryId: current?.entry.id, ...(!virtual ? { sourceCardId: asset.id } : {}) }, createId)} onEdit={() => onEdit(asset, current?.entry.id, editId)} onDelete={() => onDeleteAccount(asset)} busy={tools.busy} virtual={virtual} url={url} entryId={current?.entry.id} createId={createId} editId={editId} onNextAccount={onNextAccount} accountPosition={accountPosition} accountTotal={accountTotal}>
		<ValueRow label={t("pwVaultAccountShort")} actions={<>
			{choices.length > 1 && <CompactIcon label={t("compactAccountNextLogin", { index: position, total: choices.length })} disabled={tools.busy} onClick={advance} className="compact-account-icon compact-account-switch"><ArrowLeftRight size={16} /><small aria-hidden="true">{position}/{choices.length}</small></CompactIcon>}
			<CompactIcon label={t("pwVaultCopyUsername")} disabled={tools.busy || !username} onClick={() => void copy("pwVaultUsernameField", username, "username", Boolean(current))}>{copiedIcon("username")}</CompactIcon>
		</>}><span title={username} aria-live={choices.length > 1 ? "polite" : undefined} data-login-username>{username || t("pwVaultValueEmpty")}</span></ValueRow>
		<ValueRow label={t("pwVaultPasswordField")} actions={hasPassword ? <>
			<CompactIcon label={t(reveal ? "pwVaultHidePasswordValue" : "pwVaultRevealPassword")} aria-pressed={reveal} disabled={tools.busy} onClick={() => setRevealedKey(reveal ? "" : scope)}>{reveal ? <EyeOff size={16} /> : <Eye size={16} />}</CompactIcon>
			<CompactIcon label={t("pwVaultCopyPassword")} disabled={tools.busy} onClick={() => { if (current && session?.getSnapshot().status === "unlocked") void copy("pwVaultPasswordField", session.readEntry(current.entry.id).password, "password"); }}>{copiedIcon("password")}</CompactIcon>
		</> : <CompactIcon label={t("compactAccountAddPassword")} disabled={tools.busy} onClick={() => onEdit(asset, current?.entry.id, editId)}><Plus size={16} /></CompactIcon>}><span className={hasPassword ? "compact-account-secret" : "compact-account-muted"} data-login-password>{hasPassword ? reveal ? draft?.password : "••••••••••" : t("pwVaultNoPassword")}</span></ValueRow>
		<ValueRow label={t("pwVaultNotesField")} actions={<CompactIcon label={t("compactAccountCopyNotes")} disabled={tools.busy || !notes} onClick={() => void copy("pwVaultNotesField", notes, "notes")}>{copiedIcon("notes")}</CompactIcon>}><span title={notes || undefined} className={notes ? undefined : "compact-account-muted"} data-login-notes>{notes || t("compactAccountNoNotes")}</span></ValueRow>
	</Frame>;
}

export function CompactAccountCard(props: Props) {
	const { snapshot } = usePasswordVault();
	// Switching branches unmounts every reveal/selection/dialog state on lock.
	return snapshot.status === "unlocked" ? <UnlockedCard key={JSON.stringify([props.queries, props.focusEntryId])} {...props} /> : <LockedCard {...props} />;
}
