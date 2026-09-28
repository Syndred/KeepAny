import { createHash } from 'node:crypto';
import { z } from 'zod';
import { requireSyncMembership, type SqlPool, withSqlTransaction } from './postgres';

export const MAX_CIPHERTEXT_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const CIPHERTEXT_ATTACHMENT_TYPE = 'application/vnd.keepany.ciphertext';
const attachmentIdSchema = z.uuid();
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);

// Object-store keys are server-derived. Clients never choose a bucket or key.
export interface CiphertextObjectStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
}

export class AttachmentConflictError extends Error { constructor() { super('attachment-conflict'); } }
export class AttachmentNotFoundError extends Error { constructor() { super('attachment-not-found'); } }
export class AttachmentInvalidError extends Error { constructor() { super('attachment-invalid'); } }
export class AttachmentIntegrityError extends Error { constructor() { super('attachment-integrity'); } }

function key(workspaceId: string, attachmentId: string): string { return `${workspaceId}/${attachmentId}`; }
function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

export class AttachmentService {
  constructor(private readonly pool: SqlPool, private readonly objects: CiphertextObjectStore) {}

  async put(input: { workspaceId: string; attachmentId: string; sha256: string; bytes: Uint8Array }, subjectId: string) {
    const workspaceId = attachmentIdSchema.parse(input.workspaceId);
    const attachmentId = attachmentIdSchema.parse(input.attachmentId);
    const sha256 = digestSchema.parse(input.sha256);
    const bytes = input.bytes;
    if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > MAX_CIPHERTEXT_ATTACHMENT_BYTES || digest(bytes) !== sha256) {
      throw new AttachmentInvalidError();
    }
    const wasReady = await withSqlTransaction(this.pool, async client => {
      await requireSyncMembership(client, workspaceId, subjectId, 'write');
      await client.query(`INSERT INTO sync_attachments
        (workspace_id,attachment_id,sha256,size_bytes,status,uploaded_by)
        VALUES ($1,$2,$3,$4,'pending',$5) ON CONFLICT (workspace_id,attachment_id) DO NOTHING`,
      [workspaceId, attachmentId, sha256, bytes.length, subjectId]);
      const existing = await client.query(`SELECT sha256,size_bytes,status FROM sync_attachments
        WHERE workspace_id=$1 AND attachment_id=$2 FOR UPDATE`, [workspaceId, attachmentId]);
      const row = existing.rows[0];
      if (row?.sha256 !== sha256 || Number(row.size_bytes) !== bytes.length) throw new AttachmentConflictError();
      return row.status === 'ready';
    });

    // If the object write succeeded but the final SQL update was interrupted, the same request can safely replay.
    await this.objects.put(key(workspaceId, attachmentId), bytes);
    await withSqlTransaction(this.pool, async client => {
      await requireSyncMembership(client, workspaceId, subjectId, 'write');
      const updated = await client.query(`UPDATE sync_attachments SET status='ready',updated_at=now()
        WHERE workspace_id=$1 AND attachment_id=$2 AND sha256=$3 AND size_bytes=$4 RETURNING attachment_id`,
      [workspaceId, attachmentId, sha256, bytes.length]);
      if (!updated.rows[0]) throw new AttachmentConflictError();
    });
    return { sha256, size: bytes.length, status: wasReady ? 'duplicate' as const : 'stored' as const };
  }

  async get(workspaceIdInput: string, attachmentIdInput: string, subjectId: string) {
    const workspaceId = attachmentIdSchema.parse(workspaceIdInput);
    const attachmentId = attachmentIdSchema.parse(attachmentIdInput);
    const metadata = await withSqlTransaction(this.pool, async client => {
      await requireSyncMembership(client, workspaceId, subjectId, 'read');
      const result = await client.query(`SELECT sha256,size_bytes,status FROM sync_attachments
        WHERE workspace_id=$1 AND attachment_id=$2`, [workspaceId, attachmentId]);
      return result.rows[0];
    });
    if (!metadata || metadata.status !== 'ready') throw new AttachmentNotFoundError();
    const bytes = await this.objects.get(key(workspaceId, attachmentId));
    if (!bytes || bytes.length !== Number(metadata.size_bytes) || digest(bytes) !== metadata.sha256) {
      throw new AttachmentIntegrityError();
    }
    return { bytes, sha256: metadata.sha256 as string };
  }
}
