import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { save } from '../../../../packages/local-db/src';
import { useAppContext } from '../view-shared';
import { readSubscriptionRates, subscriptionRatesId } from '../subscription-cny';
import { Dialog } from './ui/dialog';
import { Input } from './ui/input';
import { Button } from './ui/button';

export function SubscriptionRatesDialog({ onClose }: { onClose: () => void }) {
 const { t } = useTranslation();
 const { data, notify } = useAppContext();
 const [rates, setRates] = useState(() => readSubscriptionRates(data.preferences.find(p => p.id === subscriptionRatesId)?.value));
 const [busy,setBusy] = useState(false), [error,setError] = useState('');
 const currencies = ['USD','EUR','GBP','JPY'];
 return <Dialog title={t('subscriptionRates')} onClose={onClose} closeDisabled={busy}><form className="asset-editor" onSubmit={async event => {
  event.preventDefault(); if (busy) return;
  const valid = readSubscriptionRates(rates);
  if (currencies.some(c => rates[c]?.trim() && !valid[c])) { setError(t('invalid')); return; }
  setBusy(true); setError('');
  try { await save('preference',{id:subscriptionRatesId,value:{...valid,confirmedAt:new Date().toISOString()}}); notify(t('saved')); onClose(); }
  catch { setError(t('error')); } finally { setBusy(false); }
 }}><p>{t('subscriptionRatesHint')}</p>{currencies.map(currency=><label className="field" key={currency}>{t('subscriptionRateLabel',{currency})}<Input aria-label={t('subscriptionRateLabel',{currency})} inputMode="decimal" disabled={busy} value={rates[currency] ?? ''} onChange={e=>setRates({...rates,[currency]:e.target.value})}/></label>)}{error && <p role="alert" className="field-error">{error}</p>}<div className="actions"><Button disabled={busy} onClick={onClose}>{t('cancel')}</Button><Button type="submit" variant="primary" disabled={busy}>{t('save')}</Button></div></form></Dialog>;
}
