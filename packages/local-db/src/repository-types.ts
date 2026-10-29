import type { EntityType } from "../../domain/src";
import type { SyncOperation } from "../../contracts/src";

export interface RecordRow { id: string; type: EntityType; payload: string; updatedAt: number }

export interface PulledRow { row: RecordRow; sequence: number; version: number; operationId?: string; keyEpoch?: number; ciphertext?: string }

export interface ScopedOutbox { id: string; scope: string; row: RecordRow; operation: SyncOperation; blocked?: boolean }

export interface ScopedConflict { rowId: string; localPayload: string | null; remotePayload: string; basePayload: string | null; remoteVersion: number }

export interface DatasetBinding { endpoint: string; accountId: string; workspaceId: string; scope: string }

export interface ScopedAttachmentUploadPlan {
  scope: string;
  attachmentId: string;
  sourceSha256: string;
  keyEpoch: number;
  objects: Array<{ id: string; sha256: string; bytes: Uint8Array }>;
}
