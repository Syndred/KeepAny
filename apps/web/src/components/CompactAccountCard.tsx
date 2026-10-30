import { Link } from "@tanstack/react-router";
import { ArrowLeftRight, Check, ChevronRight, Copy, ExternalLink, Eye, EyeOff, LockKeyhole, Mail, MoreHorizontal, Plus, Smartphone, UserRound } from "lucide-react";
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Asset } from "../../../../packages/domain/src";
import { accountHttpUrl, accountLoginChoices, nextAccountLogin, preferredAccountLogin } from "../account-login-choices";
import { matchesAssetSearch } from "../asset-search";
import { niceCategory } from "../view-shared";
import type { AccountVaultTools } from "./PasswordVaultPanel";
import { usePasswordVault, type PasswordVaultEntrySummary } from "./PasswordVaultProvider";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import "../compact-account.css";

type Props = { asset: Asset; entries: PasswordVaultEntrySummary[]; connectionCount: number; queries: string[]; focusEntryId?: string; tools: AccountVaultTools; onOpen: () => void };

function CompactIcon({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
	return <Button type="button" variant="ghost" size="icon" className="compact-account-icon" aria-label={label} title={label} {...props}>{children}</Button>;
}

function Frame({ asset, connectionCount, onOpen, url, menu, children, entryId, menuId }: Pick<Props, "asset" | "connectionCount" | "onOpen"> & { url: string; menu: ReactNode; children: ReactNode; entryId?: string; menuId?: string }) {
	const { t } = useTranslation();
	const Icon = asset.category === "email" ? Mail : asset.category === "phone" ? Smartphone : UserRound;
	const details = { to: "/assets/$kind/$id" as const, params: { kind: asset.kind, id: asset.id }, onClick: onOpen };
	return <article className={`unified-account asset-account-card compact-account-card asset-account-${asset.category}`} data-account-id={asset.id} data-entry-id={entryId} aria-label={asset.name} tabIndex={-1}>
		<header className="compact-account-heading"><span className="compact-account-avatar"><Icon size={18} /></span>
			<Link {...details} className="compact-account-title" title={asset.name}>{asset.name}</Link>
			{url && <a className="compact-account-icon compact-account-url" href={url} target="_blank" rel="noreferrer" aria-label={t("compactAccountOpenUrl")} title={`${t("compactAccountOpenUrl")} · ${url}`}><ExternalLink size={16} /></a>}
			<DropdownMenu><DropdownMenuTrigger render={<Button id={menuId} variant="ghost" size="icon" className="compact-account-icon" aria-label={t("moreActions")} title={t("moreActions")} />}><MoreHorizontal size={17} /></DropdownMenuTrigger><DropdownMenuContent align="end">{menu}<DropdownMenuItem render={<Link {...details} />}>{t("compactAccountProfile")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
		</header>
		{children}
		<footer className="compact-account-footer"><span className="compact-account-meta" title={[niceCategory(asset.category || "other", t), ...asset.tags].join(" · ")}><span>{[niceCategory(asset.category || "other", t), ...asset.tags].join(" · ")}</span><span aria-hidden="true">·</span><Link {...details} hash="account-relations">{t("accountConnectionCount", { count: connectionCount })}</Link></span><Link {...details}>{t("compactAccountDetails")}<ChevronRight size={12} /></Link></footer>
	</article>;
}

function ValueRow({ label, children, actions }: { label: string; children: ReactNode; actions: ReactNode }) {
	return <div className="compact-account-row"><span className="compact-account-label">{label}</span><span className="compact-account-value">{children}</span><span className="compact-account-actions">{actions}</span></div>;
}

function LockedCard({ asset, connectionCount, onOpen, tools }: Props) {
	const { t } = useTranslation();
	const { snapshot } = usePasswordVault();
	const loading = snapshot.status === "loading", empty = snapshot.status === "empty", url = accountHttpUrl(asset.url);
	const [copied, setCopied] = useState(false);
	const access = t(empty ? "pwVaultCreate" : "pwVaultUnlock");
	return <Frame asset={asset} connectionCount={connectionCount} onOpen={onOpen} url={url} menu={<>{url && <DropdownMenuItem onClick={() => void tools.copy("pwVaultUrlField", url, false)}>{t("compactAccountCopyUrl")}</DropdownMenuItem>}<DropdownMenuItem disabled={tools.busy || loading} onClick={tools.requestAccess}>{access}</DropdownMenuItem></>}>
		<ValueRow label={t("pwVaultAccountShort")} actions={<CompactIcon label={t("pwVaultCopyUsername")} disabled={!asset.username || tools.busy} onClick={() => void tools.copy("pwVaultUsernameField", asset.username, false).then((success) => setCopied(success))}>{copied ? <Check size={16} /> : <Copy size={16} />}</CompactIcon>}><span title={asset.username}>{asset.username || t("pwVaultValueEmpty")}</span></ValueRow>
		<ValueRow label={t("pwVaultPasswordField")} actions={<Button type="button" className="compact-account-access" size="small" disabled={tools.busy || loading} onClick={tools.requestAccess}>{t(loading ? "loading" : empty ? "compactAccountCreate" : "compactAccountUnlock")}</Button>}><span className="compact-account-muted"><LockKeyhole size={13} />{t(loading ? "loading" : empty ? "pwVaultStatusEmpty" : "pwVaultStatusLocked")}</span></ValueRow>
	</Frame>;
}

function UnlockedCard({ asset, entries, connectionCount, onOpen, tools, queries, focusEntryId }: Props) {
	const { t } = useTranslation();
	const menuId = useId();
	const { session, snapshot } = usePasswordVault();
	const queryKey = JSON.stringify(queries);
	const [selection, setSelection] = useState({ key: "", queryKey });
	const choices = accountLoginChoices(entries);
	const current = preferredAccountLogin(choices, selection.queryKey === queryKey ? selection.key : "", queries, focusEntryId, (query) => matchesAssetSearch(asset, query));
	const [revealedKey, setRevealedKey] = useState("");
	const [copied, setCopied] = useState("");
	const [detailsEntryId, setDetailsEntryId] = useState("");
	const generation = useRef(0);
	useEffect(() => () => { generation.current++; tools.cancelCopy(); }, [tools.cancelCopy]);
	const scope = current ? `${current.key}:${current.entry.modifiedAt}` : "";
	const detailsScope = current ? `${current.entry.id}:${snapshot.contentRevision}` : "";
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
		setRevealedKey(""); setCopied(""); setDetailsEntryId("");
		setSelection({ key: nextAccountLogin(choices, current.key)?.key ?? "", queryKey });
	}
	const copiedIcon = (field: string) => copied === `${scope}:${field}` ? <Check size={16} /> : <Copy size={16} />;
	return <Frame asset={asset} connectionCount={connectionCount} onOpen={onOpen} url={url} entryId={current?.entry.id} menuId={menuId} menu={<>
		{current && <DropdownMenuItem disabled={tools.busy} onClick={() => setDetailsEntryId(detailsScope)}>{t("compactAccountLoginDetails")}</DropdownMenuItem>}
		<DropdownMenuItem disabled={tools.busy} onClick={() => tools.addEntry(asset.id)}>{t("pwVaultNewEntry")}</DropdownMenuItem>
		{url && <DropdownMenuItem disabled={tools.busy} onClick={() => void copy("pwVaultUrlField", url, "url", Boolean(current))}>{t("compactAccountCopyUrl")}</DropdownMenuItem>}
	</>}>
		<ValueRow label={t("pwVaultAccountShort")} actions={<>
			{choices.length > 1 && <CompactIcon label={t("compactAccountNextLogin", { index: position, total: choices.length })} disabled={tools.busy} onClick={advance} className="compact-account-icon compact-account-switch"><ArrowLeftRight size={16} /><small aria-hidden="true">{position}/{choices.length}</small></CompactIcon>}
			<CompactIcon label={t("pwVaultCopyUsername")} disabled={tools.busy || !username} onClick={() => void copy("pwVaultUsernameField", username, "username", Boolean(current))}>{copiedIcon("username")}</CompactIcon>
		</>}><span title={username} data-login-username>{username || t("pwVaultValueEmpty")}</span></ValueRow>
		<ValueRow label={t("pwVaultPasswordField")} actions={hasPassword ? <>
			<CompactIcon label={t(reveal ? "pwVaultHidePasswordValue" : "pwVaultRevealPassword")} aria-pressed={reveal} disabled={tools.busy} onClick={() => setRevealedKey(reveal ? "" : scope)}>{reveal ? <EyeOff size={16} /> : <Eye size={16} />}</CompactIcon>
			<CompactIcon label={t("pwVaultCopyPassword")} disabled={tools.busy} onClick={() => { if (current && session?.getSnapshot().status === "unlocked") void copy("pwVaultPasswordField", session.readEntry(current.entry.id).password, "password"); }}>{copiedIcon("password")}</CompactIcon>
		</> : <Button type="button" size="small" className="compact-account-access" disabled={tools.busy} onClick={() => tools.addEntry(asset.id)}><Plus size={13} />{t("compactAccountAddPassword")}</Button>}><span className={hasPassword ? "compact-account-secret" : "compact-account-muted"} data-login-password>{hasPassword ? reveal ? draft?.password : "••••••••••" : t("pwVaultNoPassword")}</span></ValueRow>
		<span className="sr-only" role="status">{current && choices.length > 1 ? t("compactAccountLoginPosition", { index: position, total: choices.length, username }) : ""}</span>
		{current && detailsEntryId === detailsScope && <Dialog title={t("compactAccountLoginDetails")} className="compact-account-entry-dialog" returnFocusTo={() => document.getElementById(menuId)} onClose={() => setDetailsEntryId("")}><div className="password-vault-entry-list">{tools.renderEntry(current.entry)}</div></Dialog>}
	</Frame>;
}

export function CompactAccountCard(props: Props) {
	const { snapshot } = usePasswordVault();
	// Switching branches unmounts every reveal/selection/dialog state on lock.
	return snapshot.status === "unlocked" ? <UnlockedCard key={JSON.stringify([props.queries, props.focusEntryId])} {...props} /> : <LockedCard {...props} />;
}
