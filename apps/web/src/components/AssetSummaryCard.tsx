import type { ReactNode } from 'react';
import { Banknote, CalendarDays, Clock3, Link2, MapPin, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import type { Asset } from '../../../../packages/domain/src';
import { AssetThumbnail } from './AssetThumbnail';
import { date, money, niceCategory, useAppContext } from '../view-shared';
import { RemainingDays } from './AssetMetrics';
import { daysBetween } from '../workspace-summary';
import { cardPeriod } from '../card-period';
import { readSubscriptionRates, subscriptionCny, subscriptionRatesId } from '../subscription-cny';
import './asset-summary-card.css';
import { WalletCardFace } from './WalletCardFace';

export function AssetCardContent({ asset, categoryName }: { asset: Asset; categoryName?: string }) {
 const { t, i18n } = useTranslation();
 const { data } = useAppContext();
 const rates = readSubscriptionRates(data.preferences.find(p => p.id === subscriptionRatesId)?.value);
 const cny = asset.kind === 'subscription' ? subscriptionCny(asset, rates) : null;
 const today = format(new Date(), 'yyyy-MM-dd');
 const progress = cardPeriod(asset, today);
 const cover = asset.kind === 'item' ? asset.itemMedia?.coverId : '';
 const label = asset.walletCard ? t(`walletType_${asset.walletCard.type}`) : categoryName ?? (asset.category ? niceCategory(asset.category, t) : t(asset.kind));
 const state = asset.kind === 'item' && asset.status === 'active' ? asset.itemLifecycleStatus ? t(`itemStatus_${asset.itemLifecycleStatus}`) : t('active') : t(asset.status);
 const stateClass = asset.kind === 'item' && asset.status === 'active' ? asset.itemLifecycleStatus ?? 'active' : asset.status;
 let domain = asset.url;
 try { domain = new URL(asset.url).host; } catch { /* Preserve legacy text. */ }
 const facts: ReactNode[] = [];
 if (asset.kind === 'subscription') {
  facts.push(<span key="price"><Banknote aria-hidden="true"/><span>{cny ? money(cny.amount, 'CNY', i18n.language) : t('subscriptionCnyMissing')}<small> / {asset.interval > 1 ? `${asset.interval} ` : ''}{t(asset.cycle)}</small></span></span>);
  if (asset.dueDate) facts.push(<span key="due"><CalendarDays aria-hidden="true"/><span>{date(asset.dueDate, i18n.language)}</span></span>);
 } else if (asset.kind === 'item') {
  if (asset.itemPurchasePriceKnown) facts.push(<span key="price"><Banknote aria-hidden="true"/><span>{money(asset.amount, asset.currency, i18n.language)}</span></span>);
  if (asset.location) facts.push(<span key="place" title={asset.location}><MapPin aria-hidden="true"/><span>{asset.location}</span></span>);
 } else if (asset.url) facts.push(<span key="url" title={asset.url}><Link2 aria-hidden="true"/><span>{domain}</span></span>);
 return <>
  <div className={`summary-card-head${cover ? ' has-photo' : ''}`}>
   {cover && <div className="summary-card-photo"><AssetThumbnail asset={asset} imageId={cover}/></div>}
   <div className="summary-card-intro"><strong title={asset.name}>{asset.name}</strong>{asset.description && <p title={asset.description}>{asset.description}</p>}
    <div className="summary-card-labels"><span className="summary-card-tags" title={[label, ...asset.tags].join(' · ')}>{[label,...asset.tags].filter(Boolean).join(' · ')}</span><span className={`summary-card-state state-${stateClass}`}><i aria-hidden="true"/>{state}</span></div>
   </div>
  </div>
  {asset.walletCard && <WalletCardFace asset={asset}/>}
  {facts.length > 0 && <div className="summary-card-facts">{facts}</div>}
  <div className="summary-card-footer">
   {asset.kind === 'subscription' && asset.dueDate ? <div><span><CalendarDays aria-hidden="true"/>{t('dueDate')}</span><RemainingDays days={daysBetween(today,asset.dueDate)}/></div>
    : asset.kind === 'item' && asset.warrantyDate ? <div><span><ShieldCheck aria-hidden="true"/>{t('warrantyDate')}</span><span>{date(asset.warrantyDate,i18n.language)}{daysBetween(today,asset.warrantyDate)! < 0 ? ` · ${t('cardExpired')}` : ''}</span></div>
    : <div>{asset.purchaseDate && asset.kind === 'item' ? <span><CalendarDays aria-hidden="true"/>{date(asset.purchaseDate,i18n.language)}</span> : asset.dueDate ? <span><CalendarDays aria-hidden="true"/>{asset.walletCard ? `${t('walletExpiry')} · ` : ''}{date(asset.dueDate,i18n.language)}</span> : null}<span className="summary-card-updated"><Clock3 aria-hidden="true"/>{date(asset.updatedAt.slice(0,10),i18n.language)}</span></div>}
   {progress !== null && <progress max={100} value={progress} aria-label={t(asset.kind === 'item' ? 'warrantyDate' : 'dueDate')}/>}
  </div>
 </>;
}
