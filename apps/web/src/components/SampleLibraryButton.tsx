import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { seed } from "../data";
import { SAMPLE_LIBRARY_ID, sampleLibraryComplete } from "../sample-library";
import { useAppContext } from "../view-shared";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

export function SampleLibraryButton({ label }: { label?: string }) {
  const { data, notify } = useAppContext();
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const running = useRef(false);
  const complete = data.preferences.some(row => row.id === SAMPLE_LIBRARY_ID && sampleLibraryComplete(row.value));
  async function install() {
    if (running.current || complete) return;
    running.current = true; setBusy(true);
    try { await seed(t, i18n.language); setOpen(false); notify(t("sampleLibraryAdded")); }
    catch { notify(t("error")); }
    finally { running.current = false; setBusy(false); }
  }
  return <>
    <Button disabled={data.loading || complete || busy} onClick={() => setOpen(true)}>{complete ? t("sampleLibraryPresent") : label ?? t("loadSample")}</Button>
    {open && <Dialog title={t("sampleConfirmTitle")} closeDisabled={busy} onClose={() => { if (!busy) setOpen(false); }}>
      <p>{t("sampleConfirmHint")}</p>
      <div className="actions"><Button variant="primary" disabled={busy} onClick={() => void install()}>{t(busy ? "loading" : "loadSample")}</Button><Button disabled={busy} onClick={() => setOpen(false)}>{t("cancel")}</Button></div>
    </Dialog>}
  </>;
}
