import { Link } from "@tanstack/react-router";
import { ArrowLeftRight, Check, ChevronRight, Copy, ExternalLink, Eye, EyeOff, LockKeyhole, Mail, MoreHorizontal, Pencil, Plus, Smartphone, Trash2, UserRound } from "lucide-react";
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Asset } from "../../../../packages/domain/src";
import { accountHttpUrl, accountLoginChoices, nextAccountLogin, preferredAccountLogin } from "../account-login-choices";
import { matchesAssetSearch } from "../asset-search";
import { niceCategory } from "../view-shared";
import type { AccountVaultTools } from "./PasswordVaultPanel";
import { usePasswordVault, type PasswordVaultEntrySummary } from "./PasswordVaultProvider";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import "../compact-account.css";

type Props = { asset: Asset; entries: PasswordVaultEntrySummary[]; connectionCount: number; queries: string[]; focusEntryId?: string; tools: AccountVaultTools; onOpen: () => void; onEdit: (asset: Asset, entryId?: string, triggerId?: string, newLogin?: boolean) => void; onDeleteAccount: (asset: Asset) => void; virtual?: boolean };

function CompactIcon({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
	return <Button type="button" variant="ghost" size="icon" className="compact-account-icon" aria-label={label} title={label} {...props}>{children}</Button>;
}

function Frame({ asset, connectionCount, onOpen, onEdit, onDelete, url, menu, children, entryId, menuId, editId, busy, virtual }: Pick<Props, "asset" | "connectionCount" | "onOpen" | "virtual"> & { onEdit: () => void; onDelete: () => void; editId?: string; busy: boolean; url: string; menu: ReactNode; children: ReactNode; entryId?: string; menuId?: string }) {
	const { t } = useTranslation();
	const Icon = asset.category === "email" ? Mail : asset.category === "phone" ? Smartphone : UserRound;
	const details = { to: "/assets/$kind/$id" as const, params: { kind: asset.kind, id: asset.id }, onClick: onOpen };
	return <article className={`unified-account asset-account-card compact-account-card asset-account-${asset.category}`} data-account-id={asset.id} data-private-only={virtual ? "true" : undefined} data-entry-id={entryId} aria-label={asset.name} tabIndex={-1}>
		<header className="compact-account-heading"><span className="compact-account-avatar"><Icon size={18} /></span>
			<button type="button" className="compact-account-title" title={asset.name} onClick={onEdit}>{asset.name}</button>
			{url && <a className="compact-account-icon compact-account-url" href={url} target="_blank" rel="noreferrer" aria-label={t("compactAccountOpenUrl")} title={`${t("compactAccountOpenUrl")} · ${url}`}><ExternalLink size={16} /></a>}
            <CompactIcon id={editId} label={t("edit")} disabled={busy} onClick={onEdit}><Pencil size={16} /></CompactIcon>
            <CompactIcon label={t(entryId ? "accountDeleteLogin" : "pwVaultDeleteEntry")} disabled={busy} onClick={onDelete}><Trash2 size={16} /></CompactIcon>
		</header>
		{children}
        <footer className="compact-account-footer"><span className="compact-account-meta" title={[niceCategory(asset.category || "other", t), ...asset.tags].join(" · ")}>{[niceCategory(asset.category || "other", t), ...asset.tags].join(" · ")}</span>{!virtual && <Link {...details} hash="account-relations">{t("accountConnectionCount", { count: connectionCount })}<ChevronRight size={12} /></Link>}<DropdownMenu><DropdownMenuTrigger render={<Button id={menuId} variant="ghost" size="icon" className="compact-account-icon" aria-label={t("moreActions")} title={t("moreActions")} />}><MoreHorizontal size={17} /></DropdownMenuTrigger><DropdownMenuContent align="end">{menu}{!virtual && <DropdownMenuItem render={<Link {...details} />}>{t("accountViewRelations")}</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu></footer>
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
	const access = t(empty ? "pwVaultCreate" : "pwVaultUnlock");
	return <Frame asset={asset} connectionCount={connectionCount} onOpen={onOpen} onEdit={() => onEdit(asset)} onDelete={() => onDeleteAccount(asset)} busy={tools.busy} url={url} menu={<>{url && <DropdownMenuItem onClick={() => void tools.copy("pwVaultUrlField", url, false)}>{t("compactAccountCopyUrl")}</DropdownMenuItem>}<DropdownMenuItem disabled={tools.busy || loading} onClick={tools.requestAccess}>{access}</DropdownMenuItem></>}>
		<ValueRow label={t("pwVaultAccountShort")} actions={<CompactIcon label={t("pwVaultCopyUsername")} disabled={!asset.username || tools.busy} onClick={() => void tools.copy("pwVaultUsernameField", asset.username, false).then((success) => setCopied(success))}>{copied ? <Check size={16} /> : <Copy size={16} />}</CompactIcon>}><span title={asset.username}>{asset.username || t("pwVaultValueEmpty")}</span></ValueRow>
		<ValueRow label={t("pwVaultPasswordField")} actions={<Button type="button" className="compact-account-access" size="small" disabled={tools.busy || loading} onClick={tools.requestAccess}>{t(loading ? "loading" : empty ? "compactAccountCreate" : "compactAccountUnlock")}</Button>}><span className="compact-account-muted"><LockKeyhole size={13} />{t(loading ? "loading" : empty ? "pwVaultStatusEmpty" : "pwVaultStatusLocked")}</span></ValueRow>
	</Frame>;
}

function UnlockedCard({ asset, entries, connectionCount, onOpen, tools, queries, focusEntryId, onEdit, onDeleteAccount, virtual }: Props) {
	const { t } = useTranslation();
	const menuId = useId(), editId = useId();
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
	return <Frame asset={{ ...asset, name: current?.entry.title ?? asset.name }} connectionCount={connectionCount} onOpen={onOpen} onEdit={() => onEdit(asset, current?.entry.id, editId)} onDelete={() => current ? tools.deleteLogin(current.entry, username, virtual ? undefined : asset.id) : onDeleteAccount(asset)} busy={tools.busy} virtual={virtual} url={url} entryId={current?.entry.id} menuId={menuId} editId={editId} menu={<>
		{current && <DropdownMenuItem disabled={tools.busy} onClick={() => tools.history(current.entry)}>{t("pwVaultHistory")}</DropdownMenuItem>}
		<DropdownMenuItem disabled={tools.busy} onClick={() => onEdit(asset, undefined, editId, true)}>{t("pwVaultNewEntry")}</DropdownMenuItem>
		{current && !virtual && <DropdownMenuItem disabled={tools.busy} onClick={() => tools.unlink(current.entry, asset)}>{t("pwVaultUnlink")}</DropdownMenuItem>}
		{url && <DropdownMenuItem disabled={tools.busy} onClick={() => void copy("pwVaultUrlField", url, "url", Boolean(current))}>{t("compactAccountCopyUrl")}</DropdownMenuItem>}
	</>}>
		<ValueRow label={t("pwVaultAccountShort")} actions={<>
			{choices.length > 1 && <CompactIcon label={t("compactAccountNextLogin", { index: position, total: choices.length })} disabled={tools.busy} onClick={advance} className="compact-account-icon compact-account-switch"><ArrowLeftRight size={16} /><small aria-hidden="true">{position}/{choices.length}</small></CompactIcon>}
			<CompactIcon label={t("pwVaultCopyUsername")} disabled={tools.busy || !username} onClick={() => void copy("pwVaultUsernameField", username, "username", Boolean(current))}>{copiedIcon("username")}</CompactIcon>
		</>}><span title={username} data-login-username>{username || t("pwVaultValueEmpty")}</span></ValueRow>
		<ValueRow label={t("pwVaultPasswordField")} actions={hasPassword ? <>
			<CompactIcon label={t(reveal ? "pwVaultHidePasswordValue" : "pwVaultRevealPassword")} aria-pressed={reveal} disabled={tools.busy} onClick={() => setRevealedKey(reveal ? "" : scope)}>{reveal ? <EyeOff size={16} /> : <Eye size={16} />}</CompactIcon>
			<CompactIcon label={t("pwVaultCopyPassword")} disabled={tools.busy} onClick={() => { if (current && session?.getSnapshot().status === "unlocked") void copy("pwVaultPasswordField", session.readEntry(current.entry.id).password, "password"); }}>{copiedIcon("password")}</CompactIcon>
		</> : <Button type="button" size="small" className="compact-account-access" disabled={tools.busy} onClick={() => onEdit(asset, current?.entry.id, editId)}><Plus size={13} />{t("compactAccountAddPassword")}</Button>}><span className={hasPassword ? "compact-account-secret" : "compact-account-muted"} data-login-password>{hasPassword ? reveal ? draft?.password : "••••••••••" : t("pwVaultNoPassword")}</span></ValueRow>
		<span className="sr-only" role="status">{current && choices.length > 1 ? t("compactAccountLoginPosition", { index: position, total: choices.length, username }) : ""}</span>
	</Frame>;
}

export function CompactAccountCard(props: Props) {
	const { snapshot } = usePasswordVault();
	// Switching branches unmounts every reveal/selection/dialog state on lock.
	return snapshot.status === "unlocked" ? <UnlockedCard key={JSON.stringify([props.queries, props.focusEntryId])} {...props} /> : <LockedCard {...props} />;
}
