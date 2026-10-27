import type { AuthorityStorage } from '../../mcp/src/authority';
import { createNativeMcpAuthorityStorage, nativeMcpAuthorityScope } from './native-mcp-authority';
import { readNativeMcpHistory, revokeNativeMcpOrphans, type NativeMcpHistory } from './native-mcp-history';
import { prepareNativeMcpSession, type NativeMcpContext, type NativeMcpSession, type NativeMcpSessionOptions } from './native-mcp-session';
import { prepareNativeMcpTransport, resetNativeMcpTransport } from './native-mcp-transport';

export type NativeMcpPlatformDependencies = {
  reset: typeof resetNativeMcpTransport;
  readHistory: typeof readNativeMcpHistory;
  recover: typeof revokeNativeMcpOrphans;
  prepareSession: typeof prepareNativeMcpSession;
  storageFactory(datasetName: string): AuthorityStorage;
};
type Owner = {
  ioMayExist: boolean;
  pending: boolean;
  stopped: boolean;
  unconfirmed: boolean;
  partial: boolean;
  closing: boolean;
  cleanup?: Promise<void>;
};
const unavailable = () => Error('mcp-native-session-unavailable');
const unconfirmed = () => Error('mcp-native-revoke-unconfirmed');

/** Construct once per native page, after ordinary assets load. Construction is
 * synchronous and does no IO; MCP failure never substitutes another asset or
 * authority store. A new dataset requires a new page/factory, not a retarget. */
