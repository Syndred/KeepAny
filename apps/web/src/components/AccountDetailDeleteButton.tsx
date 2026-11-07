import { useNavigate } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Asset } from "../../../../packages/domain/src";
import { localRepository } from "../../../../packages/local-db/src";
import { useAppContext } from "../view-shared";
import { PasswordVaultPanel } from "./PasswordVaultPanel";
import { usePasswordVault, type PasswordVaultEntrySummary } from "./PasswordVaultProvider";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import "../account-detail-delete.css";

/** Reuse the list's login confirmation and guarded empty-account recycle operation. */
export function AccountDetailDeleteButton({ asset, entry, username, privateOnly = false }: { asset: Asset; entry?: PasswordVaultEntrySummary; username?: string; privateOnly?: boolean }) {
 const { t } = useTranslation(), { data, notify } = useAppContext(), { snapshot, session } = usePasswordVault();
 const navigate = useNavigate();
 const [target,setTarget] = useState<{asset:Asset;vaultRevision:string}|null>(null);
 const [busy,setBusy] = useState(false), [error,setError] = useState("");
 const running = useRef(false);
 const unlocked = snapshot.status === "unlocked";
 const returnToAccounts = () => { void navigate({ to:"/accounts", hash:"", replace:true }); };
 useEffect(() => { if (!unlocked) { setTarget(null);setError(""); } }, [unlocked]);
 async function removeEmptyAccount() {
  if (!target || running.current) return;
  running.current=true;setBusy(true);setError("");let deleted=false;
  try {
   const current=session?.getSnapshot();
   if (current?.status !== "unlocked" || current.revision !== target.vaultRevision || current.entries.some(row=>row.linkedAssetIds.includes(target.asset.id))) throw Error("asset-stale");
   const repo=await localRepository();await repo.trashEmptyAccountIfCurrent(target.asset,target.vaultRevision);
   setTarget(null);notify(t("pwVaultSaved"));deleted=true;
  } catch(cause) { setError(t(cause instanceof Error && ["asset-stale","vault-stale"].includes(cause.message) ? "assetStale" : "error")); }
  finally { running.current=false;setBusy(false); }
  if (deleted) returnToAccounts();
 }
 return <span className="account-detail-delete-control">{entry ? <PasswordVaultPanel assets={data.assets} notify={notify} onLoginDeleted={returnToAccounts} renderDetailActions={tools=><Button data-account-detail-delete disabled={!unlocked || tools.busy} onClick={()=>tools.deleteLogin(entry,username ?? entry.username,privateOnly ? undefined : asset.id)}><Trash2 size={17}/>{t("accountDetailDelete")}</Button>}/> : <><Button data-account-detail-delete disabled={!unlocked || busy || privateOnly} onClick={()=>{const current=session?.getSnapshot();if(current?.status!=="unlocked" || !current.revision)return;setError("");setTarget({asset,vaultRevision:current.revision});}}><Trash2 size={17}/>{t("accountDetailDelete")}</Button>{target && unlocked && <Dialog title={t("pwVaultDeleteEntry")} closeDisabled={busy} onClose={()=>{if(!running.current){setTarget(null);setError("");}}}><p>{target.asset.name}</p>{error && <p role="alert" className="field-error">{error}</p>}<div className="actions"><Button disabled={busy} onClick={()=>setTarget(null)}>{t("cancel")}</Button><Button variant="danger" disabled={busy} onClick={()=>void removeEmptyAccount()}>{t("pwVaultDeleteEntry")}</Button></div></Dialog>}</>}</span>;
}
