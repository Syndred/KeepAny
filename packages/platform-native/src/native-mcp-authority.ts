import { Capacitor, registerPlugin } from '@capacitor/core';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';
import type { AuthorityState, AuthorityStorage } from '../../mcp/src/authority';
import { readableFields, writableFields } from '../../mcp/src/fields';

export const nativeMcpAuthorityLimit = 2 * 1024 * 1024;
export interface NativeMcpAuthorityPlugin {
  initialize(options: { scope: string }): Promise<void>;
  readState(options: { scope: string }): Promise<{ revision: string; payload: string }>;
  compareAndSet(options: { scope: string; expectedRevision: string; payload: string }): Promise<{ committed: boolean }>;
}
const native = registerPlugin<NativeMcpAuthorityPlugin>('KeepAnyMcpAuthority');
const id = z.string().regex(/^[A-Za-z0-9_-]{1,96}$/), operation = z.string().regex(/^[A-Za-z0-9_-]{8,96}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/), stamp = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), uuid = z.uuid();
const reads = z.array(z.enum(readableFields)).min(1).max(readableFields.length).refine(value => new Set(value).size === value.length);
const writes = z.array(z.enum(writableFields)).max(writableFields.length).refine(value => new Set(value).size === value.length);
const grant = z.strictObject({ id: uuid, secretHash: hash, assetIds: z.array(id).min(1).max(500).refine(value => new Set(value).size === value.length),
  readFields: reads, writeFields: writes, createdAt: stamp, expiresAt: stamp, revokedAt: stamp.optional() })
  .refine(value => value.expiresAt > value.createdAt && value.writeFields.every(field => value.readFields.includes(field)));
const preview = z.strictObject({ id: uuid, grantId: uuid, operationId: operation, assetId: id, expectedVersion: hash, patchHash: hash,
  expiresAt: stamp, approvedAt: stamp.optional(), rejectedAt: stamp.optional() }).refine(value => value.approvedAt === undefined || value.rejectedAt === undefined);
const receipt = z.strictObject({ operationId: operation, grantId: uuid, previewId: uuid, patchHash: hash, assetId: id,
  state: z.enum(['pending', 'applied']), createdAt: stamp, completedAt: stamp.optional() })
  .refine(value => value.state === 'pending' ? value.completedAt === undefined : value.completedAt !== undefined);
const audit = z.strictObject({ id: uuid, at: stamp, grantId: uuid,
  action: z.enum(['list', 'get', 'preview', 'confirm', 'grant', 'revoke', 'approve', 'reject']),
  outcome: z.enum(['allowed', 'denied', 'applied', 'duplicate', 'conflict']), assetId: id.optional(),
  fieldNames: z.array(z.enum(readableFields)).max(readableFields.length).refine(value => new Set(value).size === value.length).optional(), operationId: operation.optional() });
const schema = z.strictObject({ grants: z.array(grant).max(1024), previews: z.array(preview).max(2048),
  operations: z.array(receipt).max(4096), audit: z.array(audit).max(8192) });
function unique(values: string[]) { return values.length === new Set(values).size; }
export function checkedNativeMcpAuthorityState(input: unknown): AuthorityState {
  const result = schema.safeParse(input);
  if (!result.success) throw Error('mcp-native-state');
  const state = result.data;
  if (!unique(state.grants.map(row => row.id)) || !unique(state.previews.map(row => row.id)) ||
    !unique(state.previews.map(row => `${row.grantId}:${row.operationId}`)) ||
    !unique(state.operations.map(row => `${row.grantId}:${row.operationId}`)) || !unique(state.audit.map(row => row.id))) throw Error('mcp-native-state');
  return state;
}
function encode(input: unknown): string {
  const payload = JSON.stringify(checkedNativeMcpAuthorityState(input));
  if (utf8ToBytes(payload).length > nativeMcpAuthorityLimit) throw Error('mcp-native-state');
  return payload;
}
function decode(payload: unknown): AuthorityState {
  if (typeof payload !== 'string' || payload.length > nativeMcpAuthorityLimit || utf8ToBytes(payload).length > nativeMcpAuthorityLimit) throw Error('mcp-native-state');
  let input: unknown; try { input = JSON.parse(payload); } catch { throw Error('mcp-native-state'); }
  return checkedNativeMcpAuthorityState(input);
}
export function nativeMcpAuthorityScope(dataset: string): string {
  if (typeof dataset !== 'string' || !/^[a-z][a-z0-9-]{2,60}$/.test(dataset)) throw Error('mcp-native-scope');
  return bytesToHex(sha256(utf8ToBytes(dataset)));
}
/** Scope is an immutable dataset identity, never a default or an archive-provided path. */
export function createNativeMcpAuthorityStorage(dataset: string, bridge: NativeMcpAuthorityPlugin = native): AuthorityStorage {
  const scope = nativeMcpAuthorityScope(dataset);
  let initialized: Promise<void> | undefined, tail: Promise<unknown> = Promise.resolve();
  const call = async <T>(work: () => Promise<T>): Promise<T> => {
    try { return await work(); } catch { throw Error('mcp-native-unavailable'); }
  };
  const ready = async () => {
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('KeepAnyMcpAuthority')) throw Error('mcp-native-unavailable');
    if (!initialized) initialized = call(() => bridge.initialize({ scope })).catch(error => { initialized = undefined; throw error; });
    await initialized;
  };
  const read = async () => {
    await ready(); const result = await call(() => bridge.readState({ scope }));
    if (!result || !uuid.safeParse(result.revision).success || Object.keys(result).sort().join(',') !== 'payload,revision') throw Error('mcp-native-state');
    return { revision: result.revision, state: decode(result.payload) };
  };
  return {
    async read() { await tail; return (await read()).state; },
    update<T>(change: (state: AuthorityState) => T | Promise<T>): Promise<T> {
      const work = tail.then(async () => {
        const current = await read(), draft = structuredClone(current.state);
        // The callback runs once. In particular, a lost acknowledgement or CAS
        // conflict must not replay an async mutation with external side effects.
        const result = await change(draft), payload = encode(draft);
        const response = await call(() => bridge.compareAndSet({ scope, expectedRevision: current.revision, payload }));
        if (!response || typeof response.committed !== 'boolean' || Object.keys(response).join(',') !== 'committed') throw Error('mcp-native-state');
        if (!response.committed) throw Error('mcp-native-conflict');
        return result;
      });
      tail = work.catch(() => undefined); return work;
    },
  };
}
