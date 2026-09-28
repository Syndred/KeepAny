import { z } from 'zod';
import type { LocalRepository, RecordRow, ScopedAttachmentUploadPlan } from '../../local-db/src';
import { openAttachment, sealAttachment } from './attachment-codec';
import type { BoundSyncAuthorizer } from './index';

const ciphertextType = 'application/vnd.keepany.ciphertext';
const maxObjectBytes = 4 * 1024 * 1024;
const responseSchema = z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/), size: z.number().int().positive(),
  status: z.enum(['stored', 'duplicate']) });

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}

function attachmentIds(row: RecordRow): string[] {
  if (row.type !== 'asset') return [];
  const value = JSON.parse(row.payload) as { attachments?: unknown };
  return z.array(z.uuid()).max(20).parse(value.attachments ?? []);
}

export class SelfHostAttachmentSync {
  constructor(private readonly repository: LocalRepository, private readonly scope: string,
    private readonly endpoint: string, private readonly token: string | undefined, private readonly workspaceId: string,
    private readonly key: Uint8Array, private readonly keyEpoch: number,
    private readonly sessionAccountId?: string, private readonly bound?: BoundSyncAuthorizer) {
    if (Number(token !== undefined) + Number(Boolean(sessionAccountId)) + Number(Boolean(bound)) !== 1)
      throw Error('sync-auth');
  }

  private requestCredentials(): RequestCredentials { return this.sessionAccountId ? 'include' : 'omit'; }
  private async assertCurrent(): Promise<void> { await this.bound?.assertCurrent(); }
  private async requestHeaders(method: 'GET' | 'PUT', url: string): Promise<Record<string, string>> {
    if (this.bound) return this.bound.headers(method, url);
    return this.sessionAccountId ? { 'X-KeepAny-Account-Id': this.sessionAccountId } :
      { Authorization: `Bearer ${this.token}` };
  }

  private path(id: string): string {
    return `${this.endpoint}/workspaces/${this.workspaceId}/attachments/${z.uuid().parse(id)}`;
  }

  private async getObject(id: string): Promise<Uint8Array | null> {
    const url = this.path(id);
    await this.assertCurrent();
    const headers = await this.requestHeaders('GET', url);
    await this.assertCurrent();
    const response = await fetch(url, { method: 'GET', headers,
      cache: 'no-store', credentials: this.requestCredentials(), signal: AbortSignal.timeout(30_000) });
    await this.assertCurrent();
    if (response.status === 404) return null;
    if (response.status === 401 || response.status === 403) throw Error('sync-auth');
    if (response.status === 502) throw Error('sync-attachment-integrity');
    if (!response.ok) throw Error(`sync-attachment-http-${response.status}`);
    if (response.headers.get('content-type') !== ciphertextType) throw Error('sync-attachment-content-type');
    const declared = Number(response.headers.get('content-length'));
    if (declared > maxObjectBytes) throw Error('sync-attachment-size');
    if (!response.body) throw Error('sync-attachment-empty');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.length;
        if (length > maxObjectBytes) throw Error('sync-attachment-size');
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const expected = response.headers.get('x-ciphertext-sha256');
    if (!expected || expected !== await digest(bytes)) throw Error('sync-attachment-integrity');
    await this.assertCurrent();
    return bytes;
  }

  private async putObject(object: { id: string; sha256: string; bytes: Uint8Array }): Promise<void> {
    if (object.bytes.length > maxObjectBytes || object.sha256 !== await digest(object.bytes)) throw Error('sync-attachment-integrity');
    const body = new ArrayBuffer(object.bytes.length);
    new Uint8Array(body).set(object.bytes);
    const url = this.path(object.id);
    await this.assertCurrent();
    const headers = await this.requestHeaders('PUT', url);
    await this.assertCurrent();
    const response = await fetch(url, { method: 'PUT', headers: {
      ...headers, 'Content-Type': ciphertextType,
      'X-Ciphertext-SHA256': object.sha256,
    }, body, cache: 'no-store', credentials: this.requestCredentials(), signal: AbortSignal.timeout(30_000) });
    await this.assertCurrent();
    if (response.status === 401 || response.status === 403) throw Error('sync-auth');
    if (response.status === 409) throw Error('sync-attachment-conflict');
    if (!response.ok) throw Error(`sync-attachment-http-${response.status}`);
    const receipt = responseSchema.parse(await response.json());
    if (receipt.sha256 !== object.sha256 || receipt.size !== object.bytes.length) throw Error('sync-attachment-receipt');
    await this.assertCurrent();
  }

  private async openRemote(id: string, manifestBytes: Uint8Array) {
    return openAttachment({ workspaceId: this.workspaceId, attachmentId: id, key: this.key,
      keyEpoch: this.keyEpoch, manifestBytes, loadObject: async objectId => {
        const bytes = await this.getObject(objectId);
        if (!bytes) throw Error('sync-attachment-remote-missing');
        return bytes;
      } });
  }

