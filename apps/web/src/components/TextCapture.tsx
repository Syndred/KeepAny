import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AssetKind } from '../../../../packages/domain/src';
import { stageTextForReview } from '../intake-text';
import { Button } from './ui/button';
import { Select, SelectOption } from './ui/select';

export function TextCapture({ onStaged }: { onStaged: () => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState(''), [kind, setKind] = useState<AssetKind>('project');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const generation = useRef(0), running = useRef(false);
  useEffect(() => () => { generation.current++; }, []);
  const preview = async () => {
    if (running.current) return;
    running.current = true; setBusy(true); setMessage('');
    const current = ++generation.current;
    try {
      await stageTextForReview(text, kind, t('intakeTextBatch'), () => current === generation.current);
      if (current === generation.current) { onStaged(); setMessage(t('reviewCandidates')); }
    } catch (error) {
      if (current === generation.current) setMessage(t(error instanceof Error && error.message === 'text-secret' ? 'intakeTextSecrets' : error instanceof Error && error.message === 'text-limit' ? 'intakeTextLimit' : 'error'));
    } finally { if (current === generation.current) { running.current = false; setBusy(false); } }
  };
  return <section className="intake-text-capture">
    <p>{t('intakeTextHint')}</p>
    <div className="field"><label htmlFor="intake-text-source">{t('intakeTextSource')}</label><textarea id="intake-text-source" rows={6} value={text} disabled={busy} onChange={event => { generation.current++; setText(event.target.value); setMessage(''); }} /></div>
    <div className="field"><label htmlFor="intake-text-kind">{t('intakeRecordType')}</label><Select id="intake-text-kind" value={kind} disabled={busy} onValueChange={value => { generation.current++; setKind(value as AssetKind); setMessage(''); }}>{(['project', 'account', 'subscription', 'item'] as const).map(value => <SelectOption key={value} value={value}>{t(value)}</SelectOption>)}</Select></div>
    <Button variant="primary" disabled={busy || !text.trim()} onClick={() => void preview()}>{busy ? t('loading') : t('intakePreviewRecords')}</Button>
    {message && <p role="status">{message}</p>}
  </section>;
}
