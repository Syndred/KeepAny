import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BridgeScope } from '../../../../packages/mcp/src/bridge';
import { useMcpRuntime } from '../mcp-runtime';
import { useAppContext } from '../view-shared';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';

export function McpRevokeButton({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation(), runtime = useMcpRuntime(), { data } = useAppContext();
  const [expected, setExpected] = useState<BridgeScope | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const running = useRef(false);
  const changed = expected !== null && expected !== runtime.scope;
  const confirm = async () => {
    if (running.current || !expected || changed) return;
    running.current = true; setBusy(true); setError('');
    try { await runtime.revoke(); setExpected(null); }
    catch { setError(t('mcpRevokeUnconfirmed')); }
    finally { running.current = false; setBusy(false); }
  };
  return <>
    <Button variant="danger" disabled={disabled || busy || !runtime.scope} onClick={() => {
      setExpected(runtime.scope); setError(''); void runtime.refreshAudit();
    }}>{t('mcpRevoke')}</Button>
    {expected && <Dialog title={t('mcpRevoke')} closeDisabled={busy} onClose={() => { if (!running.current) setExpected(null); }}>
      <p>{t('mcpRevokeConfirmHint')}</p>
      <ul>{expected.assetIds.map(id => <li key={id}>{data.assets.find(asset => asset.id === id)?.name ?? t('mcpAssetUnavailable')}</li>)}</ul>
      {(error || changed) && <p role="alert">{error || t('mcpRevokeScopeChanged')}</p>}
      <div className="actions"><Button disabled={busy} onClick={() => setExpected(null)}>{t('cancel')}</Button><Button variant="danger" disabled={busy || changed} onClick={() => void confirm()}>{t('mcpRevoke')}</Button></div>
    </Dialog>}
  </>;
}
