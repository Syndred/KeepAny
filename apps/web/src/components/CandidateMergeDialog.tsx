import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMinorUnits, type Asset } from '../../../../packages/domain/src';
import { reviewedMergeFieldsForKind, type ReviewedAssetMergeReceipt, type ReviewedCandidate,
  type ReviewedMergeField } from '../../../../packages/local-db/src/intake-review';
import type { ConfirmReviewedAssetMergeInput } from '../../../../packages/local-db/src/intake-asset-merge';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Select, SelectOption } from './ui/select';
import '../candidate-merge.css';

export const mergeFieldKey = (field: ReviewedMergeField) => field === 'itemPurchasePriceKnown' ? 'reviewMergePriceKnown' : field;
export function mergeFieldValue(asset: Asset, field: ReviewedMergeField, language: string, t: (key: string) => string): string {
  const value = asset[field];
  if (field === 'amount') return formatMinorUnits(asset.amount, asset.currency, language);
  if (field === 'cycle') return t(asset.cycle);
  if (typeof value === 'boolean') return t(value ? 'reviewMergeYes' : 'reviewMergeNo');
  return Array.isArray(value) ? value.join(', ') || '—' : String(value ?? '') || '—';
}
export function CandidateMergeReceipt({ receipt }: { receipt: ReviewedAssetMergeReceipt }) {
  const { t, i18n } = useTranslation();
  return <details className="candidate-merge-receipt"><summary>{t('reviewMergeReceipt')}</summary>
    <p>{t('reviewMergeRecorded', { time: new Date(receipt.recordedAt).toLocaleString(i18n.language) })}</p>
    <div className="candidate-merge-fields">
      {receipt.fields.map(field => <div className="candidate-merge-field" key={field}>
        <strong>{t(mergeFieldKey(field))}</strong>
        <div><small>{t('reviewMergeCurrent')}</small><p className="candidate-merge-value">{mergeFieldValue(receipt.before, field, i18n.language, t)}</p></div>
        <div><small>{t('reviewMergeIncoming')}</small><p className="candidate-merge-value">{mergeFieldValue(receipt.after, field, i18n.language, t)}</p></div>
      </div>)}
    </div>
  </details>;
}
export function CandidateMergeDialog({ candidate, invalidDrafts = {}, returnFocusTo, assets, onClose, onMerge }: {
  candidate: ReviewedCandidate; assets: Asset[]; onClose: () => void;
  invalidDrafts?: Record<string, string>;
  returnFocusTo?: () => HTMLElement | null;
  onMerge: (input: ConfirmReviewedAssetMergeInput) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const targets = assets.filter(asset => !asset.deleted && asset.kind === candidate.asset.kind && asset.id !== candidate.asset.id && asset.kind !== 'vault');
  const [expectedTarget, setExpectedTarget] = useState<Asset | null>(null);
  const [fields, setFields] = useState<ReviewedMergeField[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [frozen, setFrozen] = useState(false);
  const close = () => { if (!inFlight.current) onClose(); };
  async function submit() {
    if (inFlight.current || !expectedTarget) return;
    if (!fields.length) { setError(t('reviewMergeSelectFields')); return; }
    inFlight.current = true; setBusy(true); setError('');
    try { await onMerge({ expectedCandidate: candidate, expectedTarget, fields }); }
    catch (failure) {
      const code = failure instanceof Error ? failure.message : '';
      setFrozen(!['review-merge-fields', 'review-merge-invalid', 'review-merge-target', 'review-merge-stale'].includes(code));
      setError(t(code === 'review-merge-fields' ? 'reviewMergeSelectFields' : code === 'review-merge-invalid' || code === 'review-merge-target'
        ? 'reviewMergeInvalid' : code === 'review-merge-stale' || code === 'review-merge-conflict' ? 'reviewMergeChanged' : 'reviewMergeFailed'));
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <Dialog title={t('reviewMergeTitle')} onClose={close} returnFocusTo={returnFocusTo} closeDisabled={busy} className="candidate-merge-dialog">
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <p>{candidate.fileName} · {candidate.asset.name}</p>
      <p className="muted">{t('reviewMergeHint')}</p>
      <label className="field" htmlFor="candidate-merge-target">{t('reviewMergeTarget')}
        <Select id="candidate-merge-target" disabled={busy || frozen} value={expectedTarget?.id ?? ''} onValueChange={id => {
          setExpectedTarget(targets.find(asset => asset.id === id) ?? null); setFields([]); setError('');
        }}><SelectOption value="" disabled>{t('reviewMergeChooseTarget')}</SelectOption>
          {targets.map(asset => <SelectOption value={asset.id} key={asset.id}>{asset.name}</SelectOption>)}
        </Select>
      </label>
      {!targets.length && <p>{t('reviewMergeNoTarget')}</p>}
      {expectedTarget && <div className="candidate-merge-fields">
        {reviewedMergeFieldsForKind(expectedTarget.kind).map(field => {
          const draftInvalid = Object.hasOwn(invalidDrafts, field);
          const missing = candidate.ai?.missingFields.includes(field);
          const invalid = draftInvalid || missing;
          return <label className="candidate-merge-field" key={field}>
          <span className="candidate-merge-check"><input type="checkbox" disabled={busy || frozen || invalid} aria-label={t('reviewMergeUseField', { field: t(mergeFieldKey(field)) })}
            checked={fields.includes(field)} onChange={event => {
              setFields(current => event.target.checked ? [...current, field] : current.filter(item => item !== field)); setError('');
            }} /><strong>{t(mergeFieldKey(field))}</strong></span>
          <span><small>{t('reviewMergeCurrent')}</small><span className="candidate-merge-value">{mergeFieldValue(expectedTarget, field, i18n.language, t)}</span></span>
          <span><small>{t('reviewMergeIncoming')}</small><span className="candidate-merge-value">{draftInvalid ? invalidDrafts[field] || t('reviewMergeEmpty') : missing ? t('reviewMergeEmpty') : mergeFieldValue(candidate.asset, field, i18n.language, t)}</span>{invalid && <small className="field-error">{t('reviewMergeDraftInvalid')}</small>}</span>
        </label>; })}
      </div>}
      {error && <p role="alert" className="field-error">{error}</p>}
      <div className="actions"><Button type="submit" variant="primary" disabled={busy || !expectedTarget}>{busy ? t('loading') : t('reviewMergeConfirm')}</Button>
        <Button type="button" disabled={busy} onClick={close}>{t('cancel')}</Button></div>
    </form>
  </Dialog>;
}