export function createNativeMcpPlatform(options: { loadContext(): Promise<NativeMcpContext> }, overrides: Partial<NativeMcpPlatformDependencies> = {}) {
  const dependencies: NativeMcpPlatformDependencies = { reset: resetNativeMcpTransport,
    readHistory: readNativeMcpHistory, recover: revokeNativeMcpOrphans,
    prepareSession: prepareNativeMcpSession, storageFactory: createNativeMcpAuthorityStorage, ...overrides };
  let context: NativeMcpContext | undefined, storage: AuthorityStorage | undefined;
  let initialization: Promise<NativeMcpContext> | undefined;
  let owner: Owner | undefined;

  const capture = (value: NativeMcpContext): NativeMcpContext => {
    nativeMcpAuthorityScope(value.datasetName);
    if (!value.store || typeof value.store.get !== 'function' || typeof value.store.list !== 'function' ||
      typeof value.store.compareAndSet !== 'function' || typeof value.assertCurrent !== 'function' ||
      typeof value.onInvalidated !== 'function') throw unavailable();
    const assertCurrent = value.assertCurrent.bind(value), onInvalidated = value.onInvalidated.bind(value);
    return Object.freeze({ datasetName: value.datasetName, store: value.store, assertCurrent, onInvalidated });
  };
  const storageFor = (datasetName: string): AuthorityStorage => {
    if (!context || datasetName !== context.datasetName) throw unavailable();
    if (!storage) {
      const candidate = dependencies.storageFactory(datasetName);
      if (!candidate || typeof candidate.read !== 'function' || typeof candidate.update !== 'function') throw unavailable();
      storage = candidate;
    }
    return storage;
  };
  const initialize = (): Promise<NativeMcpContext> => {
    if (!initialization) {
      const attempt = Promise.resolve().then(async () => {
        // A stale factory must not reset a replacement dataset's transport.
        context?.assertCurrent();
        if (owner?.ioMayExist || await dependencies.reset() !== true) throw unavailable();
        if (!context) context = capture(await options.loadContext());
        const fixed = context;
        const assertNoListener = () => {
          // Reserving a prepare slot is not IO. Allocation remains behind this
          // shared initialization promise, including every recovery CAS fence.
          fixed.assertCurrent(); if (owner?.ioMayExist) throw unavailable();
        };
        assertNoListener();
        await dependencies.recover(fixed.datasetName, assertNoListener, { storageFactory: storageFor });
        assertNoListener(); return fixed;
      });
      const guarded = attempt.catch(() => {
        if (initialization === guarded) initialization = undefined;
        throw Error('mcp-native-recovery-unconfirmed');
      });
      initialization = guarded;
    }
    return initialization;
  };
  const release = (token: Owner) => { token.ioMayExist = false; token.unconfirmed = false; if (owner === token) owner = undefined; };
  const clearPartial = (token: Owner): Promise<void> => {
    if (token.cleanup) return token.cleanup;
    token.cleanup = Promise.resolve().then(async () => {
      try {
        // No ticket escaped this factory. Reset is only a cleanup retry for
        // this unreturned allocation, never an active-session history action.
        context?.assertCurrent();
        if (owner !== token || !token.partial || await dependencies.reset() !== true) throw unconfirmed();
        release(token);
      } catch { token.unconfirmed = true; throw unconfirmed(); }
    }).finally(() => { token.cleanup = undefined; });
    return token.cleanup;
  };

  return {
    async cleanupUnreturnedPreparation(): Promise<void> {
      const token = owner;
      if (!token) return;
      // This is not a global stop API. Returned sessions, pending bootstrap,
      // and uncertain durable revocation must use their own session.close().
      if (!token.partial) throw Error('mcp-native-session-occupied');
      await clearPartial(token);
    },
    async history(): Promise<NativeMcpHistory> {
      // History is not a reset/recovery retry switch for uncertain session IO.
      if (owner?.partial) throw unconfirmed();
      const fixed = await initialize();
      try {
        fixed.assertCurrent();
        const result = await dependencies.readHistory(fixed.datasetName, { storageFactory: storageFor });
        fixed.assertCurrent(); return result;
      } catch { throw Error('mcp-native-history-unavailable'); }
    },
    async prepare(request: Omit<NativeMcpSessionOptions, 'loadContext'>): Promise<NativeMcpSession> {
      if (owner?.partial) await clearPartial(owner);
      if (owner) throw owner.unconfirmed ? unconfirmed() : Error('mcp-native-session-occupied');
      const token: Owner = { ioMayExist: false, pending: true, stopped: false, unconfirmed: false, partial: false, closing: false };
      owner = token;
      let session: NativeMcpSession | undefined;
      let bootstrapped = false;
      try {
        const fixed = await initialize(); bootstrapped = true; fixed.assertCurrent();
        token.ioMayExist = true;
        session = await dependencies.prepareSession({ ...request,
          loadContext: async () => { fixed.assertCurrent(); return fixed; },
          onStopped: (confirmed, writeMayHaveApplied) => {
            token.stopped = true; token.unconfirmed = !confirmed;
            // A callback before prepare settles cannot prove a later resource
            // was also cleaned. Old callbacks may never release a new owner.
            if (confirmed && !token.pending && !token.partial && !token.closing) release(token);
            try { request.onStopped(confirmed, writeMayHaveApplied); } catch { /* UI cannot break resource ownership. */ }
          },
        }, { authorityStorage: storageFor, prepareTransport: prepareNativeMcpTransport });
        fixed.assertCurrent();
        if (token.stopped) throw unavailable();
        token.pending = false;
        const original = session;
        let closing: Promise<{ writeMayHaveApplied: boolean }> | undefined;
        return { ...original,
          close() {
            if (closing) return closing;
            token.closing = true;
            closing = Promise.resolve().then(() => original.close()).then(result => { token.closing = false; release(token); return result; }, () => {
              token.closing = false; token.unconfirmed = true; closing = undefined; throw unconfirmed();
            });
            return closing;
          },
        };
      } catch {
        token.pending = false;
        if (token.ioMayExist) {
          // If a session object exists but was not handed off (e.g. epoch
          // changed), prefer its exact-instance cleanup over a global reset.
          if (session) {
            try { await session.close(); release(token); }
            catch { token.partial = true; await clearPartial(token); }
          } else { token.partial = true; await clearPartial(token); }
        } else if (owner === token) owner = undefined;
        if (!bootstrapped) throw Error('mcp-native-recovery-unconfirmed');
        throw unavailable();
      }
    },
  };
}
export type NativeMcpPlatform = ReturnType<typeof createNativeMcpPlatform>;
