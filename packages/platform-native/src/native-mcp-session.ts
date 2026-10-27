import { McpAuthority, type AuthorityStorage } from '../../mcp/src/authority';
import { createMobileMcpPairing, type MobileMcpClientRequest, type MobileMcpScope } from '../../mcp/src/mobile-pairing';
import type { McpAssetStore, PreviewResult } from '../../mcp/src/service';
import { createNativeMcpAuthorityStorage } from './native-mcp-authority';
import { prepareNativeMcpTransport } from './native-mcp-transport';

export interface NativeMcpContext {
  datasetName: string;
  store: McpAssetStore;
  assertCurrent(): void;
  onInvalidated(listener: () => void): () => void;
}
export type NativeMcpSessionOptions = {
  address: string;
  scope: MobileMcpScope;
  loadContext(): Promise<NativeMcpContext>;
  onClient(request: MobileMcpClientRequest): void;
  onAuthorized(request: MobileMcpClientRequest, expiresAt: number): void;
  onPreviews(previews: PreviewResult[]): void;
  onStopped(confirmed: boolean): void;
};
type Dependencies = {
  authorityStorage(dataset: string): AuthorityStorage;
  prepareTransport: typeof prepareNativeMcpTransport;
};

/** Owns one immutable native dataset and one exported pairing ticket. The UI
 * must deliver its file first, then explicitly activate the foreground server. */
export async function prepareNativeMcpSession(options: NativeMcpSessionOptions, dependencies: Dependencies = {
  authorityStorage: createNativeMcpAuthorityStorage, prepareTransport: prepareNativeMcpTransport,
}) {
  let context: NativeMcpContext, authority: McpAuthority;
  try {
    context = await options.loadContext(); context.assertCurrent();
    authority = new McpAuthority(dependencies.authorityStorage(context.datasetName));
    // A missing/corrupt/unavailable private store fails before allocating IO;
    // it is never replaced by memory or the ordinary asset database.
    await authority.storage.read(); context.assertCurrent();
  } catch { throw Error('mcp-native-session-unavailable'); }
  let phase: 'prepared' | 'activating' | 'active' | 'closed' = 'prepared';
  let closing: Promise<{ writeMayHaveApplied: boolean }> | undefined;
  let transportGuard: (() => void) | undefined;
  const previews = new Map<string, PreviewResult>();
  let controller: ReturnType<typeof createMobileMcpPairing> | undefined;
  let prepared: Awaited<ReturnType<typeof prepareNativeMcpTransport>> | undefined;
  let unsubscribe = () => {};
  const isClosed = () => phase === 'closed';
  const assertActive = () => {
    context.assertCurrent();
    if (phase !== 'active' || !transportGuard) throw Error('mcp-native-stopped');
    transportGuard();
  };
  const publishPreviews = () => options.onPreviews(structuredClone([...previews.values()].filter(preview => preview.expiresAt > Date.now())));
  const close = (): Promise<{ writeMayHaveApplied: boolean }> => {
    if (closing) return closing;
    phase = 'closed'; try { unsubscribe(); } catch {} previews.clear();
    closing = Promise.resolve().then(async () => {
      const results = await Promise.allSettled([controller?.close(), prepared?.close()]);
      if (results.some(result => result.status === 'rejected')) throw Error('mcp-native-revoke-unconfirmed');
      const grantId = controller?.grantId;
      const state = grantId ? await authority.storage.read() : undefined;
      return { writeMayHaveApplied: Boolean(state?.operations.some(receipt => receipt.grantId === grantId && receipt.state === 'pending')) };
    }).then(result => { try { options.onStopped(true); } catch {} return result; }, () => {
      // Native IO has stopped even when the durable revocation acknowledgement
      // failed. Keep that distinction visible and permit an explicit retry.
      closing = undefined; try { options.onStopped(false); } catch {}
      throw Error('mcp-native-revoke-unconfirmed');
    });
    return closing;
  };
  try {
    unsubscribe = context.onInvalidated(() => { void close().catch(() => {}); });
    prepared = await dependencies.prepareTransport(options.address); context.assertCurrent();
    if (isClosed()) throw Error('mcp-native-stopped');
    controller = createMobileMcpPairing({ endpoint: prepared.endpoint, scope: options.scope, authority, store: context.store,
      assertAvailable: assertActive, onClient: options.onClient, onAuthorized: options.onAuthorized,
      onPreview: async (grantId, preview) => {
        assertActive();
        if (grantId !== controller?.grantId) throw Error('mcp-native-stopped');
        if (previews.size >= 16 && !previews.has(preview.previewId)) {
          await authority.rejectPreview(grantId, preview.previewId); throw Error('mcp-native-preview-limit');
        }
        previews.set(preview.previewId, structuredClone(preview)); publishPreviews();
      },
    });
    const owner = controller, ticket = prepared;
    return {
      pairingFile: structuredClone(owner.pairingFile),
      async activate() {
        context.assertCurrent();
        if (phase !== 'prepared') throw Error('mcp-native-stopped');
        phase = 'activating';
        try {
          await ticket.activate({ createHandler: (_, guard) => {
            context.assertCurrent();
            if (phase !== 'activating') throw Error('mcp-native-stopped');
            transportGuard = guard; phase = 'active'; return owner;
          }, onStopped: () => { void close().catch(() => {}); } });
          assertActive();
        } catch { await close().catch(() => {}); throw Error('mcp-native-transport'); }
      },
      async decideClient(clientNonce: string, approved: boolean) { assertActive(); await owner.decideClient(clientNonce, approved); assertActive(); },
      async decidePreview(previewId: string, approved: boolean) {
        assertActive(); const preview = previews.get(previewId), grantId = owner.grantId;
        if (!preview || !grantId) throw Error('mcp-native-preview-stale');
        const row = await context.store.get(preview.assetId); assertActive();
        const current = Boolean(row && row.version === preview.expectedVersion && preview.expiresAt > Date.now() &&
          preview.changes.every(change => JSON.stringify(row.asset[change.field]) === JSON.stringify(change.before)));
        if (!approved || !current) await authority.rejectPreview(grantId, previewId);
        else await authority.approvePreview(grantId, previewId);
        assertActive(); previews.delete(previewId); publishPreviews();
        if (approved && !current) throw Error('mcp-native-preview-stale');
      },
      async auditEntries() {
        context.assertCurrent();
        const grantId = owner.grantId;
        const entries = grantId ? (await authority.auditEntries(grantId)).slice(-100) : [];
        context.assertCurrent(); return entries;
      },
      close,
    };
  } catch {
    // Invalidation can finish close while native prepare is still allocating.
    // Dispose that late resource too; an already-settled close promise cannot.
    await prepared?.close().catch(() => {});
    await close().catch(() => {}); throw Error('mcp-native-session-unavailable');
  }
}
export type NativeMcpSession = Awaited<ReturnType<typeof prepareNativeMcpSession>>;
