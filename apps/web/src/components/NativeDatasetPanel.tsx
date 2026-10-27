import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getDatasetAdapter, type DatasetSummary } from '../native-datasets';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';

export function NativeDatasetPanel() {
  const adapter = getDatasetAdapter();
  const { t, i18n } = useTranslation();
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [error, setError] = useState(false), [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ row: DatasetSummary; action: 'switch' | 'abandon' } | null>(null);
  const mounted = useRef(true), inFlight = useRef(false);
  useEffect(() => {
    mounted.current = true;
    let generation = 0;
    const refresh = () => {
      const current = ++generation;
      void adapter?.list().then(rows => { if (mounted.current && current === generation) setDatasets(rows); }).catch(() => { if (mounted.current && current === generation) setError(true); });
    };
    refresh(); const stop = adapter?.subscribe(refresh);
    return () => { mounted.current = false; generation++; stop?.(); };
  }, [adapter]);
  if (!adapter) return null;
  async function perform(row: DatasetSummary, action: 'switch' | 'resume' | 'abandon') {
    if (!adapter || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(false);
    try {
      if (action === 'switch') await adapter.switchTo(row.name);
      else if (action === 'resume') await adapter.resume(row.name);
      else await adapter.abandon(row.name);
      if (mounted.current) { setDatasets(await adapter.list()); setConfirm(null); }
    } catch { if (mounted.current) setError(true); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  return <section className="card padded" aria-labelledby="local-datasets-title">
    <h3 id="local-datasets-title">{t('localDatasets')}</h3>
    <p>{t('localDatasetRestoreHint')}</p>
    {datasets.map(row => <article key={row.name} className="padded">
      <strong>{row.name === 'keepany-v1' ? t('localDatasetInitial') : t('localDatasetRestored', { date: new Date(row.createdAt).toLocaleString(i18n.language) })}</strong>
      <div className="actions">{row.active ? <span>{t('localDatasetActive')}</span> : row.phase === 'retained' ?
        <Button disabled={busy} variant="default" onClick={() => setConfirm({ row, action: 'switch' })}>{t('localDatasetSwitch')}</Button> : <>
          <span>{t('localDatasetPending')}</span>
          {row.phase === 'candidate' && <Button disabled={busy} onClick={() => void perform(row, 'resume')}>{t('localDatasetResume')}</Button>}
          <Button disabled={busy} variant="default" onClick={() => setConfirm({ row, action: 'abandon' })}>{t('localDatasetAbandon')}</Button>
        </>}</div>
    </article>)}
    {error && <p role="alert">{t('localDatasetFailure')}</p>}
    {confirm && <Dialog title={t(confirm.action === 'switch' ? 'localDatasetSwitch' : 'localDatasetAbandon')} onClose={() => { if (!inFlight.current) setConfirm(null); }} closeDisabled={busy}>
      <p>{t(confirm.action === 'switch' ? 'localDatasetSwitchConfirm' : 'localDatasetAbandonConfirm')}</p>
      <div className="actions"><Button variant="default" disabled={busy} onClick={() => setConfirm(null)}>{t('cancel')}</Button>
        <Button disabled={busy} onClick={() => void perform(confirm.row, confirm.action)}>{t('confirm')}</Button></div>
    </Dialog>}
  </section>;
}
