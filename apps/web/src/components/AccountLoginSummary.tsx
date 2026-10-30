import { ArrowLeftRight, Check, Copy, ExternalLink, Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Asset } from "../../../../packages/domain/src";
import { accountNotes } from "../account-entry-edit";
import { accountHttpUrl, type AccountLoginChoice } from "../account-login-choices";
import { useAppContext } from "../view-shared";
import { usePasswordVault } from "./PasswordVaultProvider";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Textarea } from "./ui/textarea";

export function AccountLoginSummary({ asset, current, total, index, onSwitch, onEdit }: {
    asset: Asset; current?: AccountLoginChoice; total: number; index: number; onSwitch: () => void; onEdit: () => void;
}) {
    const { t } = useTranslation(), { notify } = useAppContext();
    const { session, snapshot } = usePasswordVault();
    const [revealed, setRevealed] = useState(false), [copied, setCopied] = useState("");
    const [manual, setManual] = useState<{ label: string; value: string } | null>(null);
    const generation = useRef(0);
    useEffect(() => () => { generation.current++; }, []);
    const unlocked = snapshot.status === "unlocked" && session?.getSnapshot().status === "unlocked";
    const entry = current && unlocked ? session.readEntry(current.entry.id) : null;
    const username = current?.username ?? asset.username;
    const url = accountHttpUrl(entry?.url || asset.url);
    const notes = accountNotes(asset, entry?.notes);
    async function copy(field: string, value: string) {
        if (!value || session?.getSnapshot().status !== "unlocked") return;
        const request = ++generation.current;
        try {
            if (!navigator.clipboard?.writeText) throw Error("clipboard");
            await navigator.clipboard.writeText(value);
            if (request !== generation.current || session.getSnapshot().status !== "unlocked") return;
            setCopied(field); notify(t("pwVaultCopied"));
        } catch {
            if (request === generation.current && session.getSnapshot().status === "unlocked") setManual({ label: t(field), value });
        }
    }
    const copyButton = (field: string, value: string, label: string) => <Button type="button" size="icon" variant="ghost" aria-label={t(label)} title={t(label)} disabled={!value} onClick={() => void copy(field, value)}>{copied === field ? <Check size={18} /> : <Copy size={18} />}</Button>;
    if (!unlocked) return null;
    return <>
        <section className="card account-login-summary">
            <header className="card-header"><h2>{t("accountLoginInfo")}</h2>{total > 1 && <Button className="account-detail-switch" variant="ghost" size="small" aria-label={t("compactAccountNextLogin", { index: index + 1, total })} onClick={onSwitch}><ArrowLeftRight size={17} /><span>{index + 1}/{total}</span></Button>}</header>
            <div className="account-login-value"><span className="account-login-label">{t("pwVaultAccountShort")}</span><div><span data-login-username>{username || t("pwVaultValueEmpty")}</span>{copyButton("pwVaultUsernameField", username, "pwVaultCopyUsername")}</div></div>
            <div className="account-login-value"><span className="account-login-label">{t("pwVaultPasswordField")}</span><div><span data-login-password className="account-login-secret">{entry?.password ? revealed ? entry.password : "••••••••••" : t("pwVaultNoPassword")}</span><span className="actions">{entry?.password ? <><Button size="icon" variant="ghost" aria-label={t(revealed ? "pwVaultHidePasswordValue" : "pwVaultRevealPassword")} aria-pressed={revealed} onClick={() => setRevealed(!revealed)}>{revealed ? <EyeOff size={18} /> : <Eye size={18} />}</Button>{copyButton("pwVaultPasswordField", entry.password, "pwVaultCopyPassword")}</> : <Button size="small" onClick={onEdit}>{t("compactAccountAddPassword")}</Button>}</span></div></div>
            {url && <div className="account-login-value"><span className="account-login-label">{t("accountLoginUrl")}</span><a href={url} target="_blank" rel="noreferrer"><span>{url.replace(/^https?:\/\//, "")}</span><ExternalLink size={19} /></a></div>}
        </section>
        <section className="card account-note-summary"><h2>{t("notes")}</h2><p className={notes ? "" : "muted"}>{notes || t("accountNoNotes")}</p></section>
        {manual && <Dialog title={t("pwVaultManualCopyTitle")} onClose={() => setManual(null)}><p>{t("pwVaultManualCopyHint")}</p><label htmlFor="account-detail-manual-copy">{manual.label}</label><Textarea id="account-detail-manual-copy" readOnly value={manual.value} onFocus={event => event.currentTarget.select()} /></Dialog>}
    </>;
}
