import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import {
  syncChangeSchema, syncOperationSchema, syncPullRequestSchema, syncPushRequestSchema,
  type SyncChange, type SyncOperation, type SyncPullRequest, type SyncPushRequest, type SyncPushResult,
} from '../../contracts/src';

const operationResultSchema = z.object({ fingerprint: z.string(), result: z.object({
  operationId: z.uuid(), status: z.enum(['accepted','duplicate','conflict','rejected']),
  version: z.number().int().nonnegative(), sequence: z.number().int().nonnegative(),
  reason: z.enum(['version','tombstone','operation-reused']).optional(),
}) });
const workspaceSchema = z.object({
  sequence: z.number().int().nonnegative(),
  documents: z.record(z.string(), syncChangeSchema),
  changes: z.array(syncChangeSchema),
  operations: z.record(z.string(), operationResultSchema),
});
const stateSchema = z.object({ version: z.literal(1), workspaces: z.record(z.string(), workspaceSchema) });
const legacyChangeSchema = z.union([syncChangeSchema, syncChangeSchema.omit({ operationId: true })]);
const legacyStateSchema = stateSchema.extend({ workspaces: z.record(z.string(), workspaceSchema.extend({
  documents: z.record(z.string(), legacyChangeSchema), changes: z.array(legacyChangeSchema),
})) });
export type SyncState = z.infer<typeof stateSchema>;
const emptyState = (): SyncState => ({ version: 1, workspaces: {} });
const emptyWorkspace = (): SyncState['workspaces'][string] => ({ sequence: 0, documents: {}, changes: [], operations: {} });

export interface SyncStateStore {
  load(): Promise<SyncState>;
  save(state: SyncState): Promise<void>;
}

export class MemorySyncStateStore implements SyncStateStore {
  private state = emptyState();
  async load() { return structuredClone(this.state); }
  async save(state: SyncState) { this.state = structuredClone(stateSchema.parse(state)); }
}

// Stage 0 single-process durable adapter. Production must use a transactional shared store.
export class JsonFileSyncStateStore implements SyncStateStore {
  constructor(private readonly path: string) {}
  async load(): Promise<SyncState> {
    try {
      const stored = legacyStateSchema.parse(JSON.parse(await readFile(this.path, 'utf8')));
      const workspaces = Object.fromEntries(Object.entries(stored.workspaces).map(([workspaceId, workspace]) => {
        const accepted = new Map<number, SyncOperation>();
        for (const [operationId, entry] of Object.entries(workspace.operations)) {
          if (entry.result.status !== 'accepted') continue;
          const operation = syncOperationSchema.parse(JSON.parse(entry.fingerprint));
          if (operation.operationId !== operationId || entry.result.operationId !== operationId ||
              accepted.has(entry.result.sequence)) throw Error('sync-change-operation-backfill');
          accepted.set(entry.result.sequence, operation);
        }
        const upgrade = (change: z.infer<typeof legacyChangeSchema>): SyncChange => {
          if ('operationId' in change) return syncChangeSchema.parse(change);
          const operation = accepted.get(change.sequence);
          if (!operation || operation.id !== change.id || operation.kind !== change.kind ||
              operation.ciphertext !== change.ciphertext || operation.tombstone !== change.tombstone) {
            throw Error('sync-change-operation-backfill');
          }
          return { ...change, operationId: operation.operationId };
        };
        return [workspaceId, { ...workspace, documents: Object.fromEntries(
          Object.entries(workspace.documents).map(([id, change]) => [id, upgrade(change)])),
          changes: workspace.changes.map(upgrade) }];
      }));
      return stateSchema.parse({ ...stored, workspaces });
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
      throw error;
    }
  }
  async save(state: SyncState): Promise<void> {
    const checked = stateSchema.parse(state);
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(checked), { mode: 0o600 });
    await rename(temporary, this.path);
  }
}

