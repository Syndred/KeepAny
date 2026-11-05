import { CreditCard } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Asset } from '../../../../packages/domain/src';
import { money } from '../view-shared';

export function WalletCardFace({ asset }: { asset: Asset }) {
 const { t, i18n } = useTranslation();
 const card = asset.walletCard;
 if (!card) return null;
 return <div className={`wallet-card-face wallet-${card.type}`}>
  <div className="wallet-card-issuer"><span>{card.issuer || t(`walletType_${card.type}`)}</span><CreditCard aria-hidden="true"/></div>
  {card.lastFour && <span className="wallet-card-number">•••• {card.lastFour}</span>}
  {(card.balanceMinor !== null || card.remainingUses !== null) && <div className="wallet-card-values">
   {card.balanceMinor !== null && <span><small>{t('walletBalance')}</small><strong>{money(card.balanceMinor,'CNY',i18n.language)}</strong></span>}
   {card.remainingUses !== null && <span><small>{t('walletRemaining')}</small><strong>{t('walletUses',{count:card.remainingUses})}</strong></span>}
  </div>}
 </div>;
}
