import { createHash } from 'node:crypto';
import {
  syncChangeSchema, syncOperationSchema, syncPullRequestSchema, syncPushRequestSchema, syncPushResultSchema,
  type SyncChange, type SyncOperation, type SyncPullRequest, type SyncPushRequest, type SyncPushResult,
} from '../../contracts/src';

// The production pg Pool and the test Postgres WASM adapter both implement this surface.
export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}
export interface SqlPool { connect(): Promise<SqlClient> }

export class SyncForbiddenError extends Error { constructor() { super('forbidden'); } }
export async function withSqlTransaction<T>(pool: SqlPool, run: (client: SqlClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let begun = false;
  try {
    await client.query('BEGIN');
    begun = true;
    const value = await run(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    if (begun) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function requireSyncMembership(client: SqlClient, workspaceId: string, subjectId: string, scope: 'read' | 'write'): Promise<void> {
  if (!subjectId) throw new SyncForbiddenError();
  const result = await client.query(
    'SELECT can_read, can_write FROM sync_memberships WHERE workspace_id=$1 AND subject_id=$2 AND revoked_at IS NULL FOR SHARE',
    [workspaceId, subjectId],
  );
  const member = result.rows[0];
  if (!member || member[scope === 'read' ? 'can_read' : 'can_write'] !== true) throw new SyncForbiddenError();
}
const numeric = (value: unknown): number => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw Error('sync-sequence-range');
  return number;
};

export class PostgresSyncService {
  constructor(private readonly pool: SqlPool) {}

  async assertWorkspaceAccess(workspaceId: string, subjectId: string): Promise<void> {
    await withSqlTransaction(this.pool, async client => {
      await requireSyncMembership(client, workspaceId, subjectId, 'read');
      await requireSyncMembership(client, workspaceId, subjectId, 'write');
      const workspace = await client.query('SELECT workspace_id FROM sync_workspaces WHERE workspace_id=$1 FOR SHARE', [workspaceId]);
      if (!workspace.rows[0]) throw new SyncForbiddenError();
    });
  }

  async createWorkspace(subjectId: string): Promise<string> {
    if (!subjectId || subjectId.length > 200) throw Error('subject');
    const workspaceId = crypto.randomUUID();
    await withSqlTransaction(this.pool, async client => {
      await client.query('INSERT INTO sync_workspaces (workspace_id) VALUES ($1)', [workspaceId]);
      await client.query('INSERT INTO sync_memberships (workspace_id, subject_id, can_read, can_write) VALUES ($1,$2,true,true)', [workspaceId, subjectId]);
    });
    return workspaceId;
  }

  async push(input: SyncPushRequest, subjectId: string): Promise<{ results: SyncPushResult[] }> {
    const request = syncPushRequestSchema.parse(input);
    const results: SyncPushResult[] = [];
    // Commit each operation independently. A restarted batch reuses operationId for exact replay.
    for (const operation of request.operations) {
      results.push(await withSqlTransaction(this.pool, client => this.apply(client, request.workspaceId, subjectId, operation)));
    }
    return { results };
  }

  private async apply(client: SqlClient, workspaceId: string, subjectId: string, input: SyncOperation): Promise<SyncPushResult> {
    const operation = syncOperationSchema.parse(input);
    await requireSyncMembership(client, workspaceId, subjectId, 'write');
    const workspaceResult = await client.query('SELECT next_sequence FROM sync_workspaces WHERE workspace_id=$1 FOR UPDATE', [workspaceId]);
    if (!workspaceResult.rows[0]) throw new SyncForbiddenError();
    const fingerprint = createHash('sha256').update(JSON.stringify(operation)).digest('hex');
    const oldOperation = await client.query('SELECT fingerprint, result FROM sync_operations WHERE workspace_id=$1 AND operation_id=$2', [workspaceId, operation.operationId]);
    if (oldOperation.rows[0]) {
      const prior = syncPushResultSchema.parse(oldOperation.rows[0].result);
      if (oldOperation.rows[0].fingerprint !== fingerprint) return {
        operationId: operation.operationId, status: 'rejected', version: prior.version,
        sequence: prior.sequence, reason: 'operation-reused',
      };
      return prior.status === 'accepted' ? { ...prior, status: 'duplicate' } : prior;
    }
    const existingResult = await client.query(
      'SELECT version, sequence, tombstone FROM sync_documents WHERE workspace_id=$1 AND doc_id=$2',
      [workspaceId, operation.id],
    );
    const current = existingResult.rows[0];
    const currentVersion = current ? numeric(current.version) : 0;
    let result: SyncPushResult;
    if (currentVersion !== operation.expectedVersion) {
      result = { operationId: operation.operationId, status: 'conflict', version: currentVersion,
        sequence: current ? numeric(current.sequence) : 0, reason: 'version' };
    } else if (current?.tombstone === true && !operation.tombstone && operation.intent !== 'restore') {
      result = { operationId: operation.operationId, status: 'conflict', version: currentVersion,
        sequence: numeric(current.sequence), reason: 'tombstone' };
    } else {
      const next = await client.query('UPDATE sync_workspaces SET next_sequence=next_sequence+1 WHERE workspace_id=$1 RETURNING next_sequence', [workspaceId]);
      const sequence = numeric(next.rows[0].next_sequence);
      const version = currentVersion + 1;
      await client.query(`INSERT INTO sync_documents
        (workspace_id,doc_id,kind,schema_version,ciphertext,tombstone,version,sequence)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (workspace_id,doc_id) DO UPDATE SET
        kind=EXCLUDED.kind,schema_version=EXCLUDED.schema_version,ciphertext=EXCLUDED.ciphertext,
        tombstone=EXCLUDED.tombstone,version=EXCLUDED.version,sequence=EXCLUDED.sequence`,
      [workspaceId, operation.id, operation.kind, operation.schemaVersion, operation.ciphertext, operation.tombstone, version, sequence]);
      await client.query(`INSERT INTO sync_changes
        (workspace_id,sequence,operation_id,doc_id,kind,schema_version,ciphertext,tombstone,version)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [workspaceId, sequence, operation.operationId, operation.id, operation.kind, operation.schemaVersion, operation.ciphertext, operation.tombstone, version]);
      result = { operationId: operation.operationId, status: 'accepted', version, sequence };
    }
    await client.query(
      'INSERT INTO sync_operations (workspace_id,operation_id,fingerprint,result) VALUES ($1,$2,$3,$4::jsonb)',
      [workspaceId, operation.operationId, fingerprint, JSON.stringify(result)],
    );
    return result;
  }

  async pull(input: SyncPullRequest, subjectId: string): Promise<{ changes: SyncChange[]; nextCursor: number }> {
    const request = syncPullRequestSchema.parse(input);
    return withSqlTransaction(this.pool, async client => {
      await requireSyncMembership(client, request.workspaceId, subjectId, 'read');
      const page = await client.query(`SELECT sequence,operation_id,doc_id,kind,schema_version,ciphertext,tombstone,version
        FROM sync_changes WHERE workspace_id=$1 AND sequence>$2 ORDER BY sequence ASC LIMIT $3`,
      [request.workspaceId, request.cursor, request.limit]);
      const changes = page.rows.map(row => syncChangeSchema.parse({
        operationId: row.operation_id, id: row.doc_id, kind: row.kind, schemaVersion: numeric(row.schema_version),
        ciphertext: row.ciphertext, tombstone: row.tombstone,
        version: numeric(row.version), sequence: numeric(row.sequence),
      }));
      return { changes, nextCursor: changes.at(-1)?.sequence ?? request.cursor };
    });
  }
}
