import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export const readableFields = ['kind', 'name', 'category', 'tags', 'description', 'url', 'status', 'dueDate'] as const;
export const writableFields = ['name', 'category', 'tags', 'description', 'url'] as const;
export type ReadField = (typeof readableFields)[number];
export type WriteField = (typeof writableFields)[number];

export interface Grant {
  id: string;
  secretHash: string;
  assetIds: string[];
  readFields: ReadField[];
  writeFields: WriteField[];
  createdAt: number;
  expiresAt: number;
  revokedAt?: number;
}

export interface PendingPreview {
  id: string;
  grantId: string;
  operationId: string;
  assetId: string;
  expectedVersion: string;
  patchHash: string;
  expiresAt: number;
  approvedAt?: number;
}

export interface OperationReceipt {
  operationId: string;
  grantId: string;
  previewId: string;
  patchHash: string;
  assetId: string;
  state: 'pending' | 'applied';
  createdAt: number;
  completedAt?: number;
}

export interface AuditEntry {
  id: string;
  at: number;
  grantId: string;
  action: 'list' | 'get' | 'preview' | 'confirm' | 'grant' | 'revoke' | 'approve';
  outcome: 'allowed' | 'denied' | 'applied' | 'duplicate' | 'conflict';
  assetId?: string;
  fieldNames?: string[];
  operationId?: string;
}

export interface AuthorityState {
  grants: Grant[];
  previews: PendingPreview[];
  operations: OperationReceipt[];
  audit: AuditEntry[];
}

export interface AuthorityStorage {
  read(): Promise<AuthorityState>;
  // An implementation must make updates serial and durable before resolving.
  update<T>(change: (state: AuthorityState) => T | Promise<T>): Promise<T>;
}

const emptyState = (): AuthorityState => ({ grants: [], previews: [], operations: [], audit: [] });

