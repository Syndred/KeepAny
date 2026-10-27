import type { AuditEntry, AuthorityState, AuthorityStorage } from '../../mcp/src/authority';
import { checkedNativeMcpAuthorityState, createNativeMcpAuthorityStorage, nativeMcpAuthorityLimit, nativeMcpAuthorityScope } from './native-mcp-authority';

export type NativeMcpHistoryEntry = Pick<AuditEntry, 'id' | 'grantId' | 'at' | 'action' | 'outcome' | 'assetId' | 'fieldNames' | 'operationId'>;
export type NativeMcpHistory = { entries: NativeMcpHistoryEntry[]; lastRevokedAt: number | null };
export type NativeMcpHistoryOptions = { storageFactory?: (datasetName: string) => AuthorityStorage };
export type NativeMcpRecovery = { revokedGrantIds: string[]; lastRevokedAt: number | null };
const encoder = new TextEncoder();

function storageFor(datasetName: string, options: NativeMcpHistoryOptions): AuthorityStorage {
  // Validate even an injected factory's immutable scope before any storage IO.
  nativeMcpAuthorityScope(datasetName);
  const storage = (options.storageFactory ?? createNativeMcpAuthorityStorage)(datasetName);
  if (!storage || typeof storage.read !== 'function' || typeof storage.update !== 'function') throw Error('mcp-native-state');
  return storage;
}
function checked(input: unknown): AuthorityState {
  const state = checkedNativeMcpAuthorityState(input);
  if (encoder.encode(JSON.stringify(state)).byteLength > nativeMcpAuthorityLimit) throw Error('mcp-native-state');
  return state;
}
function lastRevokedAt(state: AuthorityState): number | null {
  let latest: number | null = null;
  for (const grant of state.grants) if (grant.revokedAt !== undefined && (latest === null || grant.revokedAt > latest)) latest = grant.revokedAt;
  return latest;
}
function project(row: AuditEntry): NativeMcpHistoryEntry {
  const result: NativeMcpHistoryEntry = { id: row.id, grantId: row.grantId, at: row.at, action: row.action, outcome: row.outcome };
  if (row.assetId !== undefined) result.assetId = row.assetId;
  if (row.fieldNames !== undefined) result.fieldNames = [...row.fieldNames];
  if (row.operationId !== undefined) result.operationId = row.operationId;
  return result;
}

/** Reads private, persisted metadata only. No default-memory fallback, grant
 * credentials, patch values, ordinary asset reads, pruning or synthetic times. */
export async function readNativeMcpHistory(datasetName: string, options: NativeMcpHistoryOptions = {}): Promise<NativeMcpHistory> {
  try {
    const state = checked(await storageFor(datasetName, options).read());
    return { entries: state.audit.slice(-100).map(project), lastRevokedAt: lastRevokedAt(state) };
  } catch { throw Error('mcp-native-history-unavailable'); }
}

/** Bootstrap only: native reset must have succeeded and no session factory may
 * be exposed until this finishes. The guard is a trusted fence, not a native
 * rollback/cancel API. A committed write with a lost ACK remains unconfirmed. */
export async function revokeNativeMcpOrphans(datasetName: string, assertNoListener: () => void, options: NativeMcpHistoryOptions = {}): Promise<NativeMcpRecovery> {
  try {
    assertNoListener();
    const storage = storageFor(datasetName, options);
    assertNoListener();
    const initial = checked(await storage.read());
    assertNoListener();
    const ids = initial.grants.filter(grant => grant.revokedAt === undefined).map(grant => grant.id);
    const revokedGrantIds: string[] = [];
    for (const id of ids) {
      assertNoListener();
      const revoked = await storage.update(state => {
        assertNoListener(); checked(state);
        const grant = state.grants.find(row => row.id === id);
        if (!grant) throw Error('mcp-native-state');
        if (grant.revokedAt !== undefined) return false;
        const at = Date.now();
        grant.revokedAt = at;
        // Unlike ordinary McpAuthority.revokeGrant, orphan recovery preserves
        // preview and operation metadata for uncertainty/history inspection.
        state.audit.push({ id: crypto.randomUUID(), at, grantId: id, action: 'revoke', outcome: 'allowed' });
        checked(state); assertNoListener();
        return true;
      });
      assertNoListener();
      if (revoked) revokedGrantIds.push(id);
    }
    assertNoListener();
    const final = checked(await storage.read());
    assertNoListener();
    // A concurrent late writer must not turn a partial scan into full success.
    if (final.grants.some(grant => grant.revokedAt === undefined)) throw Error('mcp-native-state');
    return { revokedGrantIds, lastRevokedAt: lastRevokedAt(final) };
  } catch { throw Error('mcp-native-recovery-unconfirmed'); }
}
