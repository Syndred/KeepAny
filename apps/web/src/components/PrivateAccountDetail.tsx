import { lazy, Suspense, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Mail, Pencil, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { newAsset, type Relation } from "../../../../packages/domain/src";
import type { VaultEntryDraft } from "../../../../packages/password-vault/src";
import { accountLoginChoices, nextAccountLogin, preferredAccountLogin } from "../account-login-choices";
import { useAppContext, niceCategory } from "../view-shared";
import { usePasswordVault, type PasswordVaultEntrySummary } from "./PasswordVaultProvider";
import { AccountLoginSummary } from "./AccountLoginSummary";
import { AccountEntryDialog } from "./AccountEntryDialog";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { TextLink } from "./ui/text-link";
import "../account-detail.css";
const Graph = lazy(() => import("../account-family-graph-view").then(module => ({ default: module.AssetRelationGraph })));

/** An encrypted login can be viewed and linked without publishing an ordinary asset. */
export function PrivateAccountDetail({ entry }: { entry: PasswordVaultEntrySummary }) {
    const { t } = useTranslation(), { data, notify } = useAppContext(), { session } = usePasswordVault();
    const navigate = useNavigate();
    const [selected, setSelected] = useState(""), [edit, setEdit] = useState<"edit" | "links" | null>(null);
    const [edgeId, setEdgeId] = useState<string | null>(null);
    const [remove, setRemove] = useState<{ ids: string[]; expected: VaultEntryDraft } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
    const choices = accountLoginChoices([entry]), current = preferredAccountLogin(choices, selected);
    const [base] = useState(() => newAsset("account"));
    const asset = { ...base, id: `login-${entry.id}`, name: entry.title, category: "other", username: entry.username, url: entry.url, updatedAt: entry.modifiedAt };
    const linked = data.assets.filter(asset => !asset.deleted && entry.linkedAssetIds.includes(asset.id));
    const relations: Relation[] = linked.map(asset => ({ id: `encrypted-link-${asset.id}`, from: `login-${entry.id}`, to: asset.id, label: t("relations"), createdAt: entry.modifiedAt, verifiedAt: "", deleted: false }));
    async function unlink() {
        if (!remove || busy || !session) return;
        setBusy(true); setError("");
        try { await session.saveEntryIfCurrent({ ...remove.expected, linkedAssetIds: remove.expected.linkedAssetIds.filter(id => !remove.ids.includes(id)) }, remove.expected); setRemove(null); setEdgeId(null); notify(t("saved")); }
        catch { setError(t("pwVaultError")); } finally { setBusy(false); }
    }
    return <main className="page asset-detail asset-detail-account account-relation-layout">
        <TextLink asChild><Link className="account-detail-back" to="/accounts"><ArrowLeft size={16} />{t("accountBack")}</Link></TextLink>
        <div className="page-header"><div><span className="account-detail-avatar"><Mail size={30} /></span><h1>{entry.title}</h1><div className="eyebrow">{niceCategory("other", t)}</div></div><div className="actions"><Button variant="primary" onClick={() => setEdit("edit")}><Pencil size={17} />{t("edit")}</Button></div></div>
        <div className="asset-detail-secondary"><section className="card asset-relations-card"><header className="card-header"><div><h2>{t("accountRelationMap")}</h2><p>{t("accountConnectionCount", { count: linked.length })}</p></div><Button size="small" variant="primary" onClick={() => setEdit("links")}><Plus size={16} />{t("addRelation")}</Button></header><Suspense fallback={<p role="status">{t("loading")}</p>}><Graph root={asset} assets={[asset, ...linked]} relations={relations} matches={new Set()} selectedEdgeId={edgeId} onSelectEdge={setEdgeId} onVisit={target => void navigate({ to: "/assets/$kind/$id", params: { kind: target.kind, id: target.id } })} onDeleteRelations={rows => { if (session?.getSnapshot().status === "unlocked") { setError(""); setRemove({ ids: rows.map(row => row.to), expected: session.readEntry(entry.id) }); } }} /></Suspense></section></div>
        <aside className="account-login-column"><AccountLoginSummary key={`${current?.key}:${entry.modifiedAt}`} asset={asset} current={current} total={choices.length} index={choices.findIndex(choice => choice.key === current?.key)} onSwitch={() => current && setSelected(nextAccountLogin(choices, current.key)?.key ?? "")} onEdit={() => setEdit("edit")} /></aside>
        {edit && <AccountEntryDialog entryId={entry.id} linking={edit === "links"} onClose={() => setEdit(null)} />}
        {remove && <Dialog title={t("pwVaultUnlink")} closeDisabled={busy} onClose={() => { if (!busy) setRemove(null); }}><p>{t("accountUnlinkConfirm", { name: linked.filter(asset => remove.ids.includes(asset.id)).map(asset => asset.name).join(", ") })}</p>{error && <p role="alert">{error}</p>}<div className="actions"><Button disabled={busy} onClick={() => setRemove(null)}>{t("cancel")}</Button><Button disabled={busy} variant="danger" onClick={() => void unlink()}>{t("pwVaultUnlink")}</Button></div></Dialog>}
    </main>;
}
