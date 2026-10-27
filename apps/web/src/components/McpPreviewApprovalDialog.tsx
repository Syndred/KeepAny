import { useTranslation } from 'react-i18next';
import type { Asset } from '../../../../packages/domain/src';
import type { PreviewResult } from '../../../../packages/mcp/src/service';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';

function valueText(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  return typeof value === 'string' ? value : JSON.stringify(value);
}
export function McpPreviewApprovalDialog({ preview, assets, busy, checking, current, decide, error, stop }: {
  preview: PreviewResult; assets: Asset[]; busy: boolean; checking: boolean; current: boolean;
  decide(approved: boolean): void; error?: string | null; stop?(): void;
}) {
  const { t } = useTranslation();
  return <Dialog title={t('mcpWriteApprovalTitle')} onClose={() => decide(false)} closeDisabled={busy}>
    <p>{t('mcpWriteApprovalHint')}</p>
    <p className="mcp-preview-asset">{t('mcpPreviewAsset')}: {assets.find(asset => asset.id === preview.assetId)?.name ?? preview.assetId}</p>
    <div className="mcp-preview-changes">{preview.changes.map(change => <div key={change.field} className="mcp-preview-change">
      <strong>{t(`mcpField_${change.field}`)}</strong>
      <div><small>{t('mcpValueBefore')}</small><p>{valueText(change.before)}</p></div>
      <div><small>{t('mcpValueAfter')}</small><p>{valueText(change.after)}</p></div>
    </div>)}</div>
    {error ? <p role="alert">{t(error)}</p> : !checking && !current && <p role="alert">{t('mcpPreviewExpired')}</p>}
    <div className="actions">
      <Button disabled={busy} onClick={() => decide(false)}>{t('mcpWriteApprovalDeny')}</Button>
      <Button disabled={busy || checking || !current} onClick={() => decide(true)}>{t('mcpWriteApprovalApprove')}</Button>
      {error && stop && <Button variant="danger" disabled={busy} onClick={stop}>{t('mcpNativeStop')}</Button>}
    </div>
  </Dialog>;
}