export class MemoryAuthorityStorage implements AuthorityStorage {
  private state = emptyState();
  private queue: Promise<unknown> = Promise.resolve();
  async read() { await this.queue; return structuredClone(this.state); }
  async update<T>(change: (state: AuthorityState) => T | Promise<T>): Promise<T> {
    const work = this.queue.then(async () => {
      const draft = structuredClone(this.state);
      const result = await change(draft);
      this.state = draft;
      return result;
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
}

export class McpAccessError extends Error {
  constructor(readonly code: string) { super(code); }
}

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const secretDigest = (secret: string) => digest(`keepany-mcp-grant-v1:${secret}`);
const equalDigest = (a: string, b: string) => {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && left.length === 32 && timingSafeEqual(left, right);
};

export class McpAuthority {
  constructor(readonly storage: AuthorityStorage, private readonly now = () => Date.now()) {}

  // Trusted app/CLI only. Never expose this operation as an MCP tool.
  async issueGrant(input: { assetIds: string[]; readFields: ReadField[]; writeFields?: WriteField[]; ttlMs: number }) {
    const ids = [...new Set(input.assetIds)];
    const reads = [...new Set(input.readFields)];
    const writes = [...new Set(input.writeFields ?? [])];
    if (!ids.length || ids.length > 500 || ids.some(id => !id || id.length > 96) ||
      !reads.length || reads.some(field => !readableFields.includes(field)) ||
      writes.some(field => !writableFields.includes(field) || !reads.includes(field)) ||
      !Number.isSafeInteger(input.ttlMs) || input.ttlMs < 60_000 || input.ttlMs > 7 * 24 * 60 * 60_000) {
      throw new McpAccessError('invalid-grant');
    }
    const secret = randomBytes(32).toString('base64url');
    const at = this.now();
    const grant: Grant = { id: randomUUID(), secretHash: secretDigest(secret), assetIds: ids,
      readFields: reads, writeFields: writes, createdAt: at, expiresAt: at + input.ttlMs };
    await this.storage.update(state => {
      state.grants.push(grant);
      audit(state, { at, grantId: grant.id, action: 'grant', outcome: 'allowed' });
    });
    return { id: grant.id, secret, expiresAt: grant.expiresAt };
  }

  async revokeGrant(id: string) {
    const at = this.now();
    await this.storage.update(state => {
      const grant = state.grants.find(item => item.id === id);
      if (!grant) throw new McpAccessError('grant-not-found');
      if (grant.revokedAt === undefined) grant.revokedAt = at;
      state.previews = state.previews.filter(item => item.grantId !== id);
      audit(state, { at, grantId: id, action: 'revoke', outcome: 'allowed' });
    });
  }

  async requireGrant(id: string, secret: string): Promise<Grant> {
    const grant = (await this.storage.read()).grants.find(item => item.id === id);
    if (!grant || !equalDigest(grant.secretHash, secretDigest(secret)) || grant.revokedAt !== undefined || grant.expiresAt <= this.now()) {
      throw new McpAccessError('grant-denied');
    }
    return grant;
  }

  async record(input: Omit<AuditEntry, 'id' | 'at'>) {
    await this.storage.update(state => audit(state, { ...input, at: this.now() }));
  }

  async createPreview(preview: Omit<PendingPreview, 'id' | 'expiresAt'>) {
    const at = this.now();
    return this.storage.update(state => {
      const previous = state.previews.find(item => item.grantId === preview.grantId && item.operationId === preview.operationId);
      if (previous) {
        if (previous.patchHash !== preview.patchHash || previous.assetId !== preview.assetId || previous.expectedVersion !== preview.expectedVersion)
          throw new McpAccessError('operation-reused');
        return previous;
      }
      if (state.operations.some(item => item.grantId === preview.grantId && item.operationId === preview.operationId))
        throw new McpAccessError('operation-reused');
      const item: PendingPreview = { ...preview, id: randomUUID(), expiresAt: at + 5 * 60_000 };
      state.previews.push(item);
      audit(state, { at, grantId: preview.grantId, action: 'preview', outcome: 'allowed',
        assetId: preview.assetId, operationId: preview.operationId });
      return item;
    });
  }

  // Trusted app/CLI only. Approval is separate from the model-visible preview ID.
  async approvePreview(grantId: string, previewId: string) {
    const at = this.now();
    await this.storage.update(state => {
      const grant = state.grants.find(item => item.id === grantId);
      const preview = state.previews.find(item => item.id === previewId && item.grantId === grantId);
      if (!grant || grant.revokedAt !== undefined || grant.expiresAt <= at || !preview || preview.expiresAt <= at) throw new McpAccessError('preview-denied');
      preview.approvedAt = at;
      audit(state, { at, grantId, action: 'approve', outcome: 'allowed', assetId: preview.assetId, operationId: preview.operationId });
    });
  }

  async approvedPreview(grantId: string, previewId: string, operationId: string, assetId: string, patchHash: string) {
    const item = (await this.storage.read()).previews.find(preview => preview.id === previewId && preview.grantId === grantId &&
      preview.operationId === operationId && preview.assetId === assetId && preview.patchHash === patchHash);
    if (!item || item.approvedAt === undefined || item.expiresAt <= this.now()) throw new McpAccessError('preview-not-approved');
    return item;
  }

  async operation(grantId: string, operationId: string) {
    return (await this.storage.read()).operations.find(item => item.grantId === grantId && item.operationId === operationId);
  }

  async reserveOperation(receipt: Pick<OperationReceipt, 'grantId' | 'operationId' | 'previewId' | 'patchHash' | 'assetId'>) {
    const at = this.now();
    await this.storage.update(state => {
      const existing = state.operations.find(item => item.grantId === receipt.grantId && item.operationId === receipt.operationId);
      if (existing) throw new McpAccessError('operation-reused');
      state.operations.push({ ...receipt, state: 'pending', createdAt: at });
    });
  }

  async cancelPendingOperation(grantId: string, operationId: string) {
    await this.storage.update(state => {
      state.operations = state.operations.filter(item => !(item.grantId === grantId && item.operationId === operationId && item.state === 'pending'));
    });
  }

  async completeOperation(grantId: string, operationId: string) {
    const at = this.now();
    await this.storage.update(state => {
      const receipt = state.operations.find(item => item.grantId === grantId && item.operationId === operationId);
      if (receipt?.state !== 'pending') throw new McpAccessError('operation-not-pending');
      receipt.state = 'applied';
      receipt.completedAt = at;
      state.previews = state.previews.filter(item => item.id !== receipt.previewId);
      audit(state, { at, grantId: receipt.grantId, action: 'confirm', outcome: 'applied',
        assetId: receipt.assetId, operationId: receipt.operationId });
    });
  }

  async auditEntries(grantId: string) {
    return (await this.storage.read()).audit.filter(item => item.grantId === grantId);
  }
}

function audit(state: AuthorityState, item: Omit<AuditEntry, 'id'>) {
  state.audit.push({ ...item, id: randomUUID() });
}
