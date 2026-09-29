import { createHash } from 'node:crypto';
import {
  syncChangeSchema, syncOperationSchema, syncPullRequestSchema, syncPushRequestSchema, syncPushResultSchema,
  type SyncChange, type SyncOperation, type SyncPullRequest, type SyncPushRequest, type SyncPushResult,
} from '../../contracts/src';
import type { RecoveryWrap } from '../../crypto/src';

// The production pg Pool and the test Postgres WASM adapter both implement this surface.
export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}
export interface SqlPool { connect(): Promise<SqlClient> }

export class SyncForbiddenError extends Error { constructor() { super('forbidden'); } }
export class KeyEnvelopeConflictError extends Error { constructor() { super('key-envelope-conflict'); } }
export class KeyEnvelopeNotFoundError extends Error { constructor() { super('key-envelope-not-found'); } }
export type KeyEnvelopeKind = 'recovery' | 'join';
export interface KeyEnvelopeInput {
  kind: KeyEnvelopeKind;
  wrap: RecoveryWrap;
  keyFingerprint: string;
  expiresInSeconds?: number;
}
export interface KeyEnvelopeMetadata {
  envelopeId: string;
  kind: KeyEnvelopeKind;
  keyEpoch: 1;
  keyFingerprint: string;
  createdAt: string;
  expiresAt: string | null;
}
export interface KeyEnvelope extends KeyEnvelopeMetadata { wrap: RecoveryWrap }

function keyEnvelopeMetadata(row: Record<string, unknown>): KeyEnvelopeMetadata {
  return {
    envelopeId: String(row.envelope_id), kind: row.kind as KeyEnvelopeKind, keyEpoch: 1,
    keyFingerprint: String(row.key_fingerprint).trim(),
    createdAt: new Date(String(row.created_at)).toISOString(),
    expiresAt: row.expires_at == null ? null : new Date(String(row.expires_at)).toISOString(),
  };
}

function keyEnvelope(row: Record<string, unknown>): KeyEnvelope {
  return { ...keyEnvelopeMetadata(row), wrap: row.wrap as RecoveryWrap };
}
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

  async createKeyEnvelope(workspaceId: string, subjectId: string, input: KeyEnvelopeInput): Promise<KeyEnvelopeMetadata> {
    return withSqlTransaction(this.pool, async client => {
      await requireSyncMembership(client, workspaceId, subjectId, 'write');
      // Lock the workspace to serialize the first fingerprint anchor and recovery creation.
      const workspace = await client.query('SELECT key_fingerprint FROM sync_workspaces WHERE workspace_id=$1 FOR UPDATE', [workspaceId]);
      if (!workspace.rows[0]) throw new SyncForbiddenError();
      const anchored = workspace.rows[0].key_fingerprint;
      if (anchored != null && String(anchored).trim() !== input.keyFingerprint) throw new KeyEnvelopeConflictError();
      if (input.kind === 'recovery') {
        const existing = await client.query(
          `SELECT envelope_id FROM sync_key_envelopes
           WHERE workspace_id=$1 AND kind='recovery' AND revoked_at IS NULL`, [workspaceId],
        );
        if (existing.rows[0]) throw new KeyEnvelopeConflictError();
      }
      const envelopeId = crypto.randomUUID();
      const inserted = await client.query(
        `INSERT INTO sync_key_envelopes
           (envelope_id,workspace_id,kind,key_epoch,key_fingerprint,wrap,expires_at)
         VALUES ($1,$2,$3,1,$4,$5::jsonb,
           CASE WHEN $6::integer IS NULL THEN NULL ELSE now() + ($6::integer * interval '1 second') END)
         RETURNING envelope_id,kind,key_epoch,key_fingerprint,created_at,expires_at`,
        [envelopeId, workspaceId, input.kind, input.keyFingerprint, JSON.stringify(input.wrap), input.expiresInSeconds ?? null],
      );
      if (anchored == null) await client.query(
        'UPDATE sync_workspaces SET key_fingerprint=$2 WHERE workspace_id=$1', [workspaceId, input.keyFingerprint],
      );
      return keyEnvelopeMetadata(inserted.rows[0]);
    });
  }

  async listKeyEnvelopes(workspaceId: string, subjectId: string): Promise<KeyEnvelopeMetadata[]> {
    return withSqlTransaction(this.pool, async client => {
      await requireSyncMembership(client, workspaceId, subjectId, 'read');
      const result = await client.query(
        `SELECT envelope_id,kind,key_epoch,key_fingerprint,created_at,expires_at
         FROM sync_key_envelopes WHERE workspace_id=$1 AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > now())
         ORDER BY created_at DESC,envelope_id DESC`, [workspaceId],
      );
      return result.rows.map(keyEnvelopeMetadata);
    });
  }

  async getKeyEnvelope(workspaceId: string, envelopeId: string, subjectId: string): Promise<KeyEnvelope> {
    return withSqlTransaction(this.pool, async client => {
      await requireSyncMembership(client, workspaceId, subjectId, 'read');
      const result = await client.query(
        `SELECT envelope_id,kind,key_epoch,key_fingerprint,wrap,created_at,expires_at
         FROM sync_key_envelopes WHERE workspace_id=$1 AND envelope_id=$2 AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > now())`, [workspaceId, envelopeId],
      );
      if (!result.rows[0]) throw new KeyEnvelopeNotFoundError();
      return keyEnvelope(result.rows[0]);
    });
  }

  async revokeKeyEnvelope(workspaceId: string, envelopeId: string, subjectId: string): Promise<void> {
    await withSqlTransaction(this.pool, async client => {
      await requireSyncMembership(client, workspaceId, subjectId, 'write');
      const result = await client.query(
        `UPDATE sync_key_envelopes SET revoked_at=now()
         WHERE workspace_id=$1 AND envelope_id=$2 AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > now())
         RETURNING envelope_id`, [workspaceId, envelopeId],
      );
      if (!result.rows[0]) throw new KeyEnvelopeNotFoundError();
    });
  }

  async listWorkspaces(subjectId: string): Promise<Array<{ workspaceId: string; canRead: boolean; canWrite: boolean }>> {
    if (!subjectId || subjectId.length > 200) throw Error('subject');
    const client = await this.pool.connect();
    try {
      const memberships = await client.query(
        `SELECT workspace_id, can_read, can_write FROM sync_memberships
         WHERE subject_id=$1 AND revoked_at IS NULL AND (can_read OR can_write)
         ORDER BY created_at ASC, workspace_id ASC`, [subjectId],
      );
      return memberships.rows.map(row => ({
        workspaceId: String(row.workspace_id), canRead: row.can_read === true, canWrite: row.can_write === true,
      }));
    } finally {
      client.release();
    }
  }

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
