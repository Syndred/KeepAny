import { History, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppContext } from "../view-shared";
import { usePasswordVault, type PasswordVaultEntrySummary } from "./PasswordVaultProvider";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import type { Asset } from "../../../../packages/domain/src";
import { restoreAccountHistory, type AccountHistoryRestoreProgress } from "../account-history-restore";

import "../account-history-actions.css";

type SelectedVersion = { action: "restore" | "delete"; entryId: string; index: number; at: string; contentRevision: string; asset?: Asset };

export function AccountHistory({ entry, asset }: { entry?: PasswordVaultEntrySummary; asset?: Asset }) {
    const { t, i18n } = useTranslation();
    const { session, snapshot } = usePasswordVault();
    const { notify } = useAppContext();
    const [selected, setSelected] = useState<SelectedVersion | null>(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState("");
    const inFlight = useRef(false), opener = useRef<HTMLElement | null>(null), heading = useRef<HTMLHeadingElement>(null);
    const progress = useRef<AccountHistoryRestoreProgress>({ account: null, accountChanged: false });
    useEffect(() => {
        setSelected(null); setError("");
    }, [snapshot.status, entry?.id]);
    // Discard secret drafts immediately. The inline list retains only display metadata.
    const history = useMemo(() => {
        if (!session || snapshot.status !== "unlocked" || !entry) return { rows: [], failed: false };
        try { return { rows: session.history(entry.id).map((row, index) => ({ index, at: row.at, username: row.draft.username })).reverse(), failed: false }; }
        catch { return { rows: [], failed: true }; }
    }, [session, snapshot.status, snapshot.contentRevision, entry?.id]);
    if (snapshot.status !== "unlocked") return null;
    const formatTime = (at: string) => new Date(at).toLocaleString(i18n.language, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    async function applyHistoryAction() {
        if (!selected || !entry || !session || inFlight.current) return;
        if (selected.entryId !== entry.id) { setError(t("pwVaultConflict")); return; }
        inFlight.current = true; setBusy(true); setError("");
        try {
            if (selected.action === "delete") await session.deleteHistory(entry.id, selected.index, selected);
            else await restoreAccountHistory({ session, entryId: entry.id, index: selected.index, expected: selected,
                asset: selected.asset, progress: progress.current, label: (kind, identifierKind) => t(`pwConnectKind_${identifierKind ?? kind}`) });
            setSelected(null); notify(t(selected.action === "delete" ? "accountHistoryDeleted" : "pwVaultHistoryRestored"));
        } catch (cause) {
            if (session.getSnapshot().status === "unlocked") setError(t(cause instanceof Error && cause.message === "vault-memory" ? progress.current.accountChanged ? "accountHistoryPartialMemory" : "pwVaultMemoryUnavailable" : cause instanceof Error && ["vault-stale", "stale"].includes(cause.message) ? "pwVaultConflict" : "pwVaultError"));
        } finally { inFlight.current = false; setBusy(false); }
    }
    return <section className={`card account-history-card${history.rows.length ? "" : " is-empty"}`} aria-labelledby="account-history-title">
        <header><h2 id="account-history-title" ref={heading} tabIndex={-1}>{t("accountHistoryTitle")}</h2><History size={19} aria-hidden="true"/></header>
        {history.failed ? <p role="alert" className="field-error">{t("pwVaultError")}</p> : history.rows.length ? <div className="account-history-list" tabIndex={0} role="region" aria-label={t("accountHistoryTitle")}>
            {history.rows.map(row => <div className="account-history-row" key={`${row.index}:${row.at}`}><div><strong>{formatTime(row.at)}</strong><small>{row.username || t("pwVaultValueEmpty")}</small><small>{t("pwVaultHistoryVersion", { count: row.index + 1 })}</small></div><div className="account-history-actions">
                {(["restore", "delete"] as const).map(action => <Button key={action} type="button" size="icon" variant="ghost" disabled={busy || !snapshot.contentRevision} aria-label={`${t(action === "delete" ? "accountHistoryDeleteAction" : "accountHistoryRestoreAction")} · ${formatTime(row.at)}`} title={t(action === "delete" ? "accountHistoryDeleteAction" : "accountHistoryRestoreAction")} onClick={event => { if (!snapshot.contentRevision || !entry) return; opener.current = event.currentTarget; progress.current = { account: asset ?? null, accountChanged: false }; setError(""); setSelected({ action, entryId: entry.id, index: row.index, at: row.at, contentRevision: snapshot.contentRevision, asset }); }}>{action === "delete" ? <Trash2 size={17}/> : <RotateCcw size={17}/>}</Button>)}
            </div></div>)}
        </div> : <p className="muted account-history-empty">{t("pwVaultHistoryEmpty")}</p>}
        {selected && <Dialog title={t(selected.action === "delete" ? "accountHistoryDeleteTitle" : "pwVaultHistoryRestore")} closeDisabled={busy} returnFocusTo={() => opener.current?.isConnected ? opener.current : heading.current} onClose={() => { if (!busy) { setSelected(null); setError(""); } }}><p>{t(selected.action === "delete" ? "accountHistoryDeleteConfirm" : "accountHistoryRestoreConfirm", { date: formatTime(selected.at) })}</p>{error && <p role="alert" className="field-error">{error}</p>}<div className="actions"><Button disabled={busy} onClick={() => setSelected(null)}>{t("cancel")}</Button><Button variant={selected.action === "delete" ? "danger" : "primary"} disabled={busy} onClick={() => void applyHistoryAction()}>{t(selected.action === "delete" ? "accountHistoryDeleteAction" : "pwVaultHistoryRestore")}</Button></div></Dialog>}
    </section>;
}
