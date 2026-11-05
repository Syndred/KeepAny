import { History, RotateCcw } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppContext } from "../view-shared";
import { usePasswordVault, type PasswordVaultEntrySummary } from "./PasswordVaultProvider";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import type { Asset } from "../../../../packages/domain/src";
import { restoreAccountHistory, type AccountHistoryRestoreProgress } from "../account-history-restore";

type SelectedVersion = { index: number; at: string; contentRevision: string; asset?: Asset };

export function AccountHistory({ entry, asset }: { entry?: PasswordVaultEntrySummary; asset?: Asset }) {
    const { t, i18n } = useTranslation();
    const { session, snapshot } = usePasswordVault();
    const { notify } = useAppContext();
    const [selected, setSelected] = useState<SelectedVersion | null>(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState("");
    const inFlight = useRef(false), opener = useRef<HTMLElement | null>(null), heading = useRef<HTMLHeadingElement>(null);
    const progress = useRef<AccountHistoryRestoreProgress>({ account: null, accountChanged: false });
    // Discard secret drafts immediately. The inline list retains only display metadata.
    const history = useMemo(() => {
        if (!session || snapshot.status !== "unlocked" || !entry) return { rows: [], failed: false };
        try { return { rows: session.history(entry.id).map((row, index) => ({ index, at: row.at, username: row.draft.username })).reverse(), failed: false }; }
        catch { return { rows: [], failed: true }; }
    }, [session, snapshot.status, snapshot.contentRevision, entry?.id]);
    if (snapshot.status !== "unlocked") return null;
    const formatTime = (at: string) => new Date(at).toLocaleString(i18n.language, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    async function restore() {
        if (!selected || !entry || !session || inFlight.current) return;
        inFlight.current = true; setBusy(true); setError("");
        try {
            await restoreAccountHistory({ session, entryId: entry.id, index: selected.index, expected: selected,
                asset: selected.asset, progress: progress.current, label: (kind, identifierKind) => t(`pwConnectKind_${identifierKind ?? kind}`) });
            setSelected(null); notify(t("pwVaultHistoryRestored"));
        } catch (cause) {
            if (session.getSnapshot().status === "unlocked") setError(t(cause instanceof Error && ["vault-stale", "stale"].includes(cause.message) ? "pwVaultConflict" : "pwVaultError"));
        } finally { inFlight.current = false; setBusy(false); }
    }
    return <section className="card account-history-card" aria-labelledby="account-history-title">
        <header><h2 id="account-history-title" ref={heading} tabIndex={-1}>{t("accountHistoryTitle")}</h2><History size={19} aria-hidden="true"/></header>
        {history.failed ? <p role="alert" className="field-error">{t("pwVaultError")}</p> : history.rows.length ? <div className="account-history-list" tabIndex={0} role="region" aria-label={t("accountHistoryTitle")}>
            {history.rows.map(row => <div className="account-history-row" key={`${row.index}:${row.at}`}><div><strong>{formatTime(row.at)}</strong><small>{row.username || t("pwVaultValueEmpty")}</small><small>{t("pwVaultHistoryVersion", { count: row.index + 1 })}</small></div><Button size="small" disabled={busy} aria-label={`${t("accountHistoryRestoreAction")} · ${formatTime(row.at)}`} onClick={event => { if (!snapshot.contentRevision) return; opener.current = event.currentTarget; progress.current = { account: asset ?? null, accountChanged: false }; setError(""); setSelected({ index: row.index, at: row.at, contentRevision: snapshot.contentRevision, asset }); }}><RotateCcw size={15}/>{t("accountHistoryRestoreAction")}</Button></div>)}
        </div> : <p className="muted account-history-empty">{t("pwVaultHistoryEmpty")}</p>}
        {selected && <Dialog title={t("pwVaultHistoryRestore")} closeDisabled={busy} returnFocusTo={() => opener.current?.isConnected ? opener.current : heading.current} onClose={() => { if (!busy) { setSelected(null); setError(""); } }}><p>{t("accountHistoryRestoreConfirm", { date: formatTime(selected.at) })}</p>{error && <p role="alert" className="field-error">{error}</p>}<div className="actions"><Button disabled={busy} onClick={() => setSelected(null)}>{t("cancel")}</Button><Button variant="primary" disabled={busy} onClick={() => void restore()}>{t("pwVaultHistoryRestore")}</Button></div></Dialog>}
    </section>;
}
