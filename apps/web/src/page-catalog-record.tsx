import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ExternalLink, MoreHorizontal, Plus } from "lucide-react";
import { cleanupUnreferencedFile, putFile, saveAssetIfCurrent } from "../../../packages/local-db/src";
import { AssetCardContent } from "./components/AssetSummaryCard";
import { WalletCardFace } from "./components/WalletCardFace";
import { UnifiedDetailColumns, UnifiedDetailDescription, UnifiedDetailHeader, UnifiedDetailHistory, UnifiedDetailImage, UnifiedDetailRelations } from "./components/UnifiedAssetDetail";
import { CatalogRecordEditor } from "./catalog-record-editor";
import { applyCatalogEdit, catalogCategories, catalogCategoryLabel, catalogRecords, type CatalogRecord } from "./catalog-records";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./components/ui/dropdown-menu";
import { date, useAppContext } from "./view-shared";
import "./workspaces.css";
import { withDetailImages } from "./unified-detail-data";

export function CatalogRecordCard({ record, categoryName, onOpen }: { record: CatalogRecord; categoryName: string; onOpen?: () => void }) {
 return <Link className="asset-summary-card catalog-record-card" to="/records/$id" params={{ id: record.id }} onClick={onOpen}><AssetCardContent asset={record.asset} categoryName={categoryName}/></Link>;
}
export function CatalogRecordPage({ recordId }: { recordId?: string } = {}) {
 const id = useRouterState({ select: state => (state.matches.at(-1)?.params as { id?: string })?.id });
 return <CatalogDetail key={recordId ?? id} recordId={recordId ?? id ?? ""}/>;
}
function CatalogDetail({ recordId }: { recordId: string }) {
 const { data, notify } = useAppContext(), { t, i18n } = useTranslation(), navigate = useNavigate();
 const current = catalogRecords(data.assets, data.categories).find(record => record.id === recordId);
 const [edit, setEdit] = useState(false), [remove, setRemove] = useState<CatalogRecord | null>(null);
 const [busy, setBusy] = useState(false), [error, setError] = useState("");
 const [pending, setPending] = useState<{ file: File; replace: string } | null>(null), [preview, setPreview] = useState(""), [ready, setReady] = useState(false);
 const upload = useRef<HTMLInputElement>(null), replaceId = useRef(""), inFlight = useRef(false);
 useEffect(() => { if (!pending) { setPreview(""); return; } const url = URL.createObjectURL(pending.file); setPreview(url); setReady(false); return () => URL.revokeObjectURL(url); }, [pending]);
 if (data.loading) return <p role="status">{t("loading")}</p>;
 if (!current) return <main className="page"><h1>{t("noMatches")}</h1><Button asChild><Link to="/assets">{t("back")}</Link></Button></main>;
 const category = catalogCategories(data.categories).find(row => row.id === current.categoryId);
 const categoryName = current.asset.walletCard ? t(`walletType_${current.asset.walletCard.type}`) : category ? catalogCategoryLabel(category, t) : t("catalogUnclassified");
 async function run(action: () => Promise<void>) {
  if (inFlight.current) return;
  inFlight.current = true; setBusy(true); setError("");
  try { await action(); notify(t("saved")); }
  catch (reason) { setError(t(reason instanceof Error && reason.message === "asset-stale" ? "assetStale" : "error")); }
  finally { inFlight.current = false; setBusy(false); }
 }
 async function storeImages(ids: string[], replace = "", replacement = "") {
  if (!current) return;
  const draft = current.domain ? { ...current.asset, attachments: ids } : withDetailImages(current.asset, ids, replace, replacement);
  await saveAssetIfCurrent(current.owner, applyCatalogEdit(current, { ...draft, updatedAt: new Date().toISOString() }, current.categoryId));
 }
 function chooseImage(id = "") { replaceId.current = id; setError(""); upload.current?.click(); }
 const hasLegacy = current.domain || current.owner.catalogCategoryId === undefined || current.owner.projectDomains.length > 0 || [current.owner.contact, current.owner.projectLaunchMonth, current.owner.projectInspectionDate, current.owner.projectTitle, current.owner.projectPromoUrl, current.owner.projectMediumDescription, current.owner.projectFeatures, current.owner.projectPricing, current.owner.projectPricingType, current.owner.projectEmail].some(Boolean);
 const info = <section className="card unified-detail-info"><header className="card-header"><h2>{t("detailBasicInfo")}</h2></header>{current.asset.walletCard ? <WalletCardFace asset={current.asset}/> : current.asset.url && /^https?:\/\//i.test(current.asset.url) ? <div className="unified-detail-highlight"><a href={current.asset.url} target="_blank" rel="noopener noreferrer">{current.asset.url}<ExternalLink size={15}/></a></div> : null}<dl>
  <div><dt>{t("category")}</dt><dd>{categoryName}</dd></div>
  {current.asset.walletCard?.issuer ? <div><dt>{t("walletIssuer")}</dt><dd>{current.asset.walletCard.issuer}</dd></div> : null}
  {current.asset.walletCard?.lastFour ? <div><dt>{t("walletLastFour")}</dt><dd>{current.asset.walletCard.lastFour}</dd></div> : null}
  <div><dt>{t("status")}</dt><dd>{t(current.asset.status)}</dd></div>
  <div><dt>{t(current.asset.walletCard ? "walletExpiry" : "catalogDate")}</dt><dd>{date(current.asset.dueDate, i18n.language)}</dd></div>
  {current.domain ? <div><dt>{t("project")}</dt><dd>{current.owner.name}</dd></div> : null}
 </dl>{current.asset.tags.length ? <div className="unified-detail-tags">{current.asset.tags.map(tag => <span key={tag}>{tag}</span>)}</div> : null}{hasLegacy ? <div className="actions"><Button size="small" asChild><Link to="/assets/$kind/$id" params={{ kind: "project", id: current.owner.id }} hash={current.domain ? `project-domain-${current.domain.id}` : "project-details"}>{t("catalogLegacy")}</Link></Button></div> : null}</section>;
 const description = <UnifiedDetailDescription asset={current.asset} actions={<Button size="small" variant="ghost" disabled={busy || current.asset.attachments.length >= 20} onClick={() => chooseImage()}><Plus size={16}/>{t("addPhoto")}</Button>}>
  <input ref={upload} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" aria-label={t("addPhoto")} disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) || !file.size || file.size > 20 * 1024 * 1024 || file.name.length > 255) { setError(t("uploadError")); return; } setPending({ file, replace: replaceId.current }); }}/>
  {current.asset.attachments.length ? <div className="unified-detail-gallery">{current.asset.attachments.map((image, index) => <UnifiedDetailImage key={image} id={image} label={t("detailPhotoNumber", { number: index + 1 })} actions={<><Button size="small" disabled={busy} onClick={() => chooseImage(image)}>{t("replaceImage")}</Button><Button size="small" variant="danger" disabled={busy} onClick={() => void run(async () => { await storeImages(current.asset.attachments.filter(id => id !== image)); await cleanupUnreferencedFile(image); })}>{t("removeImage")}</Button></>}/>)}</div> : <p className="unified-detail-empty">{t("detailNoImages")}</p>}
 </UnifiedDetailDescription>;
 return <main className="page unified-asset-detail catalog-record-detail">
  <UnifiedDetailHeader asset={current.asset} category={categoryName} state={t(current.asset.status)} actions={<><Button variant="primary" onClick={() => setEdit(true)}>{t("edit")}</Button><DropdownMenu><DropdownMenuTrigger render={<Button aria-label={t("moreActions")}/>}>{t("moreActions")}<MoreHorizontal size={18}/></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={!!current.domain || busy} onClick={() => { setError(""); setRemove(structuredClone(current)); }}>{t("delete")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu></>}/>
  {error && !pending && !remove ? <p className="field-error" role="alert">{error}</p> : null}
  <UnifiedDetailColumns info={info} description={description} relations={<UnifiedDetailRelations key={current.id} asset={current.asset} owner={current.domain ? current.owner : undefined}/>} history={<UnifiedDetailHistory asset={current.asset}/>}/>
  {edit ? <CatalogRecordEditor record={current} onClose={() => setEdit(false)}/> : null}
  {pending ? <Dialog title={t("preview")} closeDisabled={busy} onClose={() => { if (!inFlight.current) setPending(null); }}>{preview ? <img className="image-preview" src={preview} alt={pending.file.name} onLoad={() => setReady(true)} onError={() => { setReady(false); setError(t("uploadError")); }}/> : null}{error ? <p role="alert">{error}</p> : null}<div className="actions"><Button disabled={busy} onClick={() => setPending(null)}>{t("cancel")}</Button><Button variant="primary" disabled={busy || !ready} onClick={() => void run(async () => { let id = ""; try { id = await putFile(pending.file); const ids = pending.replace ? current.asset.attachments.map(value => value === pending.replace ? id : value) : [...current.asset.attachments, id]; await storeImages(ids, pending.replace, id); if (pending.replace) await cleanupUnreferencedFile(pending.replace); setPending(null); } catch (reason) { if (id) await cleanupUnreferencedFile(id); throw reason; } })}>{t("confirm")}</Button></div></Dialog> : null}
  {remove ? <Dialog title={t("delete")} closeDisabled={busy} onClose={() => { if (!inFlight.current) setRemove(null); }}><p>{t("deleteConfirm")}</p><p>{remove.asset.name}</p>{error ? <p role="alert">{error}</p> : null}<div className="actions"><Button disabled={busy} onClick={() => setRemove(null)}>{t("cancel")}</Button><Button variant="danger" disabled={busy} onClick={() => void run(async () => { await saveAssetIfCurrent(remove.owner, { ...remove.owner, deleted: true, updatedAt: new Date().toISOString() }); setRemove(null); void navigate({ to: "/assets" }); })}>{t("delete")}</Button></div></Dialog> : null}
 </main>;
}