  private assertMatchesLocal(opened: { name: string; type: string; sha256: string },
    local: { name: string; type: string }, sourceSha256: string): void {
    if (opened.sha256 !== sourceSha256 || opened.name !== local.name || opened.type !== local.type)
      throw Error('sync-attachment-conflict');
  }

  private async acceptRemote(id: string, local: { name: string; type: string },
    sourceSha256: string, clearPlan: boolean): Promise<boolean> {
    const manifest = await this.getObject(id);
    if (!manifest) return false;
    const opened = await this.openRemote(id, manifest);
    this.assertMatchesLocal(opened, local, sourceSha256);
    if (clearPlan) {
      await this.assertCurrent();
      await this.repository.deleteScopedAttachmentUpload(this.scope, id);
    }
    return true;
  }

  private async assertPlanMatchesLocal(plan: ScopedAttachmentUploadPlan,
    local: { name: string; type: string }, sourceSha256: string): Promise<void> {
    const objects = new Map(plan.objects.map(object => [object.id, object.bytes]));
    const manifestBytes = objects.get(plan.attachmentId);
    if (!manifestBytes) throw Error('sync-attachment-plan');
    const opened = await openAttachment({ workspaceId: this.workspaceId, attachmentId: plan.attachmentId,
      key: this.key, keyEpoch: this.keyEpoch, manifestBytes, loadObject: async objectId => {
        const bytes = objects.get(objectId);
        if (!bytes) throw Error('sync-attachment-plan');
        return bytes;
      } });
    if (opened.sha256 !== sourceSha256 || opened.name !== local.name || opened.type !== local.type)
      throw Error('sync-attachment-local-changed');
  }

  private async uploadPlan(plan: ScopedAttachmentUploadPlan,
    local: { name: string; type: string }, sourceSha256: string): Promise<void> {
    for (const object of plan.objects) await this.putObject(object);
    // Require readback and AEAD validation before any asset record can reference the objects.
    const manifest = await this.getObject(plan.attachmentId);
    if (!manifest) throw Error('sync-attachment-remote-missing');
    const opened = await this.openRemote(plan.attachmentId, manifest);
    this.assertMatchesLocal(opened, local, sourceSha256);
  }

  private async uploadOrAcceptWinner(plan: ScopedAttachmentUploadPlan,
    local: { name: string; type: string }, sourceSha256: string): Promise<void> {
    try {
      await this.uploadPlan(plan, local, sourceSha256);
    } catch (error) {
      // A different device may have committed its manifest after our initial 404.
      // Only a complete, AEAD-verified and semantically equal remote attachment wins.
      if (!(error instanceof Error) || error.message !== 'sync-attachment-conflict' ||
        !await this.acceptRemote(plan.attachmentId, local, sourceSha256, true)) throw error;
    }
  }

  async ensureUploaded(id: string): Promise<void> {
    const local = await this.repository.readFile(id);
    if (!local) throw Error('sync-attachment-local-missing');
    const sourceSha256 = await digest(local.bytes);
    let plan = await this.repository.getScopedAttachmentUpload(this.scope, id);
    if (plan) {
      if (plan.sourceSha256 !== sourceSha256 || plan.keyEpoch !== this.keyEpoch) throw Error('sync-attachment-local-changed');
      await this.assertPlanMatchesLocal(plan, local, sourceSha256);
      if (await this.acceptRemote(id, local, sourceSha256, true)) return;
      await this.uploadOrAcceptWinner(plan, local, sourceSha256);
      return;
    }
    if (await this.acceptRemote(id, local, sourceSha256, false)) return;
    const sealed = await sealAttachment({ workspaceId: this.workspaceId, attachmentId: id, key: this.key,
      keyEpoch: this.keyEpoch, name: local.name, type: local.type, bytes: local.bytes });
    await this.assertCurrent();
    plan = await this.repository.putScopedAttachmentUpload({ scope: this.scope, attachmentId: id,
      sourceSha256: sealed.sourceSha256, keyEpoch: this.keyEpoch, objects: sealed.objects });
    await this.uploadOrAcceptWinner(plan, local, sourceSha256);
  }

  async ensureUploadedRow(row: RecordRow): Promise<void> {
    for (const id of attachmentIds(row)) await this.ensureUploaded(id);
  }

  async forgetUploadedRow(row: RecordRow): Promise<void> {
    for (const id of attachmentIds(row)) {
      await this.assertCurrent();
      await this.repository.deleteScopedAttachmentUpload(this.scope, id);
    }
  }

  async ensureDownloaded(id: string): Promise<void> {
    const manifest = await this.getObject(id);
    if (!manifest) throw Error('sync-attachment-remote-missing');
    const opened = await this.openRemote(id, manifest);
    await this.assertCurrent();
    await this.repository.putSyncedFile({ id, name: opened.name, type: opened.type,
      bytes: opened.bytes, sha256: opened.sha256 });
  }

  async ensureDownloadedRow(row: RecordRow): Promise<void> {
    for (const id of attachmentIds(row)) await this.ensureDownloaded(id);
  }
}
