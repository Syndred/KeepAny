import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Asset } from '../../../packages/domain/src';
import type { BrowserAuditEntry } from '../../../packages/mcp/src/browser-bridge';
import type { BridgeScope } from '../../../packages/mcp/src/bridge';
import type { MobileMcpClientRequest, MobileMcpPairingFile, MobileMcpScope } from '../../../packages/mcp/src/mobile-pairing';
import type { PreviewResult } from '../../../packages/mcp/src/service';
import type { NativeMcpSession } from '../../../packages/platform-native/src/native-mcp-session';
import { McpRuntimeContext, type NativeMcpPhase } from './mcp-context';
import type { PlatformMcpAdapter } from './platform-mcp';
import type { FileDeliveryMessage } from './file-delivery';
import { Button } from './components/ui/button';
import { Dialog } from './components/ui/dialog';
import { McpPreviewApprovalDialog } from './components/McpPreviewApprovalDialog';

export function NativeMcpRuntimeProvider({ assets, adapter, children }: { assets: Asset[]; adapter: PlatformMcpAdapter; children: ReactNode }) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<NativeMcpPhase>('idle');
  const [preparedFile, setPreparedFile] = useState<MobileMcpPairingFile | null>(null);
  const [delivered, setDelivered] = useState(false);
  const [pendingClient, setPendingClient] = useState<MobileMcpClientRequest | null>(null);
  const [scope, setScope] = useState<BridgeScope | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [audit, setAudit] = useState<BrowserAuditEntry[]>([]);
  const [revokedAt, setRevokedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<PreviewResult[]>([]);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [previewChecking, setPreviewChecking] = useState(false);
  const [previewCurrent, setPreviewCurrent] = useState(false);
  const [previewError, setPreviewError] = useState<{ previewId: string; key: string } | null>(null);
  const sessionRef = useRef<NativeMcpSession | null>(null), generation = useRef(0);
  const cleanupRef = useRef(new Set<NativeMcpSession>());
  const phaseRef = useRef<NativeMcpPhase>('idle'), scopeRef = useRef<BridgeScope | null>(null);
  const deliveredRef = useRef(false), preparing = useRef(false), deciding = useRef(false);
  const changePhase = useCallback((value: NativeMcpPhase) => { phaseRef.current = value; setPhase(value); }, []);
  const clearConnection = useCallback(() => {
    scopeRef.current = null; setScope(null); setExpiresAt(null); setPendingClient(null); setPreviews([]);
    setPreparedFile(null); deliveredRef.current = false; setDelivered(false);
    setPreviewError(null);
  }, []);
  const stop = useCallback(async () => {
    const sessions = [...new Set([...cleanupRef.current, ...(sessionRef.current ? [sessionRef.current] : [])])];
    const wasAuthorized = scopeRef.current !== null;
    const ownGeneration = ++generation.current;
    setPendingClient(null); setPreviews([]); setPreparedFile(null); deliveredRef.current = false; setDelivered(false);
    if (!sessions.length) { clearConnection(); changePhase('idle'); setError(null); return; }
    try {
      const results = await Promise.allSettled(sessions.map(async session => {
        cleanupRef.current.add(session);
        const result = await session.close(); cleanupRef.current.delete(session);
        if (sessionRef.current === session) sessionRef.current = null;
        return result;
      }));
      if (results.some(result => result.status === 'rejected')) throw Error('mcpNativeStopUnconfirmed');
      if (generation.current !== ownGeneration) return;
      clearConnection(); changePhase('idle');
      if (wasAuthorized) setRevokedAt(Date.now());
      setError(results.some(result => result.status === 'fulfilled' && result.value.writeMayHaveApplied) ? 'mcpWriteMayHaveApplied' : null);
      try { const entries = await sessions[sessions.length - 1].auditEntries(); if (generation.current === ownGeneration) setAudit(entries); } catch {}
    } catch {
      if (generation.current === ownGeneration) { clearConnection(); changePhase('error'); setError('mcpNativeStopUnconfirmed'); }
      // Keep the closed session identity so an explicit stop can retry an
      // unacknowledged native stop or durable revocation safely.
      throw Error('mcpRevokeUnconfirmed');
    }
  }, [changePhase, clearConnection]);
  const refreshAudit = useCallback(async () => {
    const session = sessionRef.current, ownGeneration = generation.current;
    if (!session) return;
    try { const entries = await session.auditEntries(); if (generation.current === ownGeneration && sessionRef.current === session) setAudit(entries); }
    catch { if (generation.current === ownGeneration) setError('mcpNativeStateUnavailable'); }
  }, []);

  const prepare = useCallback(async (address: string, requested: MobileMcpScope) => {
    if (preparing.current) return;
    preparing.current = true;
    let ownGeneration: number | undefined;
    try {
      if (sessionRef.current || cleanupRef.current.size) await stop();
      ownGeneration = ++generation.current;
      const liveIds = new Set(assets.filter(asset => !asset.deleted).map(asset => asset.id));
      if (requested.assetIds.some(id => !liveIds.has(id))) throw Error('mcpSelectionInvalid');
      changePhase('preparing'); setError(null); clearConnection();
      const session = await adapter.prepare({ address, scope: structuredClone(requested),
        onClient: request => { if (generation.current === ownGeneration) setPendingClient(request); },
        onAuthorized: (request, expiry) => {
          if (generation.current !== ownGeneration) return;
          const granted: BridgeScope = { assetIds: [...request.scope.assetIds], readFields: [...request.scope.readFields], writeFields: [...request.scope.writeFields] };
          scopeRef.current = granted; setScope(granted); setExpiresAt(expiry); setRevokedAt(null); setPendingClient(null);
          setPreparedFile(null); setAudit([]); changePhase('authorized');
        },
        onPreviews: values => { if (generation.current === ownGeneration) setPreviews(values); },
        onStopped: (confirmed, writeMayHaveApplied) => {
          if (generation.current !== ownGeneration) return;
          const hadScope = scopeRef.current !== null;
          if (confirmed) sessionRef.current = null;
          clearConnection(); changePhase(confirmed ? 'idle' : 'error');
          if (confirmed && hadScope) setRevokedAt(Date.now());
          setError(confirmed ? writeMayHaveApplied ? 'mcpWriteMayHaveApplied' : null : 'mcpNativeStopUnconfirmed');
        },
      });
      if (generation.current !== ownGeneration) {
        cleanupRef.current.add(session);
        try { await session.close(); cleanupRef.current.delete(session); }
        catch {
          if (!sessionRef.current) { clearConnection(); changePhase('error'); }
          setError('mcpNativeStopUnconfirmed');
        }
        return;
      }
      sessionRef.current = session; setPreparedFile(session.pairingFile); changePhase('prepared');
    } catch {
      if (ownGeneration !== undefined && generation.current !== ownGeneration) return;
      if (ownGeneration === undefined) throw Error('mcpNativeStopUnconfirmed');
      setError('mcpNativePrepareFailed'); changePhase('error'); throw Error('mcpNativePrepareFailed');
    } finally { preparing.current = false; }
  }, [adapter, assets, changePhase, clearConnection, stop]);
  const reportDelivery = useCallback((message: FileDeliveryMessage) => {
    if (phaseRef.current !== 'prepared') return;
    const ready = message === 'exportFileSaved' || message === 'exportFileOpened';
    deliveredRef.current = ready; setDelivered(ready);
  }, []);
  const activate = useCallback(async () => {
    const session = sessionRef.current, ownGeneration = generation.current;
    if (!session || phaseRef.current !== 'prepared' || !deliveredRef.current) return;
    changePhase('activating'); setError(null);
    try {
      await session.activate();
      if (generation.current === ownGeneration && scopeRef.current === null) changePhase('waiting');
    } catch {
      if (generation.current === ownGeneration) { changePhase('error'); setPreparedFile(null); setError('mcpNativeActivationFailed'); }
      throw Error('mcpNativeActivationFailed');
    }
  }, [changePhase]);
  const invalidatePrepared = useCallback(() => {
    if (!sessionRef.current && phaseRef.current !== 'preparing') return;
    const closing = stop(), ownGeneration = generation.current;
    void closing.then(() => { if (generation.current === ownGeneration) setError('mcpSelectionChanged'); }).catch(() => {});
  }, [stop]);
  const decideClient = useCallback(async (approved: boolean) => {
    const session = sessionRef.current, client = pendingClient, ownGeneration = generation.current;
    if (!session || !client || deciding.current) return;
    deciding.current = true; setDecisionBusy(true); setError(null);
    try {
      await session.decideClient(client.clientNonce, approved);
      if (!approved) await stop();
      else if (generation.current === ownGeneration) { setPendingClient(null); await refreshAudit(); }
    } catch { if (generation.current === ownGeneration) setError('mcpNativeApprovalUnconfirmed'); }
    finally { deciding.current = false; setDecisionBusy(false); }
  }, [pendingClient, refreshAudit, stop]);
  const preview = previews[0];
  useEffect(() => {
    if (!preview) { setPreviewCurrent(false); return; }
    const session = sessionRef.current; let active = true;
    setPreviewChecking(true);
    void session?.checkPreview(preview.previewId).then(value => { if (active) setPreviewCurrent(value); })
      .catch(() => { if (active) setPreviewCurrent(false); }).finally(() => { if (active) setPreviewChecking(false); });
    return () => { active = false; };
  }, [preview]);
  const decidePreview = async (approved: boolean) => {
    const session = sessionRef.current, ownGeneration = generation.current;
    if (!session || !preview || deciding.current) return;
    deciding.current = true; setDecisionBusy(true); setError(null); setPreviewError(null);
    try { await session.decidePreview(preview.previewId, approved); }
    catch (cause) { if (generation.current === ownGeneration) {
      const key = cause instanceof Error && cause.message === 'mcp-native-preview-stale' ? 'mcpPreviewExpired' : 'mcpNativeApprovalUnconfirmed';
      setError(key); setPreviewError({ previewId: preview.previewId, key });
    } }
    finally { deciding.current = false; setDecisionBusy(false); }
  };
  useEffect(() => {
    if (phase !== 'waiting' && phase !== 'authorized') return;
    const timer = window.setInterval(() => {
      const session = sessionRef.current;
      if (!session) return;
      try { const values = session.pendingPreviews(); setPreviews(current => JSON.stringify(current) === JSON.stringify(values) ? current : values); }
      catch { void stop().catch(() => {}); }
    }, 800);
    return () => window.clearInterval(timer);
  }, [phase, stop]);
  useEffect(() => {
    if (phase !== 'authorized') return;
    const timer = window.setInterval(() => { void refreshAudit(); }, 5000);
    return () => window.clearInterval(timer);
  }, [phase, refreshAudit]);
  useEffect(() => {
    const deadline = phase === 'authorized' ? expiresAt : preparedFile?.expiresAt;
    if (!deadline) return;
    const timer = window.setTimeout(() => {
      const closing = stop(), ownGeneration = generation.current;
      void closing.then(() => { if (generation.current === ownGeneration) setError(phase === 'authorized' ? 'mcpNativeGrantExpired' : 'mcpNativePairExpired'); }).catch(() => {});
    }, Math.max(1, deadline - Date.now()));
    return () => window.clearTimeout(timer);
  }, [expiresAt, phase, preparedFile, stop]);
  useEffect(() => {
    const leave = () => { void stop().catch(() => {}); };
    const background = () => { if (phaseRef.current !== 'prepared') leave(); };
    window.addEventListener('pagehide', leave); window.addEventListener('keepany-native-background', background);
    return () => { window.removeEventListener('pagehide', leave); window.removeEventListener('keepany-native-background', background); leave(); };
  }, [stop]);

  const status = phase === 'authorized' ? 'connected' : phase === 'waiting' || phase === 'activating' ? 'pairing' : phase === 'error' ? 'error' : 'idle';
  return <McpRuntimeContext.Provider value={{ localConnectionAvailable: true, status, scope, expiresAt, audit, revokedAt,
    refreshAudit, prepared: null, error, prepare: () => { throw Error('mcpNativePrepareFailed'); }, invalidatePrepared,
    importPairing: async () => { throw Error('mcpPairingInvalid'); }, revoke: stop,
    native: { phase, preparedFile, delivered, pendingClient, prepare, reportDelivery, activate, decideClient } }}>
    {children}
    {pendingClient && <Dialog title={t('mcpNativeCompareTitle')} closeDisabled={decisionBusy} onClose={() => { void decideClient(false); }}>
      <p>{t('mcpNativeScopeApprovalHint')}</p>
      <p>{t('mcpNativeClient')}: {pendingClient.clientName}</p>
      <p>{t('mcpNativeComparisonCode')}: <strong>{pendingClient.comparisonCode}</strong></p>
      <ul className="mcp-scope-list">{pendingClient.scope.assetIds.map(id => <li key={id}>{assets.find(asset => asset.id === id)?.name ?? t('mcpAssetUnavailable')}</li>)}</ul>
      <p>{t('mcpReadFields')}: {pendingClient.scope.readFields.map(field => t(`mcpField_${field}`)).join(', ')}</p>
      <p>{t('mcpWriteFields')}: {pendingClient.scope.writeFields.length ? pendingClient.scope.writeFields.map(field => t(`mcpField_${field}`)).join(', ') : t('mcpNoWrite')}</p>
      <p>{t('mcpScopeDuration', { minutes: pendingClient.scope.ttlMs / 60000 })}</p>
      {error && <p role="alert">{t(error)}</p>}
      <div className="actions"><Button disabled={decisionBusy} onClick={() => { void decideClient(false); }}>{t('mcpScopeApprovalDeny')}</Button>
        <Button disabled={decisionBusy} onClick={() => { void decideClient(true); }}>{t('mcpScopeApprovalApprove')}</Button>
        {error && <Button variant="danger" disabled={decisionBusy} onClick={() => { void stop().catch(() => {}); }}>{t('mcpNativeStop')}</Button>}</div>
    </Dialog>}
    {preview && <McpPreviewApprovalDialog preview={preview} assets={assets} busy={decisionBusy} checking={previewChecking}
      current={previewCurrent} error={previewError?.previewId === preview.previewId ? previewError.key : null}
      stop={() => { void stop().catch(() => {}); }}
      decide={approved => { void decidePreview(approved); }} />}
  </McpRuntimeContext.Provider>;
}
