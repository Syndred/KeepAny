import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { recycleAccountCard, type AccountCardDeleteTarget, type AccountCardDeleteProgress } from "../account-card-delete";
import { useAppContext } from "../view-shared";
import { usePasswordVault } from "./PasswordVaultProvider";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

export function AccountDeleteDialog({ target, name, onClose, onDeleted }: { target: AccountCardDeleteTarget; name: string; onClose: () => void; onDeleted: () => void }) {
 const { t } = useTranslation(), { notify } = useAppContext(), { session, snapshot } = usePasswordVault();
 const progress = useRef<AccountCardDeleteProgress>({});
 const running = useRef(false);
 const [busy, setBusy] = useState(false), [error, setError] = useState("");
 useEffect(() => { if (snapshot.status !== "unlocked") onClose(); }, [snapshot.status, onClose]);
 async function remove() {
  if (!session || running.current || snapshot.status !== "unlocked") return;
  running.current = true; setBusy(true); setError(""); let deleted = false;
  try { await recycleAccountCard(session, target, progress.current); notify(t("pwVaultSaved")); deleted = true; }
  catch (failure) { setError(t(progress.current.vaultDone && !progress.current.publicDone ? "accountDeletePartial" : failure instanceof Error && /stale/.test(failure.message) ? "assetStale" : "error")); }
  finally { running.current = false; setBusy(false); }
  if (deleted) { onClose(); onDeleted(); }
 }
 if (snapshot.status !== "unlocked") return null;
 return <Dialog title={t("accountDeleteAccountTitle")} closeDisabled={busy} onClose={() => { if (!running.current) onClose(); }}><p>{name}</p><p>{t("accountDeleteAccountHint")}</p>{error && <p role="alert" className="field-error">{error}</p>}<div className="actions"><Button disabled={busy} onClick={onClose}>{t("cancel")}</Button><Button variant="danger" disabled={busy} onClick={() => void remove()}>{t(progress.current.vaultDone && !progress.current.publicDone ? "retry" : "accountDetailDelete")}</Button></div></Dialog>;
}