export class SyncService {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly store: SyncStateStore, private readonly onCommitted?: () => void | Promise<void>) {}

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async push(input: SyncPushRequest): Promise<{ results: SyncPushResult[] }> {
    const request = syncPushRequestSchema.parse(input);
    const results: SyncPushResult[] = [];
    for (const operation of request.operations) {
      const result = await this.serialized(() => this.apply(request.workspaceId, operation));
      results.push(result);
      if (result.status === 'accepted') await this.onCommitted?.();
    }
    return { results };
  }

  private async apply(workspaceId: string, input: SyncOperation): Promise<SyncPushResult> {
    const operation = syncOperationSchema.parse(input);
    const state = await this.store.load();
    const workspace = state.workspaces[workspaceId] ?? emptyWorkspace();
    const fingerprint = JSON.stringify(operation);
    const previous = workspace.operations[operation.operationId];
    if (previous) {
      if (previous.fingerprint !== fingerprint) return {
        operationId: operation.operationId, status: 'rejected',
        version: previous.result.version, sequence: previous.result.sequence, reason: 'operation-reused',
      };
      return previous.result.status === 'accepted' ? { ...previous.result, status: 'duplicate' } : previous.result;
    }
    const current = workspace.documents[operation.id];
    let result: SyncPushResult;
    if ((current?.version ?? 0) !== operation.expectedVersion) {
      result = { operationId: operation.operationId, status: 'conflict', version: current?.version ?? 0,
        sequence: current?.sequence ?? 0, reason: 'version' };
    } else if (current?.tombstone && !operation.tombstone && operation.intent !== 'restore') {
      result = { operationId: operation.operationId, status: 'conflict', version: current.version,
        sequence: current.sequence, reason: 'tombstone' };
    } else {
      const version = (current?.version ?? 0) + 1;
      const sequence = ++workspace.sequence;
      const change: SyncChange = { operationId: operation.operationId, id: operation.id, kind: operation.kind, schemaVersion: operation.schemaVersion,
        ciphertext: operation.ciphertext, tombstone: operation.tombstone, version, sequence };
      workspace.documents[operation.id] = change;
      workspace.changes.push(change);
      result = { operationId: operation.operationId, status: 'accepted', version, sequence };
    }
    workspace.operations[operation.operationId] = { fingerprint, result };
    state.workspaces[workspaceId] = workspace;
    await this.store.save(state);
    return result;
  }

  async pull(input: SyncPullRequest): Promise<{ changes: SyncChange[]; nextCursor: number }> {
    const request = syncPullRequestSchema.parse(input);
    return this.serialized(async () => {
      const state = await this.store.load();
      const workspace = state.workspaces[request.workspaceId] ?? emptyWorkspace();
      const changes = workspace.changes.filter(change => change.sequence > request.cursor).slice(0, request.limit);
      return { changes, nextCursor: changes.at(-1)?.sequence ?? request.cursor };
    });
  }
}

export type AuthorizeSync = (authorization: string | undefined, scope: 'sync:read' | 'sync:write') => Promise<string | null>;
export function createSyncApp(service: SyncService, authorize: AuthorizeSync) {
  const app = new Hono();
  app.use('*', bodyLimit({ maxSize: 4 * 1024 * 1024 }));
  app.post('/sync/push', async c => {
    const workspaceId = await authorize(c.req.header('authorization'), 'sync:write');
    if (!workspaceId) return c.json({ error: 'unauthorized' }, 401);
    try {
      const request = syncPushRequestSchema.parse(await c.req.json());
      if (request.workspaceId !== workspaceId) return c.json({ error: 'workspace' }, 403);
      return c.json(await service.push(request));
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ error: 'invalid-request' }, 400);
      throw error;
    }
  });
  app.post('/sync/pull', async c => {
    const workspaceId = await authorize(c.req.header('authorization'), 'sync:read');
    if (!workspaceId) return c.json({ error: 'unauthorized' }, 401);
    try {
      const request = syncPullRequestSchema.parse(await c.req.json());
      if (request.workspaceId !== workspaceId) return c.json({ error: 'workspace' }, 403);
      return c.json(await service.pull(request));
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ error: 'invalid-request' }, 400);
      throw error;
    }
  });
  return app;
}
